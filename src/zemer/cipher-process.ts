import { JSDOM, VirtualConsole } from "jsdom";
import { buildNJsExpression } from "./player-config-parser.ts";
import type {
  CipherEvaluation,
  CipherProcessRequest,
} from "./cipher-runtime.ts";

const N_PROBE_INPUT = "KdrqFlzJXl9EcCwlmEy";
const PLAYER_IIFE_TRAILER = "})(_yt_player);";
const VALID_N_RESULT = /^[a-zA-Z0-9_-]+$/;

const request = JSON.parse(
  await new Response(Deno.stdin.readable).text(),
) as CipherProcessRequest;
await Deno.stdout.write(
  new TextEncoder().encode(JSON.stringify(evaluate(request))),
);

function evaluate(request: CipherProcessRequest): CipherEvaluation {
  const { playerJs, sigExpr, nClass, signatureCiphers } = request;
  const nExpr = buildNJsExpression(nClass);
  const sigStmt = `window._cipherSigFunc = function(sig){ try { return ${
    sigExpr.replaceAll("INPUT", "sig")
  }; } catch(e){ return null; } };`;
  const nStmt = `window._nTransformFunc = function(n){ try { return ${
    nExpr.replaceAll("INPUT", "n")
  }; } catch(e){ return n; } };`;
  const exportCode = `; ${sigStmt} ${nStmt} `;
  const injectionMode = playerJs.includes(PLAYER_IIFE_TRAILER)
    ? "iife"
    : "global-fallback";
  const modified = injectionMode === "iife"
    ? playerJs.replaceAll(
      PLAYER_IIFE_TRAILER,
      `${exportCode} ${PLAYER_IIFE_TRAILER}`,
    )
    : `${playerJs}\n${exportCode}`;

  const dom = new JSDOM(
    "<!DOCTYPE html><html><head></head><body></body></html>",
    {
      url: "https://www.youtube.com/",
      pretendToBeVisual: true,
      runScripts: "outside-only",
      virtualConsole: new VirtualConsole(),
    },
  );
  const win = dom.window as typeof globalThis & {
    _cipherSigFunc?: (sig: string) => unknown;
    _nTransformFunc?: (n: string) => unknown;
    _yt_player?: Record<string, unknown>;
    eval: (code: string) => unknown;
  };

  win._yt_player = {};
  win.TextEncoder ??= TextEncoder;
  win.TextDecoder ??= TextDecoder;
  let initError: string | null = null;
  try {
    win.eval(modified);
  } catch (error) {
    initError = errorMessage(error);
  }

  const sigFn = win._cipherSigFunc;
  const nFn = win._nTransformFunc;
  const nProbe = (() => {
    try {
      const output = nFn?.(N_PROBE_INPUT);
      const valid = typeof output === "string" &&
        output !== N_PROBE_INPUT &&
        output.length >= 5 &&
        VALID_N_RESULT.test(output);
      return {
        in: N_PROBE_INPUT,
        out: output == null ? undefined : String(output),
        changed: !!(output && output !== N_PROBE_INPUT),
        valid,
      };
    } catch (error) {
      return { error: errorMessage(error), valid: false };
    }
  })();

  const result: CipherEvaluation = {
    initError,
    injectionMode,
    sigAvailable: typeof sigFn === "function",
    nAvailable: typeof nFn === "function",
    nProbe,
  };
  try {
    result.urls = signatureCiphers.map((signatureCipher) =>
      deobfuscate(signatureCipher, sigFn, nFn)
    );
  } catch (error) {
    result.error = errorMessage(error);
  } finally {
    dom.window.close();
  }
  return result;
}

function deobfuscate(
  signatureCipher: string,
  sigFn: ((sig: string) => unknown) | undefined,
  nFn: ((n: string) => unknown) | undefined,
): string {
  if (typeof sigFn !== "function" || typeof nFn !== "function") {
    throw new Error("cipher functions unavailable");
  }
  const params: Record<string, string> = {};
  for (const pair of signatureCipher.split("&")) {
    const index = pair.indexOf("=");
    if (index > 0) {
      params[decodeURIComponent(pair.slice(0, index))] = decodeURIComponent(
        pair.slice(index + 1),
      );
    }
  }
  const s = params.s;
  const sp = params.sp || "signature";
  const url = params.url;
  if (s == null || url == null) throw new Error("missing s/url");
  const sig = sigFn(s);
  if (sig == null) throw new Error("sig returned null");
  let out = `${url}${url.includes("?") ? "&" : "?"}${sp}=${
    encodeURIComponent(String(sig))
  }`;
  const nMatch = out.match(/[?&]n=([^&]+)/);
  if (nMatch?.[1]) {
    const transformed = nFn(decodeURIComponent(nMatch[1]));
    if (transformed == null) throw new Error("n returned null");
    out = out.replace(
      /([?&])n=[^&]+/,
      `$1n=${encodeURIComponent(String(transformed))}`,
    );
  }
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
