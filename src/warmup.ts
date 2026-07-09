import type { Config } from "./config.ts";
import { fetchTextLimited } from "./fetch-text.ts";
import { youtubeWatchHeaders } from "./http-headers.ts";
import { extractPlayerHash } from "./registry.ts";
import { ZEMER_PLAYER_HASH_RE } from "./zemer/player-config-parser.ts";

const playerUrlPattern =
  /(?:https?:)?\/\/www\.youtube\.com\/s\/player\/[^"'\\]+\/base\.js|\/s\/player\/[^"'\\]+\/base\.js/g;
const iframePlayerPattern = /\\?\/s\\?\/player\\?\/([a-f0-9]{8})\\?\//g;

export type PlayerDiscoverySource =
  | "iframe-api"
  | "watch-page"
  | "configured";

export type PlayerCandidate = {
  playerHash: string;
  playerUrl: string;
  source: PlayerDiscoverySource;
};

export async function discoverPlayerCandidates(
  config: Config,
): Promise<PlayerCandidate[]> {
  const iframePromise = discoverFromIframeApi(config);
  const watchPromise = discoverFromWatchPage(config);
  const [iframe, watch] = await Promise.allSettled([
    iframePromise,
    watchPromise,
  ]);

  if (iframe.status === "rejected") {
    throw new Error(
      `iframe_api discovery failed: ${errorMessage(iframe.reason)}`,
    );
  }
  if (watch.status === "rejected") {
    console.warn(`watch-page discovery skipped: ${errorMessage(watch.reason)}`);
  }

  const configured = config.extraPlayerHashes.map((playerHash) => {
    if (!ZEMER_PLAYER_HASH_RE.test(playerHash)) {
      throw new Error(`invalid configured player hash '${playerHash}'`);
    }
    return candidateForHash(playerHash, "configured");
  });
  const candidates = dedupeCandidates([
    ...iframe.value,
    ...(watch.status === "fulfilled" ? watch.value : []),
    ...configured,
  ]);
  if (candidates.length === 0) {
    throw new Error("no supported player hashes discovered");
  }
  return candidates;
}

export async function discoverCurrentPlayerUrl(
  config: Config,
): Promise<string> {
  const candidates = await discoverPlayerCandidates(config);
  const first = candidates[0];
  if (!first) throw new Error("no player candidate discovered");
  return first.playerUrl;
}

async function discoverFromIframeApi(
  config: Config,
): Promise<PlayerCandidate[]> {
  const text = await fetchLimitedWithTimeout(
    "https://www.youtube.com/iframe_api",
    config,
  );
  const hashes = [...text.matchAll(iframePlayerPattern)].map((match) =>
    match[1]
  ).filter((hash): hash is string => !!hash);
  if (hashes.length === 0) {
    throw new Error("could not find player hash in iframe_api");
  }
  return hashes.map((hash) => candidateForHash(hash, "iframe-api"));
}

async function discoverFromWatchPage(
  config: Config,
): Promise<PlayerCandidate[]> {
  const watchUrl = `https://www.youtube.com/watch?v=${
    encodeURIComponent(config.warmupVideoId)
  }&hl=en&bpctr=9999999999&has_verified=1`;
  const html = await fetchLimitedWithTimeout(watchUrl, config);
  const urls = html.match(playerUrlPattern) ?? [];
  if (urls.length === 0) {
    throw new Error("could not find player JS URL in watch page");
  }
  return urls.map((value) => {
    const playerUrl = new URL(value, "https://www.youtube.com").toString();
    return {
      playerHash: extractPlayerHash(playerUrl),
      playerUrl,
      source: "watch-page" as const,
    };
  });
}

async function fetchLimitedWithTimeout(
  url: string,
  config: Config,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    return await fetchTextLimited(url, {
      signal: controller.signal,
      headers: youtubeWatchHeaders(),
    }, config.maxWatchBytes);
  } finally {
    clearTimeout(timeout);
  }
}

function candidateForHash(
  playerHash: string,
  source: PlayerDiscoverySource,
): PlayerCandidate {
  if (!ZEMER_PLAYER_HASH_RE.test(playerHash)) {
    throw new Error(`unsupported player hash '${playerHash}' from ${source}`);
  }
  return {
    playerHash,
    playerUrl:
      `https://www.youtube.com/s/player/${playerHash}/player_ias.vflset/en_GB/base.js`,
    source,
  };
}

function dedupeCandidates(candidates: PlayerCandidate[]): PlayerCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.playerHash)) return false;
    seen.add(candidate.playerHash);
    return true;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
