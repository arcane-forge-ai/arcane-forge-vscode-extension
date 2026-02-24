import * as path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { SyncManifest } from "../types";

export class ManifestStore {
  public async load(manifestPath: string): Promise<SyncManifest | undefined> {
    try {
      const raw = await readFile(manifestPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SyncManifest>;
      if (!parsed || parsed.version !== 1 || typeof parsed.projectId !== "number" || typeof parsed.projectName !== "string") {
        return undefined;
      }
      return {
        version: 1,
        projectId: parsed.projectId,
        projectName: parsed.projectName,
        lastPullAt: typeof parsed.lastPullAt === "string" ? parsed.lastPullAt : undefined,
        lastPushAt: typeof parsed.lastPushAt === "string" ? parsed.lastPushAt : undefined,
        entries: typeof parsed.entries === "object" && parsed.entries ? parsed.entries : {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  public async save(manifestPath: string, manifest: SyncManifest): Promise<void> {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    const tempPath = `${manifestPath}.tmp`;
    const json = JSON.stringify(manifest, null, 2);
    await writeFile(tempPath, `${json}\n`, "utf8");
    await rename(tempPath, manifestPath);
  }

  public createEmpty(projectId: number, projectName: string): SyncManifest {
    return {
      version: 1,
      projectId,
      projectName,
      entries: {}
    };
  }
}

