/**
 * Assembler-landmark extractor ported from zemer-app tests/derive-player-config.mjs
 * and tests/validate-player-config.mjs (candidates()).
 */
import { zemerContentHash } from "../hash.ts";
import type { ZemerPlayerConfigEntry } from "./types.ts";

export type DerivedPlayerConfig = {
  urlHash: string | null;
  md5Alias: string;
  sts: number | null;
  sig: string | null;
  nClass: string | null;
  nClassConfirmed: boolean;
  decodeWrapper: string | null;
};

export type CandidatePair = {
  sig: string;
  nClass: string;
};

export type CandidateEnumeration = {
  sigExprs: string[];
  nClasses: string[];
  pairs: CandidatePair[];
};

const STS_PATTERN = /signatureTimestamp['":\s]+(\d{4,6})/;
const URL_HASH_PATTERN = /\/s\/player\/([a-f0-9]{8})\//;

export function derivePlayerConfigFromJs(
  playerJs: string,
  knownHash?: string | null,
): DerivedPlayerConfig {
  const sts = Number(STS_PATTERN.exec(playerJs)?.[1]) || null;
  const urlHash = knownHash ??
    URL_HASH_PATTERN.exec(playerJs)?.[1] ??
    null;
  const md5Alias = zemerContentHash(playerJs);

  const alr = playerJs.indexOf('.set("alr","yes")');
  let nClass: string | null = null;
  let sig: string | null = null;
  let decodeWrapper: string | null = null;

  if (alr >= 0) {
    const window = playerJs.slice(Math.max(0, alr - 80), alr + 160);
    const nMatch = window.match(
      /new\s+g\.([A-Za-z0-9$_]{1,8})\s*\([^,()]+,\s*!0\s*\)\s*;\s*[A-Za-z0-9$_]+\.set\("alr","yes"\)/,
    );
    if (nMatch?.[1]) nClass = nMatch[1];

    const alrSlice = window.slice(window.indexOf('"alr"'));
    const sigMatch = alrSlice.match(
      /([A-Za-z0-9$_]{1,8})\((\d+),(\d+),\s*([A-Za-z0-9$_]{1,8})\((\d+),(\d+),/,
    );
    if (sigMatch) {
      sig = `${sigMatch[1]}(${sigMatch[2]},${sigMatch[3]},INPUT)`;
      decodeWrapper = `${sigMatch[4]}(${sigMatch[5]},${sigMatch[6]},…)`;
    }
  }

  let nClassConfirmed = false;
  if (nClass) {
    nClassConfirmed = new RegExp(
      `new\\s+g\\.${
        escapeRegExp(nClass)
      }\\([^)]*\\)\\)?\\s*\\.\\s*get\\("n"\\)`,
    ).test(playerJs) ||
      (new RegExp(`g\\.${escapeRegExp(nClass)}\\b`).test(playerJs) &&
        /\.get\("n"\)/.test(playerJs));
  }

  if (!sig || !nClass) {
    const candidates = enumerateCandidatePairs(playerJs);
    sig = sig ?? candidates.sigExprs[0] ?? null;
    nClass = nClass ?? candidates.nClasses[0] ?? null;
    if (nClass && !nClassConfirmed) {
      nClassConfirmed = new RegExp(
        `new\\s+g\\.${
          escapeRegExp(nClass)
        }\\([^)]*\\)\\)?\\s*\\.\\s*get\\("n"\\)`,
      ).test(playerJs) ||
        (new RegExp(`g\\.${escapeRegExp(nClass)}\\b`).test(playerJs) &&
          /\.get\("n"\)/.test(playerJs));
    }
  }

  return {
    urlHash,
    md5Alias,
    sts,
    sig,
    nClass,
    nClassConfirmed,
    decodeWrapper,
  };
}

export function enumerateCandidatePairs(
  playerJs: string,
): CandidateEnumeration {
  const sigExprs: string[] = [];
  const nClasses = [
    ...new Set([
      ...[
        ...playerJs.matchAll(
          /new\s+g\.([A-Za-z0-9$_]{1,8})\([^)]*\)\)?\s*\.\s*get\("n"\)/g,
        ),
      ].map((match) => match[1]),
    ]),
  ];

  const alr = playerJs.indexOf('.set("alr","yes")');
  if (alr >= 0) {
    const window = playerJs.slice(Math.max(0, alr - 120), alr + 10);
    const nMatch = window.match(
      /new\s+g\.([A-Za-z0-9$_]{1,8})\([^,()]+,\s*!0\s*\)\s*;\s*[A-Za-z0-9$_]+\.set\("alr"/,
    );
    if (nMatch?.[1] && !nClasses.includes(nMatch[1])) {
      nClasses.unshift(nMatch[1]);
    }
  }

  for (const match of playerJs.matchAll(/\.set\("alr","yes"\)/g)) {
    const index = match.index ?? 0;
    const window = playerJs.slice(index, index + 220);
    const sigMatch = window.match(
      /=\s*([A-Za-z0-9$_]{1,8})\((\d+),(\d+),\s*[A-Za-z0-9$_]{1,8}\(\d+,\d+,/,
    );
    if (sigMatch) {
      const expr = `${sigMatch[1]}(${sigMatch[2]},${sigMatch[3]},INPUT)`;
      if (!sigExprs.includes(expr)) sigExprs.push(expr);
    }
  }

  const pairs: CandidatePair[] = [];
  for (const sig of sigExprs) {
    for (const nClass of nClasses) {
      pairs.push({ sig, nClass });
    }
  }

  return { sigExprs, nClasses, pairs };
}

export function derivedToEntry(
  derived: DerivedPlayerConfig,
  playerHash: string,
): ZemerPlayerConfigEntry | null {
  if (!derived.sig || !derived.nClass || !derived.sts) return null;
  const aliases = derived.md5Alias !== playerHash ? [derived.md5Alias] : [];
  return {
    sig: derived.sig,
    nClass: derived.nClass,
    sts: derived.sts,
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
