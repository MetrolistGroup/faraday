export type Config = {
  fetchTimeoutMs: number;
  maxWatchBytes: number;
  maxPlayerJsBytes: number;
  warmupVideoId: string;
  validationVideoIds: string[];
  playerRegistryPath: string;
  playerConfigsPath: string;
  extraPlayerHashes: string[];
};

function numberFromEnv(name: string, fallback: number): number {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): Config {
  const warmupVideoId = Deno.env.get("WARMUP_VIDEO_ID") ?? "dQw4w9WgXcQ";
  const validationVideoIds = listFromEnv("VALIDATION_VIDEO_IDS") ??
    [warmupVideoId, "9bZkp7q19f0"];
  const uniqueValidationVideoIds = [...new Set(validationVideoIds)];
  if (
    uniqueValidationVideoIds.length < 2 ||
    uniqueValidationVideoIds.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id))
  ) {
    throw new Error(
      "VALIDATION_VIDEO_IDS must contain at least two distinct YouTube video IDs",
    );
  }
  const extraPlayerHashes = listFromEnv("PLAYER_HASHES") ?? [];
  if (extraPlayerHashes.some((hash) => !/^[a-f0-9]{8}$/.test(hash))) {
    throw new Error("PLAYER_HASHES contains an unsupported player hash");
  }
  return {
    fetchTimeoutMs: numberFromEnv("FETCH_TIMEOUT_MS", 5000),
    maxWatchBytes: numberFromEnv("MAX_WATCH_BYTES", 2_000_000),
    maxPlayerJsBytes: numberFromEnv("MAX_PLAYER_JS_BYTES", 4_000_000),
    warmupVideoId,
    validationVideoIds: uniqueValidationVideoIds,
    playerRegistryPath: Deno.env.get("PLAYER_REGISTRY_PATH") ??
      "registry/player-registry.json",
    playerConfigsPath: Deno.env.get("PLAYER_CONFIGS_PATH") ??
      "registry/player_configs.json",
    extraPlayerHashes,
  };
}

function listFromEnv(name: string): string[] | null {
  const value = Deno.env.get(name)?.trim();
  return value ? value.split(/[\s,]+/).filter(Boolean) : null;
}
