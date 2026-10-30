import { expect } from "chai";
import { ethers } from "hardhat";
import { ConfidentialHarness } from "../typechain-types";

// Pins the public <-> confidential conversion rate so it can't regress.
//
// Any dual-ledger confidential token must satisfy
//     rate == 10 ** (publicDecimals - confidentialDecimals)
// so that `rate` public base units back exactly one confidential unit. The core's init path
// scales the confidential layer relative to the host's public ledger and clamps the requested
// confidential precision to it.
//
// Exercised through ConfidentialHarness, whose stand-in ledger is fixed at 6 public decimals
// (the same shape as a 6-decimal production host), against the real Core + ERC20ConfidentialLib
// delegatecall path.
const LIB_FQN = "contracts/ERC20Confidential/ERC20ConfidentialLib.sol:ERC20ConfidentialLib";

describe("confidential decimals / conversion rate", function () {
  async function deployHarness(confidentialDecimals: number): Promise<ConfidentialHarness> {
    const lib = await ethers.deployContract(LIB_FQN);
    await lib.waitForDeployment();
    const Harness = await ethers.getContractFactory("ConfidentialHarness", {
      libraries: { [LIB_FQN]: await lib.getAddress() },
    });
    const h = (await Harness.deploy()) as unknown as ConfidentialHarness;
    await h.waitForDeployment();
    await (await h.initialize(confidentialDecimals)).wait();
    return h;
  }

  it("CONTROL: confidentialDecimals = 6 matches the 6-decimal public ledger (rate == 1)", async function () {
    const h = await deployHarness(6);

    expect(await h.decimals()).to.equal(6); // stand-in public ledger, fixed
    expect(await h.confidentialDecimals()).to.equal(6);
    expect(await h.rate()).to.equal(1n); // 10^(6-6) = 1
  });

  // A confidential precision coarser than the public ledger's must still back one
  // confidential unit with 10^(publicDecimals - confidentialDecimals) public units.
  it("rate bridges the public/confidential decimal gap for confidentialDecimals != 6", async function () {
    // A deployer wants 4 confidential decimals on the 6-decimal public ledger.
    const h = await deployHarness(4);

    const publicDecimals = await h.decimals(); // 6, fixed
    const confDecimals = await h.confidentialDecimals(); // 4

    expect(publicDecimals).to.equal(6);
    expect(confDecimals).to.equal(4);

    const expectedRate = 10n ** (BigInt(publicDecimals) - BigInt(confDecimals)); // 10^(6-4) = 100
    expect(await h.rate()).to.equal(expectedRate);
  });

  // Requesting finer confidential precision than the public ledger offers cannot be honoured
  // (there are no sub-base public units to back it), so the core clamps to the ledger.
  it("clamps a confidential precision finer than the public ledger (rate stays 1)", async function () {
    const h = await deployHarness(18);

    expect(await h.decimals()).to.equal(6);
    expect(await h.confidentialDecimals()).to.equal(6);
    expect(await h.rate()).to.equal(1n);
  });
});
