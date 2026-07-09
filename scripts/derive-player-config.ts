import { parseArgs, stringFlag } from "../src/cli.ts";
import { loadConfig } from "../src/config.ts";
import { loadPlayerSource } from "../src/player-source.ts";
import {
  derivedToEntry,
  derivePlayerConfigFromJs,
  enumerateCandidatePairs,
} from "../src/zemer/player-config-deriver.ts";
import { formatPasteReadyEntry } from "../src/zemer/player-config-io.ts";

const { flags, rest } = parseArgs(Deno.args);
const config = loadConfig();
const selfCheck = flags["self-check"] === true;

if (selfCheck) {
  const known: Record<string, { sig: string; nClass: string; sts: number }> = {
    "66a6ea83": { sig: "C3(15,933,INPUT)", nClass: "WM", sts: 20640 },
    "dd53c628": { sig: "xz(5,7018,INPUT)", nClass: "cY", sts: 20642 },
    "1278453b": { sig: "CV(56,1770,INPUT)", nClass: "WD", sts: 20643 },
  };
  let allOk = true;
  for (const hash of Object.keys(known)) {
    const source = await loadPlayerSource(config, {
      playerHash: hash,
      cipherMode: true,
    });
    const derived = derivePlayerConfigFromJs(source.playerCode, hash);
    const expected = known[hash];
    const ok = derived.sig === expected.sig &&
      derived.nClass === expected.nClass &&
      derived.sts === expected.sts;
    console.log(`${hash}: ${ok ? "OK" : "FAIL"}`, derived);
    if (!ok) allOk = false;
  }
  Deno.exit(allOk ? 0 : 1);
}

const playerHash = stringFlag(flags, "player-hash") ?? rest[0];
if (!playerHash) {
  console.error(
    "usage: deno task player:derive -- <hash> | --self-check | --player-url <url>",
  );
  Deno.exit(1);
}

const source = await loadPlayerSource(config, {
  playerFile: stringFlag(flags, "player-file"),
  playerUrl: stringFlag(flags, "player-url"),
  playerHash,
  cipherMode: true,
});
const derived = derivePlayerConfigFromJs(source.playerCode, source.playerHash);
const candidates = enumerateCandidatePairs(source.playerCode);
const entry = derivedToEntry(derived, source.playerHash);

console.log(JSON.stringify(
  {
    playerHash: source.playerHash,
    playerUrl: source.playerUrl,
    sha256: source.sha256,
    derived,
    candidates,
    entry,
    pasteReady: entry ? formatPasteReadyEntry(source.playerHash, entry) : null,
  },
  null,
  2,
));

if (!entry) Deno.exit(1);
