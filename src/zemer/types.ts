/** Mirrors zemer-cipher FunctionNameExtractor.HardcodedPlayerConfig */
export type ZemerHardcodedPlayerConfig = {
  sigFuncName: string;
  sigConstantArg: number | null;
  sigConstantArgs: number[] | null;
  sigPreprocessFunc: string | null;
  sigPreprocessArgs: number[] | null;
  sigJsExpression: string | null;
  nFuncName: string;
  nArrayIndex: number | null;
  nConstantArgs: number[] | null;
  nJsExpression: string | null;
  signatureTimestamp: number;
};

/** One entry in player_configs.json before parser expansion */
export type ZemerPlayerConfigEntry = {
  sig: string;
  nClass: string;
  sts: number;
  aliases?: string[];
};

export type ZemerPlayerConfigsFile = {
  schemaVersion: number;
  players: Record<string, ZemerPlayerConfigEntry>;
};
