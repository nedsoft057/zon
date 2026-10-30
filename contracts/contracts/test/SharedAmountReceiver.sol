// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC7984Receiver } from "../interfaces/IERC7984Receiver.sol";
import { ebool, euint64, sharedEbool, sharedEuint64, FHE } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @notice Minimal well-behaved receiver that actually CONSUMES the shared amount, so the
///         share/receive round trip can be asserted end to end.
///
///         {MockFHERC20Receiver} decides purely on `data` and never unwraps the amount, and the two
///         malicious receivers re-enter the token as a side effect. This one just records what it
///         received, which makes it usable for two assertions the other three cannot support:
///
///           1. the legitimate path delivers the real transferred amount to the receiver; and
///           2. an arbitrary caller invoking this callback directly with a handle nobody shared
///              reverts, instead of getting an FHE operation performed on it.
contract SharedAmountReceiver is IERC7984Receiver {
    /// @notice The amount handle unwrapped from the last callback, persisted for inspection.
    euint64 public lastAmount;
    uint256 public callbackCount;

    function onConfidentialTransferReceived(
        address,
        address,
        sharedEuint64 sharedAmount,
        bytes calldata
    ) external returns (sharedEbool) {
        // Reverts unless `msg.sender` is the recorded sharer AND still holds the handle.
        euint64 amount = FHE.receiveEuint64Param(sharedAmount);

        // A received handle carries transient access only, so persisting it past this
        // transaction requires allowThis on the UNWRAPPED value.
        FHE.allowThis(amount);
        FHE.allowPublic(amount);
        lastAmount = amount;
        callbackCount += 1;

        ebool accepted = FHE.asEbool(true);
        return FHE.shareEbool(accepted, msg.sender);
    }
}
