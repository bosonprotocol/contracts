// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.6 <0.7.0;

interface IBosonRouter {

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
    * @param _to next owner of the _tokenSupplyId
    * @param _tokenSupplyId _tokenSupplyId for transfer
    * @param _value qty which has been transferred
    */
    function _onERC1155Transfer(address _from, address _to, uint256 _tokenSupplyId, uint256 _value) external;

}