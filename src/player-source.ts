import type { Config } from "./config.ts";
import { fetchTextLimited } from "./fetch-text.ts";
import { sha256Hex } from "./hash.ts";
import { youtubePlayerHeaders } from "./http-headers.ts";
import { extractPlayerHash } from "./registry.ts";
import { discoverCurrentPlayerUrl } from "./warmup.ts";

export type PlayerSourceOptions = {
  playerFile?: string;
  playerUrl?: string;
  playerHash?: string;
  /** Fetch player_ias/en_GB — required for zemer-cipher derivation parity */
  cipherMode?: boolean;
};

export type PlayerSource = {
  playerHash: string;
  playerUrl?: string;
  playerCode: string;
  sha256: string;
};

export function playerUrlForHash(
  playerHash: string,
  cipherMode: boolean,
): string {
  const playerKind = cipherMode ? "player_ias" : "player_es6";
  const locale = cipherMode ? "en_GB" : "en_US";
  return `https://www.youtube.com/s/player/${playerHash}/${playerKind}.vflset/${locale}/base.js`;
}

export async function loadPlayerSource(
  config: Config,
  options: PlayerSourceOptions,
): Promise<PlayerSource> {
  if (options.playerFile) {
    const playerCode = await Deno.readTextFile(options.playerFile);
    const sha256 = sha256Hex(playerCode);
    return {
      playerHash: options.playerHash ??
        (options.playerUrl
          ? extractPlayerHash(options.playerUrl)
          : sha256.slice(0, 8)),
      playerUrl: options.playerUrl,
      playerCode,
      sha256,
    };
  }

  const cipherMode = options.cipherMode === true;
  const playerUrl = normalizePlayerUrl(
    options.playerUrl ??
      (options.playerHash
        ? playerUrlForHash(options.playerHash, cipherMode)
        : await discoverCurrentPlayerUrl(config)),
    cipherMode,
  );
  const playerCode = await fetchPlayerJs(playerUrl, config);
  return {
    playerHash: options.playerHash ?? extractPlayerHash(playerUrl),
    playerUrl,
    playerCode,
    sha256: sha256Hex(playerCode),
  };
}

export async function fetchPlayerJs(
  url: string,
  config: Config,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    return await fetchTextLimited(url, {
      signal: controller.signal,
      headers: youtubePlayerHeaders(),
    }, config.maxPlayerJsBytes);
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizePlayerUrl(
  playerUrl: string,
  cipherMode: boolean,
): string {
  if (!cipherMode) return playerUrl;
  const url = new URL(playerUrl);
  url.pathname = url.pathname
    .replace("/player_es6.", "/player_ias.")
    .replace("/en_US/", "/en_GB/");
  return url.toString();
}
