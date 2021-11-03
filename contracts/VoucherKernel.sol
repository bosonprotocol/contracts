// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./interfaces/IVoucherSets.sol";
import "./interfaces/IVouchers.sol";
import "./interfaces/IVoucherKernel.sol";
import {PaymentMethod, VoucherState, VoucherStatus, isStateCommitted, isStateRedemptionSigned, isStateRefunded, isStateExpired, isStatus, determineStatus} from "./UsingHelpers.sol";

//preparing for ERC-1066, ERC-1444, EIP-838

/**
 * @title VoucherKernel contract controls the core business logic
 * @dev Notes:
 *  - The usage of block.timestamp is honored since vouchers are defined currently with day-precision.
 *      See: https://ethereum.stackexchange.com/questions/5924/how-do-ethereum-mining-nodes-maintain-a-time-consistent-with-the-network/5931#5931
 */
// solhint-disable-next-line
contract VoucherKernel is IVoucherKernel, Ownable, Pausable, ReentrancyGuard {
    using Address for address;
    using SafeMath for uint256;

    //ERC1155 contract representing voucher sets
    address private voucherSetTokenAddress;

    //ERC721 contract representing vouchers;
    address private voucherTokenAddress;

    //promise for an asset could be reusable, but simplified here for brevity
    struct Promise {
        bytes32 promiseId;
        uint256 nonce; //the asset that is offered
        address seller; //the seller who created the promise
        //we simplify the value for the demoapp, otherwise voucher details would be packed in one bytes32 field value
        uint256 validFrom;
        uint256 validTo;
        uint256 price;
        uint256 depositSe;
        uint256 depositBu;
        uint256 idx;
    }

    struct VoucherPaymentMethod {
        PaymentMethod paymentMethod;
        address addressTokenPrice;
        address addressTokenDeposits;
    }

    address private bosonRouterAddress; //address of the Boson Router contract
    address private cashierAddress; //address of the Cashier contract

    mapping(bytes32 => Promise) private promises; //promises to deliver goods or services
    mapping(address => uint256) private tokenNonces; //mapping between seller address and its own nonces. Every time seller creates supply ID it gets incremented. Used to avoid duplicate ID's
    mapping(uint256 => VoucherPaymentMethod) private paymentDetails; // tokenSupplyId to VoucherPaymentMethod

    bytes32[] private promiseKeys;

    mapping(uint256 => bytes32) private ordersPromise; //mapping between an order (supply a.k.a. VoucherSet) and a promise

    mapping(uint256 => VoucherStatus) private vouchersStatus; //recording the vouchers evolution

    //ID reqs
    mapping(uint256 => uint256) private typeCounters; //counter for ID of a particular type of NFT
    uint256 private constant MASK_TYPE = uint256(uint128(~0)) << 128; //the type mask in the upper 128 bits
    //1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000

    uint256 private constant MASK_NF_INDEX = uint128(~0); //the non-fungible index mask in the lower 128
    //0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111

    uint256 private constant TYPE_NF_BIT = 1 << 255; //the first bit represents an NFT type
    //1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000

    uint256 private typeId; //base token type ... 127-bits cover 1.701411835*10^38 types (not differentiating between FTs and NFTs)
    /* Token IDs:
    Fungibles: 0, followed by 127-bit FT type ID, in the upper 128 bits, followed by 0 in lower 128-bits
    <0><uint127: base token id><uint128: 0>
    
    Non-fungible VoucherSets (supply tokens): 1, followed by 127-bit NFT type ID, in the upper 128 bits, followed by 0 in lower 128-bits
    <1><uint127: base token id><uint128: 0    
    
    Non-fungible vouchers: 1, followed by 127-bit NFT type ID, in the upper 128 bits, followed by a 1-based index of an NFT token ID.
    <1><uint127: base token id><uint128: index of non-fungible>
    */

    uint256 private complainPeriod;
    uint256 private cancelFaultPeriod;

    event LogPromiseCreated(
        bytes32 indexed _promiseId,
        uint256 indexed _nonce,
        address indexed _seller,
        uint256 _validFrom,
        uint256 _validTo,
        uint256 _idx
    );

    event LogVoucherCommitted(
        uint256 indexed _tokenIdSupply,
        uint256 _tokenIdVoucher,
        address _issuer,
        address _holder,
        bytes32 _promiseId
    );

    event LogVoucherRedeemed(
        uint256 _tokenIdVoucher,
        address _holder,
        bytes32 _promiseId
    );

    event LogVoucherRefunded(uint256 _tokenIdVoucher);

    event LogVoucherComplain(uint256 _tokenIdVoucher);

    event LogVoucherFaultCancel(uint256 _tokenIdVoucher);

    event LogExpirationTriggered(uint256 _tokenIdVoucher, address _triggeredBy);

    event LogFinalizeVoucher(uint256 _tokenIdVoucher, address _triggeredBy);

    event LogBosonRouterSet(address _newBosonRouter, address _triggeredBy);

    event LogCashierSet(address _newCashier, address _triggeredBy);

    event LogVoucherTokenContractSet(address _newTokenContract, address _triggeredBy);

    event LogVoucherSetTokenContractSet(address _newTokenContract, address _triggeredBy);

    event LogComplainPeriodChanged(
        uint256 _newComplainPeriod,
        address _triggeredBy
    );

    event LogCancelFaultPeriodChanged(
        uint256 _newCancelFaultPeriod,
        address _triggeredBy
    );

    event LogVoucherSetFaultCancel(uint256 _tokenIdSupply, address _issuer);

    event LogFundsReleased(
        uint256 _tokenIdVoucher,
        uint8 _type //0 .. payment, 1 .. deposits
    );

    /**
     * @notice Checks that only the BosonRouter contract can call a function
    */
    modifier onlyFromRouter() {
        require(msg.sender == bosonRouterAddress, "UNAUTHORIZED_BR");
        _;
    }

    /**
     * @notice Checks that only the Cashier contract can call a function
    */
    modifier onlyFromCashier() {
        require(msg.sender == cashierAddress, "UNAUTHORIZED_C");
        _;
    }

    /**
     * @notice Checks that only the owver of the specified voucher can call a function
    */
    modifier onlyVoucherOwner(uint256 _tokenIdVoucher, address _sender) {
        //check authorization
        require(
            IVouchers(voucherTokenAddress).ownerOf(_tokenIdVoucher) == _sender,
            "UNAUTHORIZED_V"
        );
        _;
    }

    modifier notZeroAddress(address _addressToCheck) {
        require(_addressToCheck != address(0), "0A");
        _;
    }

    /**
     * @notice Construct and initialze the contract. Iniialises associated contract addresses, the complain period, and the cancel or fault period
     * @param _bosonRouterAddress address of the associated BosonRouter contract
     * @param _cashierAddress address of the associated Cashier contract
     * @param _voucherSetTokenAddress address of the associated ERC1155 contract instance
     * @param _voucherTokenAddress address of the associated ERC721 contract instance
      */
    constructor(address _bosonRouterAddress, address _cashierAddress, address _voucherSetTokenAddress, address _voucherTokenAddress)
    notZeroAddress(_bosonRouterAddress)
    notZeroAddress(_cashierAddress)
    notZeroAddress(_voucherSetTokenAddress)
    notZeroAddress(_voucherTokenAddress)
    {
        bosonRouterAddress = _bosonRouterAddress;
        cashierAddress = _cashierAddress;
        voucherSetTokenAddress = _voucherSetTokenAddress;
        voucherTokenAddress = _voucherTokenAddress;

        complainPeriod = 7 * 1 days;
        cancelFaultPeriod = 7 * 1 days;
    }

    /**
     * @notice Pause the process of interaction with voucherID's (ERC-721), in case of emergency.
     * Only BR contract is in control of this function.
     */
    function pause() external override onlyFromRouter {
        _pause();
    }

    /**
     * @notice Unpause the process of interaction with voucherID's (ERC-721).
     * Only BR contract is in control of this function.
     */
    function unpause() external override onlyFromRouter {
        _unpause();
    }

    /**
     * @notice Creating a new promise for goods or services.
     * Can be reused, e.g. for making different batches of these (in the future).
     * @param _seller      seller of the promise
     * @param _validFrom   Start of valid period
     * @param _validTo     End of valid period
     * @param _price       Price (payment amount)
     * @param _depositSe   Seller's deposit
     * @param _depositBu   Buyer's deposit
     */
    function createTokenSupplyId(
        address _seller,
        uint256 _validFrom,
        uint256 _validTo,
        uint256 _price,
        uint256 _depositSe,
        uint256 _depositBu,
        uint256 _quantity
    )
    external
    override
    nonReentrant
    onlyFromRouter
    returns (uint256) {
        require(_quantity > 0, "INVALID_QUANTITY");
        // solhint-disable-next-line not-rely-on-time
        require(_validTo >= block.timestamp + 5 minutes, "INVALID_VALIDITY_TO");
        require(_validTo >= _validFrom.add(5 minutes), "VALID_FROM_MUST_BE_AT_LEAST_5_MINUTES_LESS_THAN_VALID_TO");

        bytes32 key;
        key = keccak256(
            abi.encodePacked(_seller, tokenNonces[_seller]++, _validFrom, _validTo, address(this))
        );

        if (promiseKeys.length > 0) {
            require(
                promiseKeys[promises[key].idx] != key,
                "PROMISE_ALREADY_EXISTS"
            );
        }

        promises[key] = Promise({
            promiseId: key,
            nonce: tokenNonces[_seller],
            seller: _seller,
            validFrom: _validFrom,
            validTo: _validTo,
            price: _price,
            depositSe: _depositSe,
            depositBu: _depositBu,
            idx: promiseKeys.length
        });

        promiseKeys.push(key);

        emit LogPromiseCreated(
            key,
            tokenNonces[_seller],
            _seller,
            _validFrom,
            _validTo,
            promiseKeys.length - 1
        );

        return createOrder(_seller, key, _quantity);
    }

    /**
     * @notice Creates a Payment method struct recording the details on how the seller requires to receive Price and Deposits for a certain Voucher Set.
     * @param _tokenIdSupply     _tokenIdSupply of the voucher set this is related to
     * @param _paymentMethod  might be ETHETH, ETHTKN, TKNETH or TKNTKN
     * @param _tokenPrice   token address which will hold the funds for the price of the voucher
     * @param _tokenDeposits   token address which will hold the funds for the deposits of the voucher
     */
    function createPaymentMethod(
        uint256 _tokenIdSupply,
        PaymentMethod _paymentMethod,
        address _tokenPrice,
        address _tokenDeposits
    ) external override onlyFromRouter {       
        paymentDetails[_tokenIdSupply] = VoucherPaymentMethod({
            paymentMethod: _paymentMethod,
            addressTokenPrice: _tokenPrice,
            addressTokenDeposits: _tokenDeposits
        });
    }

    /**
     * @notice Create an order for offering a certain quantity of an asset
     * This creates a listing in a marketplace, technically as an ERC-1155 non-fungible token with supply.
     * @param _seller     seller of the promise
     * @param _promiseId  ID of a promise (simplified into asset for demo)
     * @param _quantity   Quantity of assets on offer
     */
    function createOrder(
        address _seller,
        bytes32 _promiseId,
        uint256 _quantity
    ) private returns (uint256) {
        //create & assign a new non-fungible type
        typeId++;
        uint256 tokenIdSupply = TYPE_NF_BIT | (typeId << 128); //upper bit is 1, followed by sequence, leaving lower 128-bits as 0;

        ordersPromise[tokenIdSupply] = _promiseId;

        IVoucherSets(voucherSetTokenAddress).mint(
            _seller,
            tokenIdSupply,
            _quantity,
            ""
        );

        return tokenIdSupply;
    }

    /**
     * @notice Fill Voucher Order, iff funds paid, then extract & mint NFT to the voucher holder
     * @param _tokenIdSupply   ID of the supply token (ERC-1155)
     * @param _issuer          Address of the token's issuer
     * @param _holder          Address of the recipient of the voucher (ERC-721)
     * @param _paymentMethod   method being used for that particular order that needs to be fulfilled
     */
    function fillOrder(
        uint256 _tokenIdSupply,
        address _issuer,
        address _holder,
        PaymentMethod _paymentMethod
    )
    external
    override
    onlyFromRouter
    nonReentrant
    {
        require(_doERC721HolderCheck(_issuer, _holder, _tokenIdSupply), "UNSUPPORTED_ERC721_RECEIVED");
        PaymentMethod paymentMethod = getVoucherPaymentMethod(_tokenIdSupply);

        //checks
        require(paymentMethod == _paymentMethod, "Incorrect Payment Method");
        checkOrderFillable(_tokenIdSupply, _issuer, _holder);

        //close order
        uint256 voucherTokenId = extract721(_issuer, _holder, _tokenIdSupply);

        emit LogVoucherCommitted(
            _tokenIdSupply,
            voucherTokenId,
            _issuer,
            _holder,
            getPromiseIdFromVoucherId(voucherTokenId)
        );
    }

    /**
     * @notice Check if holder is a contract that supports ERC721
     * @dev ERC-721
     * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.4.0-rc.0/contracts/token/ERC721/ERC721.sol
     * @param _from     Address of sender
     * @param _to       Address of recipient
     * @param _tokenId  ID of the token
     */
    function _doERC721HolderCheck(
        address _from,
        address _to,
        uint256 _tokenId
    ) internal returns (bool) {
        if (_to.isContract()) {
            try IERC721Receiver(_to).onERC721Received(_msgSender(), _from, _tokenId, "") returns (bytes4 retval) {
                return retval == IERC721Receiver.onERC721Received.selector;
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    revert("UNSUPPORTED_ERC721_RECEIVED");
                } else {
                    assembly {
                        revert(add(32, reason), mload(reason))
                    }
                }
            }
        } else {
            return true;
        }
    }

    /**
     * @notice Check order is fillable
     * @dev Will throw if checks don't pass
     * @param _tokenIdSupply  ID of the supply token
     * @param _issuer  Address of the token's issuer
     * @param _holder  Address of the recipient of the voucher (ERC-721)
     */
    function checkOrderFillable(
        uint256 _tokenIdSupply,
        address _issuer,
        address _holder
    ) internal view notZeroAddress(_holder) {
        require(_tokenIdSupply != 0, "UNSPECIFIED_ID");

        require(
            IVoucherSets(voucherSetTokenAddress).balanceOf(_issuer, _tokenIdSupply) > 0,
            "OFFER_EMPTY"
        );

        bytes32 promiseKey = ordersPromise[_tokenIdSupply];

        require(
            promises[promiseKey].validTo >= block.timestamp,
            "OFFER_EXPIRED"
        );
    }

    /**
     * @notice Extract a standard non-fungible token ERC-721 from a supply stored in ERC-1155
     * @dev Token ID is derived following the same principles for both ERC-1155 and ERC-721
     * @param _issuer          The address of the token issuer
     * @param _to              The address of the token holder
     * @param _tokenIdSupply   ID of the token type
     * @return                 ID of the voucher token
     */
    function extract721(
        address _issuer,
        address _to,
        uint256 _tokenIdSupply
    ) internal returns (uint256) {
        IVoucherSets(voucherSetTokenAddress).burn(_issuer, _tokenIdSupply, 1); // This is hardcoded as 1 on purpose

        //calculate tokenId
        uint256 voucherTokenId =
            _tokenIdSupply | ++typeCounters[_tokenIdSupply];

        //set status
        vouchersStatus[voucherTokenId].status = determineStatus(
            vouchersStatus[voucherTokenId].status,
            VoucherState.COMMIT
        );
        vouchersStatus[voucherTokenId].isPaymentReleased = false;
        vouchersStatus[voucherTokenId].isDepositsReleased = false;

        //mint voucher NFT as ERC-721
        IVouchers(voucherTokenAddress).mint(_to, voucherTokenId);

        return voucherTokenId;
    }

    /* solhint-disable */

    /**
     * @notice Redemption of the vouchers promise
     * @param _tokenIdVoucher   ID of the voucher
     * @param _messageSender   account that called the fn from the BR contract
     */
    function redeem(uint256 _tokenIdVoucher, address _messageSender)
        external
        override
        whenNotPaused
        onlyFromRouter
        onlyVoucherOwner(_tokenIdVoucher, _messageSender)
    {
        //check status
        require(
            isStateCommitted(vouchersStatus[_tokenIdVoucher].status),
            "ALREADY_PROCESSED"
        );

        //check validity period
        isInValidityPeriod(_tokenIdVoucher);
        Promise memory tPromise =
            promises[getPromiseIdFromVoucherId(_tokenIdVoucher)];

        vouchersStatus[_tokenIdVoucher].complainPeriodStart = block.timestamp;
        vouchersStatus[_tokenIdVoucher].status = determineStatus(
            vouchersStatus[_tokenIdVoucher].status,
            VoucherState.REDEEM
        );

        emit LogVoucherRedeemed(
            _tokenIdVoucher,
            _messageSender,
            tPromise.promiseId
        );
    }

    // // // // // // // //
    // UNHAPPY PATH
    // // // // // // // //

    /**
     * @notice Refunding a voucher
     * @param _tokenIdVoucher   ID of the voucher
     * @param _messageSender   account that called the fn from the BR contract
     */
    function refund(uint256 _tokenIdVoucher, address _messageSender)
        external
        override
        whenNotPaused
        onlyFromRouter
        onlyVoucherOwner(_tokenIdVoucher, _messageSender)
    {
        require(
            isStateCommitted(vouchersStatus[_tokenIdVoucher].status),
            "INAPPLICABLE_STATUS"
        );

        //check validity period
        isInValidityPeriod(_tokenIdVoucher);

        vouchersStatus[_tokenIdVoucher].complainPeriodStart = block.timestamp;
        vouchersStatus[_tokenIdVoucher].status = determineStatus(
            vouchersStatus[_tokenIdVoucher].status,
            VoucherState.REFUND
        );

        emit LogVoucherRefunded(_tokenIdVoucher);
    }

    /**
     * @notice Issue a complaint for a voucher
     * @param _tokenIdVoucher   ID of the voucher
     * @param _messageSender   account that called the fn from the BR contract
     */
    function complain(uint256 _tokenIdVoucher, address _messageSender)
        external
        override
        whenNotPaused
        onlyFromRouter
        onlyVoucherOwner(_tokenIdVoucher, _messageSender)
    {
        checkIfApplicableAndResetPeriod(_tokenIdVoucher, VoucherState.COMPLAIN);
    }   

    /**
     * @notice Cancel/Fault transaction by the Seller, admitting to a fault or backing out of the deal
     * @param _tokenIdVoucher   ID of the voucher
     * @param _messageSender   account that called the fn from the BR contract
     */
    function cancelOrFault(uint256 _tokenIdVoucher, address _messageSender)
        external
        override
        onlyFromRouter
        whenNotPaused
    {
        uint256 tokenIdSupply = getIdSupplyFromVoucher(_tokenIdVoucher);
        require(
            getSupplyHolder(tokenIdSupply) == _messageSender,
            "UNAUTHORIZED_COF"
        );

        checkIfApplicableAndResetPeriod(_tokenIdVoucher, VoucherState.CANCEL_FAULT);
    }

    /**
     * @notice Check if voucher status can be changed into desired new status. If yes, the waiting period is resetted, depending on what new status is.
     * @param _tokenIdVoucher   ID of the voucher
     * @param _newStatus   desired new status, can be {COF, COMPLAIN}
     */
    function checkIfApplicableAndResetPeriod(uint256 _tokenIdVoucher, VoucherState _newStatus)
        internal
    {
        uint8 tStatus = vouchersStatus[_tokenIdVoucher].status;

        require(
            !isStatus(tStatus, VoucherState.FINAL),
            "ALREADY_FINALIZED"
        );

        string memory revertReasonAlready; 
        string memory revertReasonExpired;

        if (_newStatus == VoucherState.COMPLAIN) {
            revertReasonAlready = "ALREADY_COMPLAINED";
            revertReasonExpired = "COMPLAINPERIOD_EXPIRED";
        } else {
            revertReasonAlready = "ALREADY_CANCELFAULT";
            revertReasonExpired = "COFPERIOD_EXPIRED";
        }

        require(
            !isStatus(tStatus, _newStatus),
            revertReasonAlready
        );

        Promise memory tPromise =
            promises[getPromiseIdFromVoucherId(_tokenIdVoucher)];
      
        if (
            isStateRedemptionSigned(tStatus) ||
            isStateRefunded(tStatus)
        ) {
            
            require(
                block.timestamp <=
                    vouchersStatus[_tokenIdVoucher].complainPeriodStart +
                        complainPeriod +
                        cancelFaultPeriod,
                revertReasonExpired
            );          
        } else if (isStateExpired(tStatus)) {
            //if redeemed or refunded
            require(
                block.timestamp <=
                    tPromise.validTo + complainPeriod + cancelFaultPeriod,
                revertReasonExpired
            );            
        } else if (
            //if the opposite of what is the desired new state. When doing COMPLAIN we need to check if already in COF (and vice versa), since the waiting periods are different.
            // VoucherState.COMPLAIN has enum index value 2, while VoucherState.CANCEL_FAULT has enum index value 1. To check the opposite status we use transformation "% 2 + 1" which maps 2 to 1 and 1 to 2 
            isStatus(vouchersStatus[_tokenIdVoucher].status, VoucherState((uint8(_newStatus) % 2 + 1))) // making it VoucherState.COMPLAIN or VoucherState.CANCEL_FAULT (opposite to new status) 
        ) {
            uint256 waitPeriod = _newStatus == VoucherState.COMPLAIN ? vouchersStatus[_tokenIdVoucher].complainPeriodStart +
                        complainPeriod : vouchersStatus[_tokenIdVoucher].cancelFaultPeriodStart + cancelFaultPeriod;
            require(
                block.timestamp <= waitPeriod,
                revertReasonExpired
            );
        } else if (_newStatus != VoucherState.COMPLAIN && isStateCommitted(tStatus)) {
            //if committed only (applicable only in COF)
            require(
                block.timestamp <=
                    tPromise.validTo + complainPeriod + cancelFaultPeriod,
                "COFPERIOD_EXPIRED"
            );
 
        } else {
            revert("INAPPLICABLE_STATUS");
            }
        
            vouchersStatus[_tokenIdVoucher].status = determineStatus(
                tStatus,
                _newStatus
            );

        if (_newStatus == VoucherState.COMPLAIN) {
            if (!isStatus(tStatus, VoucherState.CANCEL_FAULT)) {
            vouchersStatus[_tokenIdVoucher].cancelFaultPeriodStart = block
                .timestamp;  //COF period starts
            }
            emit LogVoucherComplain(_tokenIdVoucher);
        } else {
            if (!isStatus(tStatus, VoucherState.COMPLAIN)) {
            vouchersStatus[_tokenIdVoucher].complainPeriodStart = block
            .timestamp; //complain period starts
            }
            emit LogVoucherFaultCancel(_tokenIdVoucher);
        }
    }

    /**
     * @notice Cancel/Fault transaction by the Seller, cancelling the remaining uncommitted voucher set so that seller prevents buyers from committing to vouchers for items no longer in exchange.
     * @param _tokenIdSupply   ID of the voucher set
     * @param _issuer   owner of the voucher
     */
    function cancelOrFaultVoucherSet(uint256 _tokenIdSupply, address _issuer)
    external
    override
    onlyFromRouter
    nonReentrant
    whenNotPaused
    returns (uint256)
    {
        require(getSupplyHolder(_tokenIdSupply) == _issuer, "UNAUTHORIZED_COF");

        uint256 remQty = getRemQtyForSupply(_tokenIdSupply, _issuer);

        require(remQty > 0, "OFFER_EMPTY");

        IVoucherSets(voucherSetTokenAddress).burn(_issuer, _tokenIdSupply, remQty);

        emit LogVoucherSetFaultCancel(_tokenIdSupply, _issuer);

        return remQty;
    }

    // // // // // // // //
    // BACK-END PROCESS
    // // // // // // // //

    /**
     * @notice Mark voucher token that the payment was released
     * @param _tokenIdVoucher   ID of the voucher token
     */
    function setPaymentReleased(uint256 _tokenIdVoucher)
        external
        override
        onlyFromCashier
    {
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID");
        vouchersStatus[_tokenIdVoucher].isPaymentReleased = true;

        emit LogFundsReleased(_tokenIdVoucher, 0);
    }

    /**
     * @notice Mark voucher token that the deposits were released
     * @param _tokenIdVoucher   ID of the voucher token
     */
    function setDepositsReleased(uint256 _tokenIdVoucher)
        external
        override
        onlyFromCashier
    {
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID");
        vouchersStatus[_tokenIdVoucher].isDepositsReleased = true;

        emit LogFundsReleased(_tokenIdVoucher, 1);
    }

    /**
     * @notice Mark voucher token as expired
     * @param _tokenIdVoucher   ID of the voucher token
     */
    function triggerExpiration(uint256 _tokenIdVoucher) external override {
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID");

        Promise memory tPromise =
            promises[getPromiseIdFromVoucherId(_tokenIdVoucher)];

        require(tPromise.validTo < block.timestamp && isStateCommitted(vouchersStatus[_tokenIdVoucher].status),'INAPPLICABLE_STATUS');

        vouchersStatus[_tokenIdVoucher].status = determineStatus(
            vouchersStatus[_tokenIdVoucher].status,
            VoucherState.EXPIRE
        );

        emit LogExpirationTriggered(_tokenIdVoucher, msg.sender);
    }

    /**
     * @notice Mark voucher token to the final status
     * @param _tokenIdVoucher   ID of the voucher token
     */
    function triggerFinalizeVoucher(uint256 _tokenIdVoucher) external override {
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID");

        uint8 tStatus = vouchersStatus[_tokenIdVoucher].status;

        require(!isStatus(tStatus, VoucherState.FINAL), "ALREADY_FINALIZED");

        bool mark;
        Promise memory tPromise =
            promises[getPromiseIdFromVoucherId(_tokenIdVoucher)];

        if (isStatus(tStatus, VoucherState.COMPLAIN)) {
            if (isStatus(tStatus, VoucherState.CANCEL_FAULT)) {
                //if COMPLAIN && COF: then final
                mark = true;
            } else if (
                block.timestamp >=
                vouchersStatus[_tokenIdVoucher].cancelFaultPeriodStart +
                    cancelFaultPeriod
            ) {
                //if COMPLAIN: then final after cof period
                mark = true;
            }
        } else if (
            isStatus(tStatus, VoucherState.CANCEL_FAULT) &&
            block.timestamp >=
            vouchersStatus[_tokenIdVoucher].complainPeriodStart + complainPeriod
        ) {
            //if COF: then final after complain period
            mark = true;
        } else if (
            isStateRedemptionSigned(tStatus) || isStateRefunded(tStatus)
        ) {
            //if RDM/RFND NON_COMPLAIN: then final after complainPeriodStart + complainPeriod
            if (
                block.timestamp >=
                vouchersStatus[_tokenIdVoucher].complainPeriodStart +
                    complainPeriod
            ) {
                mark = true;
            }
        } else if (isStateExpired(tStatus)) {
            //if EXP NON_COMPLAIN: then final after validTo + complainPeriod
            if (block.timestamp >= tPromise.validTo + complainPeriod) {
                mark = true;
            }
        }

        require(mark, 'INAPPLICABLE_STATUS');

        vouchersStatus[_tokenIdVoucher].status = determineStatus(
            tStatus,
            VoucherState.FINAL
        );
        emit LogFinalizeVoucher(_tokenIdVoucher, msg.sender);
    }

    /* solhint-enable */

    // // // // // // // //
    // UTILS
    // // // // // // // //

    /**
     * @notice Set the address of the new holder of a _tokenIdSupply on transfer
     * @param _tokenIdSupply   _tokenIdSupply which will be transferred
     * @param _newSeller   new holder of the supply
     */
    function setSupplyHolderOnTransfer(
        uint256 _tokenIdSupply,
        address _newSeller
    ) external override onlyFromCashier {
        bytes32 promiseKey = ordersPromise[_tokenIdSupply];
        promises[promiseKey].seller = _newSeller;
    }

    /**
     * @notice Set the address of the Boson Router contract
     * @param _bosonRouterAddress   The address of the BR contract
     */
    function setBosonRouterAddress(address _bosonRouterAddress)
        external
        override
        onlyOwner
        whenPaused
        notZeroAddress(_bosonRouterAddress)
    {
        bosonRouterAddress = _bosonRouterAddress;

        emit LogBosonRouterSet(_bosonRouterAddress, msg.sender);
    }

    /**
     * @notice Set the address of the Cashier contract
     * @param _cashierAddress   The address of the Cashier contract
     */
    function setCashierAddress(address _cashierAddress)
        external
        override
        onlyOwner
        whenPaused
        notZeroAddress(_cashierAddress)
    {
        cashierAddress = _cashierAddress;

        emit LogCashierSet(_cashierAddress, msg.sender);
    }

    /**
     * @notice Set the address of the Vouchers token contract, an ERC721 contract
     * @param _voucherTokenAddress   The address of the Vouchers token contract
     */
    function setVoucherTokenAddress(address _voucherTokenAddress)
        external
        override
        onlyOwner
        notZeroAddress(_voucherTokenAddress)
        whenPaused
    {
        voucherTokenAddress = _voucherTokenAddress;
        emit LogVoucherTokenContractSet(_voucherTokenAddress, msg.sender);
    }

   /**
     * @notice Set the address of the Voucher Sets token contract, an ERC1155 contract
     * @param _voucherSetTokenAddress   The address of the Vouchers token contract
     */
    function setVoucherSetTokenAddress(address _voucherSetTokenAddress)
        external
        override
        onlyOwner
        notZeroAddress(_voucherSetTokenAddress)
        whenPaused
    {
        voucherSetTokenAddress = _voucherSetTokenAddress;
        emit LogVoucherSetTokenContractSet(_voucherSetTokenAddress, msg.sender);
    }

    /**
     * @notice Set the general complain period, should be used sparingly as it has significant consequences. Here done simply for demo purposes.
     * @param _complainPeriod   the new value for complain period (in number of seconds)
     */
    function setComplainPeriod(uint256 _complainPeriod)
        external
        override
        onlyOwner
    {
        complainPeriod = _complainPeriod;

        emit LogComplainPeriodChanged(_complainPeriod, msg.sender);
    }

    /**
     * @notice Set the general cancelOrFault period, should be used sparingly as it has significant consequences. Here done simply for demo purposes.
     * @param _cancelFaultPeriod   the new value for cancelOrFault period (in number of seconds)
     */
    function setCancelFaultPeriod(uint256 _cancelFaultPeriod)
        external
        override
        onlyOwner
    {
        cancelFaultPeriod = _cancelFaultPeriod;

        emit LogCancelFaultPeriodChanged(_cancelFaultPeriod, msg.sender);
    }

    // // // // // // // //
    // GETTERS
    // // // // // // // //

    /**
     * @notice Get the promise ID at specific index
     * @param _idx  Index in the array of promise keys
     * @return      Promise ID
     */
    function getPromiseKey(uint256 _idx)
        external
        view
        override
        returns (bytes32)
    {
        return promiseKeys[_idx];
    }

    /**
     * @notice Get the supply token ID from a voucher token
     * @param _tokenIdVoucher   ID of the voucher token
     * @return                  ID of the supply token
     */
    function getIdSupplyFromVoucher(uint256 _tokenIdVoucher)
        public
        pure
        override
        returns (uint256)
    {
        uint256 tokenIdSupply = _tokenIdVoucher & MASK_TYPE;
        require(tokenIdSupply !=0, "INEXISTENT_SUPPLY");
        return tokenIdSupply;
    }

    /**
     * @notice Get the promise ID from a voucher token
     * @param _tokenIdVoucher   ID of the voucher token
     * @return                  ID of the promise
     */
    function getPromiseIdFromVoucherId(uint256 _tokenIdVoucher)
        public
        view
        override
        returns (bytes32)
    {
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID");

        uint256 tokenIdSupply = getIdSupplyFromVoucher(_tokenIdVoucher);
        return promises[ordersPromise[tokenIdSupply]].promiseId;
    }

    /**
     * @notice Get the remaining quantity left in supply of tokens (e.g ERC-721 left in ERC-1155) of an account
     * @param _tokenSupplyId  Token supply ID
     * @param _tokenSupplyOwner    holder of the Token Supply
     * @return          remaining quantity
     */
    function getRemQtyForSupply(uint256 _tokenSupplyId, address _tokenSupplyOwner)
        public
        view
        override
        returns (uint256)
    {
        return IVoucherSets(voucherSetTokenAddress).balanceOf(_tokenSupplyOwner, _tokenSupplyId);
    }

    /**
     * @notice Get all necessary funds for a supply token
     * @param _tokenIdSupply   ID of the supply token
     * @return                  returns a tuple (Payment amount, Seller's deposit, Buyer's deposit)
     */
    function getOrderCosts(uint256 _tokenIdSupply)
        external
        view
        override
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        bytes32 promiseKey = ordersPromise[_tokenIdSupply];
        return (
            promises[promiseKey].price,
            promises[promiseKey].depositSe,
            promises[promiseKey].depositBu
        );
    }

    /**
     * @notice Get Buyer costs required to make an order for a supply token
     * @param _tokenIdSupply   ID of the supply token
     * @return                  returns a tuple (Payment amount, Buyer's deposit)
     */
    function getBuyerOrderCosts(uint256 _tokenIdSupply)
        external
        view
        override
        returns (uint256, uint256)
    {
        bytes32 promiseKey = ordersPromise[_tokenIdSupply];
        return (promises[promiseKey].price, promises[promiseKey].depositBu);
    }

    /**
     * @notice Get Seller deposit
     * @param _tokenIdSupply   ID of the supply token
     * @return                  returns sellers deposit
     */
    function getSellerDeposit(uint256 _tokenIdSupply)
        external
        view
        override
        returns (uint256)
    {
        bytes32 promiseKey = ordersPromise[_tokenIdSupply];
        return promises[promiseKey].depositSe;
    }

    /**
     * @notice Get the holder of a supply
     * @param _tokenIdSupply ID of the order (aka VoucherSet) which is mapped to the corresponding Promise.
     * @return                  Address of the holder
     */
    function getSupplyHolder(uint256 _tokenIdSupply)
        public
        view
        override
        returns (address)
    {
        bytes32 promiseKey = ordersPromise[_tokenIdSupply];
        return promises[promiseKey].seller;
    }

    /**
     * @notice Get promise data not retrieved by other accessor functions
     * @param _promiseKey   ID of the promise
     * @return promise data not returned by other accessor methods
     */
    function getPromiseData(bytes32 _promiseKey)
        external
        view
        override
        returns (bytes32, uint256, uint256, uint256, uint256 )
    {
        Promise memory tPromise = promises[_promiseKey];
        return (tPromise.promiseId, tPromise.nonce, tPromise.validFrom, tPromise.validTo, tPromise.idx); 
    }

    /**
     * @notice Get the current status of a voucher
     * @param _tokenIdVoucher   ID of the voucher token
     * @return                  Status of the voucher (via enum)
     */
    function getVoucherStatus(uint256 _tokenIdVoucher)
        external
        view
        override
        returns (
            uint8,
            bool,
            bool,
            uint256,
            uint256
        )
    {
        return (
            vouchersStatus[_tokenIdVoucher].status,
            vouchersStatus[_tokenIdVoucher].isPaymentReleased,
            vouchersStatus[_tokenIdVoucher].isDepositsReleased,
            vouchersStatus[_tokenIdVoucher].complainPeriodStart,
            vouchersStatus[_tokenIdVoucher].cancelFaultPeriodStart
        );
    }

    /**
     * @notice Get the holder of a voucher
     * @param _tokenIdVoucher   ID of the voucher token
     * @return                  Address of the holder
     */
    function getVoucherHolder(uint256 _tokenIdVoucher)
        external
        view
        override
        returns (address)
    {
        return IVouchers(voucherTokenAddress).ownerOf(_tokenIdVoucher);
    }

    /**
     * @notice Get the address of the token where the price for the supply is held
     * @param _tokenIdSupply   ID of the voucher supply token
     * @return                  Address of the token
     */
    function getVoucherPriceToken(uint256 _tokenIdSupply)
        external
        view
        override
        returns (address)
    {
        return paymentDetails[_tokenIdSupply].addressTokenPrice;
    }

    /**
     * @notice Get the address of the token where the deposits for the supply are held
     * @param _tokenIdSupply   ID of the voucher supply token
     * @return                  Address of the token
     */
    function getVoucherDepositToken(uint256 _tokenIdSupply)
        external
        view
        override
        returns (address)
    {
        return paymentDetails[_tokenIdSupply].addressTokenDeposits;
    }

    /**
     * @notice Get the payment method for a particular _tokenIdSupply
     * @param _tokenIdSupply   ID of the voucher supply token
     * @return                  payment method
     */
    function getVoucherPaymentMethod(uint256 _tokenIdSupply)
        public
        view
        override
        returns (PaymentMethod)
    {
        return paymentDetails[_tokenIdSupply].paymentMethod;
    }

    /**
     * @notice Checks whether a voucher is in valid period for redemption (between start date and end date)
     * @param _tokenIdVoucher ID of the voucher token
     */
    function isInValidityPeriod(uint256 _tokenIdVoucher)
        public
        view
        override
        returns (bool)
    {
        //check validity period
        Promise memory tPromise =
            promises[getPromiseIdFromVoucherId(_tokenIdVoucher)];
        require(tPromise.validFrom <= block.timestamp, "INVALID_VALIDITY_FROM");
        require(tPromise.validTo >= block.timestamp, "INVALID_VALIDITY_TO");

        return true;
    }

    /**
     * @notice Checks whether a voucher is in valid state to be transferred. If either payments or deposits are released, voucher could not be transferred
     * @param _tokenIdVoucher ID of the voucher token
     */
    function isVoucherTransferable(uint256 _tokenIdVoucher)
        external
        view
        override
        returns (bool)
    {
        return
            !(vouchersStatus[_tokenIdVoucher].isPaymentReleased ||
                vouchersStatus[_tokenIdVoucher].isDepositsReleased);
    }

    /**
     * @notice Get address of the Boson Router to which this contract points
     * @return Address of the Boson Router contract
     */
    function getBosonRouterAddress()
        external
        view
        override
        returns (address) 
    {
        return bosonRouterAddress;
    }

    /**
     * @notice Get address of the Cashier contract to which this contract points
     * @return Address of the Cashier contract
     */
    function getCashierAddress()
        external
        view
        override
        returns (address)
    {
        return cashierAddress;
    }

    /**
     * @notice Get the token nonce for a seller
     * @param _seller Address of the seller
     * @return The seller's nonce
     */
    function getTokenNonce(address _seller)
        external
        view
        override
        returns (uint256) 
    {
        return tokenNonces[_seller];
    }

    /**
     * @notice Get the current type Id
     * @return type Id
     */
    function getTypeId()
        external
        view
        override
        returns (uint256)
    {
        return typeId;
    }

    /**
     * @notice Get the complain period
     * @return complain period
     */
    function getComplainPeriod()
        external
        view
        override
        returns (uint256)
    {
        return complainPeriod;
    }

    /**
     * @notice Get the cancel or fault period
     * @return cancel or fault period
     */
    function getCancelFaultPeriod()
        external
        view
        override
        returns (uint256)
    {
        return cancelFaultPeriod;
    }
    
     /**
     * @notice Get the promise ID from a voucher set
     * @param _tokenIdSupply   ID of the voucher token
     * @return                  ID of the promise
     */
    function getPromiseIdFromSupplyId(uint256 _tokenIdSupply)
        external
        view
        override
        returns (bytes32) 
    {
        return ordersPromise[_tokenIdSupply];
    }

    /**
     * @notice Get the address of the Vouchers token contract, an ERC721 contract
     * @return Address of Vouchers contract
     */
    function getVoucherTokenAddress() 
        external 
        view 
        override
        returns (address)
    {
        return voucherTokenAddress;
    }

    /**
     * @notice Get the address of the VoucherSets token contract, an ERC155 contract
     * @return Address of VoucherSets contract
     */
    function getVoucherSetTokenAddress() 
        external 
        view 
        override
        returns (address)
    {
        return voucherSetTokenAddress;
    }
}
