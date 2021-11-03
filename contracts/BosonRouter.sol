// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IVoucherKernel.sol";
import "./interfaces/IERC20WithPermit.sol";
import "./interfaces/ITokenRegistry.sol";
import "./interfaces/IBosonRouter.sol";
import "./interfaces/ICashier.sol";
import "./interfaces/IGate.sol";
import "./interfaces/ITokenWrapper.sol";
import {PaymentMethod} from "./UsingHelpers.sol";
import "./libs/SafeERC20WithPermit.sol";

/**
 * @title Contract for interacting with Boson Protocol from the user's perspective.
 * @notice There are multiple permutations of the requestCreateOrder and requestVoucher functions.
 * Each function name is suffixed with a payment type that denotes the currency type of the
 * payment and deposits. The options are:
 *
 * ETHETH  - Price and deposits are specified in ETH
 * ETHTKN - Price is specified in ETH and deposits are specified in tokens
 * TKNTKN - Price and deposits are specified in tokens
 * TKNETH - Price is specified in tokens and the deposits are specified in ETH
 *
 * The functions that process payments and/or deposits in tokens do so using EIP-2612 permit functionality
 *
 */
contract BosonRouter is
    IBosonRouter,
    Pausable,
    ReentrancyGuard,
    Ownable
{
    using Address for address payable;
    using SafeMath for uint256;

    address private cashierAddress;
    address private voucherKernel;
    address private tokenRegistry;

    mapping (address => bool) private approvedGates;
    mapping(uint256 => address) private voucherSetToGateContract;

    event LogOrderCreated(
        uint256 indexed _tokenIdSupply,
        address indexed _seller,
        uint256 _quantity,
        PaymentMethod _paymentType
    );

    event LogConditionalOrderCreated(
        uint256 indexed _tokenIdSupply,
        address indexed _gateAddress
    );

    event LogVoucherKernelSet(address _newVoucherKernel, address _triggeredBy);
    event LogTokenRegistrySet(address _newTokenRegistry, address _triggeredBy);
    event LogCashierSet(address _newCashier, address _triggeredBy);

    event LogGateApprovalChanged(
        address indexed _gateAddress,
        bool _approved
    );

    /**
     * @notice Make sure the given gate address is approved
     * @param _gateAddress - the address to validate approval for
     */
    modifier onlyApprovedGate(address _gateAddress) {
        require(approvedGates[_gateAddress], "INVALID_GATE");
        _;
    }

    /**
     * @notice Checking if a non-zero address is provided, otherwise reverts.
     */
    modifier notZeroAddress(address _tokenAddress) {
        require(_tokenAddress != address(0), "0A"); //zero address
        _;
    }

    /**
     * @notice Replacement of onlyOwner modifier. If the caller is not the owner of the contract, reverts.
     */
    modifier onlyRouterOwner() {
        require(owner() == _msgSender(), "NO"); //not owner
        _;
    }

    /**
     * @notice Acts as a modifier, but it's cheaper. Checks whether provided value corresponds to the limits in the TokenRegistry.
     * @param _value the specified value is per voucher set level. E.g. deposit * qty should not be greater or equal to the limit in the TokenRegistry (ETH).
     */
    function notAboveETHLimit(uint256 _value) internal view {
        require(
            _value <= ITokenRegistry(tokenRegistry).getETHLimit(),
            "AL" // above limit
        );
    }

    /**
     * @notice Acts as a modifier, but it's cheaper. Checks whether provided value corresponds to the limits in the TokenRegistry.
     * @param _tokenAddress the token address which, we are getting the limits for.
     * @param _value the specified value is per voucher set level. E.g. deposit * qty should not be greater or equal to the limit in the TokenRegistry (ETH).
     */
    function notAboveTokenLimit(address _tokenAddress, uint256 _value)
        internal
        view
    {
        require(
            _value <= ITokenRegistry(tokenRegistry).getTokenLimit(_tokenAddress),
            "AL" //above limit
        );
    }

    /**
     * @notice Construct and initialze the contract. Iniialises associated contract addresses
     * @param _voucherKernel address of the associated VocherKernal contract instance
     * @param _tokenRegistry address of the associated TokenRegistry contract instance
     * @param _cashierAddress address of the associated Cashier contract instance
     */
    constructor(
        address _voucherKernel,
        address _tokenRegistry,
        address _cashierAddress
    )   notZeroAddress(_voucherKernel)
        notZeroAddress(_tokenRegistry)
        notZeroAddress(_cashierAddress)
    {
        voucherKernel = _voucherKernel;
        tokenRegistry = _tokenRegistry;
        cashierAddress = _cashierAddress;
    }

    /**
     * @notice Set the approval status for a given Gate contract
     * @param _gateAddress - the address of the gate contract
     * @param _approved - approval status for the gate
     */
    function setGateApproval(address _gateAddress, bool _approved)
        external
        onlyOwner
        notZeroAddress(_gateAddress)
    {
        require(approvedGates[_gateAddress] != _approved, "NO_CHANGE");
        approvedGates[_gateAddress] = _approved;
        emit LogGateApprovalChanged(_gateAddress, _approved);
    }

    /**
     * @notice Pause the Cashier && the Voucher Kernel contracts in case of emergency.
     * All functions related to creating requestCreateOrder, requestVoucher, redeem, refund, complain, cancelOrFault,
     * cancelOrFaultVoucherSet, or withdraw will be paused and cannot be executed.
     * The withdrawEthOnDisaster function is a special function in the Cashier contract for withdrawing funds if contract is paused.
     */
    function pause() external override onlyRouterOwner() {
        _pause();
        if (!Pausable(voucherKernel).paused()) { 
            IVoucherKernel(voucherKernel).pause();
            ICashier(cashierAddress).pause();
        }
    }

    /**
     * @notice Unpause the Cashier && the Voucher Kernel contracts.
     * All functions related to creating requestCreateOrder, requestVoucher, redeem, refund, complain, cancelOrFault,
     * cancelOrFaultVoucherSet, or withdraw will be unpaused.
     */
    function unpause() external override onlyRouterOwner() {
        require(ICashier(cashierAddress).canUnpause(), "UF"); //unpaused forbidden

        _unpause();
        if (Pausable(voucherKernel).paused()) { 
            IVoucherKernel(voucherKernel).unpause();
            ICashier(cashierAddress).unpause();
        }        
    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is
     * also known as a voucher set. Payment and deposits are specified in ETH.
     * @param _metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = _metadata[0];
     * uint256 _validTo = _metadata[1];
     * uint256 _price = _metadata[2];
     * uint256 _depositSe = _metadata[3];
     * uint256 _depositBu = _metadata[4];
     * uint256 _quantity = _metadata[5];
     */
    function requestCreateOrderETHETH(uint256[] calldata _metadata)
        external
        payable
        virtual
        override
        nonReentrant
        whenNotPaused
    {
        checkLimits(_metadata, address(0), address(0), 0);
        requestCreateOrder(_metadata, PaymentMethod.ETHETH, address(0), address(0), 0);
    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is also known as a voucher set.
     * The supply token/voucher set created should only be available to buyers who own a specific NFT (ERC115NonTransferrable) token.
     * This is the "condition" under which a buyer may commit to redeem a voucher that is part of the voucher set created by this function.
     * Payment and deposits are specified in ETH.
     * @param _metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = _metadata[0];
     * uint256 _validTo = _metadata[1];
     * uint256 _price = _metadata[2];
     * uint256 _depositSe = _metadata[3];
     * uint256 _depositBu = _metadata[4];
     * uint256 _quantity = _metadata[5];
     *
     * @param _gateAddress address of a gate contract that will handle the interaction between the BosonRouter contract and the non-transferrable NFT,
     * ownership of which is a condition for committing to redeem a voucher in the voucher set created by this function.
     * @param _nftTokenId Id of the NFT (ERC115NonTransferrable) token, ownership of which is a condition for committing to redeem a voucher
     * in the voucher set created by this function.
     */
    function requestCreateOrderETHETHConditional(uint256[] calldata _metadata, address _gateAddress,
        uint256 _nftTokenId)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        onlyApprovedGate(_gateAddress)
    {
        checkLimits(_metadata, address(0), address(0), 0);
        uint256 _tokenIdSupply = requestCreateOrder(_metadata, PaymentMethod.ETHETH, address(0), address(0), 0);
        finalizeConditionalOrder(_tokenIdSupply, _gateAddress, _nftTokenId);
    }


    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is
     * also known as a voucher set. Price and deposits are specified in tokens.
     * @param _tokenPriceAddress address of the token to be used for the price
     * @param _tokenDepositAddress address of the token to be used for the deposits
     * @param _tokensSent total number of tokens sent. Must be equal to seller deposit * quantity
     * @param _deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param _v signature component used to verify the permit. See EIP-2612
     * @param _r signature component used to verify the permit. See EIP-2612
     * @param _s signature component used to verify the permit. See EIP-2612
     * @param _metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = _metadata[0];
     * uint256 _validTo = _metadata[1];
     * uint256 _price = _metadata[2];
     * uint256 _depositSe = _metadata[3];
     * uint256 _depositBu = _metadata[4];
     * uint256 _quantity = _metadata[5];
     */
    function requestCreateOrderTKNTKNWithPermit(
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        uint256[] calldata _metadata
    )
    external
    override
    nonReentrant
    {
        requestCreateOrderTKNTKNWithPermitInternal(
            _tokenPriceAddress,
            _tokenDepositAddress,
            _tokensSent,
            _deadline,
            _v,
            _r,
            _s,
            _metadata
        );
    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is also known as a voucher set.
     * The supply token/voucher set created should only be available to buyers who own a specific NFT (ERC115NonTransferrable) token.
     * This is the "condition" under which a buyer may commit to redeem a voucher that is part of the voucher set created by this function.
     * Price and deposits are specified in tokens.
     * @param _tokenPriceAddress address of the token to be used for the price
     * @param _tokenDepositAddress address of the token to be used for the deposits
     * @param _tokensSent total number of tokens sent. Must be equal to seller deposit * quantity
     * @param _deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param _v signature component used to verify the permit. See EIP-2612
     * @param _r signature component used to verify the permit. See EIP-2612
     * @param _s signature component used to verify the permit. See EIP-2612
     * @param _metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = _metadata[0];
     * uint256 _validTo = _metadata[1];
     * uint256 _price = _metadata[2];
     * uint256 _depositSe = _metadata[3];
     * uint256 _depositBu = _metadata[4];
     * uint256 _quantity = _metadata[5];
     *
     * @param _gateAddress address of a gate contract that will handle the interaction between the BosonRouter contract and the non-transferrable NFT,
     * ownership of which is a condition for committing to redeem a voucher in the voucher set created by this function.
     * @param _nftTokenId Id of the NFT (ERC115NonTransferrable) token, ownership of which is a condition for committing to redeem a voucher
     * in the voucher set created by this function.
     */
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
    )
    external
    override
    nonReentrant
    onlyApprovedGate(_gateAddress)
    {
        uint256 tokenIdSupply = requestCreateOrderTKNTKNWithPermitInternal(
            _tokenPriceAddress,
            _tokenDepositAddress,
            _tokensSent,
            _deadline,
            _v,
            _r,
            _s,
            _metadata
        );

        finalizeConditionalOrder(tokenIdSupply, _gateAddress, _nftTokenId);
    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is
     * also known as a voucher set. Price is specified in ETH and deposits are specified in tokens.
     * @param _tokenDepositAddress address of the token to be used for the deposits
     * @param _tokensSent total number of tokens sent. Must be equal to seller deposit * quantity
     * @param _deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param _v signature component used to verify the permit. See EIP-2612
     * @param _r signature component used to verify the permit. See EIP-2612
     * @param _s signature component used to verify the permit. See EIP-2612
     * @param _metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = _metadata[0];
     * uint256 _validTo = _metadata[1];
     * uint256 _price = _metadata[2];
     * uint256 _depositSe = _metadata[3];
     * uint256 _depositBu = _metadata[4];
     * uint256 _quantity = _metadata[5];
     */
    function requestCreateOrderETHTKNWithPermit(
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        uint256[] calldata _metadata
    )
    external
    override
    nonReentrant
    {
        requestCreateOrderETHTKNWithPermitInternal( _tokenDepositAddress,
         _tokensSent,
         _deadline,
         _v,
         _r,
         _s,
        _metadata);

    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is also known as a voucher set.
     * The supply token/voucher set created should only be available to buyers who own a specific NFT (ERC115NonTransferrable) token.
     * This is the "condition" under which a buyer may commit to redeem a voucher that is part of the voucher set created by this function.
     * Price is specified in ETH and deposits are specified in tokens.
     * @param _tokenDepositAddress address of the token to be used for the deposits
     * @param _tokensSent total number of tokens sent. Must be equal to seller deposit * quantity
     * @param _deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param _v signature component used to verify the permit. See EIP-2612
     * @param _r signature component used to verify the permit. See EIP-2612
     * @param _s signature component used to verify the permit. See EIP-2612
     * @param _metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = _metadata[0];
     * uint256 _validTo = _metadata[1];
     * uint256 _price = _metadata[2];
     * uint256 _depositSe = _metadata[3];
     * uint256 _depositBu = _metadata[4];
     * uint256 _quantity = _metadata[5];
     *
     * @param _gateAddress address of a gate contract that will handle the interaction between the BosonRouter contract and the non-transferrable NFT,
     * ownership of which is a condition for committing to redeem a voucher in the voucher set created by this function.
     * @param _nftTokenId Id of the NFT (ERC115NonTransferrable) token, ownership of which is a condition for committing to redeem a voucher
     * in the voucher set created by this function.
     */
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
    )
    external
    override
    nonReentrant
    onlyApprovedGate(_gateAddress)
    {
        uint256 tokenIdSupply = requestCreateOrderETHTKNWithPermitInternal( _tokenDepositAddress,
         _tokensSent,
         _deadline,
         _v,
         _r,
         _s,
        _metadata);

        finalizeConditionalOrder(tokenIdSupply, _gateAddress, _nftTokenId);
    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is
     * also known as a voucher set. Price is specified in tokens and the deposits are specified in ETH.
     * Since the price, which is specified in tokens, is not collected when a voucher set is created, there is no need to call
     * permit or transferFrom on the token at this time. The address of the price token is only recorded.
     * @param _tokenPriceAddress address of the token to be used for the deposits
     * @param _metadata metadata which is required for creation of a voucher set
     *  Metadata array is used for consistency across the permutations of similar functions.
     *  Some functions require other parameters, and the number of parameters causes stack too deep error.
     *  The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = _metadata[0];
     * uint256 _validTo = _metadata[1];
     * uint256 _price = _metadata[2];
     * uint256 _depositSe = _metadata[3];
     * uint256 _depositBu = _metadata[4];
     * uint256 _quantity = _metadata[5];
     */
    function requestCreateOrderTKNETH(
        address _tokenPriceAddress,
        uint256[] calldata _metadata
    )
    external
    payable
    override
    nonReentrant
    {
        requestCreateOrderTKNETHInternal(_tokenPriceAddress, _metadata);
    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is also known as a voucher set.
     * The supply token/voucher set created should only be available to buyers who own a specific NFT (ERC115NonTransferrable) token.
     * This is the "condition" under which a buyer may commit to redeem a voucher that is part of the voucher set created by this function.
     * Price is specified in tokens and the deposits are specified in ETH.
     * Since the price, which is specified in tokens, is not collected when a voucher set is created, there is no need to call
     * permit or transferFrom on the token at this time. The address of the price token is only recorded.
     * @param _tokenPriceAddress address of the token to be used for the deposits
     * @param _metadata metadata which is required for creation of a voucher set
     *  Metadata array is used for consistency across the permutations of similar functions.
     *  Some functions require other parameters, and the number of parameters causes stack too deep error.
     *  The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = _metadata[0];
     * uint256 _validTo = _metadata[1];
     * uint256 _price = _metadata[2];
     * uint256 _depositSe = _metadata[3];
     * uint256 _depositBu = _metadata[4];
     * uint256 _quantity = _metadata[5];
     *
     * @param _gateAddress address of a gate contract that will handle the interaction between the BosonRouter contract and the non-transferable NFT,
     * ownership of which is a condition for committing to redeem a voucher in the voucher set created by this function.
     * @param _nftTokenId Id of the NFT (ERC115NonTransferrable) token, ownership of which is a condition for committing to redeem a voucher
     * in the voucher set created by this function.
     */
    function requestCreateOrderTKNETHConditional(
        address _tokenPriceAddress,
        uint256[] calldata _metadata,
        address _gateAddress,
        uint256 _nftTokenId
    )
    external
    payable
    override
    nonReentrant
    onlyApprovedGate(_gateAddress)
    {
        uint256 tokenIdSupply = requestCreateOrderTKNETHInternal(_tokenPriceAddress, _metadata);
        finalizeConditionalOrder(tokenIdSupply, _gateAddress, _nftTokenId);
    }

    /**
     * @notice Buyer requests/commits to redeem a voucher and receives Voucher Token in return.
     * Price and deposit are specified in ETH
     * @param _tokenIdSupply    ID of the supply token
     * @param _issuer           Address of the issuer of the supply token
     */
    function requestVoucherETHETH(uint256 _tokenIdSupply, address _issuer)
    external
    payable
    override
    nonReentrant
    whenNotPaused
    {
        // check if _tokenIdSupply mapped to gate contract
        // if yes, deactivate (user,_tokenIdSupply) to prevent double spending
        deactivateConditionalCommit(_tokenIdSupply);

        uint256 weiReceived = msg.value;

        //checks
        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel)
            .getBuyerOrderCosts(_tokenIdSupply);
        require(price.add(depositBu) == weiReceived, "IF"); //invalid funds

        addEscrowAmountAndFillOrder(_tokenIdSupply, _issuer, PaymentMethod.ETHETH);
    }

    /**
     * @notice Buyer requests/commits to redeem a voucher and receives Voucher Token in return.
     * Price and deposit is specified in tokens.
     * @param _tokenIdSupply ID of the supply token
     * @param _issuer Address of the issuer of the supply token
     * @param _tokensSent total number of tokens sent. Must be equal to buyer deposit plus price
     * @param _deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param _vPrice v signature component  used to verify the permit on the price token. See EIP-2612
     * @param _rPrice r signature component used to verify the permit on the price token. See EIP-2612
     * @param _sPrice s signature component used to verify the permit on the price token. See EIP-2612
     * @param _vDeposit v signature component  used to verify the permit on the deposit token. See EIP-2612
     * @param _rDeposit r signature component used to verify the permit on the deposit token. See EIP-2612
     * @param _sDeposit s signature component used to verify the permit on the deposit token. See EIP-2612
     */
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
    ) external override nonReentrant whenNotPaused {
        // check if _tokenIdSupply mapped to gate contract
        // if yes, deactivate (user,_tokenIdSupply) to prevent double spending
        deactivateConditionalCommit(_tokenIdSupply);

        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel)
            .getBuyerOrderCosts(_tokenIdSupply);
        require(_tokensSent.sub(depositBu) == price, "IF"); //invalid funds

        address tokenPriceAddress = IVoucherKernel(voucherKernel)
            .getVoucherPriceToken(_tokenIdSupply);
        address tokenDepositAddress = IVoucherKernel(voucherKernel)
            .getVoucherDepositToken(_tokenIdSupply);

        permitTransferFromAndAddEscrow(
            tokenPriceAddress,
            price,
            _deadline,
            _vPrice,
            _rPrice,
            _sPrice
        );

        permitTransferFromAndAddEscrow(
            tokenDepositAddress,
            depositBu,
            _deadline,
            _vDeposit,
            _rDeposit,
            _sDeposit
        );

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            PaymentMethod.TKNTKN
        );
    }

    /**
     * @notice Buyer requests/commits to redeem a voucher and receives Voucher Token in return.
     * Price and deposit is specified in tokens. The same token is used for both the price and deposit.
     * @param _tokenIdSupply ID of the supply token
     * @param _issuer address of the issuer of the supply token
     * @param _tokensSent total number of tokens sent. Must be equal to buyer deposit plus price
     * @param _deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param _v signature component used to verify the permit. See EIP-2612
     * @param _r signature component used to verify the permit. See EIP-2612
     * @param _s signature component used to verify the permit. See EIP-2612
     */
    function requestVoucherTKNTKNSameWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensSent,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external override nonReentrant whenNotPaused {
        // check if _tokenIdSupply mapped to gate contract
        // if yes, deactivate (user,_tokenIdSupply) to prevent double spending
        deactivateConditionalCommit(_tokenIdSupply);

        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel)
            .getBuyerOrderCosts(_tokenIdSupply);
        require(_tokensSent.sub(depositBu) == price, "IF"); //invalid funds

        address tokenPriceAddress = IVoucherKernel(voucherKernel)
            .getVoucherPriceToken(_tokenIdSupply);
        address tokenDepositAddress = IVoucherKernel(voucherKernel)
            .getVoucherDepositToken(_tokenIdSupply);

        require(tokenPriceAddress == tokenDepositAddress, "TOKENS_ARE_NOT_THE_SAME"); //invalid caller

        // If tokenPriceAddress && tokenPriceAddress are the same
        // practically it's not of importance to each we are sending the funds
        permitTransferFromAndAddEscrow(
            tokenPriceAddress,
            _tokensSent,
            _deadline,
            _v,
            _r,
            _s
        );

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            PaymentMethod.TKNTKN
        );
    }

    /**
     * @notice Buyer requests/commits to redeem a voucher and receives Voucher Token in return.
     * Price is specified in ETH and deposit is specified in tokens
     * @param _tokenIdSupply ID of the supply token
     * @param _issuer address of the issuer of the supply token
     * @param _tokensDeposit number of tokens sent to cover buyer deposit
     * @param _deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param _v signature component used to verify the permit. See EIP-2612
     * @param _r signature component used to verify the permit. See EIP-2612
     * @param _s signature component used to verify the permit. See EIP-2612
     */
    function requestVoucherETHTKNWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensDeposit,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external payable override nonReentrant whenNotPaused {
        // check if _tokenIdSupply mapped to gate contract
        // if yes, deactivate (user,_tokenIdSupply) to prevent double spending
        deactivateConditionalCommit(_tokenIdSupply);

        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel)
            .getBuyerOrderCosts(_tokenIdSupply);
        require(price == msg.value, "IP"); //invalid price
        require(depositBu == _tokensDeposit, "ID"); // invalid deposit

        address tokenDepositAddress = IVoucherKernel(voucherKernel)
            .getVoucherDepositToken(_tokenIdSupply);

        permitTransferFromAndAddEscrow(
            tokenDepositAddress,
            _tokensDeposit,
            _deadline,
            _v,
            _r,
            _s
        );

        addEscrowAmountAndFillOrder(_tokenIdSupply, _issuer, PaymentMethod.ETHTKN);
    }

    /**
     * @notice Buyer requests/commits to redeem a voucher and receives Voucher Token in return.
     * Price is specified in tokens and the deposit is specified in ETH
     * @param _tokenIdSupply ID of the supply token
     * @param _issuer address of the issuer of the supply token
     * @param _tokensPrice number of tokens sent to cover price
     * @param _deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param _v signature component used to verify the permit. See EIP-2612
     * @param _r signature component used to verify the permit. See EIP-2612
     * @param _s signature component used to verify the permit. See EIP-2612
     */
    function requestVoucherTKNETHWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensPrice,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external payable virtual override nonReentrant whenNotPaused {
        // check if _tokenIdSupply mapped to gate contract
        // if yes, deactivate (user,_tokenIdSupply) to prevent double spending
        deactivateConditionalCommit(_tokenIdSupply);

        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel)
            .getBuyerOrderCosts(_tokenIdSupply);
        require(price == _tokensPrice, "IP"); //invalid price
        require(depositBu == msg.value, "ID"); // invalid deposit

        address tokenPriceAddress = IVoucherKernel(voucherKernel)
            .getVoucherPriceToken(_tokenIdSupply);        

        permitTransferFromAndAddEscrow(
            tokenPriceAddress,
            price,
            _deadline,
            _v,
            _r,
            _s
        );

        addEscrowAmountAndFillOrder(_tokenIdSupply, _issuer, PaymentMethod.TKNETH);
    }

    /**
     * @notice Seller burns the remaining supply in the voucher set in case it's s/he no longer wishes to sell them.
     * Remaining seller deposit in escrow account is withdrawn and sent back to the seller
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) which will be burned and for which deposits will be returned
     */
    function requestCancelOrFaultVoucherSet(uint256 _tokenIdSupply)
        external
        override
        nonReentrant
        whenNotPaused
    {
        uint256 _burnedSupplyQty = IVoucherKernel(voucherKernel)
            .cancelOrFaultVoucherSet(_tokenIdSupply, msg.sender);
        ICashier(cashierAddress).withdrawDepositsSe(
            _tokenIdSupply,
            _burnedSupplyQty,
            msg.sender
        );
    }

    /**
     * @notice Redemption of the vouchers promise
     * @param _tokenIdVoucher   ID of the voucher
     */
    function redeem(uint256 _tokenIdVoucher) external override {
        IVoucherKernel(voucherKernel).redeem(_tokenIdVoucher, msg.sender);
    }

    /**
     * @notice Refunding a voucher
     * @param _tokenIdVoucher   ID of the voucher
     */
    function refund(uint256 _tokenIdVoucher) external override {
        IVoucherKernel(voucherKernel).refund(_tokenIdVoucher, msg.sender);
    }

    /**
     * @notice Issue a complaint for a voucher
     * @param _tokenIdVoucher   ID of the voucher
     */
    function complain(uint256 _tokenIdVoucher) external override {
        IVoucherKernel(voucherKernel).complain(_tokenIdVoucher, msg.sender);
    }

    /**
     * @notice Cancel/Fault transaction by the Seller, admitting to a fault or backing out of the deal
     * @param _tokenIdVoucher   ID of the voucher
     */
    function cancelOrFault(uint256 _tokenIdVoucher) external override {
        IVoucherKernel(voucherKernel).cancelOrFault(
            _tokenIdVoucher,
            msg.sender
        );
    }

    /**
     * @notice Get the address of Cashier contract
     * @return Address of Cashier address
     */
    function getCashierAddress() external view override returns (address) {
        return cashierAddress;
    }

    /**
     * @notice Get the address of Voucher Kernel contract
     * @return Address of Voucher Kernel contract
     */
    function getVoucherKernelAddress()
        external
        view
        override
        returns (address)
    {
        return voucherKernel;
    }

    /**
     * @notice Get the address of Token Registry contract
     * @return Address of Token Registrycontract
     */
    function getTokenRegistryAddress()
        external
        view
        override
        returns (address)
    {
        return tokenRegistry;
    }

    /**
     * @notice Get the address of the gate contract that handles conditional commit of certain voucher set
     * @param _tokenIdSupply    ID of the supply token
     * @return Address of the gate contract or zero address if there is no conditional commit
     */
    function getVoucherSetToGateContract(uint256 _tokenIdSupply)
        external
        view
        override
        returns (address)
    {
        return voucherSetToGateContract[_tokenIdSupply];
    }

    /**
     * @notice Call permit on either a token directly or on a token wrapper
     * @param _token Address of the token owner who is approving tokens to be transferred by spender
     * @param _tokenOwner Address of the token owner who is approving tokens to be transferred by spender
     * @param _spender Address of the party who is transferring tokens on owner's behalf
     * @param _value Number of tokens to be transferred
     * @param _deadline Time after which this permission to transfer is no longer valid. See EIP-2612
     * @param _v Part of the owner's signatue. See EIP-2612
     * @param _r Part of the owner's signatue. See EIP-2612
     * @param _s Part of the owner's signatue. See EIP-2612
     */
    function _permit(
        address _token,
        address _tokenOwner,
        address _spender,
        uint256 _value,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) internal {
        address tokenWrapper = ITokenRegistry(tokenRegistry)
            .getTokenWrapperAddress(_token);
        require(tokenWrapper != address(0), "UNSUPPORTED_TOKEN");

        //The BosonToken contract conforms to this spec, so it will be callable this way
        //if it's address is mapped to itself in the TokenRegistry
        ITokenWrapper(tokenWrapper).permit(
            _tokenOwner,
            _spender,
            _value,
            _deadline,
            _v,
            _r,
            _s
        );
    }

    /**
     * @notice Add amount to escrow and fill order (only order, were ETH involved)
     * @param _tokenIdSupply    ID of the supply token
     * @param _issuer           Address of the issuer of the supply token
     * * @param _paymentMethod  might be ETHETH, ETHTKN, TKNETH
     */    
    function addEscrowAmountAndFillOrder(uint256 _tokenIdSupply, address _issuer, PaymentMethod _paymentMethod) internal {
        //record funds in escrow ...
        ICashier(cashierAddress).addEscrowAmount{value: msg.value}(msg.sender);

        // fill order
        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            _paymentMethod
        );        
    }

    /**
     * @notice Transfer tokens to cashier and adds it to escrow
     * @param _tokenAddress tokens that are transfered
     * @param _amount       amount of tokens to transfer (expected permit)
     */
    function transferFromAndAddEscrow(address _tokenAddress, uint256 _amount)
        internal
    {
        SafeERC20WithPermit.safeTransferFrom(
            IERC20WithPermit(_tokenAddress),
            msg.sender,
            address(cashierAddress),
            _amount
        );

        ICashier(cashierAddress).addEscrowTokensAmount(
            _tokenAddress,
            msg.sender,
            _amount
        );
    }

    /**
     * @notice Calls token that implements permits, transfer tokens from there to cashier and adds it to escrow
     * @param _tokenAddress tokens that are transfered
     * @param _amount       amount of tokens to transfer
     * @param _deadline Time after which this permission to transfer is no longer valid
     * @param _v Part of the owner's signatue
     * @param _r Part of the owner's signatue
     * @param _s Part of the owner's signatue
     */
    function permitTransferFromAndAddEscrow(
        address _tokenAddress,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) internal {
        _permit(
            _tokenAddress,
            msg.sender,
            address(this),
            _amount,
            _deadline,
            _v,
            _r,
            _s
        );

        transferFromAndAddEscrow(_tokenAddress, _amount);
    }

    /**
     * @notice Checks if supplied values are within set limits
     *  @param _metadata metadata which is required for creation of a voucher
     *  Metadata array is used as in some scenarios we need several more params, as we need to recover
     *  owner address in order to permit the contract to transfer funds on his behalf.
     *  Since the params get too many, we end up in situation that the stack is too deep.
     *
     *  uint256 _validFrom = _metadata[0];
     *  uint256 _validTo = _metadata[1];
     *  uint256 _price = _metadata[2];
     *  uint256 _depositSe = _metadata[3];
     *  uint256 _depositBu = _metadata[4];
     *  uint256 _quantity = _metadata[5];
     * @param _tokenPriceAddress     token address which will hold the funds for the price of the voucher
     * @param _tokenDepositAddress  token address which will hold the funds for the deposits of the voucher
     * @param _tokensSent     tokens sent to cashier contract
     */
    function checkLimits(
        uint256[] calldata _metadata,
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent
    ) internal view {
        // check price limits. If price address == 0 -> prices in ETH
        if (_tokenPriceAddress == address(0)) {
            notAboveETHLimit(_metadata[2].mul(_metadata[5]));
        } else {
            notAboveTokenLimit(
                _tokenPriceAddress,
                _metadata[2].mul(_metadata[5])
            );
        }

        // check deposit limits. If deposit address == 0 -> deposits in ETH
        if (_tokenDepositAddress == address(0)) {
            notAboveETHLimit(_metadata[3].mul(_metadata[5]));
            notAboveETHLimit(_metadata[4].mul(_metadata[5]));
            require(_metadata[3].mul(_metadata[5]) == msg.value, "IF"); //invalid funds
        } else {
            notAboveTokenLimit(
                _tokenDepositAddress,
                _metadata[3].mul(_metadata[5])
            );
            notAboveTokenLimit(
                _tokenDepositAddress,
                _metadata[4].mul(_metadata[5])
            );
            require(_metadata[3].mul(_metadata[5]) == _tokensSent, "IF"); //invalid funds
        }
    }

    /**
     * @notice Internal function called by other TKNTKN requestCreateOrder functions to decrease code duplication.
     * Price and deposits are specified in tokens.
     * @param _tokenPriceAddress address of the token to be used for the price
     * @param _tokenDepositAddress address of the token to be used for the deposits
     * @param _tokensSent total number of tokens sent. Must be equal to seller deposit * quantity
     * @param _deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param _v signature component used to verify the permit. See EIP-2612
     * @param _r signature component used to verify the permit. See EIP-2612
     * @param _s signature component used to verify the permit. See EIP-2612
     * @param _metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = _metadata[0];
     * uint256 _validTo = _metadata[1];
     * uint256 _price = _metadata[2];
     * uint256 _depositSe = _metadata[3];
     * uint256 _depositBu = _metadata[4];
     * uint256 _quantity = _metadata[5];
     */
    function requestCreateOrderTKNTKNWithPermitInternal(
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        uint256[] calldata _metadata
    ) internal whenNotPaused notZeroAddress(_tokenPriceAddress) notZeroAddress(_tokenDepositAddress) returns (uint256) {
        checkLimits(
            _metadata,
            _tokenPriceAddress,
            _tokenDepositAddress,
            _tokensSent
        );

        _permit(
            _tokenDepositAddress,
            msg.sender,
            address(this),
            _tokensSent,
            _deadline,
            _v,
            _r,
            _s
        );

        return
            requestCreateOrder(
                _metadata,
                PaymentMethod.TKNTKN,
                _tokenPriceAddress,
                _tokenDepositAddress,
                _tokensSent
            );
    }

    function requestCreateOrderETHTKNWithPermitInternal(
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        uint256[] calldata _metadata
    ) internal whenNotPaused notZeroAddress(_tokenDepositAddress) returns (uint256) {
        checkLimits(_metadata, address(0), _tokenDepositAddress, _tokensSent);

        _permit(
            _tokenDepositAddress,
            msg.sender,
            address(this),
            _tokensSent,
            _deadline,
            _v,
            _r,
            _s
        );

        return requestCreateOrder(
            _metadata,
            PaymentMethod.ETHTKN,
            address(0),
            _tokenDepositAddress,
            _tokensSent
        );
    }

    function requestCreateOrderTKNETHInternal(
        address _tokenPriceAddress,
        uint256[] calldata _metadata
    ) internal whenNotPaused notZeroAddress(_tokenPriceAddress) returns (uint256) {
        checkLimits(_metadata, _tokenPriceAddress, address(0), 0);

        return requestCreateOrder(_metadata, PaymentMethod.TKNETH, _tokenPriceAddress, address(0), 0);
    }

    /**
     * @notice Internal helper that
     * - creates Token Supply Id
     * - creates payment method
     * - adds escrow ammount
     * - transfers tokens (if needed)
     * @param _metadata metadata which is required for creation of a voucher
     *  Metadata array is used as in some scenarios we need several more params, as we need to recover
     *  owner address in order to permit the contract to transfer funds on his behalf.
     *  Since the params get too many, we end up in situation that the stack is too deep.
     *
     *  uint256 _validFrom = _metadata[0];
     *  uint256 _validTo = _metadata[1];
     *  uint256 _price = _metadata[2];
     *  uint256 _depositSe = _metadata[3];
     *  uint256 _depositBu = _metadata[4];
     *  uint256 _quantity = _metadata[5];
     * @param _paymentMethod  might be ETHETH, ETHTKN, TKNETH or TKNTKN
     * @param _tokenPriceAddress     token address which will hold the funds for the price of the voucher
     * @param _tokenDepositAddress  token address which will hold the funds for the deposits of the voucher
     * @param _tokensSent     tokens sent to cashier contract
     */
    function requestCreateOrder(
        uint256[] calldata _metadata,
        PaymentMethod _paymentMethod,
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent
    ) internal returns (uint256) {
        //record funds in escrow ...
        if (_tokenDepositAddress == address(0)) {
            ICashier(cashierAddress).addEscrowAmount{value: msg.value}(
                msg.sender
            );
        } else {
            transferFromAndAddEscrow(_tokenDepositAddress, _tokensSent);
        }
        
        uint256 tokenIdSupply = IVoucherKernel(voucherKernel)
            .createTokenSupplyId(
                msg.sender,
                _metadata[0],
                _metadata[1],
                _metadata[2],
                _metadata[3],
                _metadata[4],
                _metadata[5]
            );

        IVoucherKernel(voucherKernel).createPaymentMethod(
            tokenIdSupply,
            _paymentMethod,
            _tokenPriceAddress,
            _tokenDepositAddress
        );              

        emit LogOrderCreated(
            tokenIdSupply,
            msg.sender,
            _metadata[5],
            _paymentMethod
        );

        return tokenIdSupply;
    }

    /**
     * @notice finalizes creating of conditional order
     * @param _tokenIdSupply    ID of the supply token
     * @param _gateAddress address of a gate contract that will handle the interaction between the BosonRouter contract and the non-transferrable NFT,
     * ownership of which is a condition for committing to redeem a voucher in the voucher set created by this function.
     * @param _nftTokenId Id of the NFT (ERC115NonTransferrable) token, ownership of which is a condition for committing to redeem a voucher
     * in the voucher set created by this function.
     */
    function finalizeConditionalOrder(uint256 _tokenIdSupply, address _gateAddress, uint256 _nftTokenId) internal {
        voucherSetToGateContract[_tokenIdSupply] = _gateAddress;

        emit LogConditionalOrderCreated(_tokenIdSupply, _gateAddress);

        if (_nftTokenId > 0) {
            IGate(_gateAddress).registerVoucherSetId(
                _tokenIdSupply,
                _nftTokenId
            );
        }
    }

    /**
     * @notice check if _tokenIdSupply mapped to gate contract,
     * if it does, deactivate (user,_tokenIdSupply) to prevent double spending
     * @param _tokenIdSupply    ID of the supply token
     */
    function deactivateConditionalCommit(uint256 _tokenIdSupply) internal {
        if (voucherSetToGateContract[_tokenIdSupply] != address(0)) {
            IGate gateContract = IGate(
                voucherSetToGateContract[_tokenIdSupply]
            );
            require(gateContract.check(msg.sender, _tokenIdSupply),"NE"); // not eligible
            gateContract.deactivate(msg.sender, _tokenIdSupply);
        }
    }

    /**
     * @notice Set the address of the VoucherKernel contract
     * @param _voucherKernelAddress   The address of the VoucherKernel contract
     */
    function setVoucherKernelAddress(address _voucherKernelAddress)
        external
        onlyOwner
        notZeroAddress(_voucherKernelAddress)
        whenPaused
    {
        voucherKernel = _voucherKernelAddress;

        emit LogVoucherKernelSet(_voucherKernelAddress, msg.sender);
    }

    /**
     * @notice Set the address of the TokenRegistry contract
     * @param _tokenRegistryAddress   The address of the TokenRegistry contract
     */
    function setTokenRegistryAddress(address _tokenRegistryAddress)
        external
        onlyOwner
        notZeroAddress(_tokenRegistryAddress)
        whenPaused
    {
        tokenRegistry = _tokenRegistryAddress;

        emit LogTokenRegistrySet(_tokenRegistryAddress, msg.sender);
    }

    /**
     * @notice Set the address of the Cashier contract
     * @param _cashierAddress   The address of the Cashier contract
     */
    function setCashierAddress(address _cashierAddress)
        external
        onlyOwner
        notZeroAddress(_cashierAddress)
        whenPaused
    {
        cashierAddress = _cashierAddress;

        emit LogCashierSet(_cashierAddress, msg.sender);
    }
}
