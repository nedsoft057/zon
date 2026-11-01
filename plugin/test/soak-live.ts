// Live soak test on a real Fhenix network: random deposits, private sends back and forth between two
// wallets, withdrawals and claims, with both encrypted balances decrypted through Fhenix and checked
// after every step, then everything withdrawn and returned. Uses the plugin's own Fhenix code.
//
// In your Codespace (unlocks the deployer key from contracts/.env with your password):
//   cd /workspaces/zon/plugin && npx -y pnpm@11.11.0 install
//   node --import tsx test/soak-live.ts                      # 60 operations on Arbitrum Sepolia
//   SOAK_OPS=100 SOAK_NETWORK=sepolia node --import tsx test/soak-live.ts
//
// Wallet A is your deployer and must hold testnet USDC and a little ETH. Wallet B is a fresh test
// wallet the script creates, saves outside the repo (~/.zon-soak-wallet) and empties at the end.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { createWalletClient, encodeFunctionData, erc20Abi, formatEther, formatUnits, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arbitrumSepolia, hardhat, sepolia } from "viem/chains";
import { publicClient, tokenAbi } from "../src/chain.js";
import { decryptClaim, encryptAmount } from "../src/cofhe.js";
import { NETWORKS, ZERO, type Network, type NetworkKey } from "../src/config.js";
import { preparePermit, viewBalance } from "../src/view.js";

const OPS = Number(process.env.SOAK_OPS ?? 60);
const NET = process.env.SOAK_NETWORK ?? "arbitrum-sepolia";
let seed = Number(process.env.SOAK_SEED ?? Date.now() % 100000);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const usdc = (x: number) => BigInt(Math.round(x * 1e6));
const fmt = (u: bigint) => formatUnits(u, 6);

// ── network + keys ────────────────────────────────────────────────────────────
let n: Network;
if (NET === "local") { // Fhenix mocks on `hardhat node`, for testing this script itself
  const dep = (name: string) => JSON.parse(readFileSync(new URL(`../../contracts/deployments/localhost/${name}.json`, import.meta.url), "utf8")).address;
  n = { key: "arbitrum-sepolia", label: "local hardhat", chainId: 31337, rpcUrl: "http://127.0.0.1:8545", usdc: dep("MockUSDC"), privateUsdc: dep("PrivateSendUSDC") } as Network;
} else n = NETWORKS[NET as NetworkKey];
if (!n || n.privateUsdc === ZERO) throw new Error(`Private USDC is not deployed on ${NET}.`);
const chain = [arbitrumSepolia, sepolia, hardhat].find(c => c.id === n.chainId)!;
const pc = publicClient(n);
const token = n.privateUsdc;

async function askHidden(question: string) {
  let muted = false;
  const out = new Writable({ write: (chunk, _e, cb) => { if (!muted) process.stdout.write(chunk); cb(); } });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  const p = new Promise<string>(res => rl.question(question, a => { rl.close(); process.stdout.write("\n"); res(a); }));
  muted = true;
  return p;
}

async function loadDeployerKey(): Promise<Hex> {
  if (process.env.SOAK_PRIVATE_KEY) return process.env.SOAK_PRIVATE_KEY as Hex;
  const envFile = new URL("../../contracts/.env", import.meta.url);
  if (!existsSync(envFile)) throw new Error("No contracts/.env: run `pnpm generate` in contracts first.");
  const line = readFileSync(envFile, "utf8").split("\n").find(l => l.startsWith("DEPLOYER_PRIVATE_KEY_ENCRYPTED="));
  if (!line) throw new Error("contracts/.env has no DEPLOYER_PRIVATE_KEY_ENCRYPTED.");
  const json = line.slice(line.indexOf("=") + 1).replace(/^'|'$/g, "");
  // ethers is already installed for the contracts; reuse it to unlock the same keystore `pnpm run deploy` uses.
  const { Wallet } = createRequire(new URL("../../contracts/package.json", import.meta.url))("ethers");
  const wallet = await Wallet.fromEncryptedJson(json, await askHidden("Password for your deployer key: "));
  return wallet.privateKey as Hex;
}

function loadWalletB(): Hex {
  const file = `${homedir()}/.zon-soak-wallet`;
  if (process.env.SOAK_B_KEY) return process.env.SOAK_B_KEY as Hex;
  if (existsSync(file)) return readFileSync(file, "utf8").trim() as Hex;
  const k = generatePrivateKey();
  writeFileSync(file, k, { mode: 0o600 });
  return k;
}

const A = privateKeyToAccount(await loadDeployerKey());
const B = privateKeyToAccount(loadWalletB());
const wallets = new Map([A, B].map(acct => [acct.address, createWalletClient({ chain, account: acct, transport: http(n.rpcUrl) })]));
const name = (a: PrivateKeyAccount) => (a === A ? "A" : "B");

// ── helpers ───────────────────────────────────────────────────────────────────
let txs = 0, gasUsed = 0n;
async function send(from: PrivateKeyAccount, to: Hex, data: Hex, value = 0n) {
  const hash = await wallets.get(from.address)!.sendTransaction({ to, data, value, account: from, chain });
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  txs++; gasUsed += r.gasUsed;
  return hash;
}
const usdcBal = (a: Hex) => pc.readContract({ address: n.usdc, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const handle = (a: Hex) => pc.readContract({ address: token, abi: tokenAbi, functionName: "confidentialBalanceOf", args: [a] });
async function decrypted(a: PrivateKeyAccount) {
  const p = await preparePermit(n, a.address, token, 30);
  return viewBalance(n, a.address, token, p.permit, await a.signTypedData(p.typedData as any), 60_000);
}
async function until<T>(what: string, read: () => Promise<T>, ok: (v: T) => boolean, ms = 180_000) {
  const end = Date.now() + ms; let last: T | undefined; let err: unknown;
  while (Date.now() < end) {
    try { last = await read(); if (ok(last)) return last; } catch (e) { err = e; }
    await new Promise(r => setTimeout(r, 3_000));
  }
  throw new Error(`${what}: still ${String(last)} after ${ms / 1000}s ${err ? `(${(err as Error).message.slice(0, 120)})` : ""}`);
}

// Expected state (the model), checked against Fhenix after every step.
const expected = new Map([[A.address, 0n], [B.address, 0n]]);
type Claim = { id: Hex; ctHash: Hex; to: PrivateKeyAccount; amount: bigint };
const pending: Claim[] = [];
const stats: Record<string, number> = {};
const count = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);

async function checkBalances(step: string) {
  for (const w of [A, B]) {
    if (BigInt(await handle(w.address)) === 0n && expected.get(w.address) === 0n) continue; // never held pUSDC
    await until(`${step}: ${name(w)}'s decrypted balance should be ${fmt(expected.get(w.address)!)}`,
      () => decrypted(w), v => v === expected.get(w.address));
  }
}
async function newClaim(to: PrivateKeyAccount, amount: bigint, known: Set<string>) {
  const c = await until(`claim for ${name(to)}`, async () =>
    (await pc.readContract({ address: token, abi: tokenAbi, functionName: "getUserClaims", args: [to.address] })).find(c => !c.claimed && !known.has(c.id)),
    v => v !== undefined, 60_000);
  pending.push({ id: c!.id, ctHash: c!.ctHash, to, amount });
}
const claimIds = async (a: Hex) => new Set((await pc.readContract({ address: token, abi: tokenAbi, functionName: "getUserClaims", args: [a] })).map(c => c.id as string));

async function payClaim(c: Claim, by: PrivateKeyAccount) {
  const d = await until(`Fhenix decryption of ${name(c.to)}'s withdrawal`, () => decryptClaim(n, by.address, c.ctHash), () => true);
  if (d.value !== c.amount) throw new Error(`claim decrypted to ${fmt(d.value)}, expected ${fmt(c.amount)}`);
  // Attack probe (free, simulated only): a forged amount must be rejected.
  await pc.simulateContract({ address: token, abi: tokenAbi, functionName: "claimUnshielded", args: [c.id, d.value + 1n, d.signature], account: by.address })
    .then(() => { throw new Error("forged claim amount was accepted"); }, e => { if (/accepted/.test(e.message)) throw e; });
  const before = await usdcBal(c.to.address);
  const hash = await send(by, token, encodeFunctionData({ abi: tokenAbi, functionName: "claimUnshielded", args: [c.id, d.value, d.signature] }));
  await until("claim payout", () => usdcBal(c.to.address), v => v - before === c.amount, 60_000);
  pending.splice(pending.indexOf(c), 1);
  return hash;
}

// ── start ────────────────────────────────────────────────────────────────────
const startHeld = await pc.readContract({ address: token, abi: tokenAbi, functionName: "totalShielded" });
const startA = { usdc: await usdcBal(A.address), eth: await pc.getBalance({ address: A.address }) };
console.log(`\nZon live soak test on ${n.label}`);
console.log(`contract ${token}`);
console.log(`A (your deployer) ${A.address}: ${fmt(startA.usdc)} USDC, ${formatEther(startA.eth)} ETH`);
console.log(`B (test wallet)   ${B.address}`);
console.log(`${OPS} operations, seed ${seed}\n`);
if (startA.usdc < usdc(3)) throw new Error("A needs at least 3 testnet USDC (Circle faucet) to run this test.");
if (BigInt(await handle(A.address)) !== 0n || BigInt(await handle(B.address)) !== 0n) {
  for (const w of [A, B]) expected.set(w.address, await decrypted(w));
  console.log(`existing private balances: A ${fmt(expected.get(A.address)!)}, B ${fmt(expected.get(B.address)!)}`);
}

if ((await pc.getBalance({ address: B.address })) < parseEther("0.0004")) {
  await send(A, B.address, "0x", parseEther("0.0008"));
  console.log("funded B with 0.0008 ETH for gas");
}
for (const w of [A, B]) {
  const a = await pc.readContract({ address: n.usdc, abi: erc20Abi, functionName: "allowance", args: [w.address, token] });
  if (a < usdc(1000)) await send(w, n.usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [token, usdc(1000)] }));
}

const t0 = Date.now();
for (let i = 1; i <= OPS; i++) {
  const from = rand() < 0.6 ? A : B, other = from === A ? B : A;
  const have = expected.get(from.address)!;
  const r = rand();
  let line = "", hash: Hex | undefined;
  try {
    if (r < 0.2 || (have === 0n && pending.length === 0)) { // deposit whole USDC (to self or the other wallet)
      const payer = (await usdcBal(from.address)) >= usdc(1) ? from : A;
      const to = rand() < 0.7 ? payer : (payer === A ? B : A);
      const amt = usdc(1 + Math.floor(rand() * 2));
      if ((await usdcBal(payer.address)) < amt) { count("skip"); continue; }
      hash = await send(payer, token, encodeFunctionData({ abi: tokenAbi, functionName: "shield", args: [to.address, amt] }));
      expected.set(to.address, expected.get(to.address)! + amt);
      line = `deposit ${fmt(amt)} ${name(payer)}→${name(to)}`; count("deposit");
    } else if (r < 0.65) { // private send, sometimes more than the balance (moves 0)
      if (have === 0n) { count("skip"); continue; }
      const amt = rand() < 0.15 ? have + usdc(0.01) : usdc(0.01 + rand() * Math.max(0.01, Number(have) / 1e6 * 0.6));
      const ts = Date.now();
      const enc = await encryptAmount(n, from.address, token, amt);
      hash = await send(from, token, encodeFunctionData({ abi: tokenAbi, functionName: "confidentialTransfer", args: [other.address, enc.ctHash, enc.inputProof] }));
      const moved = amt <= have;
      if (moved) { expected.set(from.address, have - amt); expected.set(other.address, expected.get(other.address)! + amt); }
      line = `private send ${fmt(amt)} ${name(from)}→${name(other)}${moved ? "" : " (above balance: moves 0)"} · encrypt ${((Date.now() - ts) / 1000).toFixed(1)}s`;
      count(moved ? "private send" : "private send above balance");
    } else if (r < 0.78) { // withdraw a whole amount, or everything
      if (have === 0n) { count("skip"); continue; }
      const all = rand() < 0.4 || have < usdc(1);
      const known = await claimIds(from.address);
      if (all) {
        hash = await send(from, token, encodeFunctionData({ abi: tokenAbi, functionName: "unshieldAll", args: [from.address] }));
        await newClaim(from, have, known); expected.set(from.address, 0n);
        line = `withdraw all (${fmt(have)}) ${name(from)}`; count("withdraw all");
      } else {
        const amt = usdc(1);
        hash = await send(from, token, encodeFunctionData({ abi: tokenAbi, functionName: "unshield", args: [from.address, from.address, amt] }));
        await newClaim(from, amt, known); expected.set(from.address, have - amt);
        line = `withdraw 1 ${name(from)}`; count("withdraw");
      }
    } else { // claim a pending withdrawal, sometimes submitted by the other wallet
      if (!pending.length) { count("skip"); continue; }
      const c = pending[0];
      const by = rand() < 0.3 ? (c.to === A ? B : A) : c.to;
      hash = await payClaim(c, by);
      line = `claim ${fmt(c.amount)} for ${name(c.to)}${by !== c.to ? ` (submitted by ${name(by)})` : ""}`; count(by !== c.to ? "claim by other wallet" : "claim");
    }
    await checkBalances(`step ${i}`);
    console.log(`[${String(i).padStart(3)}/${OPS}] ✓ ${line}  A=${fmt(expected.get(A.address)!)} B=${fmt(expected.get(B.address)!)}  ${hash?.slice(0, 12)}…`);
  } catch (e) {
    console.log(`[${String(i).padStart(3)}/${OPS}] ✗ ${line || "operation"} FAILED: ${(e as Error).message.slice(0, 300)}`);
    throw e;
  }
}

// ── free attack probes (simulated, no gas) ──────────────────────────────────
const mustRevert = async (label: string, p: Promise<unknown>) => p.then(() => { throw new Error(`${label} was NOT rejected`); }, () => { count(`${label} rejected`); });
await mustRevert("stranger changing caps", pc.simulateContract({ address: token, abi: [{ type: "function", name: "setCaps", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [] }], functionName: "setCaps", args: [1n, 1n], account: B.address }));
await mustRevert("stranger renouncing ownership", pc.simulateContract({ address: token, abi: [{ type: "function", name: "renounceOwnership", stateMutability: "nonpayable", inputs: [], outputs: [] }], functionName: "renounceOwnership", account: B.address }));
await mustRevert("withdrawing someone else's balance", pc.simulateContract({ address: token, abi: tokenAbi, functionName: "unshield", args: [A.address, B.address, 1n], account: B.address }));

// ── drain: withdraw everything, pay every claim, return funds to A ──────────
console.log("\ndraining: withdrawing everything and returning funds to A…");
for (const w of [A, B]) {
  const have = expected.get(w.address)!;
  if (have > 0n) { const known = await claimIds(w.address); await send(w, token, encodeFunctionData({ abi: tokenAbi, functionName: "unshieldAll", args: [w.address] })); await newClaim(w, have, known); expected.set(w.address, 0n); }
}
for (const c of [...pending]) await payClaim(c, c.to);
await checkBalances("after drain");
const bUsdc = await usdcBal(B.address);
if (bUsdc > 0n) await send(B, n.usdc, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [A.address, bUsdc] }));
const endHeld = await pc.readContract({ address: token, abi: tokenAbi, functionName: "totalShielded" });
if (endHeld !== startHeld) throw new Error(`contract held ${fmt(endHeld)}, expected ${fmt(startHeld)} after drain`);
const gasPrice = await pc.getGasPrice();
const bEth = await pc.getBalance({ address: B.address });
const fee = gasPrice * 2n * 50_000n;
if (bEth > fee) await send(B, A.address, "0x", bEth - fee);
const endA = await usdcBal(A.address);
if (endA !== startA.usdc) throw new Error(`A has ${fmt(endA)} USDC, started with ${fmt(startA.usdc)}`);

console.log(`\n✅ PASSED in ${((Date.now() - t0) / 60000).toFixed(1)} min: ${OPS} operations, ${txs} transactions, every decrypted balance matched`);
for (const [k, v] of Object.entries(stats).sort((x, y) => y[1] - x[1])) console.log(`   ${String(v).padStart(4)}  ${k}`);
console.log(`   all USDC back with A (${fmt(endA)}); contract total back to ${fmt(endHeld)}`);
console.log(`   gas used ${gasUsed}, A now has ${formatEther(await pc.getBalance({ address: A.address }))} ETH`);
process.exit(0);
