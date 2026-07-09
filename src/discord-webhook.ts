export type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type ProbeFailureNotice = {
  title: string;
  stage: string;
  playerHash?: string;
  message: string;
  fields?: DiscordEmbedField[];
};

const FAILURE_MENTION_USER_ID = "1242567443742986373";

export function discordWebhookUrl(): string | null {
  const value = Deno.env.get("DISCORD_WEBHOOK_URL")?.trim();
  return value || null;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export async function notifyProbeFailure(
  notice: ProbeFailureNotice,
): Promise<boolean> {
  const webhookUrl = discordWebhookUrl();
  if (!webhookUrl) {
    console.warn("DISCORD_WEBHOOK_URL not set — skipping Discord notification");
    return false;
  }

  const fields = [
    { name: "Stage", value: notice.stage, inline: true },
    ...(notice.playerHash
      ? [{ name: "Player hash", value: notice.playerHash, inline: true }]
      : []),
    ...(notice.fields ?? []),
    { name: "Message", value: truncate(notice.message, 1024) },
  ];

  const body = {
    content: `<@${FAILURE_MENTION_USER_ID}>`,
    allowed_mentions: {
      parse: [],
      users: [FAILURE_MENTION_USER_ID],
    },
    embeds: [{
      title: truncate(notice.title, 256),
      color: 0xed4245,
      fields,
      timestamp: new Date().toISOString(),
    }],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      console.warn(
        `Discord webhook failed (${response.status}): ${text.slice(0, 200)}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`Discord webhook failed: ${error}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
