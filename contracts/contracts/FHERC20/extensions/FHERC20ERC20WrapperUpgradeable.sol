// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { IERC1363Receiver } from "@openzeppelin/contracts/interfaces/IERC1363Receiver.sol";
import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { IERC165 } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { IFHERC20ERC20Wrapper } from "../../interfaces/IFHERC20ERC20Wrapper.sol";
import { FHERC20Upgradeable } from "../FHERC20Upgradeable.sol";
import { FHERC20Core } from "../FHERC20Core.sol";
import { FHERC20ERC20WrapperCore } from "./FHERC20ERC20WrapperCore.sol";

/**
 * @dev Proxy-friendly host of {FHERC20ERC20WrapperCore}: shields an `ERC20` token into a
 * confidential {FHERC20} token, following the OpenZeppelin Initializable pattern. All wrapper
 * logic lives in the shared core (see its docs for behavior, claim keying, and the
 * library-linking requirement).
 *
 * Storage note: the core uses the SAME ERC-7201 slot (`fherc20.storage.FHERC20ERC20Wrapper`)
 * this contract always used for its config, so existing proxies keep it across an upgrade.
 * Pending unshield claims do NOT survive an upgrade from the old helper-based implementation
 * (re-keyed claim store) — settle them first.
 */
abstract contract FHERC20ERC20WrapperUpgradeable is FHERC20Upgradeable, FHERC20ERC20WrapperCore {
    function __FHERC20ERC20Wrapper_init(IERC20 underlying_) internal onlyInitializing {
        __FHERC20ERC20Wrapper_init_unchained(underlying_);
    }

    function __FHERC20ERC20Wrapper_init_unchained(IERC20 underlying_) internal onlyInitializing {
        __FHERC20ERC20WrapperCore_init(underlying_);
    }

    /// @inheritdoc FHERC20Upgradeable
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(FHERC20Upgradeable, IERC165) returns (bool) {
        return
            interfaceId == type(IFHERC20ERC20Wrapper).interfaceId ||
            interfaceId == type(IERC1363Receiver).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ── diamond disambiguation — the wrapper core's overrides win ────────────

    function decimals() public view virtual override(FHERC20Core, FHERC20ERC20WrapperCore) returns (uint8) {
        return super.decimals();
    }

    function _update(
        address from,
        address to,
        euint64 amount
    ) internal virtual override(FHERC20Core, FHERC20ERC20WrapperCore) returns (euint64) {
        return super._update(from, to, amount);
    }
}
