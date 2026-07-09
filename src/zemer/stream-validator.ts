/**
 * HTTP 206 stream validation ported from zemer-app tests/validate-player-config.mjs
 */
import { createHash } from "node:crypto";
import type { InnertubeCred } from "../innertube-cred.ts";
import { decodeVisitorData, loadInnertubeCred } from "../innertube-cred.ts";
import { evaluateCipherCandidate } from "./cipher-runtime.ts";
import type { CandidatePair } from "./player-config-deriver.ts";
import type { ZemerPlayerConfigEntry } from "./types.ts";

const ORIGIN = "https://music.youtube.com";
const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
const WEB_REMIX = {
  clientName: "WEB_REMIX",
  clientVersion: "1.20260213.01.00",
  clientId: "67",
};
const DEFAULT_FETCH_TIMEOUT_MS = 5000;
const DEFAULT_RUNTIME_TIMEOUT_MS = 15_000;
const DEFAULT_VALIDATION_DEADLINE_MS = 120_000;
const MAX_CANDIDATE_PAIRS = 24;
const MIN_STREAM_BYTES = 1024;

export type SignatureCipherMode = "guest" | "authenticated";

export type SignatureCipherResult = {
  cipher: string;
  mode: SignatureCipherMode;
};

export type ValidationAttempt = {
  sig: string;
  nClass: string;
  nProbeChanged: boolean | undefined;
  nProbeValid: boolean | undefined;
  injectionMode: "iife" | "global-fallback";
  status: number | string;
  sampleStatuses: Array<number | string>;
  works: boolean;
};

export type ValidationWinner = {
  playerHash: string;
  md5Alias: string;
  sts: number;
  sig: string;
  nClass: string;
  entry: ZemerPlayerConfigEntry;
};

export type ValidationResult = {
  playerHash: string;
  md5Alias: string;
  sts: number;
  attempts: ValidationAttempt[];
  winner: ValidationWinner | null;
  ambiguous: boolean;
};

function sapisidHash(cookie: string): string | null {
  const match = cookie.match(/(?:^|; )SAPISID=([^;]+)/);
  if (!match?.[1]) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHash("sha1")
    .update(`${timestamp} ${match[1]} ${ORIGIN}`)
    .digest("hex");
  return `SAPISIDHASH ${timestamp}_${digest}`;
}

function buildPlayerRequest(
  sts: number,
  videoId: string,
  cred?: InnertubeCred,
) {
  return {
    context: {
      client: {
        clientName: WEB_REMIX.clientName,
        clientVersion: WEB_REMIX.clientVersion,
        gl: "US",
        hl: "en",
        ...(cred?.visitorData ? { visitorData: cred.visitorData } : {}),
      },
    },
    videoId,
    playbackContext: {
      contentPlaybackContext: { signatureTimestamp: sts },
    },
  };
}

function buildPlayerHeaders(cred?: InnertubeCred): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": WEB_UA,
    "X-Goog-Api-Format-Version": "1",
    "X-YouTube-Client-Name": WEB_REMIX.clientId,
    "X-YouTube-Client-Version": WEB_REMIX.clientVersion,
    "X-Origin": ORIGIN,
    Referer: `${ORIGIN}/`,
  };
  if (cred?.visitorData) {
    headers["X-Goog-Visitor-Id"] = cred.visitorData;
  }
  if (cred?.cookie) {
    headers.cookie = cred.cookie;
    const authorization = sapisidHash(cred.cookie);
    if (authorization) headers.Authorization = authorization;
  }
  return headers;
}

async function requestSignatureCipher(
  sts: number,
  videoId: string,
  cred?: InnertubeCred,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<string> {
  const { response, text } = await fetchTextWithTimeout(
    `${ORIGIN}/youtubei/v1/player?prettyPrint=false`,
    {
      method: "POST",
      headers: buildPlayerHeaders(cred),
      body: JSON.stringify(buildPlayerRequest(sts, videoId, cred)),
    },
    timeoutMs,
  );
  if (!response.ok) {
    throw new Error(`player request failed: HTTP ${response.status}`);
  }
  if (!text) throw new Error("player fetch returned no body");
  const json = JSON.parse(text) as {
    playabilityStatus?: { status?: string; reason?: string };
    streamingData?: {
      adaptiveFormats?: Array<{ signatureCipher?: string; mimeType?: string }>;
    };
  };

  const playability = json.playabilityStatus?.status;
  if (playability && playability !== "OK") {
    throw new Error(
      `player response not OK: ${playability} ${
        json.playabilityStatus?.reason ?? ""
      }`.trim(),
    );
  }

  const format = (json.streamingData?.adaptiveFormats ?? []).find((item) =>
    item.signatureCipher && (item.mimeType ?? "").startsWith("audio/")
  );
  if (!format?.signatureCipher) {
    throw new Error(
      "could not get signatureCipher from player response (url/sabr?)",
    );
  }
  return format.signatureCipher;
}

export type PlayerStreamProbe = {
  httpStatus: number;
  playability: string | null;
  audioCipherCount: number;
  signatureCipher: string | null;
  sParam: string | null;
};

/** Inspect WEB_REMIX player response without throwing — for negative/control tests. */
export async function probePlayerStream(
  sts: number | null,
  videoId: string,
  options: { malformedBody?: boolean } = {},
): Promise<PlayerStreamProbe> {
  const body = options.malformedBody ? { invalid: true } : sts == null
    ? {
      context: {
        client: {
          clientName: WEB_REMIX.clientName,
          clientVersion: WEB_REMIX.clientVersion,
          gl: "US",
          hl: "en",
        },
      },
      videoId,
      playbackContext: {},
    }
    : buildPlayerRequest(sts, videoId);

  const { response, text } = await fetchTextWithTimeout(
    `${ORIGIN}/youtubei/v1/player?prettyPrint=false`,
    {
      method: "POST",
      headers: buildPlayerHeaders(),
      body: JSON.stringify(body),
    },
    DEFAULT_FETCH_TIMEOUT_MS,
  );

  let json: {
    playabilityStatus?: { status?: string };
    streamingData?: {
      adaptiveFormats?: Array<{ signatureCipher?: string; mimeType?: string }>;
    };
  } = {};
  try {
    if (!text) throw new Error("player fetch returned no body");
    json = JSON.parse(text);
  } catch {
    return {
      httpStatus: response.status,
      playability: null,
      audioCipherCount: 0,
      signatureCipher: null,
      sParam: null,
    };
  }

  const audio = (json.streamingData?.adaptiveFormats ?? []).filter((item) =>
    item.signatureCipher && (item.mimeType ?? "").startsWith("audio/")
  );
  const signatureCipher = audio[0]?.signatureCipher ?? null;
  const sParam = signatureCipher
    ? new URLSearchParams(signatureCipher).get("s")
    : null;

  return {
    httpStatus: response.status,
    playability: json.playabilityStatus?.status ?? null,
    audioCipherCount: audio.length,
    signatureCipher,
    sParam,
  };
}

/** Unauthenticated WEB_REMIX — no cookie or visitor data required. */
export async function fetchSignatureCipherGuest(
  sts: number,
  videoId: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<string> {
  return await requestSignatureCipher(sts, videoId, undefined, timeoutMs);
}

/** Authenticated WEB_REMIX fallback when guest mode is blocked. */
export async function fetchSignatureCipherAuthenticated(
  sts: number,
  cred: InnertubeCred,
  videoId: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<string> {
  return await requestSignatureCipher(sts, videoId, cred, timeoutMs);
}

export async function fetchSignatureCipher(
  sts: number,
  options: {
    videoId?: string;
    cred?: InnertubeCred | null;
    preferAuth?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<SignatureCipherResult> {
  const videoId = options.videoId ??
    Deno.env.get("WARMUP_VIDEO_ID") ??
    "dQw4w9WgXcQ";
  const cred = options.cred ?? null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const order: SignatureCipherMode[] = options.preferAuth && cred?.cookie
    ? ["authenticated", "guest"]
    : ["guest", "authenticated"];

  let lastError: Error | null = null;
  for (const mode of order) {
    if (mode === "authenticated") {
      if (!cred?.cookie) continue;
      try {
        const cipher = await fetchSignatureCipherAuthenticated(
          sts,
          cred,
          videoId,
          timeoutMs,
        );
        return { cipher, mode };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      continue;
    }

    try {
      const cipher = await fetchSignatureCipherGuest(sts, videoId, timeoutMs);
      return { cipher, mode };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("could not fetch signatureCipher");
}

export type CdnProbeResult = {
  status: number | string;
  valid: boolean;
  bytesRead: number;
  contentType: string | null;
  contentRange: string | null;
};

export async function probeCdnStream(
  url: string,
  range = "bytes=0-262143",
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<CdnProbeResult> {
  if (!isGoogleVideoPlaybackUrl(url)) {
    return cdnFailure("ERR:invalid CDN URL");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": WEB_UA,
        Range: range,
        Connection: "close",
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type");
    const contentRange = response.headers.get("content-range");
    if (
      response.status !== 206 ||
      !contentType?.toLowerCase().startsWith("audio/") ||
      !contentRange ||
      !/^bytes 0-\d+\/(?:\d+|\*)$/i.test(contentRange) ||
      !isGoogleVideoPlaybackUrl(response.url) ||
      !response.body
    ) {
      await response.body?.cancel();
      return {
        status: response.status,
        valid: false,
        bytesRead: 0,
        contentType,
        contentRange,
      };
    }

    const reader = response.body.getReader();
    let bytesRead = 0;
    while (bytesRead < MIN_STREAM_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value?.byteLength ?? 0;
    }
    await reader.cancel();
    return {
      status: response.status,
      valid: bytesRead >= MIN_STREAM_BYTES,
      bytesRead,
      contentType,
      contentRange,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return cdnFailure(`ERR:${message.slice(0, 30)}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateCandidatePairs(
  playerJs: string,
  playerHash: string,
  md5Alias: string,
  sts: number,
  signatureCipher: string | string[],
  pairs: CandidatePair[],
  options: {
    timeoutMs?: number;
    runtimeTimeoutMs?: number;
    deadlineMs?: number;
  } = {},
): Promise<ValidationResult> {
  if (pairs.length > MAX_CANDIDATE_PAIRS) {
    throw new Error(
      `refusing to validate ${pairs.length} candidate pairs (max ${MAX_CANDIDATE_PAIRS})`,
    );
  }
  const signatureCiphers = Array.isArray(signatureCipher)
    ? signatureCipher
    : [signatureCipher];
  if (signatureCiphers.length === 0) {
    throw new Error("at least one signatureCipher is required");
  }
  const signatures = signatureCiphers.map((cipher) =>
    new URLSearchParams(cipher).get("s")
  );
  if (signatures.some((signature) => !signature)) {
    throw new Error("signatureCipher missing s");
  }
  if (new Set(signatures).size !== signatures.length) {
    throw new Error("validation signatureCipher samples must be distinct");
  }

  const attempts: ValidationAttempt[] = [];
  const passing: CandidatePair[] = [];
  const deadline = Date.now() +
    (options.deadlineMs ?? DEFAULT_VALIDATION_DEADLINE_MS);

  for (const pair of pairs) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("candidate validation deadline exceeded");
    }
    let status: number | string = "n/a";
    let sampleStatuses: Array<number | string> = [];
    let nProbeChanged: boolean | undefined;
    let nProbeValid: boolean | undefined;
    let injectionMode: "iife" | "global-fallback" = "global-fallback";
    let works = false;
    try {
      const evaluation = await evaluateCipherCandidate(
        {
          playerJs,
          sigExpr: pair.sig,
          nClass: pair.nClass,
          signatureCiphers,
        },
        Math.min(
          options.runtimeTimeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS,
          remaining,
        ),
      );
      injectionMode = evaluation.injectionMode;
      nProbeChanged = evaluation.nProbe.changed;
      nProbeValid = evaluation.nProbe.valid;
      if (evaluation.error || !evaluation.urls) {
        throw new Error(evaluation.error ?? "cipher returned no URLs");
      }
      const probes: CdnProbeResult[] = [];
      for (const url of evaluation.urls) {
        const fetchRemaining = deadline - Date.now();
        if (fetchRemaining <= 0) {
          throw new Error("candidate validation deadline exceeded");
        }
        probes.push(
          await probeCdnStream(
            url,
            "bytes=0-262143",
            Math.min(
              options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
              fetchRemaining,
            ),
          ),
        );
      }
      sampleStatuses = probes.map((probe) => probe.status);
      status = sampleStatuses.length === 1
        ? sampleStatuses[0] ?? "n/a"
        : sampleStatuses.join(",");
      works = evaluation.nProbe.valid === true &&
        probes.length === signatureCiphers.length &&
        probes.every((probe) => probe.valid);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = `deob-fail:${message.slice(0, 60)}`;
      sampleStatuses = [status];
    }
    attempts.push({
      sig: pair.sig,
      nClass: pair.nClass,
      nProbeChanged,
      nProbeValid,
      injectionMode,
      status,
      sampleStatuses,
      works,
    });

    if (works) passing.push(pair);
  }

  const pair = passing.length === 1 ? passing[0] : undefined;
  const aliases = md5Alias !== playerHash ? [md5Alias] : [];
  const winner = pair
    ? {
      playerHash,
      md5Alias,
      sts,
      sig: pair.sig,
      nClass: pair.nClass,
      entry: {
        sig: pair.sig,
        nClass: pair.nClass,
        sts,
        ...(aliases.length > 0 ? { aliases } : {}),
      },
    }
    : null;
  return {
    playerHash,
    md5Alias,
    sts,
    attempts,
    winner,
    ambiguous: passing.length > 1,
  };
}

async function fetchTextWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

function isGoogleVideoPlaybackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname.endsWith(".googlevideo.com") &&
      url.pathname === "/videoplayback";
  } catch {
    return false;
  }
}

function cdnFailure(status: number | string): CdnProbeResult {
  return {
    status,
    valid: false,
    bytesRead: 0,
    contentType: null,
    contentRange: null,
  };
}

export async function loadCredForValidation(): Promise<InnertubeCred> {
  const cred = await loadInnertubeCred();
  return {
    ...cred,
    visitorData: decodeVisitorData(cred.visitorData),
  };
}
