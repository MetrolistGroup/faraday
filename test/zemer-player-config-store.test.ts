import { assertRejects } from "@std/assert";
import { ZemerPlayerConfigStore } from "../src/zemer/player-config-store.ts";

Deno.test("missing player config file fails closed", async () => {
  await assertRejects(() =>
    ZemerPlayerConfigStore.fromFile(
      "test/fixtures/missing-player-configs.json",
    )
  );
});
