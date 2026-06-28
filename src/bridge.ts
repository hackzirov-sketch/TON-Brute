import { stdin, stdout } from "node:process";
import {
  checkWallets,
  deriveWallets,
  normalizeMnemonic,
  type Network,
} from "./recovery.js";

interface BridgeRequest {
  mnemonic?: unknown;
  network?: unknown;
  offline?: unknown;
}

async function readRequest(): Promise<BridgeRequest> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of stdin) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 8_192) throw new Error("So‘rov hajmi juda katta.");
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as BridgeRequest;
}

async function main(): Promise<void> {
  const request = await readRequest();
  if (typeof request.mnemonic !== "string") throw new Error("Recovery phrase yuborilmadi.");
  if (request.network !== "mainnet" && request.network !== "testnet") {
    throw new Error("Tarmoq noto‘g‘ri.");
  }

  const network: Network = request.network;
  const words = normalizeMnemonic(request.mnemonic);
  const derived = await deriveWallets(words, network);
  const checked = request.offline === true ? derived : await checkWallets(derived, network);

  const wallets = checked.map((wallet) => ({
    version: wallet.version,
    bounceable: wallet.bounceable,
    nonBounceable: wallet.nonBounceable,
    ...(request.offline === true ? {} : {
      balanceTon: "balanceTon" in wallet ? wallet.balanceTon : undefined,
      state: "state" in wallet ? wallet.state : undefined,
      error: "error" in wallet ? wallet.error : undefined,
    }),
  }));

  stdout.write(JSON.stringify({ network, offline: request.offline === true, wallets }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Noma’lum xato";
  stdout.write(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
