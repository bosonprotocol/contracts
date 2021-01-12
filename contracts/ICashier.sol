// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.6 <0.7.0;

interface ICashier {

    function pause() external;
    
    function unpause() external;

    function requestCreateOrder_ETH_ETH(uint256[] calldata metadata)
        external
        payable;

    function requestCreateOrder_TKN_TKN_WithPermit(
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
        )
        external
        payable;

    function requestCreateOrder_ETH_TKN_WithPermit(
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
        )
        external
        payable;

    function requestCreateOrder_TKN_ETH(
        address _tokenPriceAddress,
        uint256[] calldata metadata
        )
        external
        payable;

    function requestVoucher_ETH_ETH(uint256 _tokenIdSupply, address _issuer)
        external
        payable;

    function requestVoucher_TKN_TKN_WithPermit(
        uint256 _tokenIdSupply, 
        address _issuer,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 vPrice, bytes32 rPrice, bytes32 sPrice, // tokenPrice
        uint8 vDeposit, bytes32 rDeposit, bytes32 sDeposit  // tokenDeposits
        )
        external
        payable;

    // function requestVoucher_TKN_TKN_Same_WithPermit(
    //     uint256 _tokenIdSupply, 
    //     address _issuer,
    //     uint256 _tokensSent,
    //     uint256 deadline,
    //     uint8 v, bytes32 r, bytes32 s
    //     )
    //     external
    //     payable;

    function requestVoucher_ETH_TKN_WithPermit(
        uint256 _tokenIdSupply, 
        address _issuer,
        uint256 _tokensDeposit,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
        )
        external
        payable;

    function requestVoucher_TKN_ETH_WithPermit(
        uint256 _tokenIdSupply, 
        address _issuer,
        uint256 _tokensPrice,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
        )
        external
        payable;

    function withdraw(uint256 _tokenIdVoucher) external;

    function withdrawWhenPaused(uint256 _tokenIdVoucher) external;

    function withdrawDeposits(uint256 _tokenIdSupply) external;

    function withdrawPool() external;

    function setTokenContractAddress(address _tokensContractAddress)
        external;

    function getEscrowAmount(address _account) external view returns (uint256);

    /**
    * @notice Hook which will be triggered when a _tokenIdVoucher will be transferred. Escrow funds should be allocated to the new owner.
    * @param _from prev owner of the _tokenIdVoucher
    * @param _to next owner of the _tokenIdVoucher
    * @param _tokenIdVoucher _tokenIdVoucher that has been transferred
    */
    function _onERC721Transfer(address _from, address _to, uint256 _tokenIdVoucher) external;

    /**
    * @notice Pre-validation when a transfer from the the Tokens contract is triggered. Only the whole supply is allowed for transfer, otherwise reverts.
    * @param _from owner of the _tokenSupplyId
    * @param _tokenSupplyId _tokenSupplyId which will be validated
    * @param _value qty which is desired to be transferred
    */
    function _beforeERC1155Transfer(address _from, uint256 _tokenSupplyId, uint256 _value) external view;

    /**
    * @notice After the transfer happens the _tokenSupplyId should be updated in the promise. Escrow funds for the deposits (If in ETH) should be allocated to the new owner as well.
    * @param _from prev owner of the _tokenSupplyId
    * @param _to nex owner of the _tokenSupplyId
    * @param _tokenSupplyId _tokenSupplyId for transfer
    * @param _value qty which has been transferred
    */
    function _onERC1155Transfer(address _from, address _to, uint256 _tokenSupplyId, uint256 _value) external;

}