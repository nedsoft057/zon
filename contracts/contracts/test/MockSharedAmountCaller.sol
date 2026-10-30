// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64, sharedEuint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

interface ISharedAmountToken {
    function confidentialBalanceOf(address account) external view returns (euint64);

    function shield(uint256 amount) external;

    function confidentialTransfer(address to, sharedEuint64 amount) external returns (sharedEuint64);

    function unshield(sharedEuint64 amount) external returns (sharedEuint64);
}

interface ISharedAmountWrapper {
    function confidentialBalanceOf(address account) external view returns (euint64);

    function unshield(address from, address to, sharedEuint64 amount) external returns (sharedEuint64);
}

/**
 * @dev Test-only caller for the `sharedEuint64` overloads.
 *
 * Those entry points are unreachable from an EOA: producing a share requires
 * {FHE-shareEuint64}, which only a contract can call, so an externally-owned account has no way
 * to hand an already-encrypted amount to the token. This contract stands in for the
 * composing-contract caller — it holds its own confidential balance, which it therefore has ACL
 * access to and can legitimately share.
 */
contract MockSharedAmountCaller {
    /// @dev Moves this contract's own public balance into the confidential layer, giving it a
    /// balance handle it is allowed on.
    function shieldOwn(address token, uint256 amount) external {
        ISharedAmountToken(token).shield(amount);
    }

    function transferOwnBalance(address token, address to) external {
        euint64 balance = ISharedAmountToken(token).confidentialBalanceOf(address(this));
        ISharedAmountToken(token).confidentialTransfer(to, FHE.shareEuint64(balance, token));
    }

    function unshieldOwnBalance(address token) external {
        euint64 balance = ISharedAmountToken(token).confidentialBalanceOf(address(this));
        ISharedAmountToken(token).unshield(FHE.shareEuint64(balance, token));
    }

    function unshieldOwnBalanceOnWrapper(address wrapper, address to) external {
        euint64 balance = ISharedAmountWrapper(wrapper).confidentialBalanceOf(address(this));
        ISharedAmountWrapper(wrapper).unshield(address(this), to, FHE.shareEuint64(balance, wrapper));
    }

    /// @dev Negative case: sharing a handle this contract holds no ACL access to reverts with
    /// `SenderNotAllowed` inside {FHE-shareEuint64}, before the token is ever called.
    function unshieldForeignHandle(address token, euint64 foreign) external {
        ISharedAmountToken(token).unshield(FHE.shareEuint64(foreign, token));
    }

    /// @dev Negative case: handing a bare handle across the boundary without creating a share.
    /// The token's `receiveEuint64Param` finds nothing pending and reverts with `NotShared`.
    function unshieldWithoutSharing(address token, euint64 amount) external {
        ISharedAmountToken(token).unshield(sharedEuint64.wrap(euint64.unwrap(amount)));
    }
}
