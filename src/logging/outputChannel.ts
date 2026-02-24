import * as vscode from "vscode";

export class ArcaneForgeLogger implements vscode.Disposable {
  public readonly channel: vscode.OutputChannel;

  public constructor() {
    this.channel = vscode.window.createOutputChannel("Arcane Forge");
  }

  public info(message: string): void {
    this.channel.appendLine(`${this.timestamp()} [INFO] ${message}`);
  }

  public warn(message: string): void {
    this.channel.appendLine(`${this.timestamp()} [WARN] ${message}`);
  }

  public error(message: string): void {
    this.channel.appendLine(`${this.timestamp()} [ERROR] ${message}`);
  }

  public show(preserveFocus = true): void {
    this.channel.show(preserveFocus);
  }

  public dispose(): void {
    this.channel.dispose();
  }

  private timestamp(): string {
    return new Date().toISOString();
  }
}

