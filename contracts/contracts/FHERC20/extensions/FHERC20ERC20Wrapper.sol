// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { euint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { IERC1363Receiver } from "@openzeppelin/contracts/interfaces/IERC1363Receiver.sol";
import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { IERC165 } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { IFHERC20ERC20Wrapper } from "../../interfaces/IFHERC20ERC20Wrapper.sol";
import { FHERC20 } from "../FHERC20.sol";
import { FHERC20Core } from "../FHERC20Core.sol";
import { FHERC20ERC20WrapperCore } from "./FHERC20ERC20WrapperCore.sol";

/**
 * @dev Constructor-based host of {FHERC20ERC20WrapperCore}: shields an `ERC20` token into a
 * confidential {FHERC20} token. All wrapper logic lives in the shared core (see its docs for
 * behavior, claim keying, and the library-linking requirement).
 */
abstract contract FHERC20ERC20Wrapper is FHERC20, FHERC20ERC20WrapperCore {
    constructor(IERC20 underlying_) {
        __FHERC20ERC20WrapperCore_init(underlying_);
    }

    /// @inheritdoc FHERC20
    function supportsInterface(bytes4 interfaceId) public view virtual override(FHERC20, IERC165) returns (bool) {
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
