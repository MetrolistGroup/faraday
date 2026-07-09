import { assertEquals, assertRejects } from "@std/assert";
import {
  fetchSignatureCipherGuest,
  probeCdnStream,
  validateCandidatePairs,
} from "../src/zemer/stream-validator.ts";

const CDN_URL = "https://x.googlevideo.com/videoplayback?n=valid_n_value";

Deno.test("CDN validation requires 206 audio range bytes", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (() =>
      Promise.resolve(cdnResponse(200))) as typeof fetch;
    assertEquals((await probeCdnStream(CDN_URL)).valid, false);

    globalThis.fetch = (() =>
      Promise.resolve(cdnResponse(206))) as typeof fetch;
    const valid = await probeCdnStream(CDN_URL);
    assertEquals(valid.valid, true);
    assertEquals(valid.bytesRead >= 1024, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("player response timeout remains active while reading the body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input, init) => {
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    init?.signal?.addEventListener(
      "abort",
      () => streamController.error(new DOMException("aborted", "AbortError")),
    );
    return Promise.resolve(new Response(body));
  }) as typeof fetch;
  try {
    await assertRejects(() => fetchSignatureCipherGuest(1, "dQw4w9WgXcQ", 20));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("multiple passing candidate pairs are rejected as ambiguous", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(cdnResponse(206))) as typeof fetch;
  try {
    const result = await validateCandidatePairs(
      syntheticPlayer(),
      "aaaa1111",
      "bbbb2222",
      1,
      [signatureCipher("abc"), signatureCipher("def")],
      [
        { sig: "S(1,2,INPUT)", nClass: "X" },
        { sig: "T(1,2,INPUT)", nClass: "X" },
      ],
      { timeoutMs: 1000, runtimeTimeoutMs: 5000 },
    );
    assertEquals(result.ambiguous, true);
    assertEquals(result.winner, null);
    assertEquals(result.attempts.every((attempt) => attempt.works), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("candidate validation enforces its pair cap", async () => {
  await assertRejects(() =>
    validateCandidatePairs(
      syntheticPlayer(),
      "aaaa1111",
      "bbbb2222",
      1,
      signatureCipher("abc"),
      Array.from({ length: 25 }, (_, index) => ({
        sig: `S(${index},2,INPUT)`,
        nClass: "X",
      })),
    )
  );
});

function cdnResponse(status: number): Response {
  const response = new Response(new Uint8Array(2048), {
    status,
    headers: {
      "Content-Type": "audio/webm",
      ...(status === 206 ? { "Content-Range": "bytes 0-2047/10000" } : {}),
    },
  });
  Object.defineProperty(response, "url", { value: CDN_URL });
  return response;
}

function signatureCipher(signature: string): string {
  return `s=${signature}&sp=sig&url=${
    encodeURIComponent(`${CDN_URL}&sample=${signature}`)
  }`;
}

function syntheticPlayer(): string {
  return `(function(g){
g.X=class{get(){return "valid_n_value"}};
function S(a,b,input){return input.split("").reverse().join("")}
function T(a,b,input){return input.split("").reverse().join("")}
})(_yt_player);`;
}
