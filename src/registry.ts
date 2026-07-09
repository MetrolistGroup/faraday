import { readFileSync } from "node:fs";
import { ZEMER_PLAYER_HASH_RE } from "./zemer/player-config-parser.ts";

export type PlayerRegistry = {
  schemaVersion: 1;
  updatedAt: string;
  current: {
    playerHash: string;
    playerUrl: string;
    discoveredAt: string;
  } | null;
  players: PlayerRegistryEntry[];
};

export type PlayerRegistryEntry = {
  playerHash: string;
  playerUrl: string;
  sha256: string;
  firstSeenAt: string;
  status: "validated" | "needs-derivation";
  validator: "faraday";
  configPath: string;
  releaseTag?: string;
};

/** Per-player release metadata; cipher fields live in player_configs.json */
export type PlayerReleaseRecord = {
  schemaVersion: 1;
  generatedAt: string;
  playerHash: string;
  playerUrl: string;
  sha256: string;
};

export function readPlayerRegistry(path: string): PlayerRegistry | null {
  try {
    return validatePlayerRegistry(JSON.parse(readFileSync(path, "utf8")), path);
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export function validatePlayerRegistry(
  value: unknown,
  label = "player registry",
): PlayerRegistry {
  if (!isRecord(value)) {
    throw new Error(`invalid ${label}: root is not an object`);
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`invalid ${label}: unsupported schemaVersion`);
  }
  if (!isIsoDate(value.updatedAt)) {
    throw new Error(`invalid ${label}: updatedAt is not an ISO timestamp`);
  }
  if (!Array.isArray(value.players)) {
    throw new Error(`invalid ${label}: players is not an array`);
  }

  const players: PlayerRegistryEntry[] = [];
  const hashes = new Set<string>();
  for (const [index, raw] of value.players.entries()) {
    if (!isRecord(raw)) {
      throw new Error(`invalid ${label}: players[${index}] is not an object`);
    }
    const playerHash = requiredHash(
      raw.playerHash,
      `${label} players[${index}]`,
    );
    if (hashes.has(playerHash)) {
      throw new Error(`invalid ${label}: duplicate player ${playerHash}`);
    }
    hashes.add(playerHash);
    const playerUrl = requiredPlayerUrl(
      raw.playerUrl,
      playerHash,
      `${label} players[${index}]`,
    );
    if (typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.sha256)) {
      throw new Error(`invalid ${label}: bad sha256 for ${playerHash}`);
    }
    if (!isIsoDate(raw.firstSeenAt)) {
      throw new Error(`invalid ${label}: bad firstSeenAt for ${playerHash}`);
    }
    if (raw.status !== "validated" && raw.status !== "needs-derivation") {
      throw new Error(`invalid ${label}: bad status for ${playerHash}`);
    }
    if (raw.validator !== "faraday") {
      throw new Error(`invalid ${label}: bad validator for ${playerHash}`);
    }
    if (typeof raw.configPath !== "string" || !raw.configPath) {
      throw new Error(`invalid ${label}: bad configPath for ${playerHash}`);
    }
    if (
      raw.releaseTag !== undefined &&
      raw.releaseTag !== `player-${playerHash}`
    ) {
      throw new Error(`invalid ${label}: bad releaseTag for ${playerHash}`);
    }
    players.push({
      playerHash,
      playerUrl,
      sha256: raw.sha256,
      firstSeenAt: raw.firstSeenAt,
      status: raw.status,
      validator: raw.validator,
      configPath: raw.configPath,
      ...(raw.releaseTag ? { releaseTag: raw.releaseTag } : {}),
    });
  }

  let current: PlayerRegistry["current"] = null;
  if (value.current !== null) {
    if (!isRecord(value.current)) {
      throw new Error(`invalid ${label}: current is not an object or null`);
    }
    const playerHash = requiredHash(
      value.current.playerHash,
      `${label} current`,
    );
    if (!hashes.has(playerHash)) {
      throw new Error(
        `invalid ${label}: current player ${playerHash} is not in players`,
      );
    }
    current = {
      playerHash,
      playerUrl: requiredPlayerUrl(
        value.current.playerUrl,
        playerHash,
        `${label} current`,
      ),
      discoveredAt: requiredIsoDate(
        value.current.discoveredAt,
        `${label} current discoveredAt`,
      ),
    };
  }

  return {
    schemaVersion: 1,
    updatedAt: value.updatedAt,
    current,
    players,
  };
}

export function extractPlayerHash(playerUrl: string): string {
  const match = playerUrl.match(/\/s\/player\/([a-f0-9]{8})\//);
  if (!match?.[1]) {
    throw new Error(`unsupported player hash in ${playerUrl}`);
  }
  return match[1];
}

function requiredHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !ZEMER_PLAYER_HASH_RE.test(value)) {
    throw new Error(`invalid ${label}: bad player hash`);
  }
  return value;
}

function requiredPlayerUrl(
  value: unknown,
  playerHash: string,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`invalid ${label}: playerUrl is not a string`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid ${label}: malformed playerUrl`);
  }
  if (
    url.protocol !== "https:" || url.hostname !== "www.youtube.com" ||
    extractPlayerHash(value) !== playerHash
  ) {
    throw new Error(`invalid ${label}: playerUrl does not match ${playerHash}`);
  }
  return value;
}

function requiredIsoDate(value: unknown, label: string): string {
  if (!isIsoDate(value)) {
    throw new Error(`invalid ${label}: not an ISO timestamp`);
  }
  return value;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
