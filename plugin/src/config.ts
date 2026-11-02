// Every address and host this plugin uses lives in this one file.
// Each value names its official source. Nothing here comes from search results or third-party sites.
// Change a value only after checking it against the source listed next to it.

export type NetworkKey = "arbitrum" | "arbitrum-sepolia" | "ethereum" | "sepolia";

export type Network = {
  key: NetworkKey;
  label: string;
  chainId: number;
  /** Public RPC. Source is noted on each network below. */
  rpcUrl: string;
  /** Circle's USDC on this chain. Source: https://developers.circle.com/stablecoins/usdc-contract-addresses */
  usdc: `0x${string}`;
  /**
   * Our PrivateSendUSDC contract. Filled in only after WE deploy it and the deploy has been checked.
   * The zero address means "not deployed yet": every money tool refuses to run.
   */
  privateUsdc: `0x${string}`;
};

export const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const NETWORKS: Record<NetworkKey, Network> = {
  arbitrum: {
    key: "arbitrum",
    label: "Arbitrum One",
    chainId: 42161,
    // Offchain Labs. Source: https://docs.arbitrum.io/build-decentralized-apps/reference/node-providers
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    privateUsdc: ZERO,
  },
  "arbitrum-sepolia": {
    key: "arbitrum-sepolia",
    label: "Arbitrum Sepolia (testnet)",
    chainId: 421614,
    // Offchain Labs. Source: https://docs.arbitrum.io/build-decentralized-apps/reference/node-providers
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    // v2, deployed 2026-11-01. Owner: 0x79fBe68922074F041Db83F67a9bC0A51df5CdDc9. Record: contracts/deployments/arbitrumSepolia/
    privateUsdc: "0xEe7d96D22b1929AB8337Af548B358AF5E618B6A9",
  },
  ethereum: {
    key: "ethereum",
    label: "Ethereum",
    chainId: 1,
    // Ethereum has no foundation-run public RPC. Keyless public RPC by Allnodes. Source: https://ethereum-rpc.publicnode.com
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    privateUsdc: ZERO,
  },
  sepolia: {
    key: "sepolia",
    label: "Ethereum Sepolia (testnet)",
    chainId: 11155111,
    // Keyless public RPC by Allnodes. Source: https://ethereum-sepolia-rpc.publicnode.com
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    // v2, deployed 2026-11-02. Owner: 0x79fBe68922074F041Db83F67a9bC0A51df5CdDc9. Record: contracts/deployments/sepolia/
    privateUsdc: "0xD9531Ef9aC286bC44Bea5F7Ceed6AB3c96EE0211",
  },
};

// Fhenix CoFHE endpoints come from the official SDK (@cofhe/sdk/chains), not from this file.
// Fhenix CoFHE runs on Ethereum and Arbitrum (mainnet + testnet), not on Base mainnet.
// Ethereum and Arbitrum use the same Fhenix hosts (mainnet set and testnet set).
// Hosts to allow in the PayBox portal ("Test & configure" → network access):
//   arb1.arbitrum.io, sepolia-rollup.arbitrum.io,
//   ethereum-rpc.publicnode.com, ethereum-sepolia-rpc.publicnode.com,
//   cofhe.mainnet.fhenix.zone, cofhe-vrf.mainnet.fhenix.zone, cofhe-tn.mainnet.fhenix.zone,
//   testnet-cofhe.fhenix.zone, testnet-cofhe-vrf.fhenix.zone, testnet-cofhe-tn.fhenix.zone
