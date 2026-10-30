import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { FHERC20_Harness, SharedAmountReceiver } from "../typechain-types";

// Proves the `sharedEuintXX` migration of the transfer-callback boundary actually bought the
// protection it is supposed to, rather than just changing types.
//
// The boundary is FHERC20Utils.checkOnTransferReceived ->
// IERC7984Receiver.onConfidentialTransferReceived. Before the migration both encrypted values on
// that boundary were bare handles with an out-of-band `allowTransient` grant, which makes an
// unauthenticated callback into a decryption oracle: FHE operations check the permission of the
// CONTRACT performing them, so any caller could pass any handle the receiver is allowed on and
// read back a value derived from it.
//
// A clean compile proves nothing here (the old spelling compiled too), and neither does the
// existing *AndCall suite, which only walks the happy path. These two cases are the actual
// evidence: the round trip delivers the real value, and the direct-call oracle path is closed.
const AMOUNT = BigInt(1e6); // 1.0 confidential unit at 6 decimals

describe("sharedEuint64 transfer-callback boundary", function () {
  async function fixture() {
    const [, bob] = await ethers.getSigners();
    // FHERC20 base does not use the claims lib — no linking needed.
    const token = (await (
      await ethers.getContractFactory("FHERC20_Harness")
    ).deploy("Confidential Token", "CTK", 6, "")) as FHERC20_Harness;
    await token.waitForDeployment();
    await (await token.mint(bob.address, 10n * AMOUNT)).wait();

    const receiver = (await (await ethers.getContractFactory("SharedAmountReceiver")).deploy()) as SharedAmountReceiver;
    await receiver.waitForDeployment();

    const bobClient = await hre.cofhe.createClientWithBatteries(bob);
    return { bob, token, receiver, bobClient };
  }

  // Drives one real `*AndCall` transfer into the receiver. Both cases below need it: the first
  // asserts on what arrived, the second needs the handle the receiver is left holding.
  async function roundTrip(ctx: Awaited<ReturnType<typeof fixture>>) {
    const { bob, token, receiver, bobClient } = ctx;

    const [hash, proof] = await bobClient
      .encryptInputs([Encryptable.uint64(AMOUNT)])
      .setConsumingContract(await token.getAddress())
      .execute();

    await (
      await token
        .connect(bob)
        ["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](await receiver.getAddress(), hash, proof, "0x")
    ).wait();
  }

  it("round trip: the receiver really receives the transferred amount", async function () {
    const ctx = await fixture();
    const { receiver } = ctx;

    await roundTrip(ctx);

    // The callback ran, unwrapped the directed share, and persisted the handle.
    expect(await receiver.callbackCount()).to.equal(1n);
    // And what it unwrapped is the real transferred amount, not a zero or a stray handle.
    await hre.cofhe.mocks.expectPlaintext(await receiver.lastAmount(), AMOUNT);
  });

  it("oracle path is closed: calling the callback directly with an unshared handle reverts", async function () {
    const ctx = await fixture();
    const { bob, receiver } = ctx;

    // Run a real transfer first so the receiver is left holding a handle of its own:
    // SharedAmountReceiver calls `allowThis`/`allowPublic` on it, and `_update` already granted
    // the receiver persistent ACL access as the transfer's `to`. That makes this the STRONGEST
    // possible input — the receiver's own stored state, on which it has every ACL right the FHE
    // ops would need. The only thing missing is a share record, and that alone must stop it.
    // Before the migration this call succeeded and turned the callback into a decryption oracle.
    await roundTrip(ctx);
    const ownHandle = await receiver.lastAmount();

    // Assert the SPECIFIC refusal, not just "it reverted": NotShared is the ACL reporting that
    // no share record exists for this receiver. A generic `to.be.reverted` would also pass on an
    // unrelated failure and would not prove the oracle path is what closed. The check is
    // share-based rather than ACL-based, which is precisely why holding ACL does not help here.
    const acl = await hre.cofhe.mocks.getMockACL();
    await expect(
      receiver.connect(bob).onConfidentialTransferReceived(bob.address, bob.address, ownHandle, "0x"),
    ).to.be.revertedWithCustomError(acl, "NotShared");

    // Still just the one legitimate callback from the round trip — the direct call did no FHE
    // work on the supplied handle.
    expect(await receiver.callbackCount()).to.equal(1n);
  });
});
