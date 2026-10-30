import { createPublicClient, createWalletClient, getAddress, http, isAddress, type Address, type PublicClient } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { NETWORKS, ZERO, type Network, type NetworkKey } from "./config.js";

export const RPC_TIMEOUT_MS = 4_000;

export const tokenAbi = [
  { type: "function", name: "shield", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "unshield", stateMutability: "nonpayable", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint64" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "unshieldAll", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "confidentialTransfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "encryptedAmount", type: "bytes32" }, { name: "inputProof", type: "bytes" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "claimUnshielded", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }, { name: "decryptedAmount", type: "uint64" }, { name: "decryptionProof", type: "bytes" }], outputs: [] },
  { type: "function", name: "getUserClaims", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "tuple[]", components: [
    { name: "id", type: "bytes32" }, { name: "to", type: "address" }, { name: "ctHash", type: "bytes32" }, { name: "decryptedAmount", type: "uint64" }, { name: "claimed", type: "bool" },
  ] }] },
  { type: "function", name: "perUserShieldCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalShieldCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "shieldedBy", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "underlying", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export function network(key: NetworkKey): Network {
  return NETWORKS[key];
}

/** Throws unless our contract is deployed on this network. */
export function deployed(n: Network): Address {
  if (n.privateUsdc === ZERO) {
    throw new Error(`Private USDC is not deployed on ${n.label} yet, so no money can move there. Nothing was proposed.`);
  }
  return n.privateUsdc;
}

export function parseAddress(value: string, what: string): Address {
  if (!isAddress(value, { strict: false })) throw new Error(`${what} is not a valid EVM address: ${value}`);
  const a = getAddress(value);
  if (a === ZERO) throw new Error(`${what} cannot be the zero address.`);
  return a;
}

const viemChain = (n: Network) => (n.chainId === arbitrum.id ? arbitrum : arbitrumSepolia);

export function publicClient(n: Network): PublicClient {
  return createPublicClient({ chain: viemChain(n), transport: http(n.rpcUrl, { timeout: RPC_TIMEOUT_MS, retryCount: 0 }) }) as PublicClient;
}

/** A wallet client that only knows a PUBLIC address. It cannot sign anything; CoFHE uses it to learn the account. */
export function watchOnlyWallet(n: Network, account: Address) {
  return createWalletClient({ chain: viemChain(n), account, transport: http(n.rpcUrl, { timeout: RPC_TIMEOUT_MS, retryCount: 0 }) });
}

export function formatUsdc(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function parseUsdc(amount: string): bigint {
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(amount)) {
    throw new Error(`Amount must be a USDC decimal like "12.5" with at most 6 decimals: ${amount}`);
  }
  const [w, f = ""] = amount.split(".");
  const units = BigInt(w + f.padEnd(6, "0"));
  if (units === 0n) throw new Error("Amount must be greater than zero.");
  if (units >= 2n ** 64n) throw new Error("Amount is too large.");
  return units;
}
