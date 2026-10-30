import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { Encryptable } from "@cofhe/sdk";
import { arbitrum, arbSepolia, ethereum, hardhat, sepolia } from "@cofhe/sdk/chains";
import type { Address, Hex } from "viem";
import { publicClient, watchOnlyWallet } from "./chain.js";
import type { Network } from "./config.js";

/**
 * Fhenix's own chain definitions (CoFHE, verifier and threshold-network URLs) from the official SDK.
 * hardhat (Fhenix mocks) is only reachable from local integration tests.
 */
const COFHE_CHAINS = [arbitrum, arbSepolia, ethereum, sepolia, hardhat];

function cofheChain(n: Network) {
  const c = COFHE_CHAINS.find(c => c.id === n.chainId);
  if (!c) throw new Error(`Fhenix CoFHE does not support chain ${n.chainId}.`);
  return c;
}

export async function connectedClient(n: Network, account: Address) {
  const client = createCofheClient(
    createCofheConfig({
      supportedChains: [cofheChain(n)],
      fheKeyStorage: null, // every call is a fresh sandbox; nothing is written to disk
      useWorkers: false,
    }),
  );
  await client.connect(publicClient(n) as any, watchOnlyWallet(n, account) as any);
  return client;
}

export class Timeout extends Error {}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Timeout(`${what} did not finish within ${ms} ms.`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/**
 * Encrypts a uint64 amount for `contract`, bound to `sender` and this chain.
 * The proof only works when `sender` itself calls `contract`, so a leaked input is useless to anyone else.
 */
export async function encryptAmount(n: Network, sender: Address, contract: Address, units: bigint) {
  const client = await connectedClient(n, sender);
  const [ctHash, inputProof] = (await client
    .encryptInputs([Encryptable.uint64(units)])
    .setAccount(sender)
    .setChainId(n.chainId)
    .setConsumingContract(contract)
    .execute()) as unknown as [Hex, Hex];
  return { ctHash, inputProof };
}

/** Asks the Fhenix threshold network to decrypt a publicly-allowed handle (an unshield claim). */
export async function decryptClaim(n: Network, account: Address, ctHash: Hex) {
  const client = await connectedClient(n, account);
  const r = (await client.decryptForTx(ctHash).withoutACP().execute()) as { decryptedValue: bigint; signature: Hex };
  return { value: BigInt(r.decryptedValue), signature: r.signature };
}
