import type { ZemerHardcodedPlayerConfig } from "./types.ts";

/** Ported from zemer-cipher PlayerConfigParser.kt */
export const ZEMER_SUPPORTED_SCHEMA_VERSION = 1;

const SIG_RE = /^[A-Za-z0-9$_]{1,8}\(\d+,\d+,INPUT\)$/;
const NCLASS_RE = /^[A-Za-z0-9$_]{1,8}$/;
export const ZEMER_PLAYER_HASH_RE = /^[a-f0-9]{8}$/;

export type ZemerParseSuccess = {
  kind: "success";
  configs: Map<string, ZemerHardcodedPlayerConfig>;
  skippedEntries: string[];
};

export type ZemerParseFailure = {
  kind: "failure";
  reason: string;
};

export type ZemerParseResult = ZemerParseSuccess | ZemerParseFailure;

export function buildNJsExpression(nClass: string): string {
  return "(function(n){try{var u=new g." + nClass +
    "('https://x.googlevideo.com/videoplayback?n='+n,true);" +
    "var t=u.get('n');return(t&&t!==n)?t:n;}catch(e){return n;}})(INPUT)";
}

export function parsePlayerConfigs(jsonText: string): ZemerParseResult {
  const invalidNumber = findNonCanonicalJsonNumber(jsonText);
  if (invalidNumber) {
    return {
      kind: "failure",
      reason: `non-canonical integer '${invalidNumber}'`,
    };
  }

  let root: unknown;
  try {
    root = JSON.parse(jsonText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "failure", reason: `malformed JSON: ${message}` };
  }

  if (!isRecord(root)) {
    return { kind: "failure", reason: "root is not a JSON object" };
  }

  const schemaVersion = readIntPrimitive(root.schemaVersion);
  if (schemaVersion === null) {
    return { kind: "failure", reason: "schemaVersion missing or not an int" };
  }
  if (schemaVersion <= 0) {
    return { kind: "failure", reason: "schemaVersion must be positive" };
  }
  if (schemaVersion > ZEMER_SUPPORTED_SCHEMA_VERSION) {
    return {
      kind: "failure",
      reason:
        `unsupported schemaVersion ${schemaVersion} (supported: ${ZEMER_SUPPORTED_SCHEMA_VERSION})`,
    };
  }

  const players = root.players;
  if (!isRecord(players)) {
    return { kind: "failure", reason: "players missing or not an object" };
  }

  const configs = new Map<string, ZemerHardcodedPlayerConfig>();
  const skipped: string[] = [];

  for (const [hash, entryElement] of Object.entries(players)) {
    const entry = parseEntry(hash, entryElement);
    if (!entry) {
      skipped.push(hash);
      continue;
    }
    const [config, aliases] = entry;
    const keys = [hash, ...aliases];
    const duplicateWithin = keys.find((key, index) =>
      keys.indexOf(key) !== index
    );
    const duplicateAcross = keys.find((key) => configs.has(key));
    const duplicate = duplicateWithin ?? duplicateAcross;
    if (duplicate) {
      return {
        kind: "failure",
        reason: `duplicate hash/alias '${duplicate}' (entry ${hash})`,
      };
    }
    configs.set(hash, config);
    for (const alias of aliases) configs.set(alias, config);
  }

  return { kind: "success", configs, skippedEntries: skipped };
}

export function mergePlayerConfigs(
  bundled: Map<string, ZemerHardcodedPlayerConfig>,
  remote: Map<string, ZemerHardcodedPlayerConfig>,
): Map<string, ZemerHardcodedPlayerConfig> {
  return new Map([...bundled, ...remote]);
}

function parseEntry(
  hash: string,
  obj: unknown,
): [ZemerHardcodedPlayerConfig, string[]] | null {
  if (!isRecord(obj) || !ZEMER_PLAYER_HASH_RE.test(hash)) return null;

  const sig = readString(obj.sig);
  if (!sig || !SIG_RE.test(sig)) return null;

  const nClass = readString(obj.nClass);
  if (!nClass || !NCLASS_RE.test(nClass)) return null;

  const sts = readIntPrimitive(obj.sts);
  if (sts === null || sts <= 0) return null;

  const aliases = parseAliases(obj.aliases);
  if (aliases === null) return null;

  const config: ZemerHardcodedPlayerConfig = {
    sigFuncName: "_expr_sig",
    sigConstantArg: null,
    sigConstantArgs: null,
    sigPreprocessFunc: null,
    sigPreprocessArgs: null,
    sigJsExpression: sig,
    nFuncName: "_expr_n",
    nArrayIndex: null,
    nConstantArgs: null,
    nJsExpression: buildNJsExpression(nClass),
    signatureTimestamp: sts,
  };
  return [config, aliases];
}

function parseAliases(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const aliases: string[] = [];
  for (const element of value) {
    if (
      typeof element !== "string" || !ZEMER_PLAYER_HASH_RE.test(element)
    ) return null;
    aliases.push(element);
  }
  return aliases;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readIntPrimitive(value: unknown): number | null {
  if (
    typeof value === "number" && Number.isInteger(value) &&
    value >= -2_147_483_648 && value <= 2_147_483_647
  ) return value;
  return null;
}

function findNonCanonicalJsonNumber(jsonText: string): string | null {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < jsonText.length; index++) {
    const char = jsonText[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char !== "-" && (char == null || char < "0" || char > "9")) {
      continue;
    }
    let end = index + 1;
    while (end < jsonText.length && /[0-9.eE+-]/.test(jsonText[end] ?? "")) {
      end++;
    }
    const token = jsonText.slice(index, end);
    if (/^-?(?:0|[1-9]\d*)$/.test(token)) {
      const value = Number(token);
      if (
        Number.isInteger(value) && value >= -2_147_483_648 &&
        value <= 2_147_483_647
      ) {
        index = end - 1;
        continue;
      }
    }
    return token;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
