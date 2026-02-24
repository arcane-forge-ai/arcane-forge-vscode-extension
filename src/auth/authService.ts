import * as vscode from "vscode";
import type { AuthSession } from "../types";

const SECRET_KEY = "arcaneForge.authToken";

export class AuthService {
  private cachedSession: AuthSession | null | undefined;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async getSession(): Promise<AuthSession | undefined> {
    if (this.cachedSession !== undefined) {
      return this.cachedSession ?? undefined;
    }

    const token = await this.context.secrets.get(SECRET_KEY);
    if (!token) {
      this.cachedSession = null;
      return undefined;
    }

    try {
      const session = this.createSessionFromToken(token, new Date().toISOString());
      this.cachedSession = session;
      return session;
    } catch {
      this.cachedSession = null;
      return undefined;
    }
  }

  public async requireSession(): Promise<AuthSession> {
    const session = await this.getSession();
    if (!session) {
      throw new Error("Not logged in. Run 'Arcane Forge: Login' first.");
    }
    return session;
  }

  public previewSessionFromToken(token: string): AuthSession {
    return this.createSessionFromToken(token, new Date().toISOString());
  }

  public async saveToken(token: string): Promise<AuthSession> {
    const session = this.createSessionFromToken(token, new Date().toISOString());
    await this.context.secrets.store(SECRET_KEY, session.token);
    this.cachedSession = session;
    return session;
  }

  public async logout(): Promise<void> {
    await this.context.secrets.delete(SECRET_KEY);
    this.cachedSession = null;
  }

  private createSessionFromToken(rawToken: string, validatedAt: string): AuthSession {
    const token = rawToken.trim();
    if (!token) {
      throw new Error("JWT token cannot be empty.");
    }
    const claims = decodeJwtPayload(token);
    const sub = typeof claims.sub === "string" && claims.sub.length > 0 ? claims.sub : undefined;
    return {
      token,
      userId: sub,
      validatedAt
    };
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format.");
  }

  const payload = parts[1];
  const jsonText = Buffer.from(base64UrlToBase64(payload), "base64").toString("utf8");
  const parsed = JSON.parse(jsonText);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("JWT payload is not an object.");
  }
  return parsed as Record<string, unknown>;
}

function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  if (padding === 0) {
    return normalized;
  }
  return normalized + "=".repeat(4 - padding);
}

