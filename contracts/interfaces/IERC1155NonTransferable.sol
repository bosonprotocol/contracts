// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.1;

/**
 * @title Non transferable token contract, implementing ERC-1155, but preventing transfers
 */
interface IERC1155NonTransferable {
  
    /**
     * @notice Pause all token mint, transfer, burn
     */
    function pause() external;

    /**
     * @notice Unpause the contract and allows mint, transfer, burn
     */
    function unpause() external;
}
