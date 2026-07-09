import { dirname } from "node:path";
import type { Config } from "./config.ts";
import { sha256Hex } from "./hash.ts";
import { fetchPlayerJs, normalizePlayerUrl } from "./player-source.ts";
import {
  extractPlayerHash,
  type PlayerRegistry,
  type PlayerReleaseRecord,
  readPlayerRegistry,
  validatePlayerRegistry,
} from "./registry.ts";
import {
  derivedToEntry,
  derivePlayerConfigFromJs,
  enumerateCandidatePairs,
} from "./zemer/player-config-deriver.ts";
import {
  findCommittedEntry,
  formatPasteReadyEntry,
  mergePlayerConfigEntry,
  readPlayerConfigsFile,
  writeTextFileAtomic,
} from "./zemer/player-config-io.ts";
import { extractPlayerMetadata } from "./zemer/player-metadata.ts";
import { ZemerPlayerConfigStore } from "./zemer/player-config-store.ts";
import type {
  ZemerHardcodedPlayerConfig,
  ZemerPlayerConfigsFile,
} from "./zemer/types.ts";
import {
  fetchSignatureCipher,
  loadCredForValidation,
  validateCandidatePairs,
} from "./zemer/stream-validator.ts";
import { discoverPlayerCandidates } from "./warmup.ts";

export type ProbeStage =
  | "discovery"
  | "state"
  | "fetch"
  | "derivation"
  | "cipher-fetch"
  | "stream-validation"
  | "write";

export type ProbeFailure = {
  stage: ProbeStage;
  playerHash: string;
  playerUrl?: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ProbeSuccess = {
  playerHash: string;
  playerUrl: string;
  action:
    | "unchanged"
    | "registry-updated"
    | "stream-validated"
    | "derived-and-written";
  streamMode: "guest" | "authenticated";
};

export type ProbeResult =
  | { ok: true; success: ProbeSuccess }
  | { ok: false; failure: ProbeFailure };

export async function runPlayerProbe(config: Config): Promise<ProbeResult> {
  const now = new Date().toISOString();
  const registryPath = config.playerRegistryPath;
  const registryDir = dirname(registryPath);

  let candidates;
  try {
    candidates = await discoverPlayerCandidates(config);
  } catch (error) {
    return fail(
      "discovery",
      "unknown",
      error instanceof Error ? error.message : String(error),
    );
  }

  let registry: PlayerRegistry;
  let store: ZemerPlayerConfigStore;
  let configFile: ZemerPlayerConfigsFile;
  try {
    registry = readPlayerRegistry(registryPath) ??
      ({
        schemaVersion: 1,
        updatedAt: now,
        current: null,
        players: [],
      } satisfies PlayerRegistry);
    [store, configFile] = await Promise.all([
      ZemerPlayerConfigStore.fromFile(config.playerConfigsPath),
      readPlayerConfigsFile(config.playerConfigsPath),
    ]);
  } catch (error) {
    return fail(
      "state",
      "unknown",
      error instanceof Error ? error.message : String(error),
    );
  }

  const candidate = candidates.find((item) => !store.has(item.playerHash)) ??
    candidates.find((item) => item.source === "configured") ??
    candidates[0];
  if (!candidate) return fail("discovery", "unknown", "no player candidate");
  const playerUrl = normalizePlayerUrl(candidate.playerUrl, true);
  const playerHash = extractPlayerHash(playerUrl);

  let playerJs: string;
  try {
    playerJs = await fetchPlayerJs(playerUrl, config);
  } catch (error) {
    return fail(
      "fetch",
      playerHash,
      error instanceof Error ? error.message : String(error),
      { playerUrl },
    );
  }

  const sha256 = sha256Hex(playerJs);
  const derived = derivePlayerConfigFromJs(playerJs, playerHash);
  if (!derived.sts) {
    return fail(
      "derivation",
      playerHash,
      "could not extract sts from player.js",
      {
        playerUrl,
        derived,
      },
    );
  }

  const knownConfig = store.get(playerHash) ?? store.get(derived.md5Alias);
  const committed = findCommittedEntry(
    configFile.players,
    playerHash,
    derived.md5Alias,
  );

  let signatureCiphers: string[];
  let streamMode: "guest" | "authenticated";
  try {
    const cred = await loadCredForValidation();
    const ciphers: string[] = [];
    const modes: Array<"guest" | "authenticated"> = [];
    for (const videoId of config.validationVideoIds) {
      const cipherResult = await fetchSignatureCipher(derived.sts, {
        videoId,
        cred,
        timeoutMs: config.fetchTimeoutMs,
      });
      ciphers.push(cipherResult.cipher);
      modes.push(cipherResult.mode);
    }
    signatureCiphers = ciphers;
    streamMode = modes.includes("authenticated") ? "authenticated" : "guest";
  } catch (error) {
    return fail(
      "cipher-fetch",
      playerHash,
      error instanceof Error ? error.message : String(error),
      { playerUrl, sts: derived.sts },
    );
  }

  if (knownConfig) {
    let validation;
    try {
      validation = await validateCommittedConfig(
        playerJs,
        playerHash,
        derived.md5Alias,
        derived.sts,
        signatureCiphers,
        knownConfig,
        config.fetchTimeoutMs,
      );
    } catch (error) {
      return fail(
        "stream-validation",
        playerHash,
        error instanceof Error ? error.message : String(error),
        { playerUrl, source: candidate.source },
      );
    }
    if (!validation.winner) {
      return fail(
        "stream-validation",
        playerHash,
        validation.ambiguous
          ? "committed player config validation was ambiguous"
          : "committed player config failed strict HTTP 206 stream checks",
        {
          playerUrl,
          sts: derived.sts,
          config: configEntryFromHardcoded(knownConfig),
          attempts: validation.attempts,
          streamMode,
        },
      );
    }

    if (!committed) {
      return fail(
        "state",
        playerHash,
        "resolved config is missing from the raw player config table",
        { playerUrl, md5Alias: derived.md5Alias },
      );
    }
    const [primaryHash, committedEntry] = committed;
    const aliases = [
      ...new Set([
        ...(committedEntry.aliases ?? []),
        playerHash,
        derived.md5Alias,
      ].filter((hash) => hash !== primaryHash)),
    ];
    const repairedEntry = {
      ...committedEntry,
      sts: derived.sts,
      ...(aliases.length > 0 ? { aliases } : {}),
    };
    const needsConfigUpdate = JSON.stringify(repairedEntry) !==
      JSON.stringify(committedEntry);
    if (needsConfigUpdate) {
      try {
        configFile = await mergePlayerConfigEntry(
          config.playerConfigsPath,
          primaryHash,
          repairedEntry,
        );
      } catch (error) {
        return fail(
          "write",
          playerHash,
          error instanceof Error ? error.message : String(error),
          { playerUrl, primaryHash, repairedEntry },
        );
      }
    }

    const existing = registry.players.find((player) =>
      player.playerHash === playerHash
    );
    const releasePath = releasePathFor(registryDir, playerHash);
    const releaseTag = `player-${playerHash}`;
    const needsRegistryUpdate = needsConfigUpdate || !existing ||
      registry.current?.playerHash !== playerHash ||
      registry.current?.playerUrl !== playerUrl ||
      existing.playerUrl !== playerUrl ||
      existing.sha256 !== sha256 ||
      existing.configPath !== config.playerConfigsPath ||
      existing.releaseTag !== releaseTag ||
      existing.status !== "validated" ||
      existing.validator !== "faraday";

    if (!needsRegistryUpdate) {
      return {
        ok: true,
        success: {
          playerHash,
          playerUrl,
          action: "unchanged",
          streamMode,
        },
      };
    }

    registry.current = { playerHash, playerUrl, discoveredAt: now };
    if (existing) {
      existing.playerUrl = playerUrl;
      existing.sha256 = sha256;
      existing.configPath = config.playerConfigsPath;
      existing.releaseTag = releaseTag;
      existing.status = "validated";
      existing.validator = "faraday";
    } else {
      registry.players.push({
        playerHash,
        playerUrl,
        sha256,
        firstSeenAt: now,
        status: "validated",
        validator: "faraday",
        configPath: config.playerConfigsPath,
        releaseTag,
      });
    }
    registry.players.sort((a, b) => a.playerHash.localeCompare(b.playerHash));
    registry.updatedAt = now;
    try {
      await writeReleaseAndRegistry(
        releasePath,
        {
          schemaVersion: 1,
          generatedAt: now,
          playerHash,
          playerUrl,
          sha256,
        },
        registryPath,
        registry,
      );
    } catch (error) {
      return fail(
        "write",
        playerHash,
        error instanceof Error ? error.message : String(error),
        { playerUrl, releasePath, registryPath },
      );
    }

    return {
      ok: true,
      success: {
        playerHash,
        playerUrl,
        action: existing ? "registry-updated" : "stream-validated",
        streamMode,
      },
    };
  }

  const derivedEntry = derivedToEntry(derived, playerHash);
  const enumerated = enumerateCandidatePairs(playerJs);
  const pairs = derivedEntry
    ? [
      { sig: derivedEntry.sig, nClass: derivedEntry.nClass },
      ...enumerated.pairs,
    ]
    : enumerated.pairs;
  const uniquePairs = dedupePairs(pairs);

  if (!uniquePairs.length) {
    return fail(
      "derivation",
      playerHash,
      "no sig/nClass candidates extracted",
      {
        playerUrl,
        derived,
        metadata: extractPlayerMetadata(playerJs, { knownHash: playerHash }),
      },
    );
  }

  let validation;
  try {
    validation = await validateCandidatePairs(
      playerJs,
      playerHash,
      derived.md5Alias,
      derived.sts,
      signatureCiphers,
      uniquePairs,
      { timeoutMs: config.fetchTimeoutMs },
    );
  } catch (error) {
    return fail(
      "stream-validation",
      playerHash,
      error instanceof Error ? error.message : String(error),
      { playerUrl, candidateCount: uniquePairs.length },
    );
  }

  if (!validation.winner) {
    return fail(
      "stream-validation",
      playerHash,
      validation.ambiguous
        ? "multiple candidate pairs passed strict stream validation"
        : "no candidate passed strict HTTP 206 stream validation",
      {
        playerUrl,
        derived,
        derivedEntry,
        attempts: validation.attempts,
        streamMode,
        pasteReady: derivedEntry
          ? formatPasteReadyEntry(playerHash, derivedEntry)
          : null,
      },
    );
  }

  try {
    await mergePlayerConfigEntry(
      config.playerConfigsPath,
      validation.winner.playerHash,
      validation.winner.entry,
    );
  } catch (error) {
    return fail(
      "write",
      playerHash,
      error instanceof Error ? error.message : String(error),
      { playerUrl, winner: validation.winner },
    );
  }

  const existing = registry.players.find((player) =>
    player.playerHash === playerHash
  );
  registry.current = { playerHash, playerUrl, discoveredAt: now };
  const releasePath = releasePathFor(registryDir, playerHash);
  const releaseTag = `player-${playerHash}`;
  if (existing) {
    existing.playerUrl = playerUrl;
    existing.sha256 = sha256;
    existing.configPath = config.playerConfigsPath;
    existing.releaseTag = releaseTag;
    existing.status = "validated";
    existing.validator = "faraday";
  } else {
    registry.players.push({
      playerHash,
      playerUrl,
      sha256,
      firstSeenAt: now,
      status: "validated",
      validator: "faraday",
      configPath: config.playerConfigsPath,
      releaseTag,
    });
  }
  registry.players.sort((a, b) => a.playerHash.localeCompare(b.playerHash));
  registry.updatedAt = now;
  try {
    await writeReleaseAndRegistry(
      releasePath,
      {
        schemaVersion: 1,
        generatedAt: now,
        playerHash,
        playerUrl,
        sha256,
      },
      registryPath,
      registry,
    );
  } catch (error) {
    return fail(
      "write",
      playerHash,
      error instanceof Error ? error.message : String(error),
      { playerUrl, releasePath, registryPath },
    );
  }

  return {
    ok: true,
    success: {
      playerHash,
      playerUrl,
      action: "derived-and-written",
      streamMode,
    },
  };
}

function validateCommittedConfig(
  playerJs: string,
  playerHash: string,
  md5Alias: string,
  sts: number,
  signatureCiphers: string[],
  config: ZemerHardcodedPlayerConfig,
  timeoutMs: number,
) {
  const sig = config.sigJsExpression;
  const nClass = config.nJsExpression?.match(
    /new g\.([A-Za-z0-9$_]{1,8})\(/,
  )?.[1];
  if (!sig || !nClass) {
    return validateCandidatePairs(
      playerJs,
      playerHash,
      md5Alias,
      sts,
      signatureCiphers,
      [],
      { timeoutMs },
    );
  }
  return validateCandidatePairs(
    playerJs,
    playerHash,
    md5Alias,
    sts,
    signatureCiphers,
    [{ sig, nClass }],
    { timeoutMs },
  );
}

function configEntryFromHardcoded(config: ZemerHardcodedPlayerConfig) {
  const nClass = config.nJsExpression?.match(
    /new g\.([A-Za-z0-9$_]{1,8})\(/,
  )?.[1];
  return {
    sig: config.sigJsExpression,
    nClass,
    sts: config.signatureTimestamp,
  };
}

function dedupePairs(
  pairs: Array<{ sig: string; nClass: string }>,
): Array<{ sig: string; nClass: string }> {
  const seen = new Set<string>();
  const out: Array<{ sig: string; nClass: string }> = [];
  for (const pair of pairs) {
    const key = `${pair.sig}\0${pair.nClass}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}

function releasePathFor(registryDir: string, hash: string): string {
  const prefix = registryDir === "." ? "" : `${registryDir}/`;
  return `${prefix}releases/${hash}.json`;
}

function fail(
  stage: ProbeStage,
  playerHash: string,
  message: string,
  details?: Record<string, unknown>,
): ProbeResult {
  return {
    ok: false,
    failure: {
      stage,
      playerHash,
      playerUrl: typeof details?.playerUrl === "string"
        ? details.playerUrl
        : undefined,
      message,
      details,
    },
  };
}

async function writeReleaseAndRegistry(
  releasePath: string,
  release: PlayerReleaseRecord,
  registryPath: string,
  registry: PlayerRegistry,
): Promise<void> {
  validatePlayerRegistry(registry, registryPath);
  await writeTextFileAtomic(
    releasePath,
    `${JSON.stringify(release, null, 2)}\n`,
  );
  await writeTextFileAtomic(
    registryPath,
    `${JSON.stringify(registry, null, 2)}\n`,
  );
}
