import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { ContractTransactionResponse } from "ethers";
import { ERC20_Harness, PrivateSendUSDC } from "../typechain-types";

const LIB_FQN = "contracts/ERC20Confidential/ERC20ConfidentialLib.sol:ERC20ConfidentialLib";
const USDC = (n: number | bigint) => BigInt(n) * 1_000_000n; // 6 decimals

async function plaintextBalance(token: PrivateSendUSDC, who: string) {
  return hre.cofhe.mocks.getPlaintext(await token.confidentialBalanceOf(who));
}

async function pendingClaimFor(tx: ContractTransactionResponse, token: PrivateSendUSDC, recipient: string) {
  const receipt = await tx.wait();
  let ctHash: string | undefined;
  for (const log of receipt!.logs) {
    try {
      const parsed = token.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "Unshielded") ctHash = parsed.args.amount;
    } catch {}
  }
  if (!ctHash) throw new Error("Unshielded event not found");
  const claims = await token.getUserClaims(recipient);
  const claim = claims.find(c => !c.claimed && BigInt(c.ctHash) === BigInt(ctHash!));
  if (!claim) throw new Error("pending claim not found");
  return { ctHash, claimId: claim.id };
}

describe("PrivateSendUSDC", function () {
  async function fixture() {
    const [owner, bob, alice, eve] = await ethers.getSigners();

    const usdc = (await ethers.deployContract("ERC20_Harness", ["USD Coin", "USDC", 6])) as unknown as ERC20_Harness;
    const lib = await ethers.deployContract(LIB_FQN);
    const factory = await ethers.getContractFactory("PrivateSendUSDC", {
      libraries: { [LIB_FQN]: await lib.getAddress() },
    });
    const token = (await factory.deploy(
      await usdc.getAddress(),
      owner.address,
      USDC(100), // per-user lifetime cap
      USDC(250), // total cap
    )) as unknown as PrivateSendUSDC;
    await token.waitForDeployment();

    for (const s of [bob, alice, eve]) {
      await usdc.mint(s.address, USDC(1000));
      await usdc.connect(s).approve(await token.getAddress(), USDC(1000));
    }

    const bobClient = await hre.cofhe.createClientWithBatteries(bob);
    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);
    return { owner, bob, alice, eve, usdc, token, bobClient, aliceClient };
  }

  async function claimAll(token: PrivateSendUSDC, tx: ContractTransactionResponse, recipient: any, client: any) {
    const { ctHash, claimId } = await pendingClaimFor(tx, token, recipient.address);
    await hre.network.provider.send("evm_increaseTime", [11]);
    await hre.network.provider.send("evm_mine");
    const d = await client.decryptForTx(ctHash).withoutACP().execute();
    await token.connect(recipient).claimUnshielded(claimId, d.decryptedValue, d.signature);
    return d.decryptedValue as bigint;
  }

  it("is set up as confidential USDC with the given caps", async function () {
    const { token, usdc, owner } = await fixture();
    expect(await token.name()).to.equal("Private USDC");
    expect(await token.symbol()).to.equal("pUSDC");
    expect(await token.decimals()).to.equal(6);
    expect(await token.rate()).to.equal(1n);
    expect(await token.underlying()).to.equal(await usdc.getAddress());
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.perUserShieldCap()).to.equal(USDC(100));
    expect(await token.totalShieldCap()).to.equal(USDC(250));
  });

  it("full flow: shield → private send → unshield → claim", async function () {
    const { token, usdc, bob, alice, bobClient, aliceClient } = await fixture();

    await token.connect(bob).shield(bob.address, USDC(40));
    expect(await plaintextBalance(token, bob.address)).to.equal(USDC(40));

    const [enc, proof] = await bobClient
      .encryptInputs([Encryptable.uint64(USDC(15))])
      .setConsumingContract(await token.getAddress())
      .execute();
    await token.connect(bob)["confidentialTransfer(address,bytes32,bytes)"](alice.address, enc, proof);

    expect(await plaintextBalance(token, bob.address)).to.equal(USDC(25));
    expect(await plaintextBalance(token, alice.address)).to.equal(USDC(15));

    const before = await usdc.balanceOf(alice.address);
    const tx = await token.connect(alice)["unshield(address,address,uint64)"](alice.address, alice.address, USDC(10));
    expect(await claimAll(token, tx, alice, aliceClient)).to.equal(USDC(10));
    expect((await usdc.balanceOf(alice.address)) - before).to.equal(USDC(10));
    expect(await plaintextBalance(token, alice.address)).to.equal(USDC(5));
  });

  it("the transfer event carries no plaintext amount", async function () {
    const { token, bob, alice, bobClient } = await fixture();
    await token.connect(bob).shield(bob.address, USDC(20));
    const [enc, proof] = await bobClient
      .encryptInputs([Encryptable.uint64(USDC(7))])
      .setConsumingContract(await token.getAddress())
      .execute();
    const tx = await token.connect(bob)["confidentialTransfer(address,bytes32,bytes)"](alice.address, enc, proof);
    const receipt = await tx.wait();
    const raw = receipt!.logs.map(l => l.data + l.topics.join("")).join("").toLowerCase();
    expect(raw.includes(USDC(7).toString(16).padStart(64, "0"))).to.equal(false);
  });

  it("unshieldAll withdraws a balance the holder never decrypted", async function () {
    const { token, usdc, bob, alice, bobClient, aliceClient } = await fixture();
    await token.connect(bob).shield(bob.address, USDC(30));
    const [enc, proof] = await bobClient
      .encryptInputs([Encryptable.uint64(USDC(12))])
      .setConsumingContract(await token.getAddress())
      .execute();
    await token.connect(bob)["confidentialTransfer(address,bytes32,bytes)"](alice.address, enc, proof);

    const before = await usdc.balanceOf(alice.address);
    const tx = await token.connect(alice).unshieldAll(alice.address);
    expect(await claimAll(token, tx, alice, aliceClient)).to.equal(USDC(12));
    expect((await usdc.balanceOf(alice.address)) - before).to.equal(USDC(12));
    expect(await plaintextBalance(token, alice.address)).to.equal(0n);
  });

  it("enforces the per-user lifetime cap", async function () {
    const { token, bob } = await fixture();
    await token.connect(bob).shield(bob.address, USDC(60));
    await expect(token.connect(bob).shield(bob.address, USDC(41))).to.be.revertedWithCustomError(
      token,
      "PerUserCapExceeded",
    );
    await token.connect(bob).shield(bob.address, USDC(40));
    expect(await token.shieldedBy(bob.address)).to.equal(USDC(100));
  });

  it("enforces the total cap", async function () {
    const { token, bob, alice, eve } = await fixture();
    await token.connect(bob).shield(bob.address, USDC(100));
    await token.connect(alice).shield(alice.address, USDC(100));
    await expect(token.connect(eve).shield(eve.address, USDC(51))).to.be.revertedWithCustomError(
      token,
      "TotalCapExceeded",
    );
    await token.connect(eve).shield(eve.address, USDC(50));
  });

  it("pause stops deposits but never traps funds", async function () {
    const { token, usdc, owner, bob, alice, bobClient, aliceClient } = await fixture();
    await token.connect(bob).shield(bob.address, USDC(20));
    await token.connect(owner).pauseDeposits();

    await expect(token.connect(bob).shield(bob.address, USDC(1))).to.be.revertedWithCustomError(token, "EnforcedPause");

    // private sends still work while paused
    const [enc, proof] = await bobClient
      .encryptInputs([Encryptable.uint64(USDC(5))])
      .setConsumingContract(await token.getAddress())
      .execute();
    await token.connect(bob)["confidentialTransfer(address,bytes32,bytes)"](alice.address, enc, proof);

    // withdrawals still work while paused
    const before = await usdc.balanceOf(alice.address);
    const tx = await token.connect(alice).unshieldAll(alice.address);
    await claimAll(token, tx, alice, aliceClient);
    expect((await usdc.balanceOf(alice.address)) - before).to.equal(USDC(5));

    await token.connect(owner).unpauseDeposits();
    await token.connect(bob).shield(bob.address, USDC(1));
  });

  it("only the owner can change caps or pause", async function () {
    const { token, eve } = await fixture();
    await expect(token.connect(eve).setCaps(1, 1)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    await expect(token.connect(eve).pauseDeposits()).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });

  it("has no admin function that can move user funds", async function () {
    const { token } = await fixture();
    const allowed = new Set([
      // standard FHERC20 / ERC-7984 / wrapper surface (all act only on msg.sender's own funds or an operator's grant)
      "shield", "unshield", "unshieldAll", "claimUnshielded", "claimUnshieldedBatch",
      "confidentialTransfer", "confidentialTransferFrom", "confidentialTransferAndCall",
      "confidentialTransferFromAndCall", "setOperator", "onTransferReceived",
      "reassignClaim", "requestDiscloseEncryptedAmount", "discloseEncryptedAmount", "resetIndicatedBalance",
      // owner-only: caps and pause
      "setCaps", "pauseDeposits", "unpauseDeposits",
      // ownership handover
      "transferOwnership", "acceptOwnership", "renounceOwnership",
    ]);
    const writes = token.interface.fragments
      .filter((f: any) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
      .map((f: any) => f.name as string);
    const unexpected = [...new Set(writes)].filter(n => !allowed.has(n));
    expect(unexpected, `unexpected state-changing functions: ${unexpected.join(", ")}`).to.deep.equal([]);
  });

  it("the ERC-1363 deposit path is disabled", async function () {
    const { token, bob } = await fixture();
    await expect(token.onTransferReceived(bob.address, bob.address, 1, "0x")).to.be.revertedWithCustomError(
      token,
      "DirectTokenCallbackDisabled",
    );
  });

  it("a transfer above balance moves nothing (no overdraft)", async function () {
    const { token, bob, alice, bobClient } = await fixture();
    await token.connect(bob).shield(bob.address, USDC(5));
    const [enc, proof] = await bobClient
      .encryptInputs([Encryptable.uint64(USDC(6))])
      .setConsumingContract(await token.getAddress())
      .execute();
    await token.connect(bob)["confidentialTransfer(address,bytes32,bytes)"](alice.address, enc, proof);
    expect(await plaintextBalance(token, bob.address)).to.equal(USDC(5));
    expect(await plaintextBalance(token, alice.address)).to.equal(0n);
  });

  it("the per-user cap also counts the recipient (no topping someone up past the cap)", async function () {
    const { token, bob, alice, eve } = await fixture();
    await token.connect(alice).shield(alice.address, USDC(100));
    await expect(token.connect(bob).shield(alice.address, USDC(1))).to.be.revertedWithCustomError(
      token,
      "PerUserCapExceeded",
    );
    await token.connect(bob).shield(eve.address, USDC(60));
    await expect(token.connect(alice).shield(eve.address, USDC(41))).to.be.revertedWithCustomError(
      token,
      "PerUserCapExceeded",
    );
    expect(await token.shieldedTo(alice.address)).to.equal(USDC(100));
    expect(await token.shieldedTo(eve.address)).to.equal(USDC(60));
  });

  it("USDC sent straight to the contract does not count toward the total cap", async function () {
    const { token, usdc, bob, alice, eve } = await fixture();
    await token.connect(bob).shield(bob.address, USDC(100));
    await token.connect(alice).shield(alice.address, USDC(100));
    await usdc.connect(eve).transfer(await token.getAddress(), USDC(50)); // griefing attempt
    await token.connect(eve).shield(eve.address, USDC(50)); // still allowed: 250 counted of 250
    expect(await token.totalShielded()).to.equal(USDC(250));
    await expect(token.connect(eve).shield(eve.address, USDC(1))).to.be.revertedWithCustomError(
      token,
      "TotalCapExceeded",
    );
  });

  it("paid-out claims free room under the total cap", async function () {
    const { token, bob, aliceClient, alice } = await fixture();
    await token.connect(alice).shield(alice.address, USDC(100));
    await token.connect(bob).shield(bob.address, USDC(100));
    expect(await token.totalShielded()).to.equal(USDC(200));
    const tx = await token.connect(alice)["unshield(address,address,uint64)"](alice.address, alice.address, USDC(30));
    expect(await claimAll(token, tx, alice, aliceClient)).to.equal(USDC(30));
    expect(await token.totalShielded()).to.equal(USDC(170));
  });

  it("ownership cannot be renounced", async function () {
    const { token, owner, eve } = await fixture();
    await expect(token.connect(owner).renounceOwnership()).to.be.revertedWithCustomError(
      token,
      "OwnershipCannotBeRenounced",
    );
    await expect(token.connect(eve).renounceOwnership()).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount",
    );
    expect(await token.owner()).to.equal(owner.address);
  });
});
