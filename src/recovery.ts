import { mnemonicNew, mnemonicToWalletKey, mnemonicValidate } from "@ton/crypto";
import {
  TonClient,
  WalletContractV3R2,
  WalletContractV4,
  WalletContractV5R1,
} from "@ton/ton";
import { fromNano, type Address } from "@ton/core";

export type Network = "mainnet" | "testnet";
export type WalletVersion = "V3R2" | "V4R2" | "V5R1";

export interface DerivedWallet {
  version: WalletVersion;
  address: Address;
  bounceable: string;
  nonBounceable: string;
}

export interface WalletCheck extends DerivedWallet {
  balanceTon?: string;
  state?: "active" | "uninitialized" | "frozen";
  error?: string;
}

const clientCache = new Map<string, TonClient>();

function getClient(network: Network, apiKey?: string): TonClient {
  const key = `${network}:${apiKey || ""}`;
  let client = clientCache.get(key);
  if (!client) {
    const endpoint = network === "mainnet"
      ? "https://toncenter.com/api/v2/jsonRPC"
      : "https://testnet.toncenter.com/api/v2/jsonRPC";
    client = new TonClient({ endpoint, timeout: 15_000, apiKey });
    clientCache.set(key, client);
  }
  return client;
}

export function normalizeMnemonic(input: string): string[] {
  return input.trim().toLowerCase().split(/\s+/u).filter(Boolean);
}

export async function validateOwnedMnemonic(words: string[]): Promise<void> {
  if (words.length !== 12 && words.length !== 24) {
    throw new Error("Recovery phrase 12 yoki 24 ta so'zdan iborat bo'lishi kerak.");
  }

  if (!(await mnemonicValidate(words))) {
    throw new Error("Recovery phrase TON mnemonic tekshiruvidan o'tmadi.");
  }
}

function formatAddress(address: Address, network: Network, bounceable: boolean): string {
  return address.toString({
    bounceable,
    testOnly: network === "testnet",
    urlSafe: true,
  });
}

export async function deriveWallets(
  words: string[],
  network: Network,
): Promise<DerivedWallet[]> {
  await validateOwnedMnemonic(words);
  const keyPair = await mnemonicToWalletKey(words);
  const publicKey = Buffer.from(keyPair.publicKey);
  keyPair.secretKey.fill(0);

  const contracts: Array<{ version: WalletVersion; address: Address }> = [
    {
      version: "V3R2",
      address: WalletContractV3R2.create({ workchain: 0, publicKey }).address,
    },
    {
      version: "V4R2",
      address: WalletContractV4.create({ workchain: 0, publicKey }).address,
    },
    {
      version: "V5R1",
      address: WalletContractV5R1.create({
        publicKey,
        walletId: {
          networkGlobalId: network === "mainnet" ? -239 : -3,
          context: { workchain: 0, walletVersion: "v5r1", subwalletNumber: 0 },
        },
      }).address,
    },
  ];

  return contracts.map(({ version, address }) => ({
    version,
    address,
    bounceable: formatAddress(address, network, true),
    nonBounceable: formatAddress(address, network, false),
  }));
}

export async function generateMnemonic(): Promise<string[]> {
  return mnemonicNew(24);
}

export async function checkWallet(
  wallet: DerivedWallet,
  network: Network,
  apiKey?: string,
): Promise<WalletCheck> {
  const client = getClient(network, apiKey);
  try {
    const state = await client.getContractState(wallet.address);
    return {
      ...wallet,
      balanceTon: fromNano(state.balance),
      state: state.state,
    };
  } catch (error) {
    return {
      ...wallet,
      error: error instanceof Error ? error.message : "Noma'lum API xatosi",
    };
  }
}

export async function checkWallets(
  wallets: DerivedWallet[],
  network: Network,
  apiKey?: string,
): Promise<WalletCheck[]> {
  const client = getClient(network, apiKey);

  return Promise.all(wallets.map(async (wallet): Promise<WalletCheck> => {
    try {
      const state = await client.getContractState(wallet.address);
      return {
        ...wallet,
        balanceTon: fromNano(state.balance),
        state: state.state,
      };
    } catch (error) {
      return {
        ...wallet,
        error: error instanceof Error ? error.message : "Noma'lum API xatosi",
      };
    }
  }));
}
