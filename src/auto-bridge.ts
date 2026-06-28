import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  generateMnemonic,
  deriveWallets,
  checkWallet,
  type Network,
} from "./recovery.js";

const STATE_FILE = join(process.cwd(), "state.json");
const FOUND_FILE = join(process.cwd(), "found_wallets.txt");
const MAX_INTERVAL = 30_000;
const MIN_INTERVAL = 100;
const MAX_QUEUE = 1_000;

let running = true;
let paused = false;

const rl = createInterface({ input: stdin });
rl.on("line", (line: string) => {
  try {
    const cmd = JSON.parse(line);
    if (cmd.command === "stop") running = false;
    if (cmd.command === "pause") paused = true;
    if (cmd.command === "resume") paused = false;
  } catch {
    /* ignore */
  }
});

const writeQueue: string[] = [];
let draining = false;

function output(data: unknown): void {
  const line = JSON.stringify(data) + "\n";
  if (writeQueue.length >= MAX_QUEUE) {
    writeQueue.shift();
  }
  writeQueue.push(line);
  if (!draining) flush();
}

function flush(): void {
  draining = true;
  const line = writeQueue.shift();
  if (!line) {
    draining = false;
    return;
  }
  const ok = stdout.write(line);
  if (!ok) {
    stdout.once("drain", flush);
  } else {
    setImmediate(flush);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface State {
  nonce: number;
}

function loadState(): State {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as State;
    }
  } catch {
    /* ignore */
  }
  return { nonce: 0 };
}

function saveState(s: State): void {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(s), "utf-8");
  } catch {
    /* ignore */
  }
}

function appendFound(line: string): void {
  try {
    appendFileSync(FOUND_FILE, line + "\n", "utf-8");
  } catch {
    /* ignore */
  }
}

async function main(): Promise<void> {
  const network = (process.argv[2] as Network) || "mainnet";
  const apiKey = process.argv[3] || "";
  const maxChecks = parseInt(process.argv[4] || "0", 10) || Infinity;

  let intervalMs = apiKey ? 400 : 1200;
  let consecutiveGood = 0;
  let avgResponseMs = intervalMs;
  let checked = 0;
  let found = 0;
  const startTime = Date.now();
  const state = loadState();

  output({
    type: "started",
    network,
    intervalMs,
    apiKey: !!apiKey,
    maxChecks: maxChecks === Infinity ? 0 : maxChecks,
    nonce: state.nonce,
  });

  const progressTimer = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    output({
      type: "progress",
      checked,
      total: state.nonce,
      found,
      rate: elapsed > 0 ? (checked / elapsed) * 60 : 0,
      elapsed: Math.round(elapsed),
      intervalMs,
    });
  }, 3000);

  try {
    while (running && checked < maxChecks) {
      while (paused && running) {
        await delay(500);
      }
      if (!running) break;

      try {
        const words = await generateMnemonic();
        const phrase = words.join(" ");

        const derived = await deriveWallets(words, network);

        const mapped: Array<{
          version: string;
          nonBounceable: string;
          bounceable: string;
          balanceTon: string;
          state?: string;
          error?: string;
        }> = [];

        let hasBalance = false;

        for (const wallet of derived) {
          if (!running) break;

          const t0 = Date.now();
          const result = await checkWallet(wallet, network, apiKey || undefined);
          const elapsedMs = Date.now() - t0;

          avgResponseMs = avgResponseMs * 0.7 + elapsedMs * 0.3;

          mapped.push({
            version: result.version,
            nonBounceable: result.nonBounceable,
            bounceable: result.bounceable,
            balanceTon: result.balanceTon || "0",
            state: result.state,
            error: result.error,
          });

          if (result.error) {
            consecutiveGood = 0;
            const errMsg = result.error.toLowerCase();
            if (
              errMsg.includes("429") ||
              errMsg.includes("limit") ||
              errMsg.includes("too many")
            ) {
              intervalMs = Math.min(Math.floor(intervalMs * 2.5), MAX_INTERVAL);
              output({ type: "rate_limited", backoffMs: intervalMs });
            } else {
              intervalMs = Math.min(Math.floor(intervalMs * 1.5), MAX_INTERVAL);
            }
          } else {
            consecutiveGood++;
            if (consecutiveGood >= 3) {
              const target = Math.max(
                MIN_INTERVAL,
                Math.floor(avgResponseMs * 1.3),
              );
              intervalMs = Math.max(target, Math.floor(intervalMs * 0.92));
            }
          }

          try {
            const bal = parseFloat(result.balanceTon || "0");
            if (bal > 0) hasBalance = true;
          } catch {
            /* ignore */
          }

          const waitMs = Math.max(intervalMs, Math.floor(avgResponseMs * 0.5));
          await delay(waitMs);
        }

      if (!running) break;
      checked++;
      state.nonce++;
      saveState(state);

        if (hasBalance) {
          found++;
          appendFound(
            `${new Date().toISOString()}|${phrase}|${JSON.stringify(mapped)}`,
          );
        }

        output({
          type: "result",
          mnemonic: phrase,
          wallets: mapped,
          hasBalance,
        });
      } catch (err) {
        consecutiveGood = 0;
        intervalMs = Math.min(Math.floor(intervalMs * 1.5), MAX_INTERVAL);
        const msg = err instanceof Error ? err.message : "Noma'lum xato";
        output({ type: "error", error: msg });
      }
    }
  } finally {
    clearInterval(progressTimer);
    saveState(state);
    rl.close();
  }

  output({
    type: "stopped",
    checked,
    found,
    reason: checked >= maxChecks ? "range_tugadi" : "to'xtatildi",
  });
}

main().catch((err: unknown) => {
  rl.close();
  const msg = err instanceof Error ? err.message : "Noma'lum xato";
  output({ type: "fatal", error: msg });
  process.exitCode = 1;
});
