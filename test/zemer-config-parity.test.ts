import { assert, assertEquals } from "@std/assert";
import { parsePlayerConfigs } from "../src/zemer/player-config-parser.ts";

const FIXTURE_DIR = "test/fixtures/zemer-config-parity";

Deno.test("config-parity fixtures include both accept and reject cases", async () => {
  const names: string[] = [];
  for await (const entry of Deno.readDir(FIXTURE_DIR)) {
    if (entry.isFile) names.push(entry.name);
  }
  assert(names.length > 0);
  assert(names.some((name) => name.startsWith("accept-")));
  assert(names.some((name) => name.startsWith("reject-")));
});

Deno.test("accept fixtures parse as success", async () => {
  for await (const entry of Deno.readDir(FIXTURE_DIR)) {
    if (!entry.isFile || !entry.name.startsWith("accept-")) continue;
    const json = await Deno.readTextFile(`${FIXTURE_DIR}/${entry.name}`);
    const result = parsePlayerConfigs(json);
    assertEquals(result.kind, "success", entry.name);
  }
});

Deno.test("reject fixtures parse as failure", async () => {
  for await (const entry of Deno.readDir(FIXTURE_DIR)) {
    if (!entry.isFile || !entry.name.startsWith("reject-")) continue;
    const json = await Deno.readTextFile(`${FIXTURE_DIR}/${entry.name}`);
    const result = parsePlayerConfigs(json);
    assertEquals(result.kind, "failure", entry.name);
  }
});
