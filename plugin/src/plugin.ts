import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { encodeFunctionData, type Address, type Hex } from "viem";
import * as z from "zod/v4";

import { ZERO, type Network, type NetworkKey } from "./config.js";
import { deployed, erc20Abi, formatUsdc, network, parseAddress, parseUsdc, publicClient, tokenAbi } from "./chain.js";
import { decryptClaim, encryptAmount, Timeout, withTimeout } from "./cofhe.js";
import { evmOutputSchema, proposeEvm } from "./paybox.js";
import { PERMIT_DEFAULT_MINUTES, PERMIT_MAX_MINUTES, preparePermit, viewBalance } from "./view.js";

const PROTOCOL_VERSION = "2026-07-28";

/** Hosted calls get 10 s in total. Leave room for sandbox start-up and the reply. */
const ENCRYPT_BUDGET_MS = 7_500;
const DECRYPT_BUDGET_MS = 6_500;
const VIEW_BUDGET_MS = 6_500;

const networkArg = z.enum(["arbitrum", "arbitrum-sepolia", "ethereum", "sepolia"]).default("arbitrum")
  .describe(
    "arbitrum = Arbitrum One mainnet (real money, low fees; the default). ethereum = Ethereum mainnet (real money, much higher fees). " +
    "arbitrum-sepolia / sepolia = free testnets. Private USDC on one network is separate from the others.",
  );
const addressArg = (what: string) => z.string().max(42).describe(what);
const usdcArg = (what: string) => z.string().max(20).describe(`${what} in USDC as a decimal string, e.g. "12.50".`);
const walletArg = addressArg("The user's own PayBox EVM wallet address (public). It is the account that will sign.");

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const PRIVACY_NOTE =
  "What stays private: the amount of a private send and everyone's Private USDC balance. " +
  "What is still public: the sender and recipient addresses of a send, and the amounts of deposits (shield) and withdrawals (claim). " +
  "Beta: deposits are capped. Contract code is open source.";

function caip(n: Network) {
  return `eip155:${n.chainId}`;
}

function propose(n: Network, to: Address, data: Hex, summary: string) {
  const result = proposeEvm({ chain: caip(n), to, value: "0", data });
  return {
    ...result,
    content: [{ type: "text" as const, text: `${summary}\n\nUnsigned proposal on ${n.label}. PayBox simulates it and asks the user to approve. Nothing has been signed or sent yet.` }],
  };
}

async function readState(n: Network, token: Address, wallet?: Address) {
  const c = publicClient(n);
  const [perUserCap, totalCap, paused, held] = await Promise.all([
    c.readContract({ address: token, abi: tokenAbi, functionName: "perUserShieldCap" }),
    c.readContract({ address: token, abi: tokenAbi, functionName: "totalShieldCap" }),
    c.readContract({ address: token, abi: tokenAbi, functionName: "paused" }),
    c.readContract({ address: n.usdc, abi: erc20Abi, functionName: "balanceOf", args: [token] }),
  ]);
  if (!wallet) return { perUserCap, totalCap, paused, held };
  const [usdcBalance, allowance, shieldedBy, claims] = await Promise.all([
    c.readContract({ address: n.usdc, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
    c.readContract({ address: n.usdc, abi: erc20Abi, functionName: "allowance", args: [wallet, token] }),
    c.readContract({ address: token, abi: tokenAbi, functionName: "shieldedBy", args: [wallet] }),
    c.readContract({ address: token, abi: tokenAbi, functionName: "getUserClaims", args: [wallet] }),
  ]);
  return { perUserCap, totalCap, paused, held, usdcBalance, allowance, shieldedBy, claims };
}

function createServer() {
  const server = new McpServer({ name: "zon", version: "0.1.0" }, { supportedProtocolVersions: [PROTOCOL_VERSION] });

  // ── read ───────────────────────────────────────────────────────────────────
  server.registerTool("private_usdc_info", {
    title: "Private USDC: status",
    description:
      "Status of Private USDC (confidential USDC for private payments on Arbitrum and Ethereum): contract address, whether deposits are open, deposit caps, " +
      "and, if a wallet is given, its public USDC balance, how much it has deposited and any withdrawals waiting to be claimed. " +
      "Encrypted balances cannot be read here. Read-only. " + PRIVACY_NOTE,
    inputSchema: z.object({ network: networkArg, wallet: walletArg.optional() }).strict(),
    outputSchema: z.object({
      network: z.string(), deployed: z.boolean(), contract: z.string(), usdc: z.string(),
      deposits_open: z.boolean().optional(), per_user_cap_usdc: z.string().optional(), total_cap_usdc: z.string().optional(),
      total_held_usdc: z.string().optional(), wallet_usdc: z.string().optional(), wallet_deposited_usdc: z.string().optional(),
      pending_claims: z.number().optional(),
    }).strict(),
    annotations: READ,
  }, async ({ network: key, wallet }) => {
    const n = network(key as NetworkKey);
    const base = { network: n.label, deployed: n.privateUsdc !== ZERO, contract: n.privateUsdc, usdc: n.usdc };
    if (!base.deployed) {
      return { content: [{ type: "text" as const, text: `Private USDC is not deployed on ${n.label} yet.` }], structuredContent: base };
    }
    const w = wallet ? parseAddress(wallet, "wallet") : undefined;
    const s = await readState(n, n.privateUsdc, w);
    const out = {
      ...base,
      deposits_open: !s.paused,
      per_user_cap_usdc: formatUsdc(s.perUserCap),
      total_cap_usdc: formatUsdc(s.totalCap),
      total_held_usdc: formatUsdc(s.held),
      ...(w ? {
        wallet_usdc: formatUsdc(s.usdcBalance!),
        wallet_deposited_usdc: formatUsdc(s.shieldedBy!),
        pending_claims: s.claims!.filter(c => !c.claimed).length,
      } : {}),
    };
    const lines = [
      `Private USDC on ${n.label}: ${out.contract}`,
      `Deposits ${out.deposits_open ? "open" : "PAUSED (sends and withdrawals still work)"} · cap ${out.per_user_cap_usdc} USDC per wallet · ${out.total_held_usdc} / ${out.total_cap_usdc} USDC held`,
      ...(w ? [`Wallet ${w}: ${out.wallet_usdc} USDC public · ${out.wallet_deposited_usdc} USDC deposited so far · ${out.pending_claims} withdrawal(s) to claim`] : []),
    ];
    return { content: [{ type: "text" as const, text: lines.join("\n") }], structuredContent: out };
  });

  // ── view own balance (two calls: permit, then balance) ─────────────────────
  server.registerTool("private_usdc_balance_permit", {
    title: "Private USDC: prepare a balance-viewing permit",
    description:
      "Step 1 of 2 to show the user their own Private USDC balance, which is encrypted on-chain. Returns EIP-712 typed data and a permit. " +
      "Next: have PayBox sign `typed_data` with this same wallet (request_wallet_sign, op \"typedData\"; signing costs nothing and sends no " +
      "transaction), then call private_usdc_balance with `permit` and the signature. The permit only allows reading this wallet's Private " +
      "USDC balance, cannot move funds, and expires. Anyone holding both the permit and the signature can read the balance until then, so do not share them.",
    inputSchema: z.object({
      network: networkArg,
      wallet: walletArg,
      minutes: z.number().int().min(5).max(PERMIT_MAX_MINUTES).optional()
        .describe(`How long the permit stays valid, in minutes. Default ${PERMIT_DEFAULT_MINUTES}.`),
    }).strict(),
    outputSchema: z.object({
      network: z.string(), wallet: z.string(), expires_at: z.string(),
      typed_data: z.record(z.string(), z.unknown()), permit: z.string(),
    }).strict(),
    annotations: READ,
  }, async ({ network: key, wallet, minutes }) => {
    const n = network(key as NetworkKey);
    const token = deployed(n);
    const w = parseAddress(wallet, "wallet");
    const p = await preparePermit(n, w, token, minutes ?? PERMIT_DEFAULT_MINUTES);
    const out = { network: n.label, wallet: w, expires_at: p.expiresAt, typed_data: p.typedData, permit: p.permit };
    return {
      content: [{ type: "text" as const, text:
        `Viewing permit for ${w} on ${n.label}, valid until ${p.expiresAt}. Sign typed_data with this wallet in PayBox (no transaction, no fee), ` +
        `then call private_usdc_balance with the permit and the signature.` }],
      structuredContent: out,
    };
  });

  server.registerTool("private_usdc_balance", {
    title: "Private USDC: show my balance",
    description:
      "Step 2 of 2: decrypts the user's own Private USDC balance with a permit from private_usdc_balance_permit and the wallet's signature of " +
      "its typed_data. Fhenix re-encrypts the balance so only this permit can read it; the balance is never published on-chain. " +
      "Show the result only to the user. Read-only.",
    inputSchema: z.object({
      network: networkArg,
      wallet: walletArg,
      permit: z.string().max(4096).describe("The `permit` value from private_usdc_balance_permit, unchanged."),
      signature: z.string().max(132).describe("The wallet's 65-byte hex signature of that permit's typed_data."),
    }).strict(),
    outputSchema: z.object({ network: z.string(), wallet: z.string(), balance_usdc: z.string() }).strict(),
    annotations: READ,
  }, async ({ network: key, wallet, permit, signature }) => {
    const n = network(key as NetworkKey);
    const token = deployed(n);
    const w = parseAddress(wallet, "wallet");
    let units: bigint;
    try {
      units = await withTimeout(viewBalance(n, w, token, permit, signature, VIEW_BUDGET_MS), VIEW_BUDGET_MS, "Decrypting the balance");
    } catch (e) {
      if (e instanceof Timeout) throw new Error("Fhenix took too long to decrypt the balance this time. Try again with the same permit and signature.");
      throw e;
    }
    const out = { network: n.label, wallet: w, balance_usdc: formatUsdc(units) };
    return { content: [{ type: "text" as const, text: `Private USDC balance of ${w} on ${n.label}: ${out.balance_usdc} USDC` }], structuredContent: out };
  });

  // ── deposit ────────────────────────────────────────────────────────────────
  server.registerTool("private_usdc_deposit", {
    title: "Private USDC: deposit (shield)",
    description:
      "Step 1 before any private payment: turn the user's public USDC into Private USDC. The deposit amount is public; after this, " +
      "balances and send amounts are encrypted. If the contract is not yet allowed to take the USDC, this first proposes an approval " +
      "for exactly that amount; call it again after the approval confirms to propose the deposit. " + PRIVACY_NOTE,
    inputSchema: z.object({ network: networkArg, wallet: walletArg, amount: usdcArg("Amount to deposit") }).strict(),
    outputSchema: evmOutputSchema,
    annotations: WRITE,
  }, async ({ network: key, wallet, amount }) => {
    const n = network(key as NetworkKey);
    const token = deployed(n);
    const w = parseAddress(wallet, "wallet");
    const units = parseUsdc(amount);
    const s = await readState(n, token, w);

    if (s.paused) throw new Error("Deposits are paused right now. Private sends and withdrawals still work. Nothing was proposed.");
    if (s.usdcBalance! < units) throw new Error(`Wallet has ${formatUsdc(s.usdcBalance!)} USDC on ${n.label}, less than ${amount}. Nothing was proposed.`);
    if (s.shieldedBy! + units > s.perUserCap) {
      throw new Error(`Beta cap: each wallet can deposit up to ${formatUsdc(s.perUserCap)} USDC in total; this wallet has deposited ${formatUsdc(s.shieldedBy!)}. Nothing was proposed.`);
    }
    if (s.held + units > s.totalCap) {
      throw new Error(`Beta cap: the contract holds ${formatUsdc(s.held)} of ${formatUsdc(s.totalCap)} USDC allowed. Try a smaller amount. Nothing was proposed.`);
    }

    if (s.allowance! < units) {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [token, units] });
      return propose(n, n.usdc, data,
        `Step 1 of 2: allow Private USDC (${token}) to take exactly ${amount} USDC from ${w}. ` +
        `After this confirms, call private_usdc_deposit again with the same amount for step 2.`);
    }
    const data = encodeFunctionData({ abi: tokenAbi, functionName: "shield", args: [w, units] });
    return propose(n, token, data, `Deposit ${amount} USDC into Private USDC for ${w}. The deposit amount is public; the balance afterwards is encrypted.`);
  });

  // ── private send ───────────────────────────────────────────────────────────
  server.registerTool("private_usdc_send", {
    title: "Private USDC: send privately",
    description:
      "Send a private payment: moves Private USDC to another address with the AMOUNT ENCRYPTED on-chain (Fhenix FHE). " +
      "Use this whenever the user asks to pay or send someone privately, confidentially or discreetly. The sender needs a Private USDC " +
      "balance first (private_usdc_deposit). If the balance is too low, the transfer moves nothing rather than failing visibly. " +
      "The recipient withdraws with private_usdc_withdraw. " + PRIVACY_NOTE,
    inputSchema: z.object({
      network: networkArg,
      sender: walletArg,
      recipient: addressArg("The recipient's EVM address, exactly as the user gave it."),
      amount: usdcArg("Amount to send"),
    }).strict(),
    outputSchema: evmOutputSchema,
    annotations: WRITE,
  }, async ({ network: key, sender, recipient, amount }) => {
    const n = network(key as NetworkKey);
    const token = deployed(n);
    const from = parseAddress(sender, "sender");
    const to = parseAddress(recipient, "recipient");
    if (to === from) throw new Error("Sender and recipient are the same address. Nothing was proposed.");
    if (to === token || to === n.usdc) throw new Error("Recipient is a token contract; funds sent there would be lost. Nothing was proposed.");
    const units = parseUsdc(amount);

    let enc: { ctHash: Hex; inputProof: Hex };
    try {
      enc = await withTimeout(encryptAmount(n, from, token, units), ENCRYPT_BUDGET_MS, "Encrypting the amount");
    } catch (e) {
      if (e instanceof Timeout) throw new Error("Fhenix encryption took too long this time. Nothing was proposed or sent; it is safe to try again.");
      throw e;
    }
    const data = encodeFunctionData({ abi: tokenAbi, functionName: "confidentialTransfer", args: [to, enc.ctHash, enc.inputProof] });
    return propose(n, token, data,
      `Private send to ${to}. The amount is encrypted inside this transaction; on-chain observers see that ${from} sent Private USDC to ${to}, but not how much.`);
  });

  // ── withdraw ───────────────────────────────────────────────────────────────
  server.registerTool("private_usdc_withdraw", {
    title: "Private USDC: withdraw (unshield)",
    description:
      "Start turning Private USDC back into normal USDC. Leave amount empty to withdraw the whole private balance (works even if the user " +
      "does not know their balance, e.g. after receiving a private payment). This creates a pending withdrawal; about a minute later, " +
      "call private_usdc_claim to receive the USDC. The withdrawn amount becomes public when claimed. " + PRIVACY_NOTE,
    inputSchema: z.object({
      network: networkArg,
      wallet: walletArg,
      to: addressArg("Where the USDC should go. Defaults to the wallet itself.").optional(),
      amount: usdcArg("Amount to withdraw. Omit to withdraw everything").optional(),
    }).strict(),
    outputSchema: evmOutputSchema,
    annotations: WRITE,
  }, async ({ network: key, wallet, to, amount }) => {
    const n = network(key as NetworkKey);
    const token = deployed(n);
    const w = parseAddress(wallet, "wallet");
    const dest = to ? parseAddress(to, "to") : w;
    if (dest === token || dest === n.usdc) throw new Error("Destination is a token contract; funds sent there would be lost. Nothing was proposed.");
    if (amount === undefined) {
      const data = encodeFunctionData({ abi: tokenAbi, functionName: "unshieldAll", args: [dest] });
      return propose(n, token, data, `Withdraw the whole Private USDC balance of ${w} to ${dest}. Then call private_usdc_claim (for ${dest}) in about a minute.`);
    }
    const units = parseUsdc(amount);
    const data = encodeFunctionData({ abi: tokenAbi, functionName: "unshield", args: [w, dest, units] });
    return propose(n, token, data,
      `Withdraw ${amount} Private USDC from ${w} to ${dest}. If the private balance is lower, nothing is withdrawn. Then call private_usdc_claim (for ${dest}) in about a minute.`);
  });

  // ── claim ──────────────────────────────────────────────────────────────────
  server.registerTool("private_usdc_claim", {
    title: "Private USDC: claim a withdrawal",
    description:
      "Finish a withdrawal: gets Fhenix's decryption proof for the oldest pending withdrawal of this address and proposes the claim that " +
      "pays out the USDC. If Fhenix is still decrypting, it says so; try again in a minute. Only the withdrawal's recipient (or their operator) can claim.",
    inputSchema: z.object({ network: networkArg, wallet: walletArg.describe("The address the withdrawal pays out to. It signs the claim.") }).strict(),
    outputSchema: evmOutputSchema,
    annotations: WRITE,
  }, async ({ network: key, wallet }) => {
    const n = network(key as NetworkKey);
    const token = deployed(n);
    const w = parseAddress(wallet, "wallet");
    const claims = await publicClient(n).readContract({ address: token, abi: tokenAbi, functionName: "getUserClaims", args: [w] });
    const pending = claims.filter(c => !c.claimed);
    if (!pending.length) throw new Error(`${w} has no withdrawals waiting on ${n.label}. Nothing was proposed.`);
    const claim = pending[0]!;

    let d: { value: bigint; signature: Hex };
    try {
      d = await withTimeout(decryptClaim(n, w, claim.ctHash), DECRYPT_BUDGET_MS, "Decrypting the withdrawal");
    } catch (e) {
      if (e instanceof Timeout) throw new Error("Fhenix is still decrypting this withdrawal. Nothing was proposed. Try again in about a minute.");
      throw e;
    }
    const data = encodeFunctionData({ abi: tokenAbi, functionName: "claimUnshielded", args: [claim.id, d.value, d.signature] });
    const more = pending.length > 1 ? ` ${pending.length - 1} more withdrawal(s) are waiting; call this again after it confirms.` : "";
    return propose(n, token, data, `Claim ${formatUsdc(d.value)} USDC to ${w}.${d.value === 0n ? " The withdrawal was empty (balance was lower than requested), so 0 USDC is paid; claiming clears it." : ""}${more}`);
  });

  return server;
}

serveStdio(createServer, { legacy: "reject" });
