import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { loadConfig } from "../../src/config.ts";
import { loadPlayerSource } from "../../src/player-source.ts";
import {
  fetchSignatureCipherGuest,
  probePlayerStream,
  validateCandidatePairs,
} from "../../src/zemer/stream-validator.ts";

const KNOWN_HASH = "66a6ea83";
const KNOWN_STS = 20640;
const CORRECT = { sig: "C3(15,933,INPUT)", nClass: "WM" };
const WRONG_SIG = { sig: "Tl(48,5831,INPUT)", nClass: "W_" };
const WRONG_DISPATCH = { sig: "C3(0,0,INPUT)", nClass: "WM" };

Deno.test("player API: malformed requests do not mirror a proper sts response", async () => {
  const videoId = "dQw4w9WgXcQ";
  const good = await probePlayerStream(KNOWN_STS, videoId);
  const missingSts = await probePlayerStream(null, videoId);
  const wrongSts = await probePlayerStream(1, videoId);
  const malformed = await probePlayerStream(KNOWN_STS, videoId, {
    malformedBody: true,
  });

  assertEquals(good.playability, "OK");
  assert(good.audioCipherCount > 0);
  assert(good.sParam);

  assertNotEquals(missingSts.playability, "OK");
  assertEquals(missingSts.audioCipherCount, 0);
  assertEquals(missingSts.sParam, null);

  assertNotEquals(wrongSts.playability, "OK");
  assertEquals(wrongSts.audioCipherCount, 0);
  assertEquals(wrongSts.sParam, null);

  assert(malformed.httpStatus === 400 || malformed.audioCipherCount === 0);
  assertEquals(malformed.sParam, null);
});

Deno.test("player API: wrong high sts yields a different signature payload", async () => {
  const videoId = "dQw4w9WgXcQ";
  const good = await probePlayerStream(KNOWN_STS, videoId);
  const wrongHigh = await probePlayerStream(99999, videoId);

  assert(good.sParam);
  assert(wrongHigh.sParam);
  assertNotEquals(wrongHigh.sParam, good.sParam);
});

Deno.test("stream validation: only the correct sig/n pair passes HTTP 206", async () => {
  const config = loadConfig();
  const source = await loadPlayerSource(config, {
    playerHash: KNOWN_HASH,
    cipherMode: true,
  });
  assertEquals(source.playerHash, KNOWN_HASH);

  const signatureCiphers = await Promise.all(
    config.validationVideoIds.map((videoId) =>
      fetchSignatureCipherGuest(KNOWN_STS, videoId)
    ),
  );
  const signatures = signatureCiphers.map((cipher) =>
    new URLSearchParams(cipher).get("s")
  );
  assert(signatures.every((signature) => signature && signature.length > 0));
  assertEquals(new Set(signatures).size, signatureCiphers.length);

  const good = await validateCandidatePairs(
    source.playerCode,
    KNOWN_HASH,
    "2afc9693",
    KNOWN_STS,
    signatureCiphers,
    [CORRECT],
  );
  const wrongSig = await validateCandidatePairs(
    source.playerCode,
    KNOWN_HASH,
    "2afc9693",
    KNOWN_STS,
    signatureCiphers,
    [WRONG_SIG],
  );
  const wrongDispatch = await validateCandidatePairs(
    source.playerCode,
    KNOWN_HASH,
    "2afc9693",
    KNOWN_STS,
    signatureCiphers,
    [WRONG_DISPATCH],
  );

  assert(good.winner);
  assertEquals(good.attempts[0]?.sampleStatuses, [206, 206]);
  assertEquals(good.attempts[0]?.works, true);

  assertEquals(wrongSig.winner, null);
  assertEquals(wrongSig.attempts[0]?.works, false);

  assertEquals(wrongDispatch.winner, null);
  assertEquals(wrongDispatch.attempts[0]?.works, false);
});

Deno.test("stream validation: cipher from wrong sts does not validate with correct sig/n", async () => {
  const config = loadConfig();
  const source = await loadPlayerSource(config, {
    playerHash: KNOWN_HASH,
    cipherMode: true,
  });

  const goodCipher = await fetchSignatureCipherGuest(
    KNOWN_STS,
    config.warmupVideoId,
  );
  const wrongCipher = await fetchSignatureCipherGuest(
    99999,
    config.warmupVideoId,
  );
  assertNotEquals(
    new URLSearchParams(goodCipher).get("s"),
    new URLSearchParams(wrongCipher).get("s"),
  );

  const withGoodCipher = await validateCandidatePairs(
    source.playerCode,
    KNOWN_HASH,
    "2afc9693",
    KNOWN_STS,
    goodCipher,
    [CORRECT],
  );
  const withWrongCipher = await validateCandidatePairs(
    source.playerCode,
    KNOWN_HASH,
    "2afc9693",
    KNOWN_STS,
    wrongCipher,
    [CORRECT],
  );

  assert(withGoodCipher.winner);
  assertEquals(withWrongCipher.winner, null);
  assertEquals(withWrongCipher.attempts[0]?.works, false);
  assertNotEquals(withWrongCipher.attempts[0]?.status, 206);
});
