import { dirname } from "node:path";
import {
  parsePlayerConfigs,
  ZEMER_PLAYER_HASH_RE,
} from "./player-config-parser.ts";
import type {
  ZemerPlayerConfigEntry,
  ZemerPlayerConfigsFile,
} from "./types.ts";

export async function readPlayerConfigsFile(
  path: string,
): Promise<ZemerPlayerConfigsFile> {
  const jsonText = await Deno.readTextFile(path);
  return validatePlayerConfigsText(jsonText, path);
}

export function validatePlayerConfigsText(
  jsonText: string,
  label = "player configs",
): ZemerPlayerConfigsFile {
  const result = parsePlayerConfigs(jsonText);
  if (result.kind === "failure") {
    throw new Error(`invalid ${label}: ${result.reason}`);
  }
  if (result.skippedEntries.length > 0) {
    throw new Error(
      `invalid ${label}: skipped entries ${result.skippedEntries.join(", ")}`,
    );
  }
  return JSON.parse(jsonText) as ZemerPlayerConfigsFile;
}

export async function mergePlayerConfigEntry(
  path: string,
  playerHash: string,
  entry: ZemerPlayerConfigEntry,
): Promise<ZemerPlayerConfigsFile> {
  if (!ZEMER_PLAYER_HASH_RE.test(playerHash)) {
    throw new Error(`invalid player hash '${playerHash}'`);
  }
  const file = await readPlayerConfigsFile(path);
  file.players[playerHash] = entry;
  file.players = sortPlayersBySts(file.players);
  const text = `${JSON.stringify(file, null, 2)}\n`;
  const validated = validatePlayerConfigsText(text, path);
  if (!Object.hasOwn(validated.players, playerHash)) {
    throw new Error(`generated ${path} is missing primary hash ${playerHash}`);
  }
  await writeTextFileAtomic(path, text);
  return file;
}

export function sortPlayersBySts(
  players: Record<string, ZemerPlayerConfigEntry>,
): Record<string, ZemerPlayerConfigEntry> {
  const sorted = Object.entries(players).sort(([aKey, a], [bKey, b]) =>
    a.sts - b.sts || aKey.localeCompare(bKey)
  );
  return Object.fromEntries(sorted);
}

export async function writeTextFileAtomic(
  path: string,
  text: string,
): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${Deno.pid}.${Date.now()}.tmp`;
  try {
    await Deno.writeTextFile(tempPath, text);
    await Deno.rename(tempPath, path);
  } catch (error) {
    try {
      await Deno.remove(tempPath);
    } catch {
      // Best effort cleanup only; preserve the original write error.
    }
    throw error;
  }
}

export function findCommittedEntry(
  players: Record<string, ZemerPlayerConfigEntry>,
  playerHash: string,
  md5Alias: string,
): [string, ZemerPlayerConfigEntry] | null {
  for (const [hash, entry] of Object.entries(players)) {
    if (
      hash === playerHash ||
      hash === md5Alias ||
      (entry.aliases ?? []).includes(playerHash) ||
      (entry.aliases ?? []).includes(md5Alias)
    ) {
      return [hash, entry];
    }
  }
  return null;
}

export function formatPasteReadyEntry(
  playerHash: string,
  entry: ZemerPlayerConfigEntry,
): string {
  const aliases = JSON.stringify(entry.aliases ?? []);
  return `"${playerHash}": { "sig": "${entry.sig}", "nClass": "${entry.nClass}", "sts": ${entry.sts}, "aliases": ${aliases} }`;
}
