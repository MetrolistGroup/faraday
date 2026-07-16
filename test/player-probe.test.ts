import { assertEquals } from "@std/assert";
import type { Config } from "../src/config.ts";
import { runPlayerProbe } from "../src/player-probe.ts";
import { readPlayerRegistry } from "../src/registry.ts";
import { readPlayerConfigsFile } from "../src/zemer/player-config-io.ts";

const HASH = "aaaa1111";

Deno.test("known player stops after discovery without validation", async () => {
  const directory = await Deno.makeTempDir();
  const config: Config = {
    fetchTimeoutMs: 1000,
    maxWatchBytes: 100_000,
    maxPlayerJsBytes: 100_000,
    warmupVideoId: "dQw4w9WgXcQ",
    validationVideoIds: ["dQw4w9WgXcQ", "9bZkp7q19f0"],
    playerRegistryPath: `${directory}/player-registry.json`,
    playerConfigsPath: `${directory}/player_configs.json`,
    extraPlayerHashes: [],
  };
  await Deno.writeTextFile(
    config.playerConfigsPath,
    JSON.stringify({
      schemaVersion: 1,
      players: {
        [HASH]: { sig: "S(1,2,INPUT)", nClass: "X", sts: 20001 },
      },
    }),
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const result = await runPlayerProbe(config);
    assertEquals(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assertEquals(result.success.action, "unchanged");
    assertEquals(result.success.streamMode, null);
    const file = await readPlayerConfigsFile(config.playerConfigsPath);
    assertEquals(file.players[HASH]?.sts, 20001);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("check-only reports every sampled unknown player", async () => {
  const directory = await Deno.makeTempDir();
  const config: Config = {
    fetchTimeoutMs: 1000,
    maxWatchBytes: 100_000,
    maxPlayerJsBytes: 100_000,
    warmupVideoId: "dQw4w9WgXcQ",
    validationVideoIds: ["dQw4w9WgXcQ", "9bZkp7q19f0"],
    playerRegistryPath: `${directory}/player-registry.json`,
    playerConfigsPath: `${directory}/player_configs.json`,
    extraPlayerHashes: [],
  };
  await Deno.writeTextFile(
    config.playerConfigsPath,
    JSON.stringify({
      schemaVersion: 1,
      players: {
        [HASH]: { sig: "S(1,2,INPUT)", nClass: "X", sts: 20001 },
      },
    }),
  );

  const originalFetch = globalThis.fetch;
  let iframeRequests = 0;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/iframe_api")) {
      iframeRequests++;
      const hash = iframeRequests === 5
        ? "bbbb2222"
        : iframeRequests === 19
        ? "cccc3333"
        : HASH;
      return Promise.resolve(
        new Response(`var player="\\/s\\/player\\/${hash}\\/";`),
      );
    }
    return Promise.resolve(
      new Response(
        `<script src="/s/player/${HASH}/player_ias.vflset/en_US/base.js"></script>`,
      ),
    );
  }) as typeof fetch;
  try {
    const result = await runPlayerProbe(config, { checkOnly: true });
    assertEquals(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assertEquals(result.success.action, "new-player");
    assertEquals(result.success.newPlayerHashes, ["bbbb2222", "cccc3333"]);
    assertEquals(result.success.currentPlayerHash, HASH);

    globalThis.fetch = (() => {
      throw new Error("configured probe should not fetch during discovery");
    }) as typeof fetch;
    const direct = await runPlayerProbe(config, {
      checkOnly: true,
      playerHash: "dddd4444",
    });
    assertEquals(direct.ok, true, JSON.stringify(direct));
    if (direct.ok) {
      assertEquals(direct.success.playerHash, "dddd4444");
    }
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("known dominant player repairs a stale current pointer", async () => {
  const directory = await Deno.makeTempDir();
  const config: Config = {
    fetchTimeoutMs: 1000,
    maxWatchBytes: 100_000,
    maxPlayerJsBytes: 100_000,
    warmupVideoId: "dQw4w9WgXcQ",
    validationVideoIds: ["dQw4w9WgXcQ", "9bZkp7q19f0"],
    playerRegistryPath: `${directory}/player-registry.json`,
    playerConfigsPath: `${directory}/player_configs.json`,
    extraPlayerHashes: [],
  };
  await Deno.writeTextFile(
    config.playerConfigsPath,
    JSON.stringify({
      schemaVersion: 1,
      players: {
        [HASH]: { sig: "S(1,2,INPUT)", nClass: "X", sts: 20001 },
      },
    }),
  );
  const oldHash = "eeee5555";
  const oldUrl =
    `https://www.youtube.com/s/player/${oldHash}/player_ias.vflset/en_GB/base.js`;
  const playerUrl =
    `https://www.youtube.com/s/player/${HASH}/player_ias.vflset/en_GB/base.js`;
  await Deno.writeTextFile(
    config.playerRegistryPath,
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-07-16T00:00:00.000Z",
      current: {
        playerHash: oldHash,
        playerUrl: oldUrl,
        discoveredAt: "2026-07-16T00:00:00.000Z",
      },
      players: [HASH, oldHash].map((playerHash) => ({
        playerHash,
        playerUrl: playerHash === HASH ? playerUrl : oldUrl,
        sha256: "a".repeat(64),
        firstSeenAt: "2026-07-16T00:00:00.000Z",
        status: "validated",
        validator: "faraday",
        configPath: config.playerConfigsPath,
        releaseTag: `player-${playerHash}`,
      })),
    }),
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("known direct player should not fetch");
  }) as typeof fetch;
  try {
    const result = await runPlayerProbe(config, { playerHash: HASH });
    assertEquals(result.ok, true, JSON.stringify(result));
    if (result.ok) assertEquals(result.success.action, "current-updated");
    assertEquals(
      readPlayerRegistry(config.playerRegistryPath)?.current?.playerHash,
      HASH,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(directory, { recursive: true });
  }
});

function mockFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = String(input);
  if (url.endsWith("/iframe_api")) {
    return Promise.resolve(
      new Response(`var player="\\/s\\/player\\/${HASH}\\/";`),
    );
  }
  if (
    url.includes("/watch?") || url.includes("/embed/") ||
    url.startsWith("https://music.youtube.com/")
  ) {
    return Promise.resolve(
      new Response(
        `<script src="/s/player/${HASH}/player_es6.vflset/en_US/base.js"></script>`,
      ),
    );
  }
  if (url.endsWith("/base.js")) {
    return Promise.resolve(new Response(syntheticPlayer()));
  }
  if (url.includes("/youtubei/v1/player")) {
    const videoId = JSON.parse(String(init?.body)).videoId as string;
    return Promise.resolve(
      new Response(JSON.stringify({
        playabilityStatus: { status: "OK" },
        streamingData: {
          adaptiveFormats: [{
            mimeType: "audio/webm",
            signatureCipher: `s=${videoId}&sp=sig&url=${
              encodeURIComponent(
                `https://x.googlevideo.com/videoplayback?n=old&sample=${videoId}`,
              )
            }`,
          }],
        },
      })),
    );
  }
  if (url.includes("googlevideo.com/videoplayback")) {
    const response = new Response(new Uint8Array(2048), {
      status: 206,
      headers: {
        "Content-Type": "audio/webm",
        "Content-Range": "bytes 0-2047/10000",
      },
    });
    Object.defineProperty(response, "url", { value: url });
    return Promise.resolve(response);
  }
  return Promise.reject(new Error(`unexpected fetch: ${url}`));
}

function syntheticPlayer(): string {
  return `(function(g){
var meta={signatureTimestamp:20002};
g.X=class{get(){return "valid_n_value"}};
function S(a,b,input){return input.split("").reverse().join("")}
})(_yt_player);`;
}
