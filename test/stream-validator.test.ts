import { assertEquals, assertRejects } from "@std/assert";
import type { InnertubeCred } from "../src/innertube-cred.ts";
import {
  fetchSignatureCipher,
  fetchSignatureCipherGuest,
  probeCdnStream,
  validateCandidatePairs,
} from "../src/zemer/stream-validator.ts";

const CDN_URL = "https://x.googlevideo.com/videoplayback?n=valid_n_value";

Deno.test("authenticated cipher fetch is preferred when credentials exist", async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = ((_input, init) => {
    requests.push(init ?? {});
    return Promise.resolve(playerResponse());
  }) as typeof fetch;
  const cred: InnertubeCred = {
    cookie: "SAPISID=test-secret",
    visitorData: "visitor-data",
    dataSyncId: "",
    source: "test",
  };

  try {
    const result = await fetchSignatureCipher(1, {
      videoId: "dQw4w9WgXcQ",
      cred,
      preferAuth: true,
    });
    assertEquals(result.mode, "authenticated");
    assertEquals(requests.length, 1);
    assertEquals(
      new Headers(requests[0]?.headers).get("cookie"),
      cred.cookie,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("cipher fetch retries a temporary unplayable response in the same mode", async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = ((_input, init) => {
    requests.push(init ?? {});
    return Promise.resolve(
      requests.length === 1
        ? new Response(JSON.stringify({
          playabilityStatus: {
            status: "UNPLAYABLE",
            reason: "Video unavailable",
          },
        }))
        : playerResponse(),
    );
  }) as typeof fetch;
  const cred: InnertubeCred = {
    cookie: "SAPISID=test-secret",
    visitorData: "visitor-data",
    dataSyncId: "",
    source: "test",
  };
  try {
    assertEquals(
      await fetchSignatureCipher(20780, {
        videoId: "dQw4w9WgXcQ",
        cred,
        preferAuth: true,
      }),
      { cipher: signatureCipher("abc"), mode: "authenticated" },
    );
    assertEquals(requests.length, 2);
    assertEquals(
      requests.map((request) => new Headers(request.headers).get("cookie")),
      [cred.cookie, cred.cookie],
    );
    assertEquals(
      requests.map((request) => JSON.parse(String(request.body)).videoId),
      ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("cipher retry gets more time after a stalled player response body", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = ((_input, init) => {
    requests++;
    if (requests === 1) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("aborted", "AbortError"));
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(body));
    }
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(playerResponse()), 30);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  }) as typeof fetch;
  try {
    assertEquals(
      await fetchSignatureCipher(20780, {
        videoId: "dQw4w9WgXcQ",
        timeoutMs: 5,
      }),
      { cipher: signatureCipher("abc"), mode: "guest" },
    );
    assertEquals(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("cipher fetch falls back to guest after authenticated retries fail", async () => {
  const originalFetch = globalThis.fetch;
  const cookies: Array<string | null> = [];
  globalThis.fetch = ((_input, init) => {
    const cookie = new Headers(init?.headers).get("cookie");
    cookies.push(cookie);
    return Promise.resolve(
      cookie
        ? new Response(JSON.stringify({
          playabilityStatus: { status: "LOGIN_REQUIRED" },
        }))
        : playerResponse(),
    );
  }) as typeof fetch;
  const cred: InnertubeCred = {
    cookie: "SAPISID=test-secret",
    visitorData: "visitor-data",
    dataSyncId: "",
    source: "test",
  };
  try {
    const result = await fetchSignatureCipher(20780, {
      videoId: "dQw4w9WgXcQ",
      cred,
      preferAuth: true,
    });
    assertEquals(result.mode, "guest");
    assertEquals(cookies, [cred.cookie, cred.cookie, null]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("persistent cipher fetch failures stay bounded and identify the video", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (() => {
    requests++;
    return Promise.resolve(
      new Response(JSON.stringify({
        playabilityStatus: {
          status: "UNPLAYABLE",
          reason: "Video unavailable",
        },
      })),
    );
  }) as typeof fetch;
  try {
    const error = await assertRejects(
      () => fetchSignatureCipher(20780, { videoId: "9bZkp7q19f0" }),
      Error,
      "could not fetch signatureCipher for 9bZkp7q19f0",
    );
    assertEquals(requests, 2);
    assertEquals(error.message.includes("UNPLAYABLE Video unavailable"), true);
    assertEquals(error.message.includes("YT_COOKIE is not configured"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
    await assertRejects(
      () => fetchSignatureCipherGuest(1, "dQw4w9WgXcQ", 20),
      Error,
      "player request timed out after 20 ms",
    );
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

Deno.test("candidate validation retries transient CDN failures once", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (() => {
    requests++;
    return requests % 2 === 1
      ? Promise.reject(new Error("temporary network failure"))
      : Promise.resolve(cdnResponse(206));
  }) as typeof fetch;
  try {
    const result = await validateCandidatePairs(
      syntheticPlayer(),
      "aaaa1111",
      "bbbb2222",
      1,
      [signatureCipher("abc"), signatureCipher("def")],
      [{ sig: "S(1,2,INPUT)", nClass: "X" }],
      { timeoutMs: 1000, runtimeTimeoutMs: 5000 },
    );
    assertEquals(result.winner?.playerHash, "aaaa1111");
    assertEquals(requests, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("CDN retry gets more time than the initial stream request", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = ((_input, init) => {
    requests++;
    if (requests === 1) return Promise.reject(new Error("network blip"));
    if (requests !== 2) return Promise.resolve(cdnResponse(206));
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(cdnResponse(206)), 30);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      }, { once: true });
    });
  }) as typeof fetch;
  try {
    const result = await validateCandidatePairs(
      syntheticPlayer(),
      "aaaa1111",
      "bbbb2222",
      1,
      [signatureCipher("abc"), signatureCipher("def")],
      [{ sig: "S(1,2,INPUT)", nClass: "X" }],
      { timeoutMs: 5, runtimeTimeoutMs: 5000 },
    );
    assertEquals(result.winner?.playerHash, "aaaa1111");
    assertEquals(requests, 3);
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

function playerResponse(): Response {
  return new Response(JSON.stringify({
    playabilityStatus: { status: "OK" },
    streamingData: {
      adaptiveFormats: [{
        mimeType: "audio/webm",
        signatureCipher: signatureCipher("abc"),
      }],
    },
  }));
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
