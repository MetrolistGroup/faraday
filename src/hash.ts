import { createHash } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** First 4 bytes of MD5(first 10k chars), as 8 lowercase hex — zemer alias/content hash. */
export function zemerContentHash(playerJs: string): string {
  const content = playerJs.slice(0, 10_000);
  const digest = createHash("md5").update(content).digest();
  return Array.from(digest.subarray(0, 4))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
