import { assertEquals, assertThrows } from "jsr:@std/assert";
import { discoverCurrentPlayerUrl } from "../src/warmup.ts";
import {
  extractPlayerHash,
  type PlayerConfig,
  type PlayerRegistry,
  readPlayerRegistry,
} from "../src/registry.ts";

Deno.test("extracts YouTube player hashes", () => {
  assertEquals(
    extractPlayerHash(
      "https://www.youtube.com/s/player/4918c89a/player_ias.vflset/en_US/base.js",
    ),
    "4918c89a",
  );
});

Deno.test("normalizes protocol-relative YouTube player URLs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      '<script src="//www.youtube.com/s/player/4918c89a/player_ias.vflset/en_US/base.js"></script>',
    )) as unknown as typeof fetch;
  try {
    assertEquals(
      await discoverCurrentPlayerUrl({
        fetchTimeoutMs: 5000,
        maxWatchBytes: 2_000_000,
        maxPlayerJsBytes: 4_000_000,
        ejsDir: "src/yt_ejs",
        warmupVideoId: "test-video",
        playerRegistryPath: "registry/player-registry.json",
      }),
      "https://www.youtube.com/s/player/4918c89a/player_ias.vflset/en_US/base.js",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("missing registry reads as empty but corrupt registry throws", () => {
  const dir = Deno.makeTempDirSync({ prefix: "faraday-" });
  const missingPath = `${dir}/missing.json`;
  const corruptPath = `${dir}/corrupt.json`;
  try {
    assertEquals(readPlayerRegistry(missingPath), null);
    Deno.writeTextFileSync(corruptPath, "{");
    assertThrows(() => readPlayerRegistry(corruptPath));
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("player config shape matches immutable release URL model", () => {
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
        validator: "yt-dlp-ejs",
        configPath: `registry/players/${hash}.json`,
        releaseTag: `player-${hash}`,
      },
    ],
  };
  const entry = registry.players[0];
  if (!entry) throw new Error("missing registry entry");

  const config: PlayerConfig = {
    schemaVersion: 1,
    generatedAt: "2026-07-06T00:00:00.000Z",
    playerHash: hash,
    playerUrl: entry.playerUrl,
    sha256: entry.sha256,
    nTransform: {
      type: "yt-dlp-ejs-preprocessed-player",
      preprocessedPlayer: "preprocessed-player-js",
    },
  };

  assertEquals(entry.configPath, `registry/players/${hash}.json`);
  assertEquals(entry.releaseTag, `player-${hash}`);
  assertEquals(config.nTransform.type, "yt-dlp-ejs-preprocessed-player");
  assertEquals(registry.current?.playerHash, config.playerHash);
});
