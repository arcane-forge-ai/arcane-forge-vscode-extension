import * as vscode from "vscode";
import type { ProjectSummary, SelectedProject } from "../types";

const PROJECT_STATE_KEY_PREFIX = "arcaneForge.selectedProject";

export class ProjectService {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async getSelectedProject(
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<SelectedProject | undefined> {
    return this.context.workspaceState.get<SelectedProject>(this.keyForWorkspace(workspaceFolder));
  }

  public async setSelectedProject(
    workspaceFolder: vscode.WorkspaceFolder,
    project: ProjectSummary
  ): Promise<SelectedProject> {
    const selected: SelectedProject = {
      projectId: project.id,
      projectName: project.name,
      workspaceFolderUri: workspaceFolder.uri.toString()
    };
    await this.context.workspaceState.update(this.keyForWorkspace(workspaceFolder), selected);
    return selected;
  }

  public async clearSelectedProject(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    await this.context.workspaceState.update(this.keyForWorkspace(workspaceFolder), undefined);
  }

  public async promptAndSelectProject(
    workspaceFolder: vscode.WorkspaceFolder,
    projects: ProjectSummary[]
  ): Promise<SelectedProject | undefined> {
    if (projects.length === 0) {
      vscode.window.showWarningMessage("No Arcane Forge projects were found for this account.");
      return undefined;
    }

    const pick = await vscode.window.showQuickPick(
      projects.map((project) => ({
        label: project.name,
        description: `Project #${project.id}`,
        detail: project.description,
        project
      })),
      {
        title: "Select Arcane Forge Project",
        placeHolder: "Choose the project to sync with this workspace"
      }
    );

    if (!pick) {
      return undefined;
    }

    return this.setSelectedProject(workspaceFolder, pick.project);
  }

  private keyForWorkspace(workspaceFolder: vscode.WorkspaceFolder): string {
    return `${PROJECT_STATE_KEY_PREFIX}:${workspaceFolder.uri.toString()}`;
  }
}

