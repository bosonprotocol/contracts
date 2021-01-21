// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.6 <0.7.0;

interface ICashier {
    /**
     * @notice Pause the Cashier && the Voucher Kernel contracts in case of emergency.
     * All functions related to creating new batch, requestVoucher or withdraw will be paused, hence cannot be executed.
     * There is special function for withdrawing funds if contract is paused.
     */
    function pause() external;

    /**
     * @notice Unpause the Cashier && the Voucher Kernel contracts.
     * All functions related to creating new batch, requestVoucher or withdraw will be unpaused.
     */
    function unpause() external;

    /**
     * @notice Issuer/Seller offers promises as supply tokens and needs to escrow the deposit
        @param metadata metadata which is required for creation of a voucher
        Metadata array is used as in some scenarios we need several more params, as we need to recover 
        owner address in order to permit the contract to transfer funds in his behalf. 
        Since the params get too many, we end up in situation that the stack is too deep.
        
        uint256 _validFrom = metadata[0];
        uint256 _validTo = metadata[1];
        uint256 _price = metadata[2];
        uint256 _depositSe = metadata[3];
        uint256 _depositBu = metadata[4];
        uint256 _quantity = metadata[5];
     */
    function requestCreateOrderETHETH(uint256[] calldata metadata)
        external
        payable;

    function requestCreateOrderTKNTKNWithPermit(
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
    ) external payable;

    function requestCreateOrderETHTKNWithPermit(
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
    ) external payable;

    function requestCreateOrderTKNETH(
        address _tokenPriceAddress,
        uint256[] calldata metadata
    ) external payable;

    /**
     * @notice Consumer requests/buys a voucher by filling an order and receiving a Voucher Token in return
     * @param _tokenIdSupply    ID of the supply token
     * @param _issuer           Address of the issuer of the supply token
     */
    function requestVoucherETHETH(uint256 _tokenIdSupply, address _issuer)
        external
        payable;

    function requestVoucherTKNTKNWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 vPrice,
        bytes32 rPrice,
        bytes32 sPrice, // tokenPrice
        uint8 vDeposit,
        bytes32 rDeposit,
        bytes32 sDeposit // tokenDeposits
    ) external payable;

    function requestVoucherTKNTKNSameWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function requestVoucherETHTKNWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensDeposit,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable;

    function requestVoucherTKNETHWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensPrice,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable;

    /**
     * @notice Trigger withdrawals of what funds are releasable
     * The caller of this function triggers transfers to all involved entities (pool, issuer, token holder), also paying for gas.
     * @dev This function would be optimized a lot, here verbose for readability.
     * @param _tokenIdVoucher  ID of a voucher token (ERC-721) to try withdraw funds from
     */
    function withdraw(uint256 _tokenIdVoucher) external;

    /**
     * @notice Trigger withdrawals of what funds are releasable
     * The caller of this function triggers transfers to all involved entities (pool, issuer, token holder), also paying for gas.
     * @dev This function would be optimized a lot, here verbose for readability.
     * @param _tokenIdVoucher an ID of a voucher token (ERC-721) to try withdraw funds from
     */
    function withdrawWhenPaused(uint256 _tokenIdVoucher) external;

    /**
     * @notice Seller triggers withdrawals of remaining deposits for a given supply, in case the contracts are paused.
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) which will be burned and deposits will be returned for
     */
    function withdrawDeposits(uint256 _tokenIdSupply) external;

    /**
     * @notice Trigger withdrawals of pooled funds
     */
    function withdrawPool() external;

    /**
     * @notice Set the address of the ERC1155ERC721 contract
     * @param _tokensContractAddress   The address of the ERC1155ERC721 contract
     */
    function setTokenContractAddress(address _tokensContractAddress) external;

    /**
     * @notice Get the amount in escrow of an address
     * @param _account  The address of an account to query
     * @return          The balance in escrow
     */
    function getEscrowAmount(address _account) external view returns (uint256);

    /**
     * @notice Hook which will be triggered when a _tokenIdVoucher will be transferred. Escrow funds should be allocated to the new owner.
     * @param _from prev owner of the _tokenIdVoucher
     * @param _to next owner of the _tokenIdVoucher
     * @param _tokenIdVoucher _tokenIdVoucher that has been transferred
     */
    function _onERC721Transfer(
        address _from,
        address _to,
        uint256 _tokenIdVoucher
    ) external;

    /**
     * @notice Pre-validation when a transfer from the the Tokens contract is triggered. Only the whole supply is allowed for transfer, otherwise reverts.
     * @param _from owner of the _tokenSupplyId
     * @param _tokenSupplyId _tokenSupplyId which will be validated
     * @param _value qty which is desired to be transferred
     */
    function _beforeERC1155Transfer(
        address _from,
        uint256 _tokenSupplyId,
        uint256 _value
    ) external view;

    /**
     * @notice After the transfer happens the _tokenSupplyId should be updated in the promise. Escrow funds for the deposits (If in ETH) should be allocated to the new owner as well.
     * @param _from prev owner of the _tokenSupplyId
     * @param _to nex owner of the _tokenSupplyId
     * @param _tokenSupplyId _tokenSupplyId for transfer
     * @param _value qty which has been transferred
     */
    function _onERC1155Transfer(
        address _from,
        address _to,
        uint256 _tokenSupplyId,
        uint256 _value
    ) external;
}
