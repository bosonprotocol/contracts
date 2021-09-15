// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.1;

interface IGate {
    /**
     * @notice Registers connection between setID and tokenID
     * @param _tokenIdSupply an ID of a supply token (ERC-1155)
     * @param _nftTokenID an ID of a quest token
     */
    function registerVoucherSetID(uint256 _tokenIdSupply, uint256 _nftTokenID)
        external;

    /**
     * @notice Pause register and revoke
     */
    function pause() external;

    /**
     * @notice Unpause the contract and allows register and revoke
     */
    function unpause() external;
}
