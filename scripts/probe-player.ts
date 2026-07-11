import { loadConfig } from "../src/config.ts";
import { notifyProbeFailure } from "../src/discord-webhook.ts";
import { runPlayerProbe } from "../src/player-probe.ts";

try {
  const result = await runPlayerProbe(loadConfig(), {
    checkOnly: Deno.env.get("PROBE_CHECK_ONLY") === "1",
  });
  if (result.ok) {
    const { success } = result;
    await setOutput("new_player", String(success.action === "new-player"));
    await setOutput("player_hash", success.playerHash);
    await setOutput(
      "processed_player",
      String(!["unchanged", "new-player"].includes(success.action)),
    );
    const stream = success.streamMode ? ` (stream=${success.streamMode})` : "";
    console.log(`Player ${success.playerHash}: ${success.action}${stream}`);
    Deno.exit(0);
  }

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
