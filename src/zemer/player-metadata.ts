/**
 * Player metadata extraction ported from zemer-cipher FunctionNameExtractor.kt
 * (hash, sts, alias only — sig/n derivation lives in player-config-deriver.ts).
 */
import { zemerContentHash } from "../hash.ts";

const Q_ARRAY_PATTERN = /var\s+Q\s*=\s*"[^"]+"\s*\.\s*split\s*\(\s*"\}"\s*\)/;

const ANCHORED_STS_PATTERN = /signatureTimestamp['":\s]+(\d+)/;
const LOOSE_STS_PATTERN = /sts['":\s]+(\d+)/;

const PLAYER_HASH_PATTERNS = [
  /jsUrl['":\s]+[^"']*?\/player\/([a-f0-9]{8})\//,
  /player_ias\.vflset\/[^/]+\/([a-f0-9]{8})\//,
  /\/s\/player\/([a-f0-9]{8})\//,
];

export type ZemerPlayerMetadata = {
  playerHash: string | null;
  contentHash: string | null;
  signatureTimestamp: number | null;
  aliases: string[];
  hasQArrayObfuscation: boolean;
};

export function hasQArrayObfuscation(playerJs: string): boolean {
  return Q_ARRAY_PATTERN.test(playerJs);
}

export function extractPlayerHashFromJs(
  playerJs: string,
  knownHash?: string | null,
): string | null {
  if (knownHash) return knownHash;
  for (const pattern of PLAYER_HASH_PATTERNS) {
    const match = playerJs.match(pattern);
    if (match?.[1]) return match[1];
  }
  return zemerContentHash(playerJs);
}

export function extractSignatureTimestamp(
  playerJs: string,
  knownHash?: string | null,
  committedSts?: number | null,
): number | null {
  const anchored = ANCHORED_STS_PATTERN.exec(playerJs)?.[1];
  if (anchored) return Number(anchored);

  if (knownHash && committedSts) return committedSts;

  const loose = LOOSE_STS_PATTERN.exec(playerJs)?.[1];
  return loose ? Number(loose) : null;
}

export function extractPlayerMetadata(
  playerJs: string,
  options: {
    knownHash?: string | null;
    committedSts?: number | null;
  } = {},
): ZemerPlayerMetadata {
  const playerHash = extractPlayerHashFromJs(playerJs, options.knownHash);
  const contentHash = zemerContentHash(playerJs);
  const signatureTimestamp = extractSignatureTimestamp(
    playerJs,
    playerHash,
    options.committedSts,
  );
  const aliases = playerHash && contentHash !== playerHash ? [contentHash] : [];
  return {
    playerHash,
    contentHash,
    signatureTimestamp,
    aliases,
    hasQArrayObfuscation: hasQArrayObfuscation(playerJs),
  };
}
