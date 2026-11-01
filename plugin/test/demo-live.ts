// Live end-to-end run on a testnet, using the plugin's own code for every Fhenix step:
// deposit -> private send -> view balance (permit) -> withdraw -> claim.
// Spends testnet gas from DEMO_PRIVATE_KEY, which must hold testnet USDC.
//
//   DEMO_PRIVATE_KEY=0x... DEMO_RECIPIENT=0x... node --import tsx test/demo-live.ts [sepolia]
import { createWalletClient, encodeFunctionData, formatUnits, http, parseGwei, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, arbitrum, arbitrumSepolia } from "viem/chains";
import { erc20Abi, publicClient, tokenAbi } from "../src/chain.js";
import { decryptClaim, encryptAmount } from "../src/cofhe.js";
import { NETWORKS, ZERO, type NetworkKey } from "../src/config.js";
import { preparePermit, viewBalance } from "../src/view.js";

const n = NETWORKS[(process.argv[2] ?? "sepolia") as NetworkKey];
if (n.privateUsdc === ZERO) throw new Error(`Not deployed on ${n.label}.`);
const account = privateKeyToAccount(process.env.DEMO_PRIVATE_KEY as Hex);
const recipient = process.env.DEMO_RECIPIENT as Hex;
const chain = [mainnet, sepolia, arbitrum, arbitrumSepolia].find(c => c.id === n.chainId)!;
const wallet = createWalletClient({ chain, account, transport: http(n.rpcUrl) });
const pc = publicClient(n);
const token = n.privateUsdc;
const usdc = (x: number) => BigInt(Math.round(x * 1e6));
const fees = { maxPriorityFeePerGas: parseGwei("0.01") };

async function send(label: string, to: Hex, data: Hex) {
  const hash = await wallet.sendTransaction({ to, data, ...fees });
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash} (gas ${r.gasUsed})`);
  return r;
}

async function myBalance() {
  const p = await preparePermit(n, account.address, token, 30);
  const sig = await account.signTypedData(p.typedData as any);
  return viewBalance(n, account.address, token, p.permit, sig, 60_000);
}

console.log(`${n.label} · token ${token} · from ${account.address} · to ${recipient}`);
const allowance = () => pc.readContract({ address: n.usdc, abi: erc20Abi, functionName: "allowance", args: [account.address, token] });
if ((await allowance()) < usdc(10)) {
  await send("approve 10 USDC", n.usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [token, usdc(10)] }));
}
// Public RPCs are load-balanced: wait until the node we hit sees the approval.
while ((await allowance()) < usdc(10)) await new Promise(r => setTimeout(r, 2_000));
await send("deposit 10 USDC", token, encodeFunctionData({ abi: tokenAbi, functionName: "shield", args: [account.address, usdc(10)] }));

let t0 = Date.now();
const enc = await encryptAmount(n, account.address, token, usdc(3));
console.log(`encrypted 3 USDC in ${Date.now() - t0} ms`);
await send("private send 3 USDC", token, encodeFunctionData({ abi: tokenAbi, functionName: "confidentialTransfer", args: [recipient, enc.ctHash, enc.inputProof] }));

t0 = Date.now();
console.log(`decrypted own balance: ${formatUnits(await myBalance(), 6)} pUSDC (${Date.now() - t0} ms)`);

await send("withdraw 2 USDC", token, encodeFunctionData({ abi: tokenAbi, functionName: "unshield", args: [account.address, account.address, usdc(2)] }));
const claim = (await pc.readContract({ address: token, abi: tokenAbi, functionName: "getUserClaims", args: [account.address] })).find(c => !c.claimed)!;
for (let i = 0; ; i++) {
  try {
    t0 = Date.now();
    const d = await decryptClaim(n, account.address, claim.ctHash);
    console.log(`claim decrypted by Fhenix: ${formatUnits(d.value, 6)} USDC (${Date.now() - t0} ms)`);
    await send("claim", token, encodeFunctionData({ abi: tokenAbi, functionName: "claimUnshielded", args: [claim.id, d.value, d.signature] }));
    break;
  } catch (e) {
    if (i >= 5) throw e;
    console.log(`decryption not ready yet, retrying in 15 s (${(e as Error).message.slice(0, 80)})`);
    await new Promise(r => setTimeout(r, 15_000));
  }
}
console.log(`public USDC now: ${formatUnits(await pc.readContract({ address: n.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }), 6)}`);
console.log(`decrypted own balance: ${formatUnits(await myBalance(), 6)} pUSDC`);
