// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC165 } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { ERC165Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import { IFHERC20, IERC7984 } from "../interfaces/IFHERC20.sol";
import { IERC20Confidential } from "../interfaces/IERC20Confidential.sol";
import { ERC20ConfidentialIndicator } from "./ERC20ConfidentialIndicator.sol";
import { ERC20ConfidentialCoreUpgradeable } from "./ERC20ConfidentialCoreUpgradeable.sol";

/**
 * @title ERC20ConfidentialUpgradeable
 * @dev Upgradeable variant of {ERC20Confidential}: an ERC-20 extended with a second,
 * confidential (FHE-encrypted) balance layer, deployable behind a proxy.
 *
 * This contract provides dual-balance functionality:
 * - Standard ERC-20 balances and transfers (public)
 * - Confidential balances and transfers (encrypted via `euint64`)
 * - Shield/unshield to convert between public and confidential
 *
 * The confidential pool is represented by a fixed address where shielded tokens are stored.
 * The unshield flow is asynchronous: {unshield} burns confidential tokens and makes the
 * encrypted amount publicly decryptable, then {claimUnshielded} verifies the decryption
 * proof and transfers public tokens from the pool.
 *
 * ARCHITECTURE — thin host over the confidential core. The full confidential layer
 * (shield/unshield/claims incl. batch, the 8 confidential-transfer overloads, operators,
 * compliance observer, reentrancy guards) is inherited from
 * {ERC20ConfidentialCoreUpgradeable}, whose heavy FHE orchestration lives in the linked,
 * delegatecall'd {ERC20ConfidentialLib}. This contract only bridges the core to its OZ
 * ERC-20 ledger through the three `_ledger*` hooks and supplies metadata/ERC-165/init glue.
 * Deployment therefore requires linking `ERC20ConfidentialLib` (deployed once per chain;
 * the OZ upgrades plugin needs `unsafeAllowLinkedLibraries: true`).
 *
 * Upgradeable specifics: confidential state lives in the SAME ERC-7201 namespaced struct the
 * monolithic implementation used (`fherc20.storage.ERC20Confidential`, with an appended
 * `_observer` field), and the contract is set up through {__ERC20Confidential_init}.
 * NOTE on upgrading live proxies from the monolithic implementation: the confidential
 * balance/operator/metadata state carries over unchanged, but PENDING unshield claims do not —
 * the claim store is now keyed by a unique per-claimant id (see {ERC20ConfidentialLib.createClaim})
 * instead of the ciphertext handle, and the `Claim` record gained a leading `id` field. Settle
 * all pending claims before upgrading, or ship a legacy read path.
 *
 * NOTE: this contract intentionally does not NOMINALLY inherit {IERC20Confidential} — the
 * {IERC7984}/{IERC20ConfidentialCore} trees declare overlapping events, which Solidity rejects
 * when both are in one inheritance graph. The full IERC20Confidential ABI is nevertheless
 * present (via the core + ERC-20), and {supportsInterface} answers for all of
 * IERC20Confidential / IFHERC20 / IERC7984 / IERC20.
 */
abstract contract ERC20ConfidentialUpgradeable is
    Initializable,
    ERC20Upgradeable,
    ERC165Upgradeable,
    ERC20ConfidentialCoreUpgradeable
{
    function __ERC20Confidential_init(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) internal onlyInitializing {
        __ERC20_init(name_, symbol_);
        __ERC20Confidential_init_unchained(name_, symbol_, decimals_);
    }

    function __ERC20Confidential_init_unchained(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) internal onlyInitializing {
        // Same derivation as the monolithic implementation: confidential decimals clamp to 6
        // and the conversion rate is 10 ** (decimals_ - confidentialDecimals).
        __ERC20ConfidentialCore_init(decimals_, 6);
        _setIndicatorToken(new ERC20ConfidentialIndicator(address(this), name_, symbol_));
    }

    // =========================================================================
    //  ERC-165
    // =========================================================================

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == type(IERC20Confidential).interfaceId ||
            interfaceId == type(IFHERC20).interfaceId ||
            interfaceId == type(IERC7984).interfaceId ||
            interfaceId == type(IERC20).interfaceId ||
            _confidentialSupportsInterface(interfaceId) ||
            super.supportsInterface(interfaceId);
    }

    // =========================================================================
    //  Metadata
    // =========================================================================

    /// @dev Read from the shared ERC-7201 struct (set at init), where the core records the
    /// public ledger's decimals — the same field the monolithic implementation wrote, so the
    /// value survives an upgrade from it. `name`/`symbol` come from the OZ ERC-20 base unchanged.
    function decimals() public view virtual override returns (uint8) {
        return _publicDecimals();
    }

    // =========================================================================
    //  Ledger hooks — bridge the confidential core to this contract's OZ ERC-20
    // =========================================================================

    function _ledgerMint(address to, uint256 amount) internal virtual override {
        _mint(to, amount);
    }

    function _ledgerTransfer(address from, address to, uint256 amount) internal virtual override {
        _transfer(from, to, amount);
    }

    function _ledgerBalanceOf(address account) internal view virtual override returns (uint256) {
        return balanceOf(account);
    }
}
