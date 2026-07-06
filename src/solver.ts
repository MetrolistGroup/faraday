import type { Config } from "./config.ts";
import * as astring from "astring";
import * as meriyah from "meriyah";

const preprocessedByPlayerHash = new Map<string, string>();
let ejsRuntime: Promise<(payload: unknown) => EjsRawResult> | null = null;

type EjsRawResult = {
  type?: string;
  error?: unknown;
  preprocessed_player?: string;
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
  preprocessedByPlayerHash.set(playerHash, raw.preprocessed_player);
  return raw.preprocessed_player;
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
