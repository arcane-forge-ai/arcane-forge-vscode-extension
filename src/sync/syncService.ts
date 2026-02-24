import * as path from "node:path";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import * as vscode from "vscode";
import { ArcaneForgeClient } from "../api/arcaneForgeClient";
import { ArcaneForgeLogger } from "../logging/outputChannel";
import { sha256File } from "./fileHasher";
import { sanitizeDocumentNameToRelativePath, shouldIgnoreLocalName, toPosixRelativePath } from "./fileNaming";
import { ManifestStore } from "./manifestStore";
import type {
  AuthSession,
  ManifestEntry,
  PullResult,
  PushResult,
  RemoteKbEntry,
  SelectedProject,
  SyncManifest
} from "../types";

interface PullTarget {
  entry: RemoteKbEntry;
  relativePath: string;
}

interface ScannedLocalFile {
  absolutePath: string;
  relativePath: string;
  sha256: string;
}

export interface SyncExecutionContext {
  session: AuthSession;
  project: SelectedProject;
  kbRootPath: string;
  manifestPath: string;
  progress?: vscode.Progress<{ message?: string; increment?: number }>;
  cancellationToken?: vscode.CancellationToken;
}

export class SyncService {
  public constructor(
    private readonly client: ArcaneForgeClient,
    private readonly manifestStore: ManifestStore,
    private readonly logger: ArcaneForgeLogger
  ) {}

  public async pullKnowledgeBase(ctx: SyncExecutionContext): Promise<PullResult> {
    this.throwIfCancelled(ctx.cancellationToken);
    await mkdir(ctx.kbRootPath, { recursive: true });

    const remoteEntries = await this.client.listProjectFiles(ctx.session, ctx.project.projectId);
    const documentEntries = remoteEntries.filter((entry) => entry.entryType === "document");
    const activeByDocument = resolveActiveEntries(documentEntries);
    const activeEntries = Array.from(activeByDocument.values());

    const { targets, skippedCollision } = resolvePullTargets(activeEntries);
    const result: PullResult = {
      downloaded: [],
      skippedNoStorage: [],
      skippedCollision,
      failed: []
    };

    let manifest = await this.loadOrCreateManifestForProject(ctx);
    let processed = 0;

    for (const target of targets) {
      this.throwIfCancelled(ctx.cancellationToken);
      processed += 1;
      ctx.progress?.report({ message: `Downloading ${target.entry.documentName} (${processed}/${targets.length})` });

      if (!target.entry.hasStorage) {
        result.skippedNoStorage.push(target.entry.documentName);
        this.logger.warn(`Skipping ${target.entry.documentName}: no storage backing detected.`);
        continue;
      }

      try {
        const download = await this.client.getProjectFileDownloadUrl(
          ctx.session,
          ctx.project.projectId,
          target.entry.id
        );
        const bytes = await this.client.downloadFromSignedUrl(download.download_url);
        const localPath = path.join(ctx.kbRootPath, ...target.relativePath.split("/"));
        await mkdir(path.dirname(localPath), { recursive: true });
        await writeFile(localPath, bytes);
        const sha256 = await sha256File(localPath);

        manifest.entries[target.relativePath] = this.mergeManifestEntry(manifest.entries[target.relativePath], {
          relativePath: target.relativePath,
          documentName: target.entry.documentName,
          remoteFileId: target.entry.id,
          remoteCreatedAt: target.entry.createdAt,
          remoteAuthorityLevel: target.entry.authorityLevel ?? undefined,
          localSha256: sha256,
          lastPulledSha256: sha256,
          lastDownloadedAt: new Date().toISOString()
        });

        result.downloaded.push(target.relativePath);
      } catch (error) {
        const message = errorToMessage(error);
        result.failed.push({ documentName: target.entry.documentName, reason: message });
        this.logger.error(`Failed to download ${target.entry.documentName}: ${message}`);
      }
    }

    manifest.lastPullAt = new Date().toISOString();
    manifest.projectId = ctx.project.projectId;
    manifest.projectName = ctx.project.projectName;
    await this.manifestStore.save(ctx.manifestPath, manifest);
    return result;
  }

  public async pushKnowledgeBase(ctx: SyncExecutionContext): Promise<PushResult> {
    this.throwIfCancelled(ctx.cancellationToken);
    const manifest = await this.loadOrCreateManifestForProject(ctx);
    const scannedFiles = await this.scanLocalFiles(ctx.kbRootPath, ctx.cancellationToken);
    const nowIso = new Date().toISOString();

    for (const scanned of scannedFiles.values()) {
      const existing = manifest.entries[scanned.relativePath];
      manifest.entries[scanned.relativePath] = this.mergeManifestEntry(existing, {
        relativePath: scanned.relativePath,
        documentName: existing?.documentName ?? scanned.relativePath,
        localSha256: scanned.sha256
      });
    }

    const result: PushResult = {
      uploaded: [],
      skippedUnchanged: [],
      skippedConflicts: [],
      failed: []
    };

    const changedFiles: ScannedLocalFile[] = [];
    for (const scanned of scannedFiles.values()) {
      const manifestEntry = manifest.entries[scanned.relativePath];
      const baseline = manifestEntry?.lastUploadedSha256 ?? manifestEntry?.lastPulledSha256;
      if (baseline && baseline === scanned.sha256) {
        result.skippedUnchanged.push(scanned.relativePath);
      } else {
        changedFiles.push(scanned);
      }
    }

    this.logger.info(`Push scan found ${scannedFiles.size} files (${changedFiles.length} changed/new).`);
    if (changedFiles.length === 0) {
      manifest.lastPushAt = nowIso;
      await this.manifestStore.save(ctx.manifestPath, manifest);
      return result;
    }

    const remoteBefore = await this.client.listProjectFiles(ctx.session, ctx.project.projectId);
    const activeRemoteBefore = resolveActiveEntries(remoteBefore.filter((entry) => entry.entryType === "document"));

    const uploadQueue: Array<{ file: ScannedLocalFile; documentName: string }> = [];
    for (const localFile of changedFiles) {
      const manifestEntry = manifest.entries[localFile.relativePath];
      const documentName = manifestEntry?.documentName ?? localFile.relativePath;
      const activeRemote = activeRemoteBefore.get(documentName);

      if (
        manifestEntry?.remoteFileId !== undefined &&
        activeRemote &&
        activeRemote.id !== manifestEntry.remoteFileId
      ) {
        result.skippedConflicts.push(localFile.relativePath);
        this.logger.warn(
          `Conflict for ${localFile.relativePath}: remote active entry changed (${manifestEntry.remoteFileId} -> ${activeRemote.id}).`
        );
        continue;
      }

      uploadQueue.push({ file: localFile, documentName });
    }

    let uploadedCount = 0;
    for (const item of uploadQueue) {
      this.throwIfCancelled(ctx.cancellationToken);
      uploadedCount += 1;
      ctx.progress?.report({
        message: `Uploading ${item.file.relativePath} (${uploadedCount}/${uploadQueue.length})`
      });

      try {
        await this.client.uploadProjectFile(
          ctx.session,
          ctx.project.projectId,
          item.file.absolutePath,
          item.documentName
        );
        result.uploaded.push(item.file.relativePath);
      } catch (error) {
        const message = errorToMessage(error);
        result.failed.push({ path: item.file.relativePath, reason: message });
        this.logger.error(`Failed to upload ${item.file.relativePath}: ${message}`);
      }
    }

    const remoteAfter = await this.client.listProjectFiles(ctx.session, ctx.project.projectId);
    const activeRemoteAfter = resolveActiveEntries(remoteAfter.filter((entry) => entry.entryType === "document"));

    for (const relativePath of result.uploaded) {
      const scanned = scannedFiles.get(relativePath);
      if (!scanned) {
        continue;
      }
      const current = manifest.entries[relativePath];
      const documentName = current?.documentName ?? relativePath;
      const remote = activeRemoteAfter.get(documentName);
      manifest.entries[relativePath] = this.mergeManifestEntry(current, {
        relativePath,
        documentName,
        remoteFileId: remote?.id,
        remoteCreatedAt: remote?.createdAt,
        remoteAuthorityLevel: remote?.authorityLevel ?? undefined,
        localSha256: scanned.sha256,
        lastUploadedSha256: scanned.sha256,
        lastUploadedAt: nowIso
      });
    }

    manifest.lastPushAt = nowIso;
    manifest.projectId = ctx.project.projectId;
    manifest.projectName = ctx.project.projectName;
    await this.manifestStore.save(ctx.manifestPath, manifest);
    return result;
  }

  public async loadManifest(manifestPath: string): Promise<SyncManifest | undefined> {
    return this.manifestStore.load(manifestPath);
  }

  private async loadOrCreateManifestForProject(ctx: SyncExecutionContext): Promise<SyncManifest> {
    const existing = await this.manifestStore.load(ctx.manifestPath);
    if (!existing || existing.projectId !== ctx.project.projectId) {
      if (existing && existing.projectId !== ctx.project.projectId) {
        this.logger.warn(
          `Resetting sync manifest because selected project changed (${existing.projectId} -> ${ctx.project.projectId}).`
        );
      }
      return this.manifestStore.createEmpty(ctx.project.projectId, ctx.project.projectName);
    }
    existing.projectName = ctx.project.projectName;
    return existing;
  }

  private async scanLocalFiles(
    kbRootPath: string,
    cancellationToken?: vscode.CancellationToken
  ): Promise<Map<string, ScannedLocalFile>> {
    const results = new Map<string, ScannedLocalFile>();

    try {
      await stat(kbRootPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return results;
      }
      throw error;
    }

    await this.walkDirectory(kbRootPath, "", results, cancellationToken);
    return results;
  }

  private async walkDirectory(
    rootPath: string,
    currentRelative: string,
    output: Map<string, ScannedLocalFile>,
    cancellationToken?: vscode.CancellationToken
  ): Promise<void> {
    this.throwIfCancelled(cancellationToken);
    const absoluteDir = currentRelative ? path.join(rootPath, ...currentRelative.split("/")) : rootPath;
    const entries = await readdir(absoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      this.throwIfCancelled(cancellationToken);
      if (shouldIgnoreLocalName(entry.name)) {
        continue;
      }

      const childRelative = currentRelative ? `${currentRelative}/${entry.name}` : entry.name;
      if (childRelative === ".arcane-forge" || childRelative.startsWith(".arcane-forge/")) {
        continue;
      }

      const childAbsolute = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        await this.walkDirectory(rootPath, childRelative, output, cancellationToken);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = toPosixRelativePath(childRelative);
      const sha256 = await sha256File(childAbsolute);
      output.set(relativePath, {
        absolutePath: childAbsolute,
        relativePath,
        sha256
      });
    }
  }

  private mergeManifestEntry(existing: ManifestEntry | undefined, patch: Partial<ManifestEntry>): ManifestEntry {
    return {
      relativePath: patch.relativePath ?? existing?.relativePath ?? "",
      documentName: patch.documentName ?? existing?.documentName ?? patch.relativePath ?? "",
      remoteFileId: patch.remoteFileId ?? existing?.remoteFileId,
      remoteCreatedAt: patch.remoteCreatedAt ?? existing?.remoteCreatedAt,
      remoteAuthorityLevel: patch.remoteAuthorityLevel ?? existing?.remoteAuthorityLevel,
      localSha256: patch.localSha256 ?? existing?.localSha256,
      lastPulledSha256: patch.lastPulledSha256 ?? existing?.lastPulledSha256,
      lastUploadedSha256: patch.lastUploadedSha256 ?? existing?.lastUploadedSha256,
      lastDownloadedAt: patch.lastDownloadedAt ?? existing?.lastDownloadedAt,
      lastUploadedAt: patch.lastUploadedAt ?? existing?.lastUploadedAt
    };
  }

  private throwIfCancelled(token?: vscode.CancellationToken): void {
    if (token?.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
  }
}

export function resolveActiveEntries(entries: RemoteKbEntry[]): Map<string, RemoteKbEntry> {
  const grouped = new Map<string, RemoteKbEntry[]>();
  for (const entry of entries) {
    const key = entry.documentName;
    const list = grouped.get(key);
    if (list) {
      list.push(entry);
    } else {
      grouped.set(key, [entry]);
    }
  }

  const active = new Map<string, RemoteKbEntry>();
  for (const [documentName, group] of grouped.entries()) {
    const nonDeprecated = group.filter((entry) => entry.authorityLevel !== "deprecated");
    const candidates = nonDeprecated.length > 0 ? nonDeprecated : group;
    const first = candidates[0];
    if (!first) {
      continue;
    }
    let winner = first;
    for (let i = 1; i < candidates.length; i += 1) {
      if (compareEntryRecency(candidates[i], winner) > 0) {
        winner = candidates[i];
      }
    }
    active.set(documentName, winner);
  }
  return active;
}

function resolvePullTargets(entries: RemoteKbEntry[]): { targets: PullTarget[]; skippedCollision: string[] } {
  const byLocalPath = new Map<string, PullTarget>();
  const skippedCollision: string[] = [];

  for (const entry of entries) {
    const relativePath = sanitizeDocumentNameToRelativePath(entry.documentName, entry.id);
    const candidate: PullTarget = { entry, relativePath };
    const existing = byLocalPath.get(relativePath);
    if (!existing) {
      byLocalPath.set(relativePath, candidate);
      continue;
    }

    if (compareEntryRecency(candidate.entry, existing.entry) > 0) {
      skippedCollision.push(existing.entry.documentName);
      byLocalPath.set(relativePath, candidate);
    } else {
      skippedCollision.push(candidate.entry.documentName);
    }
  }

  const targets = Array.from(byLocalPath.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { targets, skippedCollision };
}

export function compareEntryRecency(a: RemoteKbEntry, b: RemoteKbEntry): number {
  const dateDelta = parseDateMillis(a.createdAt) - parseDateMillis(b.createdAt);
  if (dateDelta !== 0) {
    return dateDelta;
  }
  return a.id - b.id;
}

function parseDateMillis(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
