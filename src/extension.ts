import * as vscode from "vscode";
import { ArcaneForgeApiError, ArcaneForgeClient } from "./api/arcaneForgeClient";
import { AuthService } from "./auth/authService";
import { BrowserLoginHandler } from "./auth/browserLoginHandler";
import {
  getApiBaseUrl,
  getKbDirectory,
  getKbRootPath,
  getManifestPath,
  getPreferredWorkspaceFolder,
  getWebBaseUrl,
  requireWorkspaceFolder
} from "./config";
import { ArcaneForgeLogger } from "./logging/outputChannel";
import { ProjectService } from "./projects/projectService";
import { ManifestStore } from "./sync/manifestStore";
import { SyncService } from "./sync/syncService";
import type { AuthSession, SelectedProject } from "./types";

export function activate(context: vscode.ExtensionContext): void {
  const logger = new ArcaneForgeLogger();
  const authService = new AuthService(context);
  const browserLoginHandler = new BrowserLoginHandler(context.extension.id, logger);
  const projectService = new ProjectService(context);
  const manifestStore = new ManifestStore();

  context.subscriptions.push(logger);
  context.subscriptions.push(browserLoginHandler);
  context.subscriptions.push(vscode.window.registerUriHandler(browserLoginHandler));

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "arcaneForge.selectProject";
  context.subscriptions.push(statusBar);

  const createClient = (workspaceFolder?: vscode.WorkspaceFolder): ArcaneForgeClient =>
    new ArcaneForgeClient(getApiBaseUrl(workspaceFolder), logger);

  const refreshStatusBar = async (): Promise<void> => {
    const workspaceFolder = getPreferredWorkspaceFolder();
    const session = await authService.getSession();
    const selectedProject = workspaceFolder ? await projectService.getSelectedProject(workspaceFolder) : undefined;

    statusBar.text = selectedProject
      ? `$(cloud) Arcane Forge: ${selectedProject.projectName}`
      : "$(cloud) Arcane Forge: No Project";
    statusBar.tooltip = session
      ? `Logged in${session.userId ? ` as ${session.userId}` : ""}${workspaceFolder ? "" : " (no workspace selected)"}`
      : "Not logged in";
    statusBar.show();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("arcaneForge")) {
        void refreshStatusBar();
      }
    })
  );
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => void refreshStatusBar()));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshStatusBar()));

  const register = (command: string, handler: () => Promise<void>) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        try {
          await handler();
          await refreshStatusBar();
        } catch (error) {
          await handleCommandError(error, logger);
        }
      })
    );
  };

  register("arcaneForge.login", async () => {
    const workspaceFolder = getPreferredWorkspaceFolder();
    const webBaseUrl = getWebBaseUrl(workspaceFolder);
    const client = createClient(workspaceFolder);

    const loginAttempt = await browserLoginHandler.startLogin();
    const loginUrl = buildBrowserLoginUrl(webBaseUrl, loginAttempt.callbackUri.toString(true), loginAttempt.state);

    logger.info(`Starting browser login via ${loginUrl}`);
    const opened = await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
    if (!opened) {
      browserLoginHandler.cancelPending("Could not open browser for login.");
      throw new Error("Could not open browser for Arcane Forge login.");
    }

    void vscode.window.showInformationMessage(
      "Complete Arcane Forge login in your browser. The extension is waiting for the browser callback."
    );

    let token: string;
    try {
      const result = await loginAttempt.awaitResult();
      token = result.accessToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = await vscode.window.showWarningMessage(
        `Browser login did not complete: ${message}`,
        "Use Developer Token",
        "Retry Later"
      );
      if (fallback === "Use Developer Token") {
        await runManualTokenLogin(authService, client, logger);
        return;
      }
      throw error;
    }

    const previewSession = authService.previewSessionFromToken(token);
    await client.validateAuth(previewSession);
    await authService.saveToken(token);

    logger.info("Browser login successful.");
    vscode.window.showInformationMessage("Arcane Forge login successful.");
  });

  register("arcaneForge.logout", async () => {
    await authService.logout();
    logger.info("Logged out.");
    vscode.window.showInformationMessage("Arcane Forge logout complete.");
  });

  register("arcaneForge.selectProject", async () => {
    const workspaceFolder = requireWorkspaceFolder();
    const session = await authService.requireSession();
    const client = createClient(workspaceFolder);
    const projects = await client.listProjects(session);
    const selected = await projectService.promptAndSelectProject(workspaceFolder, projects);
    if (!selected) {
      return;
    }
    logger.info(`Selected project ${selected.projectName} (#${selected.projectId}) for ${workspaceFolder.name}.`);
    vscode.window.showInformationMessage(`Arcane Forge project selected: ${selected.projectName}`);
  });

  register("arcaneForge.pullKnowledgeBase", async () => {
    const workspaceFolder = requireWorkspaceFolder();
    const session = await authService.requireSession();
    const client = createClient(workspaceFolder);
    const project = await requireSelectedProject(projectService, workspaceFolder, client, session);
    const syncService = new SyncService(client, manifestStore, logger);

    const kbRootPath = getKbRootPath(workspaceFolder);
    const manifestPath = getManifestPath(workspaceFolder);

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Arcane Forge: Pull Knowledge Base",
        cancellable: true
      },
      (progress, cancellationToken) =>
        syncService.pullKnowledgeBase({
          session,
          project,
          kbRootPath,
          manifestPath,
          progress,
          cancellationToken
        })
    );

    logger.info(
      `Pull complete. Downloaded=${result.downloaded.length}, collisions=${result.skippedCollision.length}, failed=${result.failed.length}.`
    );
    if (result.skippedCollision.length > 0) {
      logger.warn(`Sanitized path collisions skipped (older uploads): ${result.skippedCollision.join(", ")}`);
    }
    if (result.failed.length > 0) {
      logger.warn(`Pull failures: ${result.failed.map((f) => `${f.documentName}: ${f.reason}`).join(" | ")}`);
      logger.show(true);
    }

    const message = `Pulled ${result.downloaded.length} file(s) into ${getKbDirectory(workspaceFolder)}. Local deletions do not affect the knowledge base.`;
    vscode.window.showInformationMessage(message);
  });

  register("arcaneForge.pushKnowledgeBase", async () => {
    const workspaceFolder = requireWorkspaceFolder();
    const session = await authService.requireSession();
    const client = createClient(workspaceFolder);
    const project = await requireSelectedProject(projectService, workspaceFolder, client, session);
    const syncService = new SyncService(client, manifestStore, logger);

    const kbRootPath = getKbRootPath(workspaceFolder);
    const manifestPath = getManifestPath(workspaceFolder);

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Arcane Forge: Push Knowledge Base",
        cancellable: true
      },
      (progress, cancellationToken) =>
        syncService.pushKnowledgeBase({
          session,
          project,
          kbRootPath,
          manifestPath,
          progress,
          cancellationToken
        })
    );

    logger.info(
      `Push complete. Uploaded=${result.uploaded.length}, unchanged=${result.skippedUnchanged.length}, conflicts=${result.skippedConflicts.length}, failed=${result.failed.length}.`
    );
    if (result.skippedConflicts.length > 0) {
      logger.warn(`Push conflicts skipped: ${result.skippedConflicts.join(", ")}`);
      logger.show(true);
    }
    if (result.failed.length > 0) {
      logger.warn(`Push failures: ${result.failed.map((f) => `${f.path}: ${f.reason}`).join(" | ")}`);
      logger.show(true);
    }

    const message = `Pushed ${result.uploaded.length} changed file(s). Local deletions do not delete KB entries.`;
    vscode.window.showInformationMessage(message);
  });

  register("arcaneForge.showSyncStatus", async () => {
    const workspaceFolder = getPreferredWorkspaceFolder();
    const session = await authService.getSession();
    const selectedProject = workspaceFolder ? await projectService.getSelectedProject(workspaceFolder) : undefined;
    const manifestPath = workspaceFolder ? getManifestPath(workspaceFolder) : undefined;
    const syncService = workspaceFolder ? new SyncService(createClient(workspaceFolder), manifestStore, logger) : undefined;
    const manifest = manifestPath && syncService ? await syncService.loadManifest(manifestPath) : undefined;

    const lines = [
      `Logged in: ${session ? "yes" : "no"}`,
      `Workspace: ${workspaceFolder ? workspaceFolder.uri.fsPath : "(none)"}`,
      `Project: ${selectedProject ? `${selectedProject.projectName} (#${selectedProject.projectId})` : "(none)"}`,
      `KB Directory: ${workspaceFolder ? getKbRootPath(workspaceFolder) : "(n/a)"}`,
      `Manifest: ${manifestPath ?? "(n/a)"}`,
      `Manifest Project: ${manifest ? `${manifest.projectName} (#${manifest.projectId})` : "(none)"}`,
      `Tracked Files: ${manifest ? Object.keys(manifest.entries).length : 0}`,
      `Last Pull: ${manifest?.lastPullAt ?? "(never)"}`,
      `Last Push: ${manifest?.lastPushAt ?? "(never)"}`
    ];

    logger.info("Sync status requested.");
    for (const line of lines) {
      logger.info(line);
    }
    logger.show();
    vscode.window.showInformationMessage("Arcane Forge sync status written to the output panel.");
  });

  void refreshStatusBar();
}

export function deactivate(): void {}

async function requireSelectedProject(
  projectService: ProjectService,
  workspaceFolder: vscode.WorkspaceFolder,
  client: ArcaneForgeClient,
  session: AuthSession
): Promise<SelectedProject> {
  const existing = await projectService.getSelectedProject(workspaceFolder);
  if (existing) {
    return existing;
  }

  const projects = await client.listProjects(session);
  const selected = await projectService.promptAndSelectProject(workspaceFolder, projects);
  if (!selected) {
    throw new Error("No Arcane Forge project selected.");
  }
  return selected;
}

async function runManualTokenLogin(
  authService: AuthService,
  client: ArcaneForgeClient,
  logger: ArcaneForgeLogger
): Promise<void> {
  const token = await vscode.window.showInputBox({
    title: "Arcane Forge Developer Token Login",
    prompt: "Paste your Arcane Forge JWT token (developer fallback)",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim().length > 0 ? undefined : "Token is required")
  });

  if (!token) {
    return;
  }

  const previewSession = authService.previewSessionFromToken(token);
  await client.validateAuth(previewSession);
  await authService.saveToken(token);
  logger.info("Developer token login successful.");
  vscode.window.showInformationMessage("Arcane Forge login successful (developer token).");
}

function buildBrowserLoginUrl(webBaseUrl: string, callbackUri: string, state: string): string {
  const loginUrl = new URL("/login", webBaseUrl);
  const nextPath = "/auth/ide-complete";
  loginUrl.searchParams.set("next", nextPath);
  loginUrl.searchParams.set("ext_callback", callbackUri);
  loginUrl.searchParams.set("state", state);
  return loginUrl.toString();
}

async function handleCommandError(error: unknown, logger: ArcaneForgeLogger): Promise<void> {
  if (error instanceof vscode.CancellationError) {
    logger.warn("Operation cancelled.");
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ArcaneForgeApiError && error.status === 401) {
    logger.error(`Authentication error: ${message}`);
    logger.show(true);
    vscode.window.showErrorMessage("Arcane Forge authentication failed (401). Please run 'Arcane Forge: Login' again.");
    return;
  }

  logger.error(message);
  if (error instanceof Error && error.stack) {
    logger.error(error.stack);
  }
  logger.show(true);
  vscode.window.showErrorMessage(`Arcane Forge: ${message}`);
}
