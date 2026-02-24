import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { ArcaneForgeLogger } from "../logging/outputChannel";
import type { AuthSession, ProjectSummary, RemoteKbEntry } from "../types";

interface ApiProjectResponse {
  id: number;
  name: string;
  description?: string;
  updated_at?: string | null;
}

interface ApiFileInfo {
  id: number;
  document_name: string;
  file_type: string;
  created_at: string;
  original_file_size?: number | null;
  content_type?: string | null;
  download_url?: string | null;
  has_storage?: boolean;
  entry_type?: string;
  authority_level?: string;
  storage_file_key?: string | null;
  storage_public_url?: string | null;
}

interface ApiFileListResponse {
  files: ApiFileInfo[];
}

interface ApiFileDownloadResponse {
  download_url: string;
  file_name: string;
  file_size?: number | null;
  content_type?: string | null;
  expires_in?: number;
}

interface ApiFileUploadResponse {
  message: string;
  file_name: string;
  success?: boolean;
  file_id?: number | null;
  file_size?: number | null;
  content_type?: string | null;
  has_storage?: boolean;
}

export class ArcaneForgeApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ArcaneForgeApiError";
  }
}

export class ArcaneForgeClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly logger: ArcaneForgeLogger
  ) {}

  public async validateAuth(session: AuthSession): Promise<void> {
    await this.listProjects(session);
  }

  public async listProjects(session: AuthSession): Promise<ProjectSummary[]> {
    const url = `${this.baseUrl}/api/v1/projects`;
    const response = await this.fetchWithAuth(url, session, { method: "GET" });
    const payload = (await this.parseJsonResponse<ApiProjectResponse[]>(response, url)) ?? [];
    return payload.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      updatedAt: project.updated_at ?? null
    }));
  }

  public async listProjectFiles(session: AuthSession, projectId: number): Promise<RemoteKbEntry[]> {
    const url = `${this.baseUrl}/api/v1/projects/${projectId}/files`;
    const response = await this.fetchWithAuth(url, session, { method: "GET" });
    const payload = await this.parseJsonResponse<ApiFileListResponse>(response, url);
    const files = Array.isArray(payload?.files) ? payload.files : [];

    return files.map((file) => ({
      id: file.id,
      documentName: file.document_name,
      fileType: file.file_type,
      entryType: file.entry_type ?? "document",
      authorityLevel: file.authority_level ?? "reference",
      createdAt: file.created_at,
      hasStorage: Boolean(
        file.has_storage ?? file.storage_file_key ?? file.storage_public_url ?? file.download_url
      ),
      contentType: file.content_type ?? null,
      originalFileSize: file.original_file_size ?? null
    }));
  }

  public async getProjectFileDownloadUrl(
    session: AuthSession,
    projectId: number,
    fileId: number
  ): Promise<ApiFileDownloadResponse> {
    const url = `${this.baseUrl}/api/v1/projects/${projectId}/files/${fileId}/download`;
    const response = await this.fetchWithAuth(url, session, { method: "GET" });
    const payload = await this.parseJsonResponse<ApiFileDownloadResponse>(response, url);
    if (!payload || typeof payload.download_url !== "string") {
      throw new ArcaneForgeApiError("Missing signed download URL in API response.", response.status, url, payload);
    }
    return payload;
  }

  public async downloadFromSignedUrl(url: string): Promise<Buffer> {
    this.logger.info(`Downloading file content from signed URL`);
    const response = await this.fetchRaw(url, { method: "GET" });
    if (!response.ok) {
      const body = await safeJsonOrText(response);
      throw new ArcaneForgeApiError(
        `Signed URL download failed with status ${response.status}.`,
        response.status,
        url,
        body
      );
    }
    const bytes = await response.arrayBuffer();
    return Buffer.from(bytes);
  }

  public async uploadProjectFile(
    session: AuthSession,
    projectId: number,
    localFilePath: string,
    remoteDocumentName: string
  ): Promise<ApiFileUploadResponse> {
    const url = `${this.baseUrl}/api/v1/projects/${projectId}/files`;
    const content = await readFile(localFilePath);
    const form = new FormData();
    form.append("file", new Blob([content]), path.basename(localFilePath));
    form.append("filename", remoteDocumentName);

    const response = await this.fetchWithAuth(url, session, {
      method: "POST",
      body: form
    });

    const payload = await this.parseJsonResponse<ApiFileUploadResponse>(response, url);
    if (!payload) {
      throw new ArcaneForgeApiError("Empty upload response.", response.status, url);
    }
    return payload;
  }

  private async fetchWithAuth(
    url: string,
    session: AuthSession,
    init: RequestInit
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.token}`
    };

    if (session.userId) {
      headers["X-User-ID"] = session.userId;
    }

    const mergedHeaders = new Headers(init.headers ?? {});
    for (const [key, value] of Object.entries(headers)) {
      if (!mergedHeaders.has(key)) {
        mergedHeaders.set(key, value);
      }
    }

    return this.fetchRaw(url, {
      ...init,
      headers: mergedHeaders
    });
  }

  private async fetchRaw(url: string, init: RequestInit): Promise<Response> {
    if (typeof fetch !== "function") {
      throw new Error("Global fetch is not available in this VS Code extension host runtime.");
    }
    this.logger.info(`${init.method ?? "GET"} ${url}`);
    return fetch(url, init);
  }

  private async parseJsonResponse<T>(response: Response, url: string): Promise<T> {
    const body = await safeJsonOrText(response);
    if (!response.ok) {
      throw new ArcaneForgeApiError(
        `API request failed with status ${response.status}.`,
        response.status,
        url,
        body
      );
    }
    return body as T;
  }
}

async function safeJsonOrText(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  try {
    const text = await response.text();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

