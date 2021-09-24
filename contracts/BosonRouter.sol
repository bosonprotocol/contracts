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
import "./UsingHelpers.sol";

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
    UsingHelpers,
    Pausable,
    ReentrancyGuard,
    Ownable
{
    using Address for address payable;
    using SafeMath for uint256;

    address private cashierAddress;
    address private voucherKernel;
    address private tokenRegistry;

    mapping(uint256 => address) private voucherSetToGateContract;

    event LogOrderCreated(
        uint256 indexed _tokenIdSupply,
        address _seller,
        uint256 _quantity,
        uint8 _paymentType
    );

    event LogConditionalOrderCreated(
        uint256 indexed _tokenIdSupply,
        address indexed _gateAddress
    );

    /**
     * @notice Acts as a modifier, but it's cheaper. Checking if a non-zero address is provided, otherwise reverts.
     */
    function notZeroAddress(address tokenAddress) private pure {
        require(tokenAddress != address(0), "0A"); //zero address
    }

    /**
     * @notice Acts as a modifier, but it's cheaper. Replacement of onlyOwner modifier. If the caller is not the owner of the contract, reverts.
     */
    function onlyRouterOwner() internal view {
        require(owner() == _msgSender(), "NO"); //not owner
    }

    /**
     * @notice Acts as a modifier, but it's cheaper. Checks whether provided value corresponds to the limits in the TokenRegistry.
     * @param value the specified value is per voucher set level. E.g. deposit * qty should not be greater or equal to the limit in the TokenRegistry (ETH).
     */
    function notAboveETHLimit(uint256 value) internal view {
        require(
            value <= ITokenRegistry(tokenRegistry).getETHLimit(),
            "AL" // above limit
        );
    }

    /**
     * @notice Acts as a modifier, but it's cheaper. Checks whether provided value corresponds to the limits in the TokenRegistry.
     * @param _tokenAddress the token address which, we are getting the limits for.
     * @param value the specified value is per voucher set level. E.g. deposit * qty should not be greater or equal to the limit in the TokenRegistry (ETH).
     */
    function notAboveTokenLimit(address _tokenAddress, uint256 value)
        internal
        view
    {
        require(
            value <= ITokenRegistry(tokenRegistry).getTokenLimit(_tokenAddress),
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
    ) {
        notZeroAddress(_voucherKernel);
        notZeroAddress(_tokenRegistry);
        notZeroAddress(_cashierAddress);

        voucherKernel = _voucherKernel;
        tokenRegistry = _tokenRegistry;
        cashierAddress = _cashierAddress;
    }

    /**
     * @notice Pause the Cashier && the Voucher Kernel contracts in case of emergency.
     * All functions related to creating requestCreateOrder, requestVoucher, redeem, refund, complain, cancelOrFault, 
     * cancelOrFaultVoucherSet, or withdraw will be paused and cannot be executed.
     * The withdrawEthOnDisaster function is a special function in the Cashier contract for withdrawing funds if contract is paused.
     */
    function pause() external override {
        onlyRouterOwner();
        _pause();
        IVoucherKernel(voucherKernel).pause();
        ICashier(cashierAddress).pause();
    }

    /**
     * @notice Unpause the Cashier && the Voucher Kernel contracts.
     * All functions related to creating requestCreateOrder, requestVoucher, redeem, refund, complain, cancelOrFault, 
     * cancelOrFaultVoucherSet, or withdraw will be unpaused.
     */
    function unpause() external override {
        onlyRouterOwner();
        require(ICashier(cashierAddress).canUnpause(), "UF"); //unpaused forbidden

        _unpause();
        IVoucherKernel(voucherKernel).unpause();
        ICashier(cashierAddress).unpause();
    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is
     * also known as a voucher set. Payment and deposits are specified in ETH.
     * @param metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = metadata[0];
     * uint256 _validTo = metadata[1];
     * uint256 _price = metadata[2];
     * uint256 _depositSe = metadata[3];
     * uint256 _depositBu = metadata[4];
     * uint256 _quantity = metadata[5];
     */
    function requestCreateOrderETHETH(uint256[] calldata metadata)
        external
        payable
        override
        nonReentrant
        whenNotPaused
    {
        checkLimits(metadata, address(0), address(0), 0);
        requestCreateOrder(metadata, ETHETH, address(0), address(0), 0);
    }

   
    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is
     * also known as a voucher set. Price and deposits are specified in tokens.
     * @param _tokenPriceAddress address of the token to be used for the price
     * @param _tokenDepositAddress address of the token to be used for the deposits
     * @param _tokensSent total number of tokens sent. Must be equal to seller deposit * quantity
     * @param deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param v signature component used to verify the permit. See EIP-2612
     * @param r signature component used to verify the permit. See EIP-2612
     * @param s signature component used to verify the permit. See EIP-2612
     * @param metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *   
     * uint256 _validFrom = metadata[0];
     * uint256 _validTo = metadata[1];
     * uint256 _price = metadata[2];
     * uint256 _depositSe = metadata[3];
     * uint256 _depositBu = metadata[4];
     * uint256 _quantity = metadata[5];
     */
    function requestCreateOrderTKNTKNWithPermit(
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
    ) external override {
        requestCreateOrderTKNTKNWithPermitInternal(
            _tokenPriceAddress,
            _tokenDepositAddress,
            _tokensSent,
            deadline,
            v,
            r,
            s,
            metadata
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
     * @param deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param v signature component used to verify the permit. See EIP-2612
     * @param r signature component used to verify the permit. See EIP-2612
     * @param s signature component used to verify the permit. See EIP-2612
     * @param metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *   
     * uint256 _validFrom = metadata[0];
     * uint256 _validTo = metadata[1];
     * uint256 _price = metadata[2];
     * uint256 _depositSe = metadata[3];
     * uint256 _depositBu = metadata[4];
     * uint256 _quantity = metadata[5];
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
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata,
        address _gateAddress,
        uint256 _nftTokenId
    ) external override {
        notZeroAddress(_gateAddress);

        uint256 tokenIdSupply = requestCreateOrderTKNTKNWithPermitInternal(
            _tokenPriceAddress,
            _tokenDepositAddress,
            _tokensSent,
            deadline,
            v,
            r,
            s,
            metadata
        );

        voucherSetToGateContract[tokenIdSupply] = _gateAddress;

        emit LogConditionalOrderCreated(tokenIdSupply, _gateAddress);

        if (_nftTokenId > 0) {
            IGate(_gateAddress).registerVoucherSetId(
                tokenIdSupply,
                _nftTokenId
            );
        }
    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is
     * also known as a voucher set. Price is specified in ETH and deposits are specified in tokens.
     * @param _tokenDepositAddress address of the token to be used for the deposits
     * @param _tokensSent total number of tokens sent. Must be equal to seller deposit * quantity
     * @param deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param v signature component used to verify the permit. See EIP-2612
     * @param r signature component used to verify the permit. See EIP-2612
     * @param s signature component used to verify the permit. See EIP-2612
     * @param metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *   
     * uint256 _validFrom = metadata[0];
     * uint256 _validTo = metadata[1];
     * uint256 _price = metadata[2];
     * uint256 _depositSe = metadata[3];
     * uint256 _depositBu = metadata[4];
     * uint256 _quantity = metadata[5];
     */
    function requestCreateOrderETHTKNWithPermit(
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
    ) external override whenNotPaused {
        notZeroAddress(_tokenDepositAddress);
        checkLimits(metadata, address(0), _tokenDepositAddress, _tokensSent);

        _permit(
            _tokenDepositAddress,
            msg.sender,
            address(this),
            _tokensSent,
            deadline,
            v,
            r,
            s
        );

        requestCreateOrder(
            metadata,
            ETHTKN,
            address(0),
            _tokenDepositAddress,
            _tokensSent
        );
    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is
     * also known as a voucher set. Price is specified in tokens and the deposits are specified in ETH.
     * Since the price, which is specified in tokens, is not collected when a voucher set is created, there is no need to call
     * permit or transferFrom on the token at this time. The address of the price token is only recorded.
     * @param _tokenPriceAddress address of the token to be used for the deposits
     * @param metadata metadata which is required for creation of a voucher set
     *  Metadata array is used for consistency across the permutations of similar functions.
     *  Some functions require other parameters, and the number of parameters causes stack too deep error.
     *  The use of the matadata array mitigates the stack too deep error.
     *   
     * uint256 _validFrom = metadata[0];
     * uint256 _validTo = metadata[1];
     * uint256 _price = metadata[2];
     * uint256 _depositSe = metadata[3];
     * uint256 _depositBu = metadata[4];
     * uint256 _quantity = metadata[5];
     */
    function requestCreateOrderTKNETH(
        address _tokenPriceAddress,
        uint256[] calldata metadata
    ) external payable override nonReentrant whenNotPaused {
        notZeroAddress(_tokenPriceAddress);
        checkLimits(metadata, _tokenPriceAddress, address(0), 0);

        requestCreateOrder(metadata, TKNETH, _tokenPriceAddress, address(0), 0);
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
        uint256 weiReceived = msg.value;

        //checks
        (uint256 price, , uint256 depositBu) = IVoucherKernel(voucherKernel)
            .getOrderCosts(_tokenIdSupply);
        require(price.add(depositBu) == weiReceived, "IF"); //invalid funds

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            ETHETH
        );

        //record funds in escrow ...
        ICashier(cashierAddress).addEscrowAmount{value: msg.value}(msg.sender);
    }
   
    /**
     * @notice Buyer requests/commits to redeem a voucher and receives Voucher Token in return.
     * Price and deposit is specified in tokens.
     * @param _tokenIdSupply ID of the supply token
     * @param _issuer Address of the issuer of the supply token
     * @param _tokensSent total number of tokens sent. Must be equal to buyer deposit plus price
     * @param deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param vPrice v signature component  used to verify the permit on the price token. See EIP-2612
     * @param rPrice r signature component used to verify the permit on the price token. See EIP-2612
     * @param sPrice s signature component used to verify the permit on the price token. See EIP-2612
     * @param vDeposit v signature component  used to verify the permit on the deposit token. See EIP-2612
     * @param rDeposit r signature component used to verify the permit on the deposit token. See EIP-2612
     * @param sDeposit s signature component used to verify the permit on the deposit token. See EIP-2612
     */
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
            deadline,
            vPrice,
            rPrice,
            sPrice
        );

        permitTransferFromAndAddEscrow(
            tokenDepositAddress,
            depositBu,
            deadline,
            vDeposit,
            rDeposit,
            sDeposit
        );

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            TKNTKN
        );
    }

    /**
     * @notice Buyer requests/commits to redeem a voucher and receives Voucher Token in return.
     * Price and deposit is specified in tokens. The same token is used for both the price and deposit.
     * @param _tokenIdSupply ID of the supply token
     * @param _issuer address of the issuer of the supply token
     * @param _tokensSent total number of tokens sent. Must be equal to buyer deposit plus price
     * @param deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param v signature component used to verify the permit. See EIP-2612
     * @param r signature component used to verify the permit. See EIP-2612
     * @param s signature component used to verify the permit. See EIP-2612
     */
    function requestVoucherTKNTKNSameWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
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

        require(tokenPriceAddress == tokenDepositAddress, "IC"); //invalid caller

        // If tokenPriceAddress && tokenPriceAddress are the same
        // practically it's not of importance to each we are sending the funds
        permitTransferFromAndAddEscrow(
            tokenPriceAddress,
            _tokensSent,
            deadline,
            v,
            r,
            s
        );

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            TKNTKN
        );
    }

    /**
     * @notice Buyer requests/commits to redeem a voucher and receives Voucher Token in return.
     * Price is specified in ETH and deposit is specified in tokens
     * @param _tokenIdSupply ID of the supply token
     * @param _issuer address of the issuer of the supply token
     * @param _tokensDeposit number of tokens sent to cover buyer deposit
     * @param deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param v signature component used to verify the permit. See EIP-2612
     * @param r signature component used to verify the permit. See EIP-2612
     * @param s signature component used to verify the permit. See EIP-2612
     */
    function requestVoucherETHTKNWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensDeposit,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable override nonReentrant whenNotPaused {
        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel)
            .getBuyerOrderCosts(_tokenIdSupply);
        require(price == msg.value, "IP"); //invalid price
        require(depositBu == _tokensDeposit, "ID"); // invalid deposit

        address tokenDepositAddress = IVoucherKernel(voucherKernel)
            .getVoucherDepositToken(_tokenIdSupply);

        permitTransferFromAndAddEscrow(
            tokenDepositAddress,
            _tokensDeposit,
            deadline,
            v,
            r,
            s
        );

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            ETHTKN
        );

        //record funds in escrow ...
        ICashier(cashierAddress).addEscrowAmount{value: msg.value}(msg.sender);
    }

    /**
     * @notice Buyer requests/commits to redeem a voucher and receives Voucher Token in return.
     * Price is specified in tokens and the deposit is specified in ETH
     * @param _tokenIdSupply ID of the supply token
     * @param _issuer address of the issuer of the supply token
     * @param _tokensPrice number of tokens sent to cover price
     * @param deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param v signature component used to verify the permit. See EIP-2612
     * @param r signature component used to verify the permit. See EIP-2612
     * @param s signature component used to verify the permit. See EIP-2612
     */
    function requestVoucherTKNETHWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensPrice,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable override nonReentrant whenNotPaused {
        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel)
            .getBuyerOrderCosts(_tokenIdSupply);
        require(price == _tokensPrice, "IP"); //invalid price
        require(depositBu == msg.value, "ID"); // invalid deposit

        address tokenPriceAddress = IVoucherKernel(voucherKernel)
            .getVoucherPriceToken(_tokenIdSupply);

        permitTransferFromAndAddEscrow(
            tokenPriceAddress,
            price,
            deadline,
            v,
            r,
            s
        );

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            TKNETH
        );

        //record funds in escrow ...
        ICashier(cashierAddress).addEscrowAmount{value: msg.value}(msg.sender);
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
     * @param token Address of the token owner who is approving tokens to be transferred by spender
     * @param owner Address of the token owner who is approving tokens to be transferred by spender
     * @param owner Address of the token owner who is approving tokens to be transferred by spender
     * @param spender Address of the party who is transferring tokens on owner's behalf
     * @param value Number of tokens to be transferred
     * @param deadline Time after which this permission to transfer is no longer valid. See EIP-2612
     * @param v Part of the owner's signatue. See EIP-2612
     * @param r Part of the owner's signatue. See EIP-2612
     * @param s Part of the owner's signatue. See EIP-2612
     */
    function _permit(
        address token,
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal {
        address tokenWrapper = ITokenRegistry(tokenRegistry)
            .getTokenWrapperAddress(token);
        require(tokenWrapper != address(0), "UNSUPPORTED_TOKEN");

        //The BosonToken contract conforms to this spec, so it will be callable this way
        //if it's address is mapped to itself in the TokenRegistry
        ITokenWrapper(tokenWrapper).permit(
            owner,
            spender,
            value,
            deadline,
            v,
            r,
            s
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
        IERC20WithPermit(_tokenAddress).transferFrom(
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
     *  @param metadata metadata which is required for creation of a voucher
     *  Metadata array is used as in some scenarios we need several more params, as we need to recover
     *  owner address in order to permit the contract to transfer funds on his behalf.
     *  Since the params get too many, we end up in situation that the stack is too deep.
     *
     *  uint256 _validFrom = metadata[0];
     *  uint256 _validTo = metadata[1];
     *  uint256 _price = metadata[2];
     *  uint256 _depositSe = metadata[3];
     *  uint256 _depositBu = metadata[4];
     *  uint256 _quantity = metadata[5];
     * @param _tokenPriceAddress     token address which will hold the funds for the price of the voucher
     * @param _tokenDepositAddress  token address which will hold the funds for the deposits of the voucher
     * @param _tokensSent     tokens sent to cashier contract
     */
    function checkLimits(
        uint256[] memory metadata,
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent
    ) internal view returns (bool) {
        // check price limits. If price address == 0 -> prices in ETH
        if (_tokenPriceAddress == address(0)) {
            notAboveETHLimit(metadata[2].mul(metadata[5]));
        } else {
            notAboveTokenLimit(
                _tokenPriceAddress,
                metadata[2].mul(metadata[5])
            );
        }

        // check deposit limits. If deposit address == 0 -> deposits in ETH
        if (_tokenDepositAddress == address(0)) {
            notAboveETHLimit(metadata[3].mul(metadata[5]));
            notAboveETHLimit(metadata[4].mul(metadata[5]));
            require(metadata[3].mul(metadata[5]) == msg.value, "IF"); //invalid funds
        } else {
            notAboveTokenLimit(
                _tokenDepositAddress,
                metadata[3].mul(metadata[5])
            );
            notAboveTokenLimit(
                _tokenDepositAddress,
                metadata[4].mul(metadata[5])
            );
            require(metadata[3].mul(metadata[5]) == _tokensSent, "IF"); //invalid funds
        }
    }

    /**
     * @notice Internal function called by other TKNTKN requestCreateOrder functions to decrease code duplication. 
     * Price and deposits are specified in tokens.
     * @param _tokenPriceAddress address of the token to be used for the price
     * @param _tokenDepositAddress address of the token to be used for the deposits
     * @param _tokensSent total number of tokens sent. Must be equal to seller deposit * quantity
     * @param deadline deadline after which permit signature is no longer valid. See EIP-2612
     * @param v signature component used to verify the permit. See EIP-2612
     * @param r signature component used to verify the permit. See EIP-2612
     * @param s signature component used to verify the permit. See EIP-2612
     * @param metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = metadata[0];
     * uint256 _validTo = metadata[1];
     * uint256 _price = metadata[2];
     * uint256 _depositSe = metadata[3];
     * uint256 _depositBu = metadata[4];
     * uint256 _quantity = metadata[5];
     */
    function requestCreateOrderTKNTKNWithPermitInternal(
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
    ) internal whenNotPaused returns (uint256) {
        notZeroAddress(_tokenPriceAddress);
        notZeroAddress(_tokenDepositAddress);
        checkLimits(
            metadata,
            _tokenPriceAddress,
            _tokenDepositAddress,
            _tokensSent
        );

        _permit(
            _tokenDepositAddress,
            msg.sender,
            address(this),
            _tokensSent,
            deadline,
            v,
            r,
            s
        );

        return
            requestCreateOrder(
                metadata,
                TKNTKN,
                _tokenPriceAddress,
                _tokenDepositAddress,
                _tokensSent
            );
    }

    /**
     * @notice Internal helper that
     * - creates Token Supply Id
     * - creates payment method
     * - adds escrow ammount
     * - transfers tokens (if needed)
     * @param metadata metadata which is required for creation of a voucher
     *  Metadata array is used as in some scenarios we need several more params, as we need to recover
     *  owner address in order to permit the contract to transfer funds on his behalf.
     *  Since the params get too many, we end up in situation that the stack is too deep.
     *
     *  uint256 _validFrom = metadata[0];
     *  uint256 _validTo = metadata[1];
     *  uint256 _price = metadata[2];
     *  uint256 _depositSe = metadata[3];
     *  uint256 _depositBu = metadata[4];
     *  uint256 _quantity = metadata[5];
     * @param _paymentMethod  might be ETHETH, ETHTKN, TKNETH or TKNTKN
     * @param _tokenPriceAddress     token address which will hold the funds for the price of the voucher
     * @param _tokenDepositAddress  token address which will hold the funds for the deposits of the voucher
     * @param _tokensSent     tokens sent to cashier contract
     */
    function requestCreateOrder(
        uint256[] memory metadata,
        uint8 _paymentMethod,
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent
    ) internal returns (uint256) {
        uint256 tokenIdSupply = IVoucherKernel(voucherKernel)
            .createTokenSupplyID(
                msg.sender,
                metadata[0],
                metadata[1],
                metadata[2],
                metadata[3],
                metadata[4],
                metadata[5]
            );

        IVoucherKernel(voucherKernel).createPaymentMethod(
            tokenIdSupply,
            _paymentMethod,
            _tokenPriceAddress,
            _tokenDepositAddress
        );

        //record funds in escrow ...
        if (_tokenDepositAddress == address(0)) {
            ICashier(cashierAddress).addEscrowAmount{value: msg.value}(
                msg.sender
            );
        } else {
            transferFromAndAddEscrow(_tokenDepositAddress, _tokensSent);
        }

        emit LogOrderCreated(
            tokenIdSupply,
            msg.sender,
            metadata[5],
            _paymentMethod
        );

        return tokenIdSupply;
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
}
