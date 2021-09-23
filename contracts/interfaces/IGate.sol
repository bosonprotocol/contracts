// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.1;

interface IGate {
    event LogNonTransferableContractSet(
        address indexed _nonTransferableTokenContractAddress
    );
    event LogBosonRouterSet(address indexed _bosonRouter);
    event LogVoucherSetRegistered(
        uint256 indexed _tokenIdSupply,
        uint256 indexed _nftTokenID
    );
    event LogUserVoucherDeactivated(
        address indexed _user,
        uint256 indexed _tokenIdSupply
    );

    /**
     * @notice For a given _tokenIdSupply, it tells on which NFT it depends
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return quest NFT token ID
     */
    function getNftTokenId(uint256 _tokenIdSupply)
        external
        view
        returns (uint256);

    /**
     * @notice Sets the contract, where gate contract checks if quest NFT token exists
     * @param _nonTransferableTokenContractAddress address of a non-transferable token contract
     */
    function setNonTransferableTokenContract(
        address _nonTransferableTokenContractAddress
    ) external;

    /**
     * @notice Sets the Boson router contract address, from which deactivate is accepted
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
     * @return true if user posesses quest NFT token, and the token is not deactivated
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
    function deactivate(address _user, uint256 _tokenIdSupply) external;

    /**
     * @notice Pause register and deactivate
     */
    function pause() external;

    /**
     * @notice Unpause the contract and allows register and deactivate
     */
    function unpause() external;
}
