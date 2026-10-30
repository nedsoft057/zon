// Local end-to-end check of balance viewing against Fhenix's mocks: deposit into PrivateSendUSDC, then
// prepare a permit, sign it as the user's wallet would (through PayBox), and decrypt the balance.
//
//   cd contracts && pnpm exec hardhat node --network hardhat   # deploys the mocks and PrivateSendUSDC
//   cd plugin && node --import tsx test/view-local.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWalletClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { publicClient } from "../src/chain.js";
import type { Network } from "../src/config.js";
import { preparePermit, viewBalance } from "../src/view.js";

const deployed = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../contracts/deployments/localhost/${name}.json`, import.meta.url), "utf8")).address as Address;
const token = deployed("PrivateSendUSDC");
const usdc = deployed("MockUSDC");
const n = { key: "arbitrum", label: "local hardhat", chainId: 31337, rpcUrl: "http://127.0.0.1:8545", usdc, privateUsdc: token } as Network;

// Hardhat's well-known dev accounts #1 and #2.
const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const pc = publicClient(n);
const wallet = createWalletClient({ chain: hardhat, account: alice, transport: http(n.rpcUrl) });
const abi = parseAbi([
  "function mint(address,uint256)",
  "function approve(address,uint256) returns (bool)",
  "function shield(address,uint256) returns (bytes32)",
]);
const send = async (address: Address, functionName: "mint" | "approve" | "shield", args: readonly [Address, bigint]) =>
  pc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address, abi, functionName, args }) });

async function view(account: typeof alice, signer = account) {
  const p = await preparePermit(n, account.address, token, 30);
  const signature = await signer.signTypedData(p.typedData as any);
  return viewBalance(n, account.address, token, p.permit, signature, 8_000);
}

await send(usdc, "mint", [alice.address, 50_000_000n]);
await send(usdc, "approve", [token, 12_500_000n]);
const before = await view(alice);
await send(token, "shield", [alice.address, 12_500_000n]);

const t0 = Date.now();
assert.equal(await view(alice) - before, 12_500_000n);
console.log(`alice: decrypted Private USDC balance grew by 12.5 USDC (${Date.now() - t0} ms)`);

assert.equal(await view(bob), 0n);
console.log("bob: never deposited, balance 0");

await assert.rejects(view(alice, bob), /does not match/);
console.log("a permit signed by another wallet is rejected");
