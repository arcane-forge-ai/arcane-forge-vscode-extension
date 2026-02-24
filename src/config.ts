import * as path from "node:path";
import * as vscode from "vscode";

export const EXTENSION_NAMESPACE = "arcaneForge";
export const DEFAULT_KB_DIRECTORY = "game_knowledge_base";
export const DEFAULT_API_BASE_URL = "https://arcane-forge-service.dev.arcaneforge.ai";
export const DEFAULT_WEB_BASE_URL = "https://arcaneforge.ai";

export function getExtensionConfig(workspaceFolder?: vscode.WorkspaceFolder): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(EXTENSION_NAMESPACE, workspaceFolder);
}

export function getKbDirectory(workspaceFolder?: vscode.WorkspaceFolder): string {
  const raw = getExtensionConfig(workspaceFolder).get<string>("kbDirectory", DEFAULT_KB_DIRECTORY).trim();
  return raw.length > 0 ? raw : DEFAULT_KB_DIRECTORY;
}

export function getApiBaseUrl(workspaceFolder?: vscode.WorkspaceFolder): string {
  const raw = getExtensionConfig(workspaceFolder).get<string>("apiBaseUrl", DEFAULT_API_BASE_URL).trim();
  return (raw.length > 0 ? raw : DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export function getWebBaseUrl(workspaceFolder?: vscode.WorkspaceFolder): string {
  const raw = getExtensionConfig(workspaceFolder).get<string>("webBaseUrl", DEFAULT_WEB_BASE_URL).trim();
  return (raw.length > 0 ? raw : DEFAULT_WEB_BASE_URL).replace(/\/+$/, "");
}

export function getPreferredWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const folder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (folder) {
      return folder;
    }
  }
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0] : undefined;
}

export function requireWorkspaceFolder(): vscode.WorkspaceFolder {
  const folder = getPreferredWorkspaceFolder();
  if (!folder) {
    throw new Error("Arcane Forge commands require an open workspace folder.");
  }
  return folder;
}

export function getKbRootPath(workspaceFolder: vscode.WorkspaceFolder): string {
  const kbDirectory = getKbDirectory(workspaceFolder);
  return path.resolve(workspaceFolder.uri.fsPath, kbDirectory);
}

export function getManifestPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.resolve(workspaceFolder.uri.fsPath, ".arcane-forge", "sync-manifest.json");
}
