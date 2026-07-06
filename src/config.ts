export type Config = {
  fetchTimeoutMs: number;
  maxWatchBytes: number;
  maxPlayerJsBytes: number;
  ejsDir: string;
  warmupVideoId: string;
  playerRegistryPath: string;
};

function numberFromEnv(name: string, fallback: number): number {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): Config {
  return {
    fetchTimeoutMs: numberFromEnv("FETCH_TIMEOUT_MS", 5000),
    maxWatchBytes: numberFromEnv("MAX_WATCH_BYTES", 2_000_000),
    maxPlayerJsBytes: numberFromEnv("MAX_PLAYER_JS_BYTES", 4_000_000),
    ejsDir: Deno.env.get("FARADAY_EJS_DIR") ?? "src/yt_ejs",
    warmupVideoId: Deno.env.get("WARMUP_VIDEO_ID") ?? "dQw4w9WgXcQ",
    playerRegistryPath: Deno.env.get("PLAYER_REGISTRY_PATH") ??
      "registry/player-registry.json",
  };
}
