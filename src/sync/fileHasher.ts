import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256Buffer(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return sha256Buffer(data);
}

