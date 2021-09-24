// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

/**
 * @title Non transferable token contract, implementing ERC-1155, but preventing transfers
 */
interface IERC1155NonTransferable {
    /**
     * @notice Mint an amount of a desired token
     * Currently no restrictions as to who is allowed to mint - so, it is external.
     * @dev ERC-1155
     * @param _to       owner of the minted token
     * @param _tokenId  ID of the token to be minted
     * @param _value    Amount of the token to be minted
     * @param _data     Additional data forwarded to onERC1155BatchReceived if _to is a contract
     */
    function mint(
        address _to,
        uint256 _tokenId,
        uint256 _value,
        bytes calldata _data
    ) external;

    /**
     * @notice Burn an amount of tokens with the given ID
     * @dev ERC-1155
     * @param _account  Account which owns the token
     * @param _tokenId  ID of the token
     * @param _value    Amount of the token
     */
    function burn(
        address _account,
        uint256 _tokenId,
        uint256 _value
    ) external;

    /**
     * @notice Pause all token mint, transfer, burn
     */
    function pause() external;

    /**
     * @notice Unpause the contract and allows mint, transfer, burn
     */
    function unpause() external;
}
