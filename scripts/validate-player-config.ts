import { parseArgs, stringFlag } from "../src/cli.ts";
import { loadConfig } from "../src/config.ts";
import { notifyProbeFailure } from "../src/discord-webhook.ts";
import { describeCred } from "../src/innertube-cred.ts";
import { loadPlayerSource } from "../src/player-source.ts";
import {
  derivePlayerConfigFromJs,
  enumerateCandidatePairs,
} from "../src/zemer/player-config-deriver.ts";
import {
  findCommittedEntry,
  formatPasteReadyEntry,
  mergePlayerConfigEntry,
  readPlayerConfigsFile,
} from "../src/zemer/player-config-io.ts";
import {
  fetchSignatureCipher,
  loadCredForValidation,
  validateCandidatePairs,
} from "../src/zemer/stream-validator.ts";

const { flags, rest } = parseArgs(Deno.args);
const config = loadConfig();
const playerHash = stringFlag(flags, "player-hash") ?? rest[0];
const fixedSig = stringFlag(flags, "sig") ?? rest[1];
const fixedNClass = stringFlag(flags, "n-class") ?? rest[2];
const write = flags.write === true;

if (!playerHash) {
  console.error(
    "usage: deno task player:validate -- <hash> [--sig <expr> --n-class <name>] [--write]",
  );
  Deno.exit(1);
}

const cred = await loadCredForValidation();
console.log(describeCred(cred));

const source = await loadPlayerSource(config, {
  playerFile: stringFlag(flags, "player-file"),
  playerUrl: stringFlag(flags, "player-url"),
  playerHash,
  cipherMode: true,
});
const derived = derivePlayerConfigFromJs(source.playerCode, source.playerHash);
const sts = derived.sts;
if (!sts) {
  await reportFailure(
    playerHash,
    "derivation",
    "could not extract signatureTimestamp from player.js",
    { derived },
  );
  Deno.exit(1);
}

console.log(
  `player ${source.playerHash}  md5Alias=${derived.md5Alias}  sts=${sts}  size=${source.playerCode.length}`,
);

let signatureCiphers: string[];
let streamMode: "guest" | "authenticated";
try {
  const ciphers: string[] = [];
  const modes: Array<"guest" | "authenticated"> = [];
  for (const videoId of config.validationVideoIds) {
    const cipherResult = await fetchSignatureCipher(sts, {
      videoId,
      cred,
      preferAuth: flags["prefer-auth"] === true,
      timeoutMs: config.fetchTimeoutMs,
    });
    ciphers.push(cipherResult.cipher);
    modes.push(cipherResult.mode);
  }
  signatureCiphers = ciphers;
  streamMode = modes.includes("authenticated") ? "authenticated" : "guest";
} catch (error) {
  await reportFailure(
    source.playerHash,
    "cipher-fetch",
    error instanceof Error ? error.message : String(error),
    { sts },
  );
  Deno.exit(1);
}

const sLens = signatureCiphers.map((cipher) =>
  new URLSearchParams(cipher).get("s")?.length
);
console.log(
  `got ${signatureCiphers.length} signatureCipher samples via ${streamMode} (s lengths=${
    sLens.join(",")
  })\n`,
);

let pairs: Array<{ sig: string; nClass: string }>;
if (fixedSig && fixedNClass) {
  pairs = [{ sig: fixedSig, nClass: fixedNClass }];
} else {
  const enumerated = enumerateCandidatePairs(source.playerCode);
  console.log(
    `candidates: sig=[${enumerated.sigExprs.join(", ")}]  nClass=[${
      enumerated.nClasses.join(", ")
    }]`,
  );
  pairs = [...enumerated.pairs];

  try {
    const file = await readPlayerConfigsFile(config.playerConfigsPath);
    const committed = findCommittedEntry(
      file.players,
      source.playerHash,
      derived.md5Alias,
    );
    if (committed) {
      const [, entry] = committed;
      console.log(
        `committed config found: sig=${entry.sig} nClass=${entry.nClass}`,
      );
      pairs = [
        { sig: entry.sig, nClass: entry.nClass },
        ...pairs.filter((pair) =>
          pair.sig !== entry.sig || pair.nClass !== entry.nClass
        ),
      ];
    }
  } catch (error) {
    console.warn(
      `warning: could not read committed configs (${error}) — validating extracted candidates only`,
    );
  }
}

if (!pairs.length) {
  await reportFailure(
    source.playerHash,
    "derivation",
    "no candidates extracted",
    { derived },
  );
  Deno.exit(1);
}

const result = await validateCandidatePairs(
  source.playerCode,
  source.playerHash,
  derived.md5Alias,
  sts,
  signatureCiphers,
  pairs,
  { timeoutMs: config.fetchTimeoutMs },
);

for (const attempt of result.attempts) {
  const ok = attempt.works ? "✓ WORKS" : "";
  console.log(
    `  sig=${attempt.sig.padEnd(20)} n=g.${
      attempt.nClass.padEnd(4)
    } nProbe.changed=${String(attempt.nProbeChanged).padEnd(5)} nProbe.valid=${
      String(attempt.nProbeValid).padEnd(5)
    } GET=${attempt.status}  ${ok}`,
  );
}

console.log();
if (result.winner) {
  console.log(`✓ VALIDATED CONFIG for ${source.playerHash}:`);
  console.log(
    formatPasteReadyEntry(result.winner.playerHash, result.winner.entry),
  );
  if (write) {
    await mergePlayerConfigEntry(
      config.playerConfigsPath,
      result.winner.playerHash,
      result.winner.entry,
    );
    console.log(`\nWrote entry to ${config.playerConfigsPath}`);
  }
} else {
  await reportFailure(
    source.playerHash,
    "stream-validation",
    result.ambiguous
      ? "multiple candidate pairs passed strict validation"
      : "no candidate passed strict HTTP 206 stream validation",
    { attempts: result.attempts, streamMode },
  );
  Deno.exit(1);
}

async function reportFailure(
  hash: string,
  stage: string,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  console.error(`✗ ${message}`);
  if (details) console.error(JSON.stringify(details, null, 2));
  await notifyProbeFailure({
    title: "Faraday player validation failed",
    stage,
    playerHash: hash,
    message,
  });
}
