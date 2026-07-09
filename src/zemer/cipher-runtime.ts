export type CipherNProbe = {
  in?: string;
  out?: string;
  changed?: boolean;
  valid?: boolean;
  error?: string;
};

export type CipherProcessRequest = {
  playerJs: string;
  sigExpr: string;
  nClass: string;
  signatureCiphers: string[];
};

export type CipherEvaluation = {
  initError: string | null;
  injectionMode: "iife" | "global-fallback";
  sigAvailable: boolean;
  nAvailable: boolean;
  nProbe: CipherNProbe;
  urls?: string[];
  error?: string;
};

const DEFAULT_RUNTIME_TIMEOUT_MS = 15_000;

export function evaluateCipherCandidate(
  request: CipherProcessRequest,
  timeoutMs = DEFAULT_RUNTIME_TIMEOUT_MS,
): Promise<CipherEvaluation> {
  return runCipherProcess(request, timeoutMs);
}

async function runCipherProcess(
  request: CipherProcessRequest,
  timeoutMs: number,
): Promise<CipherEvaluation> {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--cached-only",
      "--config",
      new URL("../../deno.json", import.meta.url).pathname,
      "--allow-env",
      "--v8-flags=--max-old-space-size=256",
      import.meta.resolve("./cipher-process.ts"),
    ],
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  const inputPromise = writer.write(
    new TextEncoder().encode(JSON.stringify(request)),
  ).then(() => writer.close());
  let timedOut = false;
  const kill = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may have exited between the status check and kill.
    }
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);
  const statusPromise = child.status;
  const stdoutPromise = readLimited(child.stdout, 64 * 1024, kill);
  const stderrPromise = readLimited(child.stderr, 32 * 1024, kill);

  try {
    const [, status, stdout, stderrBytes] = await Promise.all([
      inputPromise,
      statusPromise,
      stdoutPromise,
      stderrPromise,
    ]);
    if (!status.success) {
      const stderr = new TextDecoder().decode(stderrBytes).trim();
      throw new Error(
        timedOut
          ? `cipher runtime timed out after ${timeoutMs}ms`
          : `cipher process exited ${status.code}${
            stderr ? `: ${stderr}` : ""
          }`,
      );
    }
    return JSON.parse(
      new TextDecoder().decode(stdout),
    ) as CipherEvaluation;
  } catch (error) {
    kill();
    await Promise.allSettled([
      inputPromise,
      statusPromise,
      stdoutPromise,
      stderrPromise,
    ]);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimited(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onOverflow: () => void,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        onOverflow();
        throw new Error(`cipher process output exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
