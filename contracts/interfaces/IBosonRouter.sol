// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "./../UsingHelpers.sol";

interface IBosonRouter {
    function pause() external;

    function unpause() external;

    /**
     * @notice Issuer/Seller offers promises as supply tokens and needs to escrow the deposit
        @param _metadata metadata which is required for creation of a voucher
        Metadata array is used as in some scenarios we need several more params, as we need to recover 
        owner address in order to permit the contract to transfer funds in his behalf. 
        Since the params get too many, we end up in situation that the stack is too deep.
        
        uint256 _validFrom = _metadata[0];
        uint256 _validTo = _metadata[1];
        uint256 _price = _metadata[2];
        uint256 _depositSe = _metadata[3];
        uint256 _depositBu = _metadata[4];
        uint256 _quantity = _metadata[5];
     */
    function requestCreateOrderETHETH(uint256[] calldata _metadata)
        external
        payable;

    function requestCreateOrderETHETHConditional(
        uint256[] calldata _metadata,
        address _gateAddress,
        uint256 _nftTokenId
    ) external payable;

    function requestCreateOrderTKNTKNWithPermit(
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        uint256[] calldata _metadata
    ) external;

    function requestCreateOrderTKNTKNWithPermitConditional(
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        uint256[] calldata _metadata,
        address _gateAddress,
        uint256 _nftTokenId
    ) external;

    function requestCreateOrderETHTKNWithPermit(
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        uint256[] calldata _metadata
    ) external;

    function requestCreateOrderETHTKNWithPermitConditional(
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        uint256[] calldata _metadata,
        address _gateAddress,
        uint256 _nftTokenId
    ) external;

    function requestCreateOrderTKNETH(
        address _tokenPriceAddress,
        uint256[] calldata _metadata
    ) external payable;

    function requestCreateOrderTKNETHConditional(
        address _tokenPriceAddress,
        uint256[] calldata _metadata,
        address _gateAddress,
        uint256 _nftTokenId
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
        uint256 _deadline,
        uint8 _vPrice,
        bytes32 _rPrice,
        bytes32 _sPrice, // tokenPrice
        uint8 _vDeposit,
        bytes32 _rDeposit,
        bytes32 _sDeposit // tokenDeposits
    ) external;

    function requestVoucherTKNTKNSameWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensSent,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external;

    function requestVoucherETHTKNWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensDeposit,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external payable;

    function requestVoucherTKNETHWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensPrice,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external payable;

    /**
     * @notice Seller burns the remaining supply and withdrawal of the locked deposits for them are being sent back.
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) which will be burned and deposits will be returned for
     */
    function requestCancelOrFaultVoucherSet(uint256 _tokenIdSupply) external;

    /**
     * @notice Redemption of the vouchers promise
     * @param _tokenIdVoucher   ID of the voucher
     */
    function redeem(uint256 _tokenIdVoucher) external;

    /**
     * @notice Refunding a voucher
     * @param _tokenIdVoucher   ID of the voucher
     */
    function refund(uint256 _tokenIdVoucher) external;

    /**
     * @notice Issue a complain for a voucher
     * @param _tokenIdVoucher   ID of the voucher
     */
    function complain(uint256 _tokenIdVoucher) external;

    /**
     * @notice Cancel/Fault transaction by the Seller, admitting to a fault or backing out of the deal
     * @param _tokenIdVoucher   ID of the voucher
     */
    function cancelOrFault(uint256 _tokenIdVoucher) external;

    /**
     * @notice Get the address of Cashier contract
     * @return Address of Cashier address
     */
    function getCashierAddress() external view returns (address);

    /**
     * @notice Get the address of Voucher Kernel contract
     * @return Address of Voucher Kernel contract
     */
    function getVoucherKernelAddress() external view returns (address);

    /**
     * @notice Get the address gate contract that handles conditional commit of certain voucher set
     * @param _tokenIdSupply    ID of the supply token
     * @return Address of the gate contract or zero address if there is no conditional commit
     */
    function getVoucherSetToGateContract(uint256 _tokenIdSupply)
        external
        view
        returns (address);

    function getTokenRegistryAddress() external view returns (address);
}
