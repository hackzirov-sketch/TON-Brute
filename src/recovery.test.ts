import { describe, expect, it } from "vitest";
import { mnemonicNew } from "@ton/crypto";
import { deriveWallets, normalizeMnemonic, validateOwnedMnemonic } from "./recovery.js";

describe("recovery", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeMnemonic("  Alpha\n BETA  ")).toEqual(["alpha", "beta"]);
  });

  it("rejects an unsupported word count", async () => {
    await expect(validateOwnedMnemonic(["one", "two"])).rejects.toThrow("12 yoki 24");
  });

  it("derives three distinct wallet versions from a valid TON mnemonic", async () => {
    const words = await mnemonicNew(24);
    const wallets = await deriveWallets(words, "mainnet");

    expect(wallets.map((wallet) => wallet.version)).toEqual(["V3R2", "V4R2", "V5R1"]);
    expect(new Set(wallets.map((wallet) => wallet.address.toRawString())).size).toBe(3);
    expect(wallets.every((wallet) => wallet.nonBounceable.startsWith("UQ"))).toBe(true);
    expect(wallets.every((wallet) => wallet.bounceable.startsWith("EQ"))).toBe(true);
  });

  it("marks friendly testnet addresses as test-only", async () => {
    const words = await mnemonicNew(24);
    const wallets = await deriveWallets(words, "testnet");

    expect(wallets.every((wallet) => wallet.nonBounceable.startsWith("0Q"))).toBe(true);
    expect(wallets.every((wallet) => wallet.bounceable.startsWith("kQ"))).toBe(true);
  });
});
