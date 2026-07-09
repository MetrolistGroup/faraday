import { assertEquals } from "@std/assert";
import type { Config } from "../src/config.ts";
import { runPlayerProbe } from "../src/player-probe.ts";
import { readPlayerConfigsFile } from "../src/zemer/player-config-io.ts";

const HASH = "aaaa1111";

Deno.test("known config validation repairs committed sts before publishing", async () => {
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
    const file = await readPlayerConfigsFile(config.playerConfigsPath);
    assertEquals(file.players[HASH]?.sts, 20002);
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
  if (url.includes("/watch?")) {
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
