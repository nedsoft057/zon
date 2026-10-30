// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { IERC165 } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { IFHERC20NativeWrapper } from "../../interfaces/IFHERC20NativeWrapper.sol";
import { IWETH } from "../../interfaces/IWETH.sol";
import { FHERC20Upgradeable } from "../FHERC20Upgradeable.sol";
import { FHERC20Core } from "../FHERC20Core.sol";
import { FHERC20NativeWrapperCore } from "./FHERC20NativeWrapperCore.sol";

/**
 * @dev Proxy-friendly host of {FHERC20NativeWrapperCore}: shields a chain's native token
 * (e.g. ETH) into a confidential {FHERC20} token, following the OpenZeppelin Initializable
 * pattern. All wrapper logic lives in the shared core (see its docs for behavior, claim keying,
 * and the library-linking requirement).
 *
 * Storage note: the core uses the SAME ERC-7201 slot (`fherc20.storage.FHERC20NativeWrapper`)
 * this contract always used for its config, so existing proxies keep it across an upgrade.
 * Pending unshield claims do NOT survive an upgrade from the old helper-based implementation
 * (re-keyed claim store) — settle them first.
 */
abstract contract FHERC20NativeWrapperUpgradeable is FHERC20Upgradeable, FHERC20NativeWrapperCore {
    function __FHERC20NativeWrapper_init(IWETH weth_) internal onlyInitializing {
        __FHERC20NativeWrapper_init_unchained(weth_);
    }

    function __FHERC20NativeWrapper_init_unchained(IWETH weth_) internal onlyInitializing {
        __FHERC20NativeWrapperCore_init(weth_);
    }

    /// @inheritdoc FHERC20Upgradeable
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(FHERC20Upgradeable, IERC165) returns (bool) {
        return interfaceId == type(IFHERC20NativeWrapper).interfaceId || super.supportsInterface(interfaceId);
    }

    // ── diamond disambiguation — the wrapper core's overrides win ────────────

    function decimals() public view virtual override(FHERC20Core, FHERC20NativeWrapperCore) returns (uint8) {
        return super.decimals();
    }

    function _update(
        address from,
        address to,
        euint64 amount
    ) internal virtual override(FHERC20Core, FHERC20NativeWrapperCore) returns (euint64) {
        return super._update(from, to, amount);
    }
}
