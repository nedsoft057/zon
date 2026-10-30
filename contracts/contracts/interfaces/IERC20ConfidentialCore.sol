// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { euint64, externalEuint64, sharedEuint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/**
 * @dev Confidential-only surface for {ERC20ConfidentialCoreUpgradeable}.
 *
 * Unlike {IERC20Confidential}, this interface deliberately does NOT inherit OpenZeppelin's
 * `IERC20` / `IERC165` (nor `IERC7984` / `IFHERC20`). That keeps a contract which already brings
 * its own public ERC-20 ledger and ERC-165 surface free of duplicate base
 * types when it also mixes in the confidential layer. The public ERC-20 metadata/ledger and
 * `supportsInterface` are expected to come from the host ledger.
 */
interface IERC20ConfidentialCore {
    /// @dev Emitted when the expiration timestamp for an operator is updated for a holder.
    event OperatorSet(address indexed holder, address indexed operator, uint48 until);

    /// @dev Emitted when a confidential transfer is made of encrypted amount `amount`.
    event ConfidentialTransfer(address indexed from, address indexed to, euint64 indexed amount);

    /// @dev Emitted when tokens are shielded (public -> confidential).
    event TokensShielded(address indexed account, uint256 amount);

    /// @dev Emitted when an unshield request is created.
    event TokensUnshielded(address indexed account, euint64 indexed amount);

    /// @dev Emitted when an unshield request is claimed (public tokens transferred).
    ///      `unshieldRequestId` is the unique claim id (as passed to {claimUnshielded}), not the
    ///      ciphertext handle; `unshieldAmount` wraps the burned handle.
    event UnshieldedTokensClaimed(
        address indexed account,
        bytes32 indexed unshieldRequestId,
        euint64 indexed unshieldAmount,
        uint64 unshieldAmountCleartext
    );

    function confidentialDecimals() external view returns (uint8);

    function confidentialTotalSupply() external view returns (euint64);

    /// @dev Plaintext twin of {confidentialTotalSupply} (pool balance scaled to confidential
    /// decimals). The value is public information, so it is exposed directly for consumers that
    /// don't need a ciphertext; derived on read, so always current.
    function confidentialTotalSupplyPlaintext() external view returns (uint256);

    function confidentialBalanceOf(address account) external view returns (euint64);

    function isOperator(address holder, address spender) external view returns (bool);

    function setOperator(address operator, uint48 until) external;

    function shield(uint256 amount) external;

    function unshield(uint64 amount) external returns (sharedEuint64);

    function unshield(sharedEuint64 sharedAmount) external returns (sharedEuint64);

    /// @param id The unique claim id from {getClaim}/{getUserClaims} (NOT the ciphertext handle).
    function claimUnshielded(bytes32 id, uint64 decryptedAmount, bytes calldata decryptionProof) external;

    /// @param ids The unique claim ids from {getClaim}/{getUserClaims} (NOT ciphertext handles).
    function claimUnshieldedBatch(
        bytes32[] calldata ids,
        uint64[] calldata decryptedAmounts,
        bytes[] calldata decryptionProofs
    ) external;

    function confidentialTransfer(address to, sharedEuint64 sharedAmount) external returns (sharedEuint64 transferred);

    function confidentialTransfer(
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (sharedEuint64 transferred);

    function confidentialTransferFrom(
        address from,
        address to,
        sharedEuint64 sharedAmount
    ) external returns (sharedEuint64 transferred);

    function confidentialTransferFrom(
        address from,
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (sharedEuint64 transferred);
}
