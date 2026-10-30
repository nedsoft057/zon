// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import { ERC165Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import { IERC165 } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { IFHERC20, IERC7984 } from "../interfaces/IFHERC20.sol";
import { FHERC20Core } from "./FHERC20Core.sol";

/**
 * @dev Upgradeable implementation of {IFHERC20} — proxy-friendly host over {FHERC20Core}.
 *
 * All FHERC20 logic (encrypted balances/transfers, operators, indicator view layer, disclosure)
 * lives in {FHERC20Core}, shared with the constructor-based {FHERC20}. This contract only guards
 * one-time setup with the OZ Initializable pattern and supplies the ERC-165 answers.
 *
 * Storage note: {FHERC20Core} uses the SAME ERC-7201 struct and slot (`fherc20.storage.FHERC20`)
 * this contract always used, so existing proxies keep their state across an upgrade to this
 * implementation.
 *
 * See {FHERC20Core} for the full behavioral documentation.
 */
abstract contract FHERC20Upgradeable is Initializable, ContextUpgradeable, ERC165Upgradeable, FHERC20Core {
    /**
     * @dev Sets the values for {name}, {symbol}, {decimals}, and {contractURI}.
     *
     * This function should be called by the initializer of the implementing contract:
     *
     * ```solidity
     * function initialize(...) public initializer {
     *     __FHERC20_init(name_, symbol_, decimals_, contractURI_);
     * }
     * ```
     */
    function __FHERC20_init(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        string memory contractURI_
    ) internal onlyInitializing {
        __FHERC20_init_unchained(name_, symbol_, decimals_, contractURI_);
    }

    function __FHERC20_init_unchained(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        string memory contractURI_
    ) internal onlyInitializing {
        __FHERC20Core_init(name_, symbol_, decimals_, contractURI_);
    }

    // =========================================================================
    //  ERC-165
    // =========================================================================

    /// @inheritdoc ERC165Upgradeable
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(IERC165, ERC165Upgradeable) returns (bool) {
        return
            interfaceId == type(IFHERC20).interfaceId ||
            interfaceId == type(IERC7984).interfaceId ||
            interfaceId == type(IERC20).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
