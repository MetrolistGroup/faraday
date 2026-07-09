/** Ported from zemer-app tests/cred.mjs */

export type InnertubeCred = {
  cookie: string;
  visitorData: string;
  dataSyncId: string;
  source: string;
};

const LABELS: Record<string, keyof InnertubeCred> = {
  "INNERTUBE COOKIE": "cookie",
  "VISITOR DATA": "visitorData",
  "DATASYNC ID": "dataSyncId",
};

export function parseCookieFile(text: string): Partial<InnertubeCred> {
  const out: Partial<InnertubeCred> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\*\*\*\s*(.+?)\s*\*\*\*\s*=(.*)$/);
    if (!match) continue;
    const field = LABELS[match[1].trim().toUpperCase()];
    if (field) out[field] = match[2].trim();
  }
  return out;
}

export async function loadInnertubeCred(
  options: { cookieFile?: string } = {},
): Promise<InnertubeCred> {
  const cookieFile = options.cookieFile ??
    Deno.env.get("COOKIE_FILE") ??
    "innertube_cookie.txt";
  let fromFile: Partial<InnertubeCred> = {};
  let source = "env";

  try {
    const text = await Deno.readTextFile(cookieFile);
    fromFile = parseCookieFile(text);
    source = cookieFile;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      console.warn(`cred: failed to read ${cookieFile}: ${error}`);
    }
  }

  let cookie = Deno.env.get("YT_COOKIE") ?? fromFile.cookie ?? "";
  let visitorData = Deno.env.get("YT_VISITOR_DATA") ?? fromFile.visitorData ??
    "";
  let dataSyncId = Deno.env.get("YT_DATASYNC_ID") ?? fromFile.dataSyncId ?? "";

  const credUrl = Deno.env.get("CRED_URL");
  if (!cookie && !visitorData && credUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(credUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      if (!text) throw new Error("credential fetch returned no body");
      const json = JSON.parse(text) as Partial<InnertubeCred>;
      cookie = json.cookie ?? "";
      visitorData = json.visitorData ?? "";
      dataSyncId = json.dataSyncId ?? "";
      source = credUrl;
    } catch (error) {
      console.warn(`cred: CRED_URL fetch failed: ${error}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  return { cookie, visitorData, dataSyncId, source };
}

export function describeCred(cred: InnertubeCred): string {
  const has = (value: string) => (value ? "yes" : "NO");
  return [
    `cookie=${has(cred.cookie)}`,
    `SAPISID=${/SAPISID=/.test(cred.cookie) ? "yes" : "NO"}`,
    `visitorData=${
      cred.visitorData ? cred.visitorData.slice(0, 14) + "…" : ""
    }`,
    `dataSyncId=${
      cred.dataSyncId ? cred.dataSyncId.slice(0, 8) + "…" : "(none)"
    }`,
    `[${cred.source}]`,
  ].join(" ");
}

export function decodeVisitorData(value: string): string {
  try {
    return value && /%[0-9A-Fa-f]{2}/.test(value)
      ? decodeURIComponent(value)
      : value;
  } catch {
    return value;
  }
}
