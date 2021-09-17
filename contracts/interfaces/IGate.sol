// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.1;

interface IGate {
    /**
     * @notice Sets the contract, where gate contract checks if quest NFT token exists
     * @param _nonTransferableTokenContractAddress address of a non-transferable token contract
     */
    function setNonTransferableTokenContract(
        address _nonTransferableTokenContractAddress
    ) external;

    /**
     * @notice Sets the Boson router contract address, from which revoke is accepted
     * @param _bosonRouter address of a non-transferable token contract
     */
    function setBosonRouterAddress(address _bosonRouter) external;

    /**
     * @notice Registers connection between setID and tokenID
     * @param _tokenIdSupply an ID of a supply token (ERC-1155)
     * @param _nftTokenID an ID of a quest token
     */
    function registerVoucherSetID(uint256 _tokenIdSupply, uint256 _nftTokenID)
        external;

    /**
     * @notice Checks if user posesses the required quest NFT token for given voucher set
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return true if user posesses quest NFT token, and the token is not revoked
     */
    function check(address _user, uint256 _tokenIdSupply)
        external
        view
        returns (bool);

    /**
     * @notice Stores information that certain user already claimed
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     */
    function revoke(address _user, uint256 _tokenIdSupply) external;

    /**
     * @notice Pause register and revoke
     */
    function pause() external;

    /**
     * @notice Unpause the contract and allows register and revoke
     */
    function unpause() external;
}
