import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateMnemonic,
  deriveWallets,
  checkWallet,
  type Network,
} from "./recovery.js";

const SEEN_FILE = join(process.cwd(), "checked_seeds.txt");
const FOUND_FILE = join(process.cwd(), "found_wallets.txt");
const SAVE_EVERY = 50;

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
  writeQueue.push(JSON.stringify(data) + "\n");
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

function loadSeen(): Set<string> {
  if (!existsSync(SEEN_FILE)) return new Set();
  const raw = readFileSync(SEEN_FILE, "utf-8").trim();
  if (!raw) return new Set();
  return new Set(raw.split("\n"));
}

function appendLine(path: string, line: string): void {
  try {
    appendFileSync(path, line + "\n", "utf-8");
  } catch {
    /* ignore */
  }
}

async function main(): Promise<void> {
  const network = (process.argv[2] as Network) || "mainnet";
  const apiKey = process.argv[4] || "";
  const maxChecks = parseInt(process.argv[5] || "0", 10) || Infinity;

  const MIN_MS = 100;
  const MAX_MS = 30_000;
  let intervalMs = apiKey ? 400 : 1200;
  let consecutiveGood = 0;
  let avgResponseMs = intervalMs;

  let checked = 0;
  let found = 0;
  const startTime = Date.now();
  const seen = loadSeen();
  let sinceLastSave = 0;

  output({ type: "started", network, intervalMs, apiKey: !!apiKey, maxChecks: maxChecks === Infinity ? 0 : maxChecks, seenLoaded: seen.size });

  const progressTimer = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    output({
      type: "progress",
      checked,
      found,
      rate: elapsed > 0 ? (checked / elapsed) * 60 : 0,
      elapsed: Math.round(elapsed),
      intervalMs,
    });
  }, 3000);

  function flushSeen(): void {
    try {
      appendLine(SEEN_FILE, [...seen].slice(-SAVE_EVERY).join("\n"));
    } catch { /* ignore */ }
  }

  while (running && checked < maxChecks) {
    while (paused && running) {
      output({ type: "paused" });
      await delay(1000);
    }
    if (!running) break;

    try {
      let words: string[];
      let phrase: string;
      let attempts = 0;
      do {
        words = await generateMnemonic();
        phrase = words.join(" ");
        attempts++;
        if (attempts > 1000) {
          seen.clear();
          attempts = 0;
        }
      } while (seen.has(phrase));
      seen.add(phrase);
      sinceLastSave++;

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
          if (errMsg.includes("429") || errMsg.includes("limit") || errMsg.includes("too many")) {
            intervalMs = Math.min(Math.floor(intervalMs * 2.5), MAX_MS);
            output({ type: "rate_limited", backoffMs: intervalMs });
          } else {
            intervalMs = Math.min(Math.floor(intervalMs * 1.5), MAX_MS);
          }
        } else {
          consecutiveGood++;
          if (consecutiveGood >= 3) {
            const target = Math.max(MIN_MS, Math.floor(avgResponseMs * 1.3));
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

      // Save to file periodically
      if (sinceLastSave >= SAVE_EVERY) {
        flushSeen();
        sinceLastSave = 0;
      }

      if (hasBalance) {
        found++;
        appendLine(FOUND_FILE, `${new Date().toISOString()}|${phrase}|${JSON.stringify(mapped)}`);
      }
      output({
        type: "result",
        mnemonic: phrase,
        wallets: mapped,
        hasBalance,
      });
    } catch (err) {
      consecutiveGood = 0;
      intervalMs = Math.min(Math.floor(intervalMs * 1.5), MAX_MS);
      const msg = err instanceof Error ? err.message : "Noma'lum xato";
      output({ type: "error", error: msg });
    }
  }

  clearInterval(progressTimer);
  flushSeen();
  output({ type: "stopped", checked, found, reason: checked >= maxChecks ? "range_tugadi" : "to'xtatildi" });
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : "Noma'lum xato";
  output({ type: "fatal", error: msg });
  process.exitCode = 1;
});
