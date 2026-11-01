import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Deploys PrivateSendUSDC, linked against this chain's ERC20ConfidentialLib (script 00).
 *
 * USDC is Circle's native USDC per chain (same values as plugin/src/config.ts).
 * Source: https://developers.circle.com/stablecoins/usdc-contract-addresses
 *
 * Settings (env):
 *   PRIVATE_SEND_OWNER       owner (caps + pause only). Defaults to the deployer on testnets; REQUIRED on mainnets.
 *   PRIVATE_SEND_USER_CAP    per-wallet lifetime deposit cap, whole USDC. Testnet default 1000; REQUIRED on mainnets.
 *   PRIVATE_SEND_TOTAL_CAP   cap on total USDC held, whole USDC. Testnet default 100000; REQUIRED on mainnets.
 *
 *   ETHERSCAN_MAINNET_API_KEY=... PRIVATE_SEND_OWNER=0x... pnpm exec hardhat deploy --network arbitrumSepolia --tags PrivateSendUSDC
 *
 * After deploying, copy the address from deployments/<network>/PrivateSendUSDC.json into
 * plugin/src/config.ts (`privateUsdc`) for the matching network.
 */
const USDC: Record<number, string> = {
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum One
  421614: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // Arbitrum Sepolia
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Ethereum Sepolia
};
const MAINNETS = new Set([1, 42161]);

const deployPrivateSendUSDC: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get, log } = hre.deployments;
  const chainId = Number(await hre.getChainId());
  const mainnet = MAINNETS.has(chainId);

  let usdc = USDC[chainId];
  if (!usdc) {
    if (hre.network.live) throw new Error(`No USDC address for chain ${chainId}. Fhenix CoFHE runs on Ethereum and Arbitrum only.`);
    // Dev network: a mock USDC so the script can be dry-run end to end.
    usdc = (await deploy("MockUSDC", { contract: "ERC20_Harness", from: deployer, args: ["USD Coin", "USDC", 6], log: true }))
      .address;
  }

  const setting = (name: string, testnetDefault?: string) => {
    const v = process.env[name];
    if (v) return v;
    if (mainnet || testnetDefault === undefined) throw new Error(`Set ${name} to deploy on chain ${chainId}.`);
    return testnetDefault;
  };
  const owner = setting("PRIVATE_SEND_OWNER", deployer);
  const userCap = BigInt(setting("PRIVATE_SEND_USER_CAP", "1000")) * 1_000_000n;
  const totalCap = BigInt(setting("PRIVATE_SEND_TOTAL_CAP", "100000")) * 1_000_000n;
  if (!hre.ethers.isAddress(owner)) throw new Error(`PRIVATE_SEND_OWNER is not an address: ${owner}`);

  const lib = await get("ERC20ConfidentialLib");
  const token = await deploy("PrivateSendUSDC", {
    from: deployer,
    args: [usdc, owner, userCap, totalCap],
    libraries: { ERC20ConfidentialLib: lib.address },
    log: true,
    waitConfirmations: hre.network.live ? 5 : 1,
  });
  log(`PrivateSendUSDC at ${token.address} on '${hre.network.name}' (chain ${chainId}), USDC ${usdc}, owner ${owner}`);

  if (!hre.network.live || !process.env.ETHERSCAN_MAINNET_API_KEY) return;
  try {
    await hre.run("verify:verify", {
      address: token.address,
      constructorArguments: [usdc, owner, userCap, totalCap],
      libraries: { ERC20ConfidentialLib: lib.address },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/already.{0,10}verified/i.test(message)) log(`explorer verification failed (retry by re-running): ${message}`);
  }
};

deployPrivateSendUSDC.tags = ["PrivateSendUSDC"];
deployPrivateSendUSDC.dependencies = ["ERC20ConfidentialLib"];
export default deployPrivateSendUSDC;
