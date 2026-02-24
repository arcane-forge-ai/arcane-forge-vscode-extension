export type EntryType = "document" | "link" | "folder" | "contact" | "other" | string;
export type AuthorityLevel = "source_of_truth" | "reference" | "deprecated" | string;

export interface AuthSession {
  token: string;
  userId?: string;
  validatedAt: string;
}

export interface ProjectSummary {
  id: number;
  name: string;
  description?: string;
  updatedAt?: string | null;
}

export interface SelectedProject {
  projectId: number;
  projectName: string;
  workspaceFolderUri: string;
}

export interface RemoteKbEntry {
  id: number;
  documentName: string;
  fileType: string;
  entryType: EntryType;
  authorityLevel?: AuthorityLevel | null;
  createdAt: string;
  hasStorage: boolean;
  contentType?: string | null;
  originalFileSize?: number | null;
}

export interface ManifestEntry {
  relativePath: string;
  documentName: string;
  remoteFileId?: number;
  remoteCreatedAt?: string;
  remoteAuthorityLevel?: string;
  localSha256?: string;
  lastPulledSha256?: string;
  lastUploadedSha256?: string;
  lastDownloadedAt?: string;
  lastUploadedAt?: string;
}

export interface SyncManifest {
  version: 1;
  projectId: number;
  projectName: string;
  lastPullAt?: string;
  lastPushAt?: string;
  entries: Record<string, ManifestEntry>;
}

export interface PullOptions {
  overwriteLocalChanges: boolean;
  activeOnly: true;
}

export interface PullResult {
  downloaded: string[];
  skippedNoStorage: string[];
  skippedCollision: string[];
  failed: Array<{ documentName: string; reason: string }>;
}

export interface PushResult {
  uploaded: string[];
  skippedUnchanged: string[];
  skippedConflicts: string[];
  failed: Array<{ path: string; reason: string }>;
}

