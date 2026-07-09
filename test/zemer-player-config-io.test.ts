import { assertEquals, assertRejects } from "@std/assert";
import {
  mergePlayerConfigEntry,
  readPlayerConfigsFile,
} from "../src/zemer/player-config-io.ts";

const VALID = `{
  "schemaVersion": 1,
  "players": {
    "aaaa1111": {
      "sig": "F(1,2,INPUT)",
      "nClass": "N",
      "sts": 1,
      "aliases": ["bbbb2222"]
    }
  }
}\n`;

Deno.test("strict config reader rejects skipped entries", async () => {
  await withTempFile(
    '{"schemaVersion":1,"players":{"bad":{"sig":"F(1,2,INPUT)","nClass":"N","sts":1}}}',
    async (path) => {
      await assertRejects(() => readPlayerConfigsFile(path));
    },
  );
});

Deno.test("config merge rejects collisions without changing the file", async () => {
  await withTempFile(VALID, async (path) => {
    await assertRejects(() =>
      mergePlayerConfigEntry(path, "bbbb2222", {
        sig: "G(3,4,INPUT)",
        nClass: "M",
        sts: 2,
      })
    );
    assertEquals(await Deno.readTextFile(path), VALID);
  });
});

Deno.test("config merge refuses to create a missing table", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await assertRejects(() =>
      mergePlayerConfigEntry(`${directory}/missing.json`, "cccc3333", {
        sig: "G(3,4,INPUT)",
        nClass: "M",
        sts: 2,
      })
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function withTempFile(
  text: string,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const path = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(path, text);
    await run(path);
  } finally {
    await Deno.remove(path);
  }
}
