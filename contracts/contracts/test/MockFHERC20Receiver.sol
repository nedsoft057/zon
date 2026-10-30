// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC7984Receiver } from "../interfaces/IERC7984Receiver.sol";
import { ebool, sharedEbool, sharedEuint64, FHE } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract MockFHERC20Receiver is IERC7984Receiver {
    event ConfidentialTransferCallback(bool success);

    error InvalidInput(uint8 input);

    /// @dev Decides purely on `data`, so it never unwraps the shared amount; that share simply
    ///      expires at the end of the transaction.
    function onConfidentialTransferReceived(
        address,
        address,
        sharedEuint64,
        bytes calldata data
    ) external returns (sharedEbool) {
        uint8 input = abi.decode(data, (uint8));

        if (input > 1) revert InvalidInput(input);

        bool success = input == 1;
        emit ConfidentialTransferCallback(success);

        ebool returnVal = FHE.asEbool(success);

        // Directed back at the token that called us, instead of an out-of-band grant.
        return FHE.shareEbool(returnVal, msg.sender);
    }
}
