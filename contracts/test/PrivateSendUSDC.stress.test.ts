import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { ERC20_Harness, PrivateSendUSDC } from "../typechain-types";

// Randomised stress run against Fhenix's mocks: deposits, private sends, partial and full
// withdrawals, claims (including by third parties), donations, pauses and attack attempts.
// After every operation the contract is checked against an independent plaintext model.
//
//   STRESS_OPS=1000 STRESS_SEED=7 pnpm exec hardhat test --network hardhat test/PrivateSendUSDC.stress.test.ts

const LIB_FQN = "contracts/ERC20Confidential/ERC20ConfidentialLib.sol:ERC20ConfidentialLib";
const USDC = (n: number | bigint) => BigInt(n) * 1_000_000n;
const OPS = Number(process.env.STRESS_OPS ?? 1000);
const SEED = Number(process.env.STRESS_SEED ?? 7);
const PER_USER_CAP = USDC(600);
const TOTAL_CAP = USDC(2500);
const MINT = USDC(5000);

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pending = { id: string; ctHash: string; to: string; amount: bigint };

describe("PrivateSendUSDC stress", function () {
  it(`${OPS} random operations keep every balance and total exact`, async function () {
    this.timeout(0);
    const rand = rng(SEED);
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const amount = (max: bigint) => (max <= 0n ? 1n : BigInt(Math.floor(rand() * Number(max))) + 1n);

    const [owner, ...rest] = await ethers.getSigners();
    const users = rest.slice(0, 6);
    const usdc = (await ethers.deployContract("ERC20_Harness", ["USD Coin", "USDC", 6])) as unknown as ERC20_Harness;
    const lib = await ethers.deployContract(LIB_FQN);
    const factory = await ethers.getContractFactory("PrivateSendUSDC", { libraries: { [LIB_FQN]: await lib.getAddress() } });
    const token = (await factory.deploy(await usdc.getAddress(), owner.address, PER_USER_CAP, TOTAL_CAP)) as unknown as PrivateSendUSDC;
    const tokenAddr = await token.getAddress();
    const clients = new Map<string, any>();
    for (const u of users) {
      await usdc.mint(u.address, MINT);
      await usdc.connect(u).approve(tokenAddr, ethers.MaxUint256);
      clients.set(u.address, await hre.cofhe.createClientWithBatteries(u));
    }

    // Independent model of what the contract must hold.
    const bal = new Map(users.map(u => [u.address, 0n]));
    const by = new Map(users.map(u => [u.address, 0n]));
    const to_ = new Map(users.map(u => [u.address, 0n]));
    const pending: Pending[] = [];
    let held = 0n, donated = 0n, paused = false, txs = 0;
    const stats: Record<string, number> = {};
    const count = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);

    async function plain(addr: string) {
      const h = await token.confidentialBalanceOf(addr);
      return BigInt(h) === 0n ? 0n : BigInt(await hre.cofhe.mocks.getPlaintext(h));
    }
    async function claimFromTx(tx: any, recipient: string, amt: bigint) {
      const receipt = await tx.wait();
      let ctHash: string | undefined;
      for (const log of receipt.logs) {
        try { const p = token.interface.parseLog({ topics: log.topics as string[], data: log.data }); if (p?.name === "Unshielded") ctHash = p.args.amount; } catch {}
      }
      const c = (await token.getUserClaims(recipient)).find(c => !c.claimed && BigInt(c.ctHash) === BigInt(ctHash!));
      expect(c, "claim created").to.not.equal(undefined);
      pending.push({ id: c!.id, ctHash: ctHash!, to: recipient, amount: amt });
    }
    async function check(step: number) {
      for (const u of users) expect(await plain(u.address), `step ${step}: balance of ${u.address}`).to.equal(bal.get(u.address));
      const sumBal = [...bal.values()].reduce((a, b) => a + b, 0n);
      const sumPending = pending.reduce((a, p) => a + p.amount, 0n);
      expect(held, `step ${step}: model held`).to.equal(sumBal + sumPending);
      expect(await token.totalShielded(), `step ${step}: totalShielded`).to.equal(held);
      expect(await usdc.balanceOf(tokenAddr), `step ${step}: USDC in contract`).to.equal(held + donated);
      expect(held <= TOTAL_CAP, `step ${step}: total cap`).to.equal(true);
      for (const u of users) {
        expect(await token.shieldedBy(u.address)).to.equal(by.get(u.address));
        expect(await token.shieldedTo(u.address)).to.equal(to_.get(u.address));
        expect(by.get(u.address)! <= PER_USER_CAP && to_.get(u.address)! <= PER_USER_CAP).to.equal(true);
      }
      let publicSum = await usdc.balanceOf(tokenAddr);
      for (const u of users) publicSum += await usdc.balanceOf(u.address);
      expect(publicSum, `step ${step}: no USDC created or lost`).to.equal(MINT * BigInt(users.length));
    }

    for (let step = 1; step <= OPS; step++) {
      const r = rand();
      const a = pick(users), b = pick(users.filter(u => u !== a));

      if (r < 0.25) { // deposit, to self or to someone else, odd amounts included
        const target = rand() < 0.6 ? a : b;
        const amt = amount(USDC(80));
        const ok = !paused && by.get(a.address)! + amt <= PER_USER_CAP && to_.get(target.address)! + amt <= PER_USER_CAP && held + amt <= TOTAL_CAP;
        if (ok) {
          await (await token.connect(a).shield(target.address, amt)).wait(); txs++;
          by.set(a.address, by.get(a.address)! + amt); to_.set(target.address, to_.get(target.address)! + amt);
          bal.set(target.address, bal.get(target.address)! + amt); held += amt; count("deposit");
        } else {
          await expect(token.connect(a).shield(target.address, amt)).to.be.reverted; count("deposit rejected (cap/pause)");
        }
      } else if (r < 0.55) { // private send, sometimes more than the balance
        const have = bal.get(a.address)!;
        const amt = amount(have > 0n ? (have * 12n) / 10n : USDC(5));
        const [enc, proof] = await clients.get(a.address).encryptInputs([Encryptable.uint64(amt)]).setConsumingContract(tokenAddr).execute();
        if (BigInt(await token.confidentialBalanceOf(a.address)) === 0n) { // never held pUSDC: Fhenix rejects
          await expect(token.connect(a)["confidentialTransfer(address,bytes32,bytes)"](b.address, enc, proof)).to.be.revertedWithCustomError(token, "FHERC20ZeroBalance");
          count("send from a never-funded wallet rejected"); await check(step); continue;
        }
        await (await token.connect(a)["confidentialTransfer(address,bytes32,bytes)"](b.address, enc, proof)).wait(); txs++;
        if (amt <= have) { bal.set(a.address, have - amt); bal.set(b.address, bal.get(b.address)! + amt); count("private send"); }
        else count("private send above balance (moved 0)");
      } else if (r < 0.65) { // partial withdrawal, sometimes more than the balance
        const have = bal.get(a.address)!;
        if (have === 0n) { count("skip"); continue; }
        const amt = amount((have * 12n) / 10n);
        const out = amt <= have ? amt : 0n;
        const dest = rand() < 0.8 ? a : b;
        const tx = await token.connect(a)["unshield(address,address,uint64)"](a.address, dest.address, amt); txs++;
        await claimFromTx(tx, dest.address, out);
        bal.set(a.address, have - out); count(out ? "withdraw" : "withdraw above balance (0)");
      } else if (r < 0.70) { // withdraw everything
        const have = bal.get(a.address)!;
        if (have === 0n) {
          await token.connect(a).unshieldAll.staticCall(a.address).then(() => count("withdraw-all of 0 allowed"), () => count("withdraw-all of nothing rejected"));
          continue;
        }
        const tx = await token.connect(a).unshieldAll(a.address); txs++;
        await claimFromTx(tx, a.address, have);
        bal.set(a.address, 0n); count("withdraw all");
      } else if (r < 0.90) { // claim, sometimes by a stranger, plus forged / repeated claims
        if (!pending.length) { count("skip"); continue; }
        const i = Math.floor(rand() * pending.length);
        const p = pending[i];
        await hre.network.provider.send("evm_increaseTime", [11]);
        await hre.network.provider.send("evm_mine");
        const caller = rand() < 0.3 ? pick(users) : users.find(u => u.address === p.to)!;
        const d = await clients.get(caller.address).decryptForTx(p.ctHash).withoutACP().execute();
        expect(BigInt(d.decryptedValue), "decrypted claim amount").to.equal(p.amount);
        if (rand() < 0.2) {
          await expect(token.connect(caller).claimUnshielded(p.id, BigInt(d.decryptedValue) + 1n, d.signature)).to.be.reverted;
          count("forged claim amount rejected");
        }
        const before = await usdc.balanceOf(p.to);
        await (await token.connect(caller).claimUnshielded(p.id, d.decryptedValue, d.signature)).wait(); txs++;
        expect((await usdc.balanceOf(p.to)) - before, "claim pays the recipient exactly").to.equal(caller.address === p.to || caller.address !== p.to ? p.amount : 0n);
        held -= p.amount; pending.splice(i, 1);
        count(caller.address === p.to ? "claim" : "claim submitted by someone else (paid to owner of claim)");
        if (rand() < 0.3) { await expect(token.connect(caller).claimUnshielded(p.id, d.decryptedValue, d.signature)).to.be.reverted; count("double claim rejected"); }
      } else if (r < 0.93) { // donation straight to the contract (griefing attempt)
        const amt = amount(USDC(30));
        await (await usdc.connect(a).transfer(tokenAddr, amt)).wait(); txs++;
        donated += amt; count("donation");
      } else if (r < 0.96) { // owner pause/unpause; strangers can't
        await expect(token.connect(a).pauseDeposits()).to.be.reverted;
        await (await (paused ? token.connect(owner).unpauseDeposits() : token.connect(owner).pauseDeposits())).wait(); txs++;
        paused = !paused; count(paused ? "pause" : "unpause");
      } else { // other attacks
        await expect(token.connect(a).setCaps(USDC(1e9), USDC(1e9))).to.be.reverted;
        await expect(token.connect(a).renounceOwnership()).to.be.reverted;
        await expect(token.connect(owner).renounceOwnership()).to.be.reverted;
        await expect(token.connect(a)["unshield(address,address,uint64)"](b.address, a.address, 1n)).to.be.reverted;
        count("admin / theft attempts rejected");
      }
      await check(step);
    }

    // Drain: every holder withdraws everything and every claim is paid. Nothing may be left over.
    for (const u of users) if (bal.get(u.address)! > 0n) {
      const tx = await token.connect(u).unshieldAll(u.address); txs++;
      await claimFromTx(tx, u.address, bal.get(u.address)!); bal.set(u.address, 0n);
    }
    await hre.network.provider.send("evm_increaseTime", [11]);
    await hre.network.provider.send("evm_mine");
    for (const p of [...pending]) {
      const d = await clients.get(p.to).decryptForTx(p.ctHash).withoutACP().execute();
      await (await token.connect(users.find(u => u.address === p.to)!).claimUnshielded(p.id, d.decryptedValue, d.signature)).wait(); txs++;
      held -= p.amount; pending.splice(pending.indexOf(p), 1);
    }
    await check(OPS + 1);
    expect(await token.totalShielded()).to.equal(0n);
    expect(await usdc.balanceOf(tokenAddr)).to.equal(donated);

    console.log(`\n      ${OPS} operations, ${txs} successful transactions, seed ${SEED}`);
    for (const [k, v] of Object.entries(stats).sort((x, y) => y[1] - x[1])) console.log(`        ${String(v).padStart(4)}  ${k}`);
    console.log(`      drained to 0: every deposit paid back exactly; ${ethers.formatUnits(donated, 6)} USDC of donations left untouched`);
  });
});
