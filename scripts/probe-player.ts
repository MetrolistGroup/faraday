import { dirname } from "node:path";
import { loadConfig } from "../src/config.ts";
import { fetchTextLimited } from "../src/fetch-text.ts";
import { sha256Hex } from "../src/hash.ts";
import { youtubePlayerHeaders } from "../src/http-headers.ts";
import {
  extractPlayerHash,
  type PlayerConfig,
  type PlayerRegistry,
  readPlayerRegistry,
} from "../src/registry.ts";
import { preprocessPlayer } from "../src/solver.ts";
import { discoverCurrentPlayerUrl } from "../src/warmup.ts";

const config = loadConfig();
const now = new Date().toISOString();
const registryPath = config.playerRegistryPath;
const registryDir = dirname(registryPath);
const playerConfigPathFor = (hash: string) =>
  `${registryDir === "." ? "" : `${registryDir}/`}players/${hash}.json`;
const registry = readPlayerRegistry(registryPath) ??
  ({
    schemaVersion: 1,
    updatedAt: now,
    current: null,
    players: [],
  } satisfies PlayerRegistry);

const playerUrl = await discoverCurrentPlayerUrl(config);
const playerHash = extractPlayerHash(playerUrl);
const existing = registry.players.find((player) =>
  player.playerHash === playerHash
);
const playerConfigPath = playerConfigPathFor(playerHash);

if (existing && await fileExists(playerConfigPath)) {
  const releaseTag = `player-${playerHash}`;
  const needsRegistryUpdate = registry.current?.playerHash !== playerHash ||
    registry.current.playerUrl !== playerUrl ||
    existing.playerUrl !== playerUrl ||
    existing.configPath !== playerConfigPath ||
    existing.releaseTag !== releaseTag;
  if (needsRegistryUpdate) {
    registry.current = { playerHash, playerUrl, discoveredAt: now };
    existing.playerUrl = playerUrl;
    existing.configPath = playerConfigPath;
    existing.releaseTag = releaseTag;
    registry.updatedAt = now;
    await writeRegistry(registryPath, registry);
    console.log(`Updated registry current player to ${playerHash}.`);
  } else {
    console.log(`Current player ${playerHash} already registered; no changes.`);
  }
  Deno.exit(0);
}

const playerJs = await fetchPlayerJs(playerUrl);
const sha256 = sha256Hex(playerJs);
const preprocessedPlayer = await preprocessPlayer(playerHash, playerJs, config);

registry.current = { playerHash, playerUrl, discoveredAt: now };
const playerConfig: PlayerConfig = {
  schemaVersion: 1,
  generatedAt: now,
  playerHash,
  playerUrl,
  sha256,
  nTransform: {
    type: "yt-dlp-ejs-preprocessed-player",
    preprocessedPlayer,
  },
};
if (existing) {
  existing.playerUrl = playerUrl;
  existing.sha256 = sha256;
  existing.configPath = playerConfigPath;
  existing.releaseTag = `player-${playerHash}`;
  delete (existing as { nTransform?: unknown }).nTransform;
} else {
  registry.players.push({
    playerHash,
    playerUrl,
    sha256,
    firstSeenAt: now,
    status: "validated",
    validator: "yt-dlp-ejs",
    configPath: playerConfigPath,
    releaseTag: `player-${playerHash}`,
  });
}
registry.players.sort((a, b) => a.playerHash.localeCompare(b.playerHash));
registry.updatedAt = now;
await writeJson(playerConfigPath, playerConfig);
await writeRegistry(registryPath, registry);
console.log(
  `${existing ? "Updated" : "Registered new"} player ${playerHash} (${
    sha256.slice(0, 12)
  }).`,
);

async function fetchPlayerJs(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    return fetchTextLimited(url, {
      signal: controller.signal,
      headers: youtubePlayerHeaders(),
    }, config.maxPlayerJsBytes);
  } finally {
    clearTimeout(timeout);
  }
}

async function writeRegistry(
  path: string,
  value: PlayerRegistry,
): Promise<void> {
  await writeJson(path, value);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${Deno.pid}.${Date.now()}.tmp`;
  await Deno.writeTextFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await Deno.rename(tempPath, path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
