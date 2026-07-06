import { createHash } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function shortHash(value: string): string {
  return sha256Hex(value).slice(0, 16);
}
