import { loadConfig } from "../src/config.ts";
import { notifyProbeFailure } from "../src/discord-webhook.ts";
import { runPlayerProbe } from "../src/player-probe.ts";

try {
  const config = loadConfig();
  const checkOnly = Deno.env.get("PROBE_CHECK_ONLY") === "1";
  const requestedHashes = !checkOnly && config.extraPlayerHashes.length > 0
    ? config.extraPlayerHashes
    : [undefined];
  const currentPlayerHash = Deno.env.get("CURRENT_PLAYER_HASH") ??
    config.extraPlayerHashes[0];
  const successes = [];

  for (const playerHash of requestedHashes) {
    const result = await runPlayerProbe(config, {
      checkOnly,
      playerHash,
      updateCurrent: !playerHash || playerHash === currentPlayerHash,
    });
    if (!result.ok) {
      const { failure } = result;
      console.error(`Probe failed [${failure.stage}] ${failure.message}`);
      if (failure.details) {
        console.error(JSON.stringify(failure.details, null, 2));
      }
      await notifyProbeFailure({
        title: "Faraday player probe failed",
        stage: failure.stage,
        playerHash: failure.playerHash,
        message: failure.message,
        fields: failure.playerUrl
          ? [{ name: "Player URL", value: failure.playerUrl }]
          : undefined,
      });
      Deno.exit(1);
    }
    successes.push(result.success);
    const stream = result.success.streamMode
      ? ` (stream=${result.success.streamMode})`
      : "";
    console.log(
      `Player ${result.success.playerHash}: ${result.success.action}${stream}`,
    );
  }

  const first = successes[0];
  if (!first) throw new Error("probe returned no results");
  const newPlayerHashes = first.newPlayerHashes ??
    successes.filter((success) => success.action === "new-player").map((
      success,
    ) => success.playerHash);
  const changedPlayers = successes
    .filter((success) => !["unchanged", "new-player"].includes(success.action));
  const processedPlayerHashes = changedPlayers
    .filter((success) => success.action !== "current-updated")
    .map((success) => success.playerHash);
  await setOutput("new_player", String(newPlayerHashes.length > 0));
  await setOutput("player_hash", newPlayerHashes[0] ?? first.playerHash);
  await setOutput("player_hashes", newPlayerHashes.join(","));
  const dominantPlayerHash = first.currentPlayerHash ?? first.playerHash;
  await setOutput(
    "probe_player_hashes",
    [...new Set([...newPlayerHashes, dominantPlayerHash])].join(","),
  );
  await setOutput(
    "current_player_hash",
    dominantPlayerHash,
  );
  await setOutput(
    "processed_player",
    String(changedPlayers.length > 0),
  );
  await setOutput("processed_player_hashes", processedPlayerHashes.join(","));
  Deno.exit(0);
} catch (error) {
  const message = error instanceof Error
    ? error.stack ?? error.message
    : String(error);
  console.error(`Probe crashed: ${message}`);
  await notifyProbeFailure({
    title: "Faraday player probe crashed",
    stage: "internal",
    message,
  });
}

Deno.exit(1);

async function setOutput(name: string, value: string): Promise<void> {
  const path = Deno.env.get("GITHUB_OUTPUT");
  if (path) {
    await Deno.writeTextFile(path, `${name}=${value}\n`, { append: true });
  }
}
