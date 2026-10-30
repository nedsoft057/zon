// Cold-start timing of the exact encrypt/decrypt code the plugin ships, bundled the same way.
// Runs against Fhenix's real CoFHE services. It moves no money and needs no keys:
// it only encrypts a number and asks Fhenix's verifier to sign it.
import { encryptAmount } from "../src/cofhe.js";
import { NETWORKS, type NetworkKey } from "../src/config.js";

const key = (process.argv[2] ?? "arbitrum-sepolia") as NetworkKey;
const n = NETWORKS[key];
// Public addresses only. The account is Favour's own PayBox wallet (from list_credentials);
// the "consuming contract" is Circle's USDC on the same chain, from config.ts. Nothing is sent to either.
const account = "0x79fBe68922074F041Db83F67a9bC0A51df5CdDc9" as const;
const consumer = n.usdc;

const t0 = performance.now();
const { ctHash, inputProof } = await encryptAmount(n, account, consumer, 1_234_567n);
const ms = Math.round(performance.now() - t0);
console.log(JSON.stringify({ network: n.label, encrypt_ms: ms, ctHash, inputProofBytes: (inputProof.length - 2) / 2 }));
