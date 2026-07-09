import { assert, assertEquals } from "@std/assert";
import {
  derivedToEntry,
  derivePlayerConfigFromJs,
  enumerateCandidatePairs,
} from "../src/zemer/player-config-deriver.ts";

const SAMPLE_JS = `
var x = { signatureTimestamp: 20613 };
var P = {};
var K = new g.Yx(P, !0);
K.set("alr","yes");
K && (K = mP(4,155, dv(1,2,K)));
var probe = new g.Yx("https://x.googlevideo.com/videoplayback?n="+n, !0).get("n");
`;

Deno.test("derivePlayerConfigFromJs extracts assembler landmark fields", () => {
  const derived = derivePlayerConfigFromJs(SAMPLE_JS, "16ee6936");
  assertEquals(derived.sts, 20613);
  assertEquals(derived.sig, "mP(4,155,INPUT)");
  assertEquals(derived.nClass, "Yx");
  assertEquals(derived.nClassConfirmed, true);
});

Deno.test("derivedToEntry builds zemer-shaped config entry", () => {
  const derived = derivePlayerConfigFromJs(SAMPLE_JS, "16ee6936");
  const entry = derivedToEntry(derived, "16ee6936");
  if (!entry) throw new Error("missing entry");
  assertEquals(entry.sig, "mP(4,155,INPUT)");
  assertEquals(entry.nClass, "Yx");
  assertEquals(entry.sts, 20613);
  assert(entry.aliases && entry.aliases.length > 0);
});

Deno.test("enumerateCandidatePairs finds sig and nClass candidates", () => {
  const candidates = enumerateCandidatePairs(SAMPLE_JS);
  assert(candidates.sigExprs.includes("mP(4,155,INPUT)"));
  assert(candidates.nClasses.includes("Yx"));
  assert(
    candidates.pairs.some((pair) =>
      pair.sig === "mP(4,155,INPUT)" && pair.nClass === "Yx"
    ),
  );
});

Deno.test("derivePlayerConfigFromJs accepts 1-8 char identifiers", () => {
  const js = `
  var x = { signatureTimestamp: 20613 };
  var P = {};
  var K = new g.Abc123_$(P, !0);
  K.set("alr","yes");
  K && (K = Fn123456(4,155, Wrap1234(1,2,K)));
  var probe = new g.Abc123_$('https://x.googlevideo.com/videoplayback?n='+n, !0).get("n");
  `;
  const derived = derivePlayerConfigFromJs(js, "16ee6936");
  assertEquals(derived.sig, "Fn123456(4,155,INPUT)");
  assertEquals(derived.nClass, "Abc123_$");
});
