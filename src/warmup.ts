import type { Config } from "./config.ts";
import { fetchTextLimited } from "./fetch-text.ts";
import { youtubeWatchHeaders } from "./http-headers.ts";

const playerUrlPattern =
  /(?:https?:)?\/\/www\.youtube\.com\/s\/player\/[^"'\\]+\/base\.js|\/s\/player\/[^"'\\]+\/base\.js/g;

export async function discoverCurrentPlayerUrl(
  config: Config,
): Promise<string> {
  const watchUrl = `https://www.youtube.com/watch?v=${
    encodeURIComponent(config.warmupVideoId)
  }&hl=en&bpctr=9999999999&has_verified=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    const html = await fetchTextLimited(watchUrl, {
      signal: controller.signal,
      headers: youtubeWatchHeaders(),
    }, config.maxWatchBytes);
    const match = html.match(playerUrlPattern)?.[0];
    if (!match) throw new Error("could not find player JS URL in watch page");
    return new URL(match, "https://www.youtube.com").toString();
  } finally {
    clearTimeout(timeout);
  }
}
