import { dirname } from "node:path";
import { loadConfig } from "../src/config.ts";
import {
  type PlayerRegistryEntry,
  readPlayerRegistry,
} from "../src/registry.ts";
import { readPlayerConfigsFile } from "../src/zemer/player-config-io.ts";
import { parsePlayerConfigs } from "../src/zemer/player-config-parser.ts";

const config = loadConfig();
const registry = readPlayerRegistry(config.playerRegistryPath);
if (!registry) throw new Error(`missing ${config.playerRegistryPath}`);
const configText = await Deno.readTextFile(config.playerConfigsPath);
await readPlayerConfigsFile(config.playerConfigsPath);
const parsed = parsePlayerConfigs(configText);
if (parsed.kind !== "success") throw new Error(parsed.reason);
if (parsed.skippedEntries.length > 0) {
  throw new Error(
    `player configs skipped: ${parsed.skippedEntries.join(", ")}`,
  );
}

for (const player of registry.players) {
  if (!parsed.configs.has(player.playerHash)) {
    throw new Error(
      `registry player ${player.playerHash} has no cipher config`,
    );
  }
  await verifyRelease(player);
}
if (!registry.current) throw new Error("registry.current is null");
if (!parsed.configs.has(registry.current.playerHash)) {
  throw new Error(
    `current player ${registry.current.playerHash} has no config`,
  );
}

console.log(
  `Verified ${registry.players.length} releases and ${parsed.configs.size} expanded configs`,
);

async function verifyRelease(player: PlayerRegistryEntry): Promise<void> {
  const path = `${
    dirname(config.playerRegistryPath)
  }/releases/${player.playerHash}.json`;
  const value = JSON.parse(await Deno.readTextFile(path)) as Record<
    string,
    unknown
  >;
  if (
    value.schemaVersion !== 1 || value.playerHash !== player.playerHash ||
    value.playerUrl !== player.playerUrl || value.sha256 !== player.sha256 ||
    typeof value.generatedAt !== "string" ||
    new Date(value.generatedAt).toISOString() !== value.generatedAt
  ) {
    throw new Error(`release metadata does not match registry: ${path}`);
  }
}
