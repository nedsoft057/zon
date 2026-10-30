// Every address and host this plugin uses lives in this one file.
// Each value names its official source. Nothing here comes from search results or third-party sites.
// Change a value only after checking it against the source listed next to it.

export type NetworkKey = "arbitrum" | "arbitrum-sepolia";

export type Network = {
  key: NetworkKey;
  label: string;
  chainId: number;
  /** Public RPC run by Offchain Labs. Source: https://docs.arbitrum.io/build-decentralized-apps/reference/node-providers */
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
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    privateUsdc: ZERO,
  },
  "arbitrum-sepolia": {
    key: "arbitrum-sepolia",
    label: "Arbitrum Sepolia (testnet)",
    chainId: 421614,
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    privateUsdc: ZERO,
  },
};

// Fhenix CoFHE endpoints come from the official SDK (@cofhe/sdk/chains), not from this file.
// Hosts to allow in the PayBox portal ("Test & configure" → network access):
//   arb1.arbitrum.io, sepolia-rollup.arbitrum.io,
//   cofhe.mainnet.fhenix.zone, cofhe-vrf.mainnet.fhenix.zone, cofhe-tn.mainnet.fhenix.zone,
//   testnet-cofhe.fhenix.zone, testnet-cofhe-vrf.fhenix.zone, testnet-cofhe-tn.fhenix.zone
