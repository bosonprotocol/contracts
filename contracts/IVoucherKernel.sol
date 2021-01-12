// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.6 <0.7.0;

interface IVoucherKernel {

    function pause() external;
    
    function unpause() external;

    function createTokenSupplyID(address _seller, uint256 _validFrom, uint256 _validTo, uint256 _price, uint256 _depositSe, uint256 _depositBu, uint256 _quantity) external returns (uint256);

    function createPaymentMethod(uint256 _tokenIdSupply, uint8 _paymentMethod, address _tokenPrice, address _tokenDeposits) external;

    function getOrderCosts(uint256 _tokenIdSupply) external view returns (uint256, uint256, uint256);

    function fillOrder(uint256 _tokenIdSupply, address _issuer, address _holder) external;

    function getVoucherPriceToken(uint256 _tokenIdSupply) external view returns (address);

    function getVoucherDepositToken(uint256 _tokenIdSupply) external view returns (address);

    function getBuyerOrderCosts(uint256 _tokenIdSupply) external view returns (uint256, uint256);

    function getIdSupplyFromVoucher(uint256 _tokenIdVoucher) external pure returns (uint256);

    function getVoucherPaymentMethod(uint256 _tokenIdSupply) external view returns (uint8);

    function getVoucherStatus(uint256 _tokenIdVoucher) external view returns (uint8, bool, bool);

    function getSupplyHolder(uint256 _tokenIdSupply) external view returns (address);

    function getVoucherHolder(uint256 _tokenIdVoucher) external view returns (address);

    function setPaymentReleased(uint256 _tokenIdVoucher) external;

    function setDepositsReleased(uint256 _tokenIdVoucher) external;
        
    function getSellerDeposit(uint256 _tokenIdSupply) external view returns (uint256);

    function getRemQtyForSupply(uint _tokenSupplyId, address _owner) external view returns (uint256);

    function burnSupplyOnPause(address _issuer, uint256 _tokenIdSupply, uint256 _qty) external;

    function setSupplyHolderOnTransfer(uint256 _tokenIdSupply, address _newSeller) external;

    function redeem(uint256 _tokenIdVoucher, address _msgSender) external;

    function refund(uint256 _tokenIdVoucher, address _msgSender) external;

    function cancelOrFault(uint256 _tokenIdVoucher, address _msgSender) external;

    function complain(uint256 _tokenIdVoucher, address _msgSender) external;

}