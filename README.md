# PayBox Private Send

A PayBox plugin for private USDC payments on Arbitrum and Ethereum, the chains where Fhenix CoFHE runs (it is not on Base mainnet). When a user tells their AI "send 20 USDC privately to 0x…", the agent finds this plugin, and the payment amount is **encrypted on-chain** with Fhenix CoFHE.

**Status: beta, unaudited.** Built on Fhenix's audited `FHERC20ERC20Wrapper` (Consensys Diligence), with launch guard rails added on top.

## What is private and what isn't

| | Visible on-chain? |
|---|---|
| Amount of a private send | **No**, encrypted |
| Private USDC balances | **No**, encrypted |
| Sender and recipient addresses of a send | Yes |
| Deposit (shield) amount | Yes |
| Withdrawal amount, once claimed | Yes |

FHE encryption is lattice-based, which is believed to resist quantum attacks. Addresses are still visible, so this is not "invisible", it is "nobody can see how much".

## Repo layout

```
contracts/   Fhenix's fhenix-confidential-contracts @ 9eb5f46 (MIT), plus our files:
             contracts/PrivateSend/PrivateSendUSDC.sol
             test/PrivateSendUSDC.test.ts
plugin/      PayBox plugin (starter 1.0.2 tooling) — src/plugin.ts, src/cofhe.ts, src/config.ts
.github/     CI: contract tests, PayBox conformance, live encryption benchmark
```

## The contract: PrivateSendUSDC

Everything that moves money is Fhenix's audited wrapper code, unchanged. We only add:

- **Deposit caps**: lifetime cap per wallet and a cap on total USDC held.
- **Pause switch**: stops new deposits only. Sends, withdrawals and claims keep working, so a pause can never trap funds.
- **No admin withdraw**: the owner can change caps and pause deposits. That's all. A test fails if any other admin function appears.
- **`unshieldAll(to)`**: withdraw a whole private balance without knowing it (needed by people who received a private payment).
- The ERC-1363 deposit path is switched off (it would skip the caps).

## Plugin tools

| Tool | What it does |
|---|---|
| `private_usdc_info` | Status, caps, and a wallet's public USDC / deposits / pending claims. Read-only. |
| `private_usdc_deposit` | Proposes the USDC approval (exact amount) if needed, then the deposit. |
| `private_usdc_send` | Encrypts the amount with Fhenix (bound to the sender + our contract), proposes the private transfer. |
| `private_usdc_withdraw` | Proposes a withdrawal of an amount, or of everything. |
| `private_usdc_claim` | Gets Fhenix's decryption proof and proposes the claim that pays out USDC. |

The plugin never holds keys or signs. Every write is an unsigned proposal that PayBox simulates and the user approves.

## Every address used (check these before deploying)

All in `plugin/src/config.ts`, one place:

| What | Address | Source |
|---|---|---|
| USDC, Arbitrum One | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| USDC, Arbitrum Sepolia | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| USDC, Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| USDC, Ethereum Sepolia | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| CoFHE address book (inside Fhenix's FHE.sol) | `0xC0F4e00E531a2B086492Ae3DCC1515038307196b` | Fhenix `cofhe-contracts`, compiled in, not set by us |
| PrivateSendUSDC | *not deployed yet on any of the four networks* (zero address = every money tool refuses) | Filled in after our own deploy, one per network |

Fhenix service URLs come from Fhenix's official SDK (`@cofhe/sdk/chains`), not from us.

PayBox portal → network hosts to allow:
`arb1.arbitrum.io`, `sepolia-rollup.arbitrum.io`, `ethereum-rpc.publicnode.com`, `ethereum-sepolia-rpc.publicnode.com`, `cofhe.mainnet.fhenix.zone`, `cofhe-vrf.mainnet.fhenix.zone`, `cofhe-tn.mainnet.fhenix.zone`, `testnet-cofhe.fhenix.zone`, `testnet-cofhe-vrf.fhenix.zone`, `testnet-cofhe-tn.fhenix.zone`

## Run it

Contracts (Node 24):

```bash
cd contracts
pnpm install --frozen-lockfile
pnpm exec hardhat test --network hardhat test/PrivateSendUSDC.test.ts
```

Plugin (Node 24, pnpm 11.11.0):

```bash
cd plugin
pnpm install
pnpm test     # PayBox checks: typecheck, deterministic build, conformance
pnpm unit
pnpm bench    # real Fhenix encryption timing; moves no money
```

## Open questions to settle before mainnet

1. **Does encryption fit PayBox's 10-second limit and 10 MiB bundle?** `pnpm bench` answers this. If not, the fallback is a small encryption service we host, which the plugin calls.
2. **Viewing your private balance** needs a signed Fhenix permit. Not in v1; `unshieldAll` covers withdrawing without knowing the balance.
3. **Deployment** (deployer key, testnet first) — steps will be added once tests pass.
