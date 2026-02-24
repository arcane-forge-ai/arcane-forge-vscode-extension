import * as path from "node:path";

const INVALID_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_TRAILING_RE = /[. ]+$/g;

export function sanitizeDocumentNameToRelativePath(documentName: string, fallbackId?: number): string {
  const normalized = documentName.replace(/\\/g, "/");
  const rawSegments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");

  const sanitizedSegments = rawSegments
    .map((segment) => sanitizePathSegment(segment))
    .filter((segment) => segment.length > 0);

  if (sanitizedSegments.length === 0) {
    sanitizedSegments.push(fallbackId ? `file_${fallbackId}` : "file");
  }

  return sanitizedSegments.join("/");
}

export function sanitizePathSegment(segment: string): string {
  let out = segment.replace(INVALID_CHARS_RE, "_");
  out = out.replace(WINDOWS_TRAILING_RE, "");
  out = out.trim();
  if (!out) {
    return "_";
  }
  return out;
}

export function toPosixRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function shouldIgnoreLocalName(name: string): boolean {
  return name.startsWith(".");
}

