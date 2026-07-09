import { assert, assertEquals, assertRejects } from "@std/assert";
import { evaluateCipherCandidate } from "../src/zemer/cipher-runtime.ts";

const SIGNATURE_CIPHER =
  "s=abc&sp=sig&url=https%3A%2F%2Fx.googlevideo.com%2Fvideoplayback%3Fn%3Dold";

Deno.test("cipher process evaluates a valid candidate", async () => {
  const result = await evaluateCipherCandidate({
    playerJs: syntheticPlayer(""),
    sigExpr: "S(1,2,INPUT)",
    nClass: "X",
    signatureCiphers: [SIGNATURE_CIPHER],
  }, 5000);

  assertEquals(result.initError, null);
  assertEquals(result.nProbe.valid, true);
  assertEquals(
    result.urls,
    ["https://x.googlevideo.com/videoplayback?n=valid_n_value&sig=cba"],
  );
});

Deno.test("cipher process cannot write through a jsdom escape", async () => {
  const directory = await Deno.makeTempDir();
  const target = `${directory}/escaped`;
  try {
    const attack =
      `window.constructor.constructor("return process")().getBuiltinModule("fs").writeFileSync(${
        JSON.stringify(target)
      },"owned");`;
    const result = await evaluateCipherCandidate({
      playerJs: syntheticPlayer(attack),
      sigExpr: "S(1,2,INPUT)",
      nClass: "X",
      signatureCiphers: [SIGNATURE_CIPHER],
    }, 5000);
    assert(result.initError?.includes("Requires write access"));
    await assertRejects(() => Deno.stat(target));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("cipher process cannot read through a jsdom escape", async () => {
  const attack =
    'window.constructor.constructor("return process")().getBuiltinModule("fs").readFileSync(".env","utf8");';
  const result = await evaluateCipherCandidate({
    playerJs: syntheticPlayer(attack),
    sigExpr: "S(1,2,INPUT)",
    nClass: "X",
    signatureCiphers: [SIGNATURE_CIPHER],
  }, 5000);
  assert(result.initError?.includes("Requires read access"));
});

Deno.test("cipher process output is bounded", async () => {
  const attack =
    'window.constructor.constructor("return process")().stdout.write("x".repeat(70000));';
  await assertRejects(() =>
    evaluateCipherCandidate({
      playerJs: syntheticPlayer(attack),
      sigExpr: "S(1,2,INPUT)",
      nClass: "X",
      signatureCiphers: [SIGNATURE_CIPHER],
    }, 5000)
  );
});

Deno.test("cipher process is killed on synchronous evaluation timeout", async () => {
  await assertRejects(
    () =>
      evaluateCipherCandidate({
        playerJs: syntheticPlayer("while(true){}"),
        sigExpr: "S(1,2,INPUT)",
        nClass: "X",
        signatureCiphers: [SIGNATURE_CIPHER],
      }, 100),
  );
});

function syntheticPlayer(prefix: string): string {
  return `(function(g){${prefix}
g.X=class{get(){return "valid_n_value"}};
function S(a,b,input){return input.split("").reverse().join("")}
})(_yt_player);`;
}
