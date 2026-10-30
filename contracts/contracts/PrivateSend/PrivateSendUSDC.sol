// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { FHE, euint64, sharedEuint64 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

import { FHERC20 } from "../FHERC20/FHERC20.sol";
import { FHERC20ERC20Wrapper } from "../FHERC20/extensions/FHERC20ERC20Wrapper.sol";

/**
 * @title PrivateSendUSDC
 * @notice Confidential USDC for the PayBox Private Send plugin.
 *
 * All money logic (shield, encrypted transfers, unshield, claim) is Fhenix's audited
 * FHERC20ERC20Wrapper, used unchanged. This contract only adds launch guard rails:
 *
 *  - Deposit caps: a lifetime cap per depositor and a cap on total USDC held.
 *  - Pause switch: stops NEW deposits only. Private sends, unshield and claim always work,
 *    so a pause can never trap anyone's money.
 *  - No admin withdraw: the owner can change caps and pause deposits. Nothing else.
 *    There is no function that lets the owner, or anyone, move another person's funds.
 *  - unshieldAll: lets a holder withdraw their whole confidential balance without first
 *    having to decrypt it (recipients often don't know their exact balance).
 */
contract PrivateSendUSDC is FHERC20ERC20Wrapper, Ownable2Step, Pausable {
    /// @notice Max total USDC (underlying units) one address may ever shield. 0 = no deposits.
    uint256 public perUserShieldCap;
    /// @notice Max USDC (underlying units) the contract may hold in total.
    uint256 public totalShieldCap;
    /// @notice Lifetime USDC shielded by each address (public anyway: deposits are on-chain).
    mapping(address => uint256) public shieldedBy;

    event CapsUpdated(uint256 perUserShieldCap, uint256 totalShieldCap);

    error PerUserCapExceeded(address depositor, uint256 attempted, uint256 cap);
    error TotalCapExceeded(uint256 attemptedTotal, uint256 cap);
    error DirectTokenCallbackDisabled();

    constructor(
        IERC20 usdc,
        address owner_,
        uint256 perUserShieldCap_,
        uint256 totalShieldCap_
    ) FHERC20("Private USDC", "pUSDC", 6, "") FHERC20ERC20Wrapper(usdc) Ownable(owner_) {
        perUserShieldCap = perUserShieldCap_;
        totalShieldCap = totalShieldCap_;
        emit CapsUpdated(perUserShieldCap_, totalShieldCap_);
    }

    // ── deposits (capped, pausable) ──────────────────────────────────────────

    /// @inheritdoc FHERC20ERC20Wrapper
    function shield(address to, uint256 amount) public virtual override whenNotPaused returns (sharedEuint64) {
        uint256 counted = amount - (amount % rate());
        uint256 newUserTotal = shieldedBy[msg.sender] + counted;
        if (newUserTotal > perUserShieldCap) revert PerUserCapExceeded(msg.sender, newUserTotal, perUserShieldCap);

        uint256 newHeld = IERC20(underlying()).balanceOf(address(this)) + counted;
        if (newHeld > totalShieldCap) revert TotalCapExceeded(newHeld, totalShieldCap);

        shieldedBy[msg.sender] = newUserTotal;
        return super.shield(to, amount);
    }

    /// @dev The ERC-1363 deposit path would skip the caps and the pause. Native USDC does not
    /// use it, so it is switched off entirely.
    function onTransferReceived(address, address, uint256, bytes calldata) public pure override returns (bytes4) {
        revert DirectTokenCallbackDisabled();
    }

    // ── withdrawals (never paused) ───────────────────────────────────────────

    /**
     * @notice Unshield your entire confidential balance to `to`. Creates a pending claim like
     * {unshield}; the amount becomes public when the claim is decrypted and paid out.
     */
    function unshieldAll(address to) external nonReentrant returns (sharedEuint64) {
        euint64 balance = confidentialBalanceOf(msg.sender);
        return FHE.shareEuint64(_unshield(msg.sender, to, balance), msg.sender);
    }

    // ── owner controls (caps and pause only) ─────────────────────────────────

    function setCaps(uint256 perUserShieldCap_, uint256 totalShieldCap_) external onlyOwner {
        perUserShieldCap = perUserShieldCap_;
        totalShieldCap = totalShieldCap_;
        emit CapsUpdated(perUserShieldCap_, totalShieldCap_);
    }

    function pauseDeposits() external onlyOwner {
        _pause();
    }

    function unpauseDeposits() external onlyOwner {
        _unpause();
    }
}
