import { assertEquals } from "@std/assert";
import {
  discordWebhookUrl,
  notifyProbeFailure,
} from "../src/discord-webhook.ts";

Deno.test("discordWebhookUrl returns null when unset", () => {
  const previous = Deno.env.get("DISCORD_WEBHOOK_URL");
  Deno.env.delete("DISCORD_WEBHOOK_URL");
  try {
    assertEquals(discordWebhookUrl(), null);
  } finally {
    if (previous) Deno.env.set("DISCORD_WEBHOOK_URL", previous);
  }
});

Deno.test("notifyProbeFailure posts embed payload to webhook", async () => {
  const previous = Deno.env.get("DISCORD_WEBHOOK_URL");
  Deno.env.set("DISCORD_WEBHOOK_URL", "https://discord.test/webhook");

  const originalFetch = globalThis.fetch;
  let captured: { url: string; body: unknown } | undefined;
  globalThis.fetch = ((input, init) => {
    captured = {
      url: String(input),
      body: JSON.parse(String(init?.body)),
    };
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;

  try {
    const sent = await notifyProbeFailure({
      title: "test failure",
      stage: "stream-validation",
      playerHash: "66a6ea83",
      message: "no HTTP 206",
    });
    assertEquals(sent, true);
    if (!captured) throw new Error("missing fetch call");
    assertEquals(captured.url, "https://discord.test/webhook");
    const body = captured.body as {
      content: string;
      allowed_mentions: { parse: string[]; users: string[] };
      embeds: Array<{ title: string }>;
    };
    assertEquals(body.content, "<@1242567443742986373>");
    assertEquals(body.allowed_mentions, {
      parse: [],
      users: ["1242567443742986373"],
    });
    const embed = body.embeds[0];
    assertEquals(embed.title, "test failure");
  } finally {
    globalThis.fetch = originalFetch;
    if (previous) Deno.env.set("DISCORD_WEBHOOK_URL", previous);
    else Deno.env.delete("DISCORD_WEBHOOK_URL");
  }
});

Deno.test("notifyProbeFailure no-ops when webhook unset", async () => {
  const previous = Deno.env.get("DISCORD_WEBHOOK_URL");
  Deno.env.delete("DISCORD_WEBHOOK_URL");

  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (() => {
    called = true;
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;

  try {
    const sent = await notifyProbeFailure({
      title: "ignored",
      stage: "discovery",
      message: "missing webhook",
    });
    assertEquals(sent, false);
    assertEquals(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous) Deno.env.set("DISCORD_WEBHOOK_URL", previous);
  }
});
