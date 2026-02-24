import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { ArcaneForgeLogger } from "../logging/outputChannel";

interface PendingLogin {
  state: string;
  resolve: (result: BrowserLoginResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface BrowserLoginStartResult {
  state: string;
  callbackUri: vscode.Uri;
  awaitResult: () => Promise<BrowserLoginResult>;
}

export interface BrowserLoginResult {
  accessToken: string;
  refreshToken?: string;
}

export class BrowserLoginHandler implements vscode.UriHandler, vscode.Disposable {
  private pending: PendingLogin | undefined;
  private readonly onDidReceiveAuthUriEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidReceiveAuthUri = this.onDidReceiveAuthUriEmitter.event;

  public constructor(
    private readonly extensionId: string,
    private readonly logger: ArcaneForgeLogger
  ) {}

  public async startLogin(timeoutMs = 5 * 60 * 1000): Promise<BrowserLoginStartResult> {
    if (this.pending) {
      throw new Error("A browser login is already in progress.");
    }

    const state = randomUUID();
    const callbackInternal = vscode.Uri.parse(`${vscode.env.uriScheme}://${this.extensionId}/auth/callback`);
    const callbackUri = await vscode.env.asExternalUri(callbackInternal);

    let settled = false;
    let resolvePending!: (result: BrowserLoginResult) => void;
    let rejectPending!: (error: Error) => void;
    const resultPromise = new Promise<BrowserLoginResult>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      this.pending = undefined;
      rejectPending(new Error("Browser login timed out. Please try again."));
    }, timeoutMs);

    this.pending = {
      state,
      resolve: (result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.pending = undefined;
        resolvePending(result);
      },
      reject: (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.pending = undefined;
        rejectPending(error);
      },
      timeout
    };

    const awaitResult = () => resultPromise;

    return {
      state,
      callbackUri,
      awaitResult
    };
  }

  public handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
    this.logger.info(`Received auth callback URI: ${uri.toString(true)}`);
    this.onDidReceiveAuthUriEmitter.fire(uri);

    const pending = this.pending;
    if (!pending) {
      this.logger.warn("Ignoring auth callback because no login is pending.");
      return;
    }

    const params = new URLSearchParams(uri.query);
    const error = params.get("error");
    if (error) {
      const description = params.get("error_description") ?? params.get("message") ?? "Unknown auth error";
      pending.reject(new Error(`Browser login failed: ${error} (${description})`));
      return;
    }

    const callbackState = params.get("state");
    if (!callbackState || callbackState !== pending.state) {
      pending.reject(new Error("Browser login callback state mismatch."));
      return;
    }

    const accessToken = params.get("access_token") ?? params.get("token") ?? params.get("jwt");
    if (!accessToken) {
      pending.reject(new Error("Browser login callback did not include an access token."));
      return;
    }

    const refreshToken = params.get("refresh_token") ?? undefined;
    pending.resolve({ accessToken, refreshToken });
  }

  public cancelPending(reason = "Browser login was cancelled."): void {
    if (!this.pending) {
      return;
    }
    clearTimeout(this.pending.timeout);
    this.pending.reject(new Error(reason));
  }

  public dispose(): void {
    this.cancelPending("Browser login handler disposed.");
    this.onDidReceiveAuthUriEmitter.dispose();
  }
}
