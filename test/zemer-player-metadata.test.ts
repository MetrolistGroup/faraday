import { assertEquals } from "@std/assert";
import { zemerContentHash } from "../src/hash.ts";
import {
  extractPlayerMetadata,
  hasQArrayObfuscation,
} from "../src/zemer/player-metadata.ts";

Deno.test("zemer content hash uses first 10k bytes and returns 8 hex chars", () => {
  const hash = zemerContentHash("x".repeat(20_000));
  assertEquals(hash.length, 8);
  assertEquals(hash, zemerContentHash("x".repeat(20_000)));
});

Deno.test("extractPlayerMetadata prefers anchored signatureTimestamp", () => {
  const metadata = extractPlayerMetadata(
    "var x = { signatureTimestamp: 20640 }; var sts = 1;",
    { knownHash: "66a6ea83" },
  );
  assertEquals(metadata.signatureTimestamp, 20640);
  assertEquals(metadata.playerHash, "66a6ea83");
});

Deno.test("extractPlayerMetadata builds alias when content hash differs", () => {
  const playerJs = "var x = { signatureTimestamp: 20640 };";
  const metadata = extractPlayerMetadata(playerJs, { knownHash: "66a6ea83" });
  const alias = zemerContentHash(playerJs);
  assertEquals(metadata.contentHash, alias);
  assertEquals(metadata.aliases, alias !== "66a6ea83" ? [alias] : []);
});

Deno.test("hasQArrayObfuscation detects Q-array pattern", () => {
  const js = 'var Q = "a}b}c".split("}")';
  assertEquals(hasQArrayObfuscation(js), true);
});
