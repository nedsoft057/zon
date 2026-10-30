// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { IERC165 } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { IFHERC20NativeWrapper } from "../../interfaces/IFHERC20NativeWrapper.sol";
import { IWETH } from "../../interfaces/IWETH.sol";
import { FHERC20 } from "../FHERC20.sol";
import { FHERC20Core } from "../FHERC20Core.sol";
import { FHERC20NativeWrapperCore } from "./FHERC20NativeWrapperCore.sol";

/**
 * @dev Constructor-based host of {FHERC20NativeWrapperCore}: shields a chain's native token
 * (e.g. ETH) into a confidential {FHERC20} token. All wrapper logic lives in the shared core
 * (see its docs for behavior, claim keying, and the library-linking requirement).
 */
abstract contract FHERC20NativeWrapper is FHERC20, FHERC20NativeWrapperCore {
    constructor(IWETH weth_) {
        __FHERC20NativeWrapperCore_init(weth_);
    }

    /// @inheritdoc FHERC20
    function supportsInterface(bytes4 interfaceId) public view virtual override(FHERC20, IERC165) returns (bool) {
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
