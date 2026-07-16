import { assertEquals, assertThrows } from "@std/assert";
import type { Config } from "../src/config.ts";
import {
  discoverCurrentPlayerUrl,
  discoverPlayerCandidates,
} from "../src/warmup.ts";
import { loadPlayerSource } from "../src/player-source.ts";
import {
  extractPlayerHash,
  type PlayerRegistry,
  readPlayerRegistry,
  validatePlayerRegistry,
} from "../src/registry.ts";

const TEST_CONFIG: Config = {
  fetchTimeoutMs: 5000,
  maxWatchBytes: 2_000_000,
  maxPlayerJsBytes: 4_000_000,
  warmupVideoId: "dQw4w9WgXcQ",
  validationVideoIds: ["dQw4w9WgXcQ", "9bZkp7q19f0"],
  playerRegistryPath: "registry/player-registry.json",
  playerConfigsPath: "registry/player_configs.json",
  extraPlayerHashes: [],
};

Deno.test("extracts YouTube player hashes", () => {
  assertEquals(
    extractPlayerHash(
      "https://www.youtube.com/s/player/4918c89a/player_ias.vflset/en_US/base.js",
    ),
    "4918c89a",
  );
});

Deno.test("rejects unsupported player hash formats", () => {
  assertThrows(() =>
    extractPlayerHash(
      "https://www.youtube.com/s/player/not-eight/player_ias.vflset/en_GB/base.js",
    )
  );
});

Deno.test("normalizes protocol-relative YouTube player URLs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    const body = url.endsWith("/iframe_api")
      ? 'var player="\\/s\\/player\\/4918c89a\\/";'
      : '<script src="//www.youtube.com/s/player/4918c89a/player_ias.vflset/en_US/base.js"></script>';
    return Promise.resolve(new Response(body));
  }) as typeof fetch;
  try {
    assertEquals(
      await discoverCurrentPlayerUrl(TEST_CONFIG),
      "https://www.youtube.com/s/player/4918c89a/player_ias.vflset/en_GB/base.js",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("loadPlayerSource fetches a hash-specific player when hash is provided", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = ((input: string | URL | Request) => {
    requestedUrl = String(input);
    return Promise.resolve(new Response("var player = true;"));
  }) as unknown as typeof fetch;
  try {
    const source = await loadPlayerSource(TEST_CONFIG, {
      playerHash: "66a6ea83",
      cipherMode: true,
    });
    assertEquals(
      requestedUrl,
      "https://www.youtube.com/s/player/66a6ea83/player_ias.vflset/en_GB/base.js",
    );
    assertEquals(source.playerHash, "66a6ea83");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("discovery includes externally configured regional rotations", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/iframe_api")) {
      return Promise.resolve(
        new Response('var player="\\/s\\/player\\/4918c89a\\/";'),
      );
    }
    return Promise.resolve(
      new Response(
        '<script src="/s/player/4918c89a/player_es6.vflset/en_US/base.js"></script>',
      ),
    );
  }) as typeof fetch;
  try {
    const candidates = await discoverPlayerCandidates({
      ...TEST_CONFIG,
      extraPlayerHashes: ["66a6ea83"],
    });
    assertEquals(
      candidates.map((candidate) => candidate.playerHash),
      ["4918c89a", "66a6ea83"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("discovery samples canary and auxiliary player surfaces", async () => {
  const originalFetch = globalThis.fetch;
  let iframeRequests = 0;
  const requestCounts = new Map<string, number>();
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    requestCounts.set(url, (requestCounts.get(url) ?? 0) + 1);
    if (url.endsWith("/iframe_api")) {
      iframeRequests++;
      const hash = iframeRequests === 1 ? "caaca001" : "4918c89a";
      return Promise.resolve(
        new Response(`var player="\\/s\\/player\\/${hash}\\/";`),
      );
    }
    const hash = url.startsWith("https://music.youtube.com/")
      ? "abcde001"
      : url.includes("/embed/")
      ? "abcde002"
      : "4918c89a";
    return Promise.resolve(
      new Response(
        `<script src="/s/player/${hash}/player_ias.vflset/en_US/base.js"></script>`,
      ),
    );
  }) as typeof fetch;
  try {
    const candidates = await discoverPlayerCandidates(TEST_CONFIG);
    assertEquals(
      candidates.map((candidate) => candidate.playerHash),
      ["4918c89a", "caaca001", "abcde001", "abcde002"],
    );
    assertEquals(iframeRequests, 30);
    assertEquals(requestCounts.get("https://music.youtube.com/"), 5);
    assertEquals(
      requestCounts.get("https://www.youtube.com/embed/dQw4w9WgXcQ"),
      5,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("missing registry reads as empty but corrupt registry throws", () => {
  assertEquals(readPlayerRegistry("test/fixtures/missing-registry.json"), null);
  assertThrows(() =>
    readPlayerRegistry(
      "test/fixtures/zemer-config-parity/reject-malformed.json",
    )
  );
});

Deno.test("player release record identifies the Faraday validator", () => {
  const hash = "4918c89a";
  const registry: PlayerRegistry = {
    schemaVersion: 1,
    updatedAt: "2026-07-06T00:00:00.000Z",
    current: {
      playerHash: hash,
      playerUrl:
        `https://www.youtube.com/s/player/${hash}/player_ias.vflset/en_US/base.js`,
      discoveredAt: "2026-07-06T00:00:00.000Z",
    },
    players: [
      {
        playerHash: hash,
        playerUrl:
          `https://www.youtube.com/s/player/${hash}/player_ias.vflset/en_US/base.js`,
        sha256: "abc",
        firstSeenAt: "2026-07-06T00:00:00.000Z",
        status: "validated",
        validator: "faraday",
        configPath: "registry/player_configs.json",
        releaseTag: `player-${hash}`,
      },
    ],
  };
  const entry = registry.players[0];
  if (!entry) throw new Error("missing registry entry");

  assertEquals(entry.configPath, "registry/player_configs.json");
  assertEquals(entry.releaseTag, `player-${hash}`);
  assertEquals(entry.validator, "faraday");
  assertEquals(registry.current?.playerHash, hash);
});

Deno.test("registry schema validation rejects structurally corrupt JSON", () => {
  assertThrows(() =>
    validatePlayerRegistry({
      schemaVersion: 1,
      updatedAt: "not-a-date",
      current: null,
      players: [],
    })
  );
});
