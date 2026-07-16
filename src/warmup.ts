import type { Config } from "./config.ts";
import { fetchTextLimited } from "./fetch-text.ts";
import { youtubeWatchHeaders } from "./http-headers.ts";
import { extractPlayerHash } from "./registry.ts";
import { ZEMER_PLAYER_HASH_RE } from "./zemer/player-config-parser.ts";

const playerUrlPattern =
  /(?:https?:)?\/\/www\.youtube\.com\/s\/player\/[^"'\\]+\/base\.js|\/s\/player\/[^"'\\]+\/base\.js/g;
const iframePlayerPattern = /\\?\/s\\?\/player\\?\/([a-f0-9]{8})\\?\//g;
const iframeSampleCount = 30;
const auxiliarySampleCount = 5;

export type PlayerDiscoverySource =
  | "iframe-api"
  | "music-page"
  | "watch-page"
  | "embed-page"
  | "configured";

export type PlayerCandidate = {
  playerHash: string;
  playerUrl: string;
  source: PlayerDiscoverySource;
};

export async function discoverPlayerCandidates(
  config: Config,
): Promise<PlayerCandidate[]> {
  const [iframe, music, watch, embed] = await Promise.allSettled([
    sampleCandidates(iframeSampleCount, () => discoverFromIframeApi(config)),
    sampleCandidates(
      auxiliarySampleCount,
      () =>
        discoverFromPage("https://music.youtube.com/", "music-page", config),
    ),
    sampleCandidates(auxiliarySampleCount, () => discoverFromWatchPage(config)),
    sampleCandidates(auxiliarySampleCount, () => discoverFromEmbedPage(config)),
  ]);

  if (iframe.status === "rejected") {
    throw new Error(
      `iframe_api discovery failed: ${errorMessage(iframe.reason)}`,
    );
  }
  if (watch.status === "rejected") {
    console.warn(`watch-page discovery skipped: ${errorMessage(watch.reason)}`);
  }
  if (music.status === "rejected") {
    console.warn(`music-page discovery skipped: ${errorMessage(music.reason)}`);
  }
  if (embed.status === "rejected") {
    console.warn(`embed-page discovery skipped: ${errorMessage(embed.reason)}`);
  }

  const configured = config.extraPlayerHashes.map((playerHash) => {
    if (!ZEMER_PLAYER_HASH_RE.test(playerHash)) {
      throw new Error(`invalid configured player hash '${playerHash}'`);
    }
    return candidateForHash(playerHash, "configured");
  });
  const candidates = dedupeCandidates([
    ...iframe.value,
    ...(music.status === "fulfilled" ? music.value : []),
    ...(watch.status === "fulfilled" ? watch.value : []),
    ...(embed.status === "fulfilled" ? embed.value : []),
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
  return await discoverFromPage(watchUrl, "watch-page", config);
}

async function discoverFromEmbedPage(
  config: Config,
): Promise<PlayerCandidate[]> {
  const embedUrl = `https://www.youtube.com/embed/${
    encodeURIComponent(config.warmupVideoId)
  }`;
  return await discoverFromPage(embedUrl, "embed-page", config);
}

async function discoverFromPage(
  url: string,
  source: Exclude<PlayerDiscoverySource, "iframe-api" | "configured">,
  config: Config,
): Promise<PlayerCandidate[]> {
  const html = await fetchLimitedWithTimeout(url, config);
  const urls = html.match(playerUrlPattern) ?? [];
  if (urls.length === 0) {
    throw new Error(`could not find player JS URL in ${source}`);
  }
  return urls.map((value) => {
    const playerUrl = new URL(value, "https://www.youtube.com").toString();
    return {
      playerHash: extractPlayerHash(playerUrl),
      playerUrl,
      source,
    };
  });
}

async function sampleCandidates(
  count: number,
  sample: () => Promise<PlayerCandidate[]>,
): Promise<PlayerCandidate[]> {
  const candidates: PlayerCandidate[] = [];
  let lastError: unknown;
  for (let index = 0; index < count; index++) {
    try {
      candidates.push(...await sample());
    } catch (error) {
      lastError = error;
    }
  }
  if (candidates.length === 0 && lastError) throw lastError;
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(
      candidate.playerHash,
      (counts.get(candidate.playerHash) ?? 0) + 1,
    );
  }
  return candidates.sort((a, b) =>
    (counts.get(b.playerHash) ?? 0) - (counts.get(a.playerHash) ?? 0)
  );
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

export function candidateForHash(
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
