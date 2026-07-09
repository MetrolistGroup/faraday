import {
  parsePlayerConfigs,
  type ZemerParseResult,
} from "./player-config-parser.ts";
import type { ZemerHardcodedPlayerConfig } from "./types.ts";

export class ZemerPlayerConfigStore {
  #configs = new Map<string, ZemerHardcodedPlayerConfig>();

  static async fromFile(path: string): Promise<ZemerPlayerConfigStore> {
    const store = new ZemerPlayerConfigStore();
    const result = await store.loadFile(path);
    if (result.kind === "failure") {
      throw new Error(`invalid player configs at ${path}: ${result.reason}`);
    }
    if (result.skippedEntries.length > 0) {
      throw new Error(
        `invalid player configs at ${path}: skipped entries ${
          result.skippedEntries.join(", ")
        }`,
      );
    }
    return store;
  }

  async loadFile(path: string): Promise<ZemerParseResult> {
    const jsonText = await Deno.readTextFile(path);
    return this.loadText(jsonText);
  }

  loadText(jsonText: string): ZemerParseResult {
    const result = parsePlayerConfigs(jsonText);
    if (result.kind === "success") {
      this.#configs = result.configs;
    }
    return result;
  }

  get(playerHash: string): ZemerHardcodedPlayerConfig | undefined {
    return this.#configs.get(playerHash);
  }

  has(playerHash: string): boolean {
    return this.#configs.has(playerHash);
  }

  entries(): IterableIterator<[string, ZemerHardcodedPlayerConfig]> {
    return this.#configs.entries();
  }

  lookup: (playerHash: string) => ZemerHardcodedPlayerConfig | undefined = (
    playerHash,
  ) => this.get(playerHash);
}
