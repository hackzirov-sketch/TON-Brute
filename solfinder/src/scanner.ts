import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { stderr, stdout } from "node:process";

const MAX_INTERVAL = 30_000;
const MIN_INTERVAL = 200;

interface WalletResult {
  address: string;
  balanceSol: string;
}

interface ScanResult {
  type: "result";
  index: number;
  secretKey: string;
  address: string;
  wallet: WalletResult;
}

interface ScanError {
  type: "error";
  index?: number;
  message: string;
}

type Output = ScanResult | ScanError;

function logJson(data: Output): void {
  stdout.write(JSON.stringify(data) + "\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const endpoint = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const delayMs = parseInt(process.env.SCAN_DELAY_MS || "1200", 10);
  const connection = new Connection(endpoint, "confirmed");

  let index = 0;
  let intervalMs = delayMs;
  let consecGood = 0;
  let avgMs = delayMs;

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  while (true) {
    index++;
    try {
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();
      const secretKey = Buffer.from(keypair.secretKey).toString("hex");

      const t0 = Date.now();
      const balance = await connection.getBalance(keypair.publicKey);
      const elapsedMs = Date.now() - t0;

      avgMs = avgMs * 0.7 + elapsedMs * 0.3;
      const solBalance = balance / LAMPORTS_PER_SOL;

      if (elapsedMs > 3000 || balance < 0) {
        consecGood = 0;
        intervalMs = Math.min(Math.floor(intervalMs * 2), MAX_INTERVAL);
        logJson({ type: "error", index, message: "RPC timeout or error" });
        await sleep(intervalMs);
        continue;
      }

      consecGood++;
      if (consecGood >= 5) {
        const target = Math.max(MIN_INTERVAL, Math.floor(avgMs * 1.5));
        intervalMs = Math.max(target, Math.floor(intervalMs * 0.92));
      }

      logJson({
        type: "result",
        index,
        secretKey,
        address,
        wallet: {
          address,
          balanceSol: solBalance.toFixed(9),
        },
      });

      keypair.secretKey.fill(0);
    } catch (err) {
      consecGood = 0;
      intervalMs = Math.min(Math.floor(intervalMs * 1.5), MAX_INTERVAL);
      const msg = err instanceof Error ? err.message : String(err);
      logJson({ type: "error", index, message: msg });
    }

    await sleep(intervalMs);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  stderr.write(JSON.stringify({ type: "fatal", message: msg }) + "\n");
  process.exit(1);
});
