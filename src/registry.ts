import { readFileSync } from "node:fs";

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
  status: "validated";
  validator: "yt-dlp-ejs";
  configPath?: string;
  releaseTag?: string;
};

export type PlayerConfig = {
  schemaVersion: 1;
  generatedAt: string;
  playerHash: string;
  playerUrl: string;
  sha256: string;
  nTransform: {
    type: "yt-dlp-ejs-preprocessed-player";
    preprocessedPlayerEncoding: "base64";
    preprocessedPlayer: string;
  };
};

export function readPlayerRegistry(path: string): PlayerRegistry | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PlayerRegistry;
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

export function extractPlayerHash(playerUrl: string): string {
  const match = playerUrl.match(/\/s\/player\/([^/]+)\//);
  if (!match?.[1]) {
    throw new Error(`could not extract player hash from ${playerUrl}`);
  }
  return match[1];
}
