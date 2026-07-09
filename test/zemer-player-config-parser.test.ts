import { assert, assertEquals } from "@std/assert";
import {
  buildNJsExpression,
  parsePlayerConfigs,
} from "../src/zemer/player-config-parser.ts";

const VALID_ENTRY =
  `"16ee6936": { "sig": "mP(4,155,INPUT)", "nClass": "Yx", "sts": 20613, "aliases": ["ca366632"] }`;

function file(players: string, schemaVersion = 1): string {
  return `{ "schemaVersion": ${schemaVersion}, "players": { ${players} } }`;
}

function parseSuccess(json: string) {
  const result = parsePlayerConfigs(json);
  assertEquals(result.kind, "success");
  if (result.kind !== "success") throw new Error("expected success");
  return result;
}

Deno.test("valid entry parses into expression-based config shape", () => {
  const success = parseSuccess(file(VALID_ENTRY));
  const config = success.configs.get("16ee6936");
  if (!config) throw new Error("missing config");
  assertEquals(config.sigFuncName, "_expr_sig");
  assertEquals(config.sigJsExpression, "mP(4,155,INPUT)");
  assertEquals(config.nFuncName, "_expr_n");
  assertEquals(config.nJsExpression, buildNJsExpression("Yx"));
  assertEquals(config.signatureTimestamp, 20613);
  assertEquals(success.skippedEntries.length, 0);
});

Deno.test("alias resolves to the same config instance as primary hash", () => {
  const success = parseSuccess(file(VALID_ENTRY));
  assertEquals(
    success.configs.get("16ee6936"),
    success.configs.get("ca366632"),
  );
});

Deno.test("entry without aliases is valid", () => {
  const success = parseSuccess(
    file(
      `"69e2a55d": { "sig": "Jf(20,3699,INPUT)", "nClass": "iE", "sts": 20611 }`,
    ),
  );
  assertEquals([...success.configs.keys()].sort(), ["69e2a55d"]);
});

Deno.test("entry with null aliases is skipped like zemer-cipher", () => {
  const success = parseSuccess(
    file(
      `"69e2a55d": { "sig": "Jf(20,3699,INPUT)", "nClass": "iE", "sts": 20611, "aliases": null }`,
    ),
  );
  assertEquals([...success.configs.keys()], []);
  assertEquals(success.skippedEntries, ["69e2a55d"]);
});

Deno.test("alias collision rejects the whole file", () => {
  const result = parsePlayerConfigs(
    file(
      `${VALID_ENTRY}, "deadbeef": { "sig": "Jf(20,3699,INPUT)", "nClass": "iE", "sts": 20611, "aliases": ["16ee6936"] }`,
    ),
  );
  assertEquals(result.kind, "failure");
});

Deno.test("sig with appended statement is skipped", () => {
  const success = parseSuccess(
    file(
      `"aaaa1111": { "sig": "mP(4,155,INPUT);alert(1)", "nClass": "Yx", "sts": 1 }, ${VALID_ENTRY}`,
    ),
  );
  assert(success.skippedEntries.includes("aaaa1111"));
  assert(success.configs.has("16ee6936"));
});

Deno.test("string sts is skipped", () => {
  const success = parseSuccess(
    file(
      `"aaaa1111": { "sig": "mP(4,155,INPUT)", "nClass": "Yx", "sts": "20613" }, ${VALID_ENTRY}`,
    ),
  );
  assert(success.skippedEntries.includes("aaaa1111"));
});

Deno.test("non-canonical and out-of-range integers reject the file", () => {
  for (const sts of ["1.0", "1e3", "2147483648"]) {
    const result = parsePlayerConfigs(
      file(
        `"aaaa1111": { "sig": "mP(4,155,INPUT)", "nClass": "Yx", "sts": ${sts} }`,
      ),
    );
    assertEquals(result.kind, "failure", sts);
  }
});

Deno.test("newer schemaVersion rejects the whole file", () => {
  const result = parsePlayerConfigs(file(VALID_ENTRY, 2));
  assertEquals(result.kind, "failure");
});

Deno.test("n template matches cross-language golden file", async () => {
  const golden = await Deno.readTextFile(
    "test/fixtures/zemer-config-parity/n-template-Yx.golden",
  );
  assertEquals(buildNJsExpression("Yx"), golden);
});

Deno.test("n template matches pre-refactor literals", () => {
  const golden: Record<string, string> = {
    W_: buildNJsExpression("W_"),
    W1: buildNJsExpression("W1"),
    uY: buildNJsExpression("uY"),
    iE: buildNJsExpression("iE"),
    Yx: buildNJsExpression("Yx"),
    cV: buildNJsExpression("cV"),
  };
  for (const [nClass, expected] of Object.entries(golden)) {
    assertEquals(buildNJsExpression(nClass), expected, nClass);
  }
});

Deno.test("bundled player_configs.json parses successfully", async () => {
  const json = await Deno.readTextFile("registry/player_configs.json");
  const result = parsePlayerConfigs(json);
  assertEquals(result.kind, "success");
  if (result.kind !== "success") return;
  assertEquals(result.skippedEntries, []);
  assert(result.configs.size > 0);
  assert(result.configs.has("66a6ea83"));
  const file = JSON.parse(json) as {
    players: Record<string, { aliases?: string[] }>;
  };
  const expandedCount = Object.values(file.players).reduce(
    (count, entry) => count + 1 + (entry.aliases?.length ?? 0),
    0,
  );
  assertEquals(result.configs.size, expandedCount);
});
