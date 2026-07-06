import type { Config } from "./config.ts";
import * as astring from "astring";
import * as meriyah from "meriyah";
import { minify } from "terser";

const preprocessedByPlayerHash = new Map<string, string>();
let ejsRuntime: Promise<(payload: unknown) => EjsRawResult> | null = null;

type EjsRawResult = {
  type?: string;
  error?: unknown;
  preprocessed_player?: string;
  responses?: EjsRawResponse[];
};

type EjsRawResponse = {
  type?: string;
  error?: unknown;
  data?: Record<string, unknown>;
};

export async function preprocessPlayer(
  playerHash: string,
  playerCode: string,
  config: Config,
): Promise<string> {
  const cached = preprocessedByPlayerHash.get(playerHash);
  if (cached) return cached;
  const jsc = await getEjsRuntime(config);
  const raw = jsc({
    type: "player",
    player: playerCode,
    output_preprocessed: true,
    requests: [],
  });
  if (raw.type !== "result") {
    throw new Error(String(raw.error ?? "unexpected EJS result"));
  }
  if (
    typeof raw.preprocessed_player !== "string" ||
    raw.preprocessed_player.length === 0
  ) {
    throw new Error(
      `EJS preprocessing produced no config for player ${playerHash}`,
    );
  }
  const compacted = await compactPreprocessedPlayer(raw.preprocessed_player);
  assertEquivalentPreprocessed(jsc, raw.preprocessed_player, compacted);
  preprocessedByPlayerHash.set(playerHash, compacted);
  return compacted;
}

async function compactPreprocessedPlayer(preprocessedPlayer: string): Promise<string> {
  const result = await minify(preprocessedPlayer, {
    compress: false,
    mangle: false,
    format: { comments: false },
  });
  if (!result.code) throw new Error("Terser produced no preprocessed player output");
  return result.code;
}

function assertEquivalentPreprocessed(
  jsc: (payload: unknown) => EjsRawResult,
  original: string,
  compacted: string,
): void {
  const requests = [
    { type: "sig", challenges: ["abcdefghijklmnopqrstuvwxyz"] },
    { type: "n", challenges: ["0123456789abcdef"] },
  ];
  const originalResult = solvePreprocessedSamples(jsc, original, requests);
  const compactedResult = solvePreprocessedSamples(jsc, compacted, requests);
  if (JSON.stringify(originalResult) !== JSON.stringify(compactedResult)) {
    throw new Error("Compacted preprocessed player changed EJS solve output");
  }
}

function solvePreprocessedSamples(
  jsc: (payload: unknown) => EjsRawResult,
  preprocessedPlayer: string,
  requests: Array<{ type: string; challenges: string[] }>,
): Array<Record<string, string>> {
  const raw = jsc({
    type: "preprocessed",
    preprocessed_player: preprocessedPlayer,
    requests,
  });
  if (raw.type !== "result") {
    throw new Error(String(raw.error ?? "unexpected EJS validation result"));
  }
  return (raw.responses ?? []).map((response) => {
    if (response.type !== "result") {
      throw new Error(String(response.error ?? "unexpected EJS validation response"));
    }
    return Object.fromEntries(
      Object.entries(response.data ?? {}).map(([key, value]) => [key, String(value)]),
    );
  });
}

async function getEjsRuntime(
  config: Config,
): Promise<(payload: unknown) => EjsRawResult> {
  ejsRuntime ??= loadEjsRuntime(config);
  try {
    return await ejsRuntime;
  } catch (error) {
    ejsRuntime = null;
    throw error;
  }
}

async function loadEjsRuntime(
  config: Config,
): Promise<(payload: unknown) => EjsRawResult> {
  const lib = await Deno.readTextFile(`${config.ejsDir}/yt.solver.lib.min.js`);
  const core = await Deno.readTextFile(
    `${config.ejsDir}/yt.solver.core.min.js`,
  );
  const runtimeGlobal = { console } as Record<string, unknown>;

  Function(
    "globalThis",
    `${lib}; globalThis.lib = typeof lib !== "undefined" ? lib : globalThis.lib;`,
  )(runtimeGlobal);
  Object.assign(runtimeGlobal, runtimeGlobal.lib);
  Function(
    "astring",
    "meriyah",
    "globalThis",
    `${core}; globalThis.jsc = jsc;`,
  )(astring, meriyah, runtimeGlobal);

  const jsc = runtimeGlobal.jsc;
  if (typeof jsc !== "function") {
    throw new Error("yt-dlp EJS did not expose jsc()");
  }
  return jsc as (payload: unknown) => EjsRawResult;
}
