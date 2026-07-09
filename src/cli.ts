export type ParsedArgs = {
  flags: Record<string, string | boolean>;
  rest: string[];
};

export function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") continue;
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    if (equalsIndex !== -1) {
      flags[arg.slice(2, equalsIndex)] = arg.slice(equalsIndex + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index++;
    } else {
      flags[key] = true;
    }
  }

  return { flags, rest };
}

export function stringFlag(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

export function numberFlag(
  flags: Record<string, string | boolean>,
  key: string,
  fallback: number,
): number {
  const value = stringFlag(flags, key);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(path));
}

export async function writeJsonFile(
  path: string,
  value: unknown,
): Promise<void> {
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
