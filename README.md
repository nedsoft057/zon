# Zon

Zon is a PayBox plugin for private USDC payments on Arbitrum and Ethereum, the chains where Fhenix CoFHE runs (it is not on Base mainnet). When a user tells their AI "send 20 USDC privately to 0x…", the agent finds this plugin, and the payment amount is **encrypted on-chain** with Fhenix CoFHE.

One-pager: [zon-one-pager.vercel.app](https://zon-one-pager.vercel.app)

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
| `private_usdc_balance_permit` | Prepares a Fhenix viewing permit (EIP-712) for the user's wallet to sign in PayBox. No transaction. |
| `private_usdc_balance` | Takes the permit + signature and decrypts the user's own Private USDC balance. Read-only. |

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
| PrivateSendUSDC, Ethereum Sepolia | `0xfd8A60F18F79d6CE7f3a546f528cd70dB0e3A461` | Our deploy, owner `0x79fBe68922074F041Db83F67a9bC0A51df5CdDc9`. Full flow run live, e.g. [a private send](https://sepolia.etherscan.io/tx/0x4f679b1635deebc0dd589130cc537df0e0765264ddc1ed3678caca2953be1dad) |
| PrivateSendUSDC, other networks | *not deployed yet* (zero address = every money tool refuses) | Filled in after our own deploy, one per network |

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

Deploy (from your own computer; the key never leaves it):

```bash
cd contracts
pnpm generate              # new deployer key, encrypted with your password into contracts/.env (git-ignored)
# or: pnpm account:import  # use an existing private key instead
pnpm account               # show the deployer address and its balances; fund it with gas
PRIVATE_SEND_OWNER=0xYourMainWallet ETHERSCAN_MAINNET_API_KEY=... pnpm deploy --network sepolia --tags PrivateSendUSDC
```

The deployer only pays gas. `PRIVATE_SEND_OWNER` becomes the contract owner (caps and pause). Mainnets also require `PRIVATE_SEND_USER_CAP`, `PRIVATE_SEND_TOTAL_CAP` and an Etherscan key.

Plugin (Node 24, pnpm 11.11.0):

```bash
cd plugin
pnpm install
pnpm test     # PayBox checks: typecheck, deterministic build, conformance
pnpm unit
pnpm bench    # real Fhenix encryption timing; moves no money

# balance viewing end to end against Fhenix's mocks (needs the local chain first):
#   cd ../contracts && pnpm exec hardhat node --network hardhat
node --import tsx test/view-local.ts
# permit + signature checks against the live chains (no money, throwaway key):
node --import tsx test/permit-live.ts
# full live run on a testnet (deposit, private send, view balance, withdraw, claim); key must hold testnet USDC:
DEMO_PRIVATE_KEY=0x... DEMO_RECIPIENT=0x... node --import tsx test/demo-live.ts sepolia
```
