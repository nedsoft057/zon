import { ACPUtils, type ACP } from "@cofhe/sdk/acps";
import { FheTypes } from "@cofhe/sdk";
import { getAddress, isHex, verifyTypedData, type Address, type Hex } from "viem";
import { publicClient, tokenAbi } from "./chain.js";
import { connectedClient } from "./cofhe.js";
import type { Network } from "./config.js";

// Viewing an encrypted balance with a Fhenix ACP (access permission), across two stateless tool calls:
//   1. preparePermit: build a self ACP scoped to our contract only, with a fresh sealing keypair.
//      Return the EIP-712 data for the user's wallet to sign (through PayBox) and the ACP as an opaque blob.
//   2. viewBalance: take the blob + signature back, check them, and ask Fhenix's threshold network to
//      re-encrypt ("seal") the balance to the ACP's sealing key, then unseal it here.
// The plugin never signs. The blob holds the sealing private key: together with the signature it lets
// whoever has both read this wallet's Private USDC balance (nothing else, no spending) until it expires.

export const PERMIT_DEFAULT_MINUTES = 30;
export const PERMIT_MAX_MINUTES = 60;

const ZERO_HANDLE = `0x${"00".repeat(32)}` as const;

/** Wallet client stand-in: ACPUtils.sign only calls signTypedData, and we answer it ourselves. */
function signer(account: Address, signTypedData: (args: any) => Promise<Hex>) {
  return { account: { address: account, type: "json-rpc" }, signTypedData } as any;
}

/** EIP-712 values as plain JSON (bigints become decimal strings, as wallets accept). */
function json<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}

function encodePermit(acp: ACP): string {
  return Buffer.from(JSON.stringify(ACPUtils.serialize(acp))).toString("base64");
}

function decodePermit(blob: string): ACP {
  try {
    return ACPUtils.deserialize(JSON.parse(Buffer.from(blob, "base64").toString("utf8")));
  } catch {
    throw new Error("permit is not one returned by private_usdc_balance_permit. Ask for a new permit.");
  }
}

export async function preparePermit(n: Network, wallet: Address, token: Address, minutes: number) {
  const expiration = Math.floor(Date.now() / 1000) + minutes * 60;
  const acp = ACPUtils.createSelf({ issuer: wallet, name: "PayBox Private USDC", expiration, contracts: [token] });
  let typedData: any;
  await ACPUtils.sign(acp, publicClient(n), signer(wallet, async args => {
    typedData = args;
    return `0x${"00".repeat(65)}`;
  }));
  const { account: _, ...rest } = typedData;
  return { typedData: json(rest) as Record<string, unknown>, permit: encodePermit(acp), expiresAt: new Date(expiration * 1000).toISOString() };
}

export async function viewBalance(n: Network, wallet: Address, token: Address, permit: string, signature: string, budgetMs: number) {
  if (!isHex(signature) || signature.length !== 132) throw new Error("signature must be the 65-byte hex signature PayBox returned.");
  const acp = decodePermit(permit);
  if (acp.type !== "self" || getAddress(acp.issuer) !== wallet) throw new Error("This permit was made for a different wallet.");
  if (acp.contracts.length !== 1 || getAddress(acp.contracts[0]!) !== token) throw new Error("This permit is not for Private USDC on this network.");
  if (acp.expiration * 1000 <= Date.now()) throw new Error("This permit has expired. Ask for a new one with private_usdc_balance_permit.");

  const signed = await ACPUtils.sign(acp, publicClient(n), signer(wallet, async args => {
    const ok = await verifyTypedData({ ...args, address: wallet, signature: signature as Hex });
    if (!ok) throw new Error("The signature does not match this permit and wallet. Sign the typed data from private_usdc_balance_permit with the same wallet.");
    return signature as Hex;
  }));

  const handle = await publicClient(n).readContract({ address: token, abi: tokenAbi, functionName: "confidentialBalanceOf", args: [wallet] });
  if (handle === ZERO_HANDLE) return 0n;

  const client = await connectedClient(n, wallet);
  return BigInt(await client.decryptForView(handle, FheTypes.Uint64).setACP(signed).set404RetryTimeout(budgetMs).execute());
}
