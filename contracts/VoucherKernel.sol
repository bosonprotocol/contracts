// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.1;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IERC1155.sol";
import "./interfaces/IERC165.sol";
import "./interfaces/IERC721.sol";
import "./interfaces/IERC1155ERC721.sol";
import "./interfaces/IERC721TokenReceiver.sol";
import "./interfaces/IVoucherKernel.sol";
import "./UsingHelpers.sol";

//preparing for ERC-1066, ERC-1444, EIP-838

/**
 * @title VoucherKernel contract is controlling the core business logic
 * @dev Notes:
 *  - Since this is a reference app, it is not yet optimized.
 *      In the next phase, the bulk raw data will be packed into a single bytes32 field and/or pushed off-chain.
 *  - The usage of block.timestamp is honored since vouchers are defined currently with day-precision.
 *      See: https://ethereum.stackexchange.com/questions/5924/how-do-ethereum-mining-nodes-maintain-a-time-consistent-with-the-network/5931#5931
 */
// solhint-disable-next-line
contract VoucherKernel is IVoucherKernel, Ownable, Pausable, UsingHelpers {
    using Address for address;
    using SafeMath for uint256;

    //AssetRegistry assetRegistry;
    address public tokensContract;

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
        uint8 paymentMethod;
        address addressTokenPrice;
        address addressTokenDeposits;
    }

    address public bosonRouterAddress; //address of the Boson Router contract
    address public cashierAddress; //address of the Cashier contract

    mapping(bytes32 => Promise) public promises; //promises to deliver goods or services
    mapping(address => uint256) public tokenNonces; //mapping between seller address and its own nonces. Every time seller creates supply ID it gets incremented. Used to avoid duplicate ID's
    mapping(uint256 => VoucherPaymentMethod) public paymentDetails; // tokenSupplyId to VoucherPaymentMethod

    bytes32[] public promiseKeys;

    mapping(uint256 => bytes32) public ordersPromise; //mapping between an order (supply a.k.a. VoucherSet token) and a promise

    mapping(uint256 => VoucherStatus) public vouchersStatus; //recording the vouchers evolution

    //standard reqs
    mapping(uint256 => mapping(address => uint256)) private balances; //balance of token ids of an account
    mapping(address => mapping(address => bool)) private operatorApprovals; //approval of accounts of an operator

    //ID reqs
    mapping(uint256 => uint256) public typeCounters; //counter for ID of a particular type of NFT
    uint256 public constant MASK_TYPE = uint256(uint128(~0)) << 128; //the type mask in the upper 128 bits
    //1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000

    uint256 public constant MASK_NF_INDEX = uint128(~0); //the non-fungible index mask in the lower 128
    //0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111

    uint256 public constant TYPE_NF_BIT = 1 << 255; //the first bit represents an NFT type
    //1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000

    uint256 public typeId; //base token type ... 127-bits cover 1.701411835*10^38 types (not differentiating between FTs and NFTs)
    /* Token IDs:
    Fungibles: 0, followed by 127-bit FT type ID, in the upper 128 bits, followed by 0 in lower 128-bits
    <0><uint127: base token id><uint128: 0>
    
    Non-fungible VoucherSets (supply tokens): 1, followed by 127-bit NFT type ID, in the upper 128 bits, followed by 0 in lower 128-bits
    <1><uint127: base token id><uint128: 0    
    
    Non-fungible vouchers: 1, followed by 127-bit NFT type ID, in the upper 128 bits, followed by a 1-based index of an NFT token ID.
    <1><uint127: base token id><uint128: index of non-fungible>
    */

    uint256 public complainPeriod;
    uint256 public cancelFaultPeriod;

    event LogPromiseCreated(
        bytes32 indexed _promiseId,
        uint256 indexed _nonce,
        address indexed _seller,
        uint256 _validFrom,
        uint256 _validTo,
        uint256 _idx
    );

    event LogVoucherDelivered(
        uint256 indexed _tokenIdSupply,
        uint256 _tokenIdVoucher,
        address _issuer,
        address _holder,
        bytes32 _promiseId,
        uint256 _correlationId
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

    modifier onlyFromRouter() {
        require(bosonRouterAddress != address(0), "UNSPECIFIED_BR"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(msg.sender == bosonRouterAddress, "UNAUTHORIZED_BR"); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        _;
    }

    modifier onlyFromCashier() {
        require(cashierAddress != address(0), "UNSPECIFIED_BR"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(msg.sender == cashierAddress, "UNAUTHORIZED_C"); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        _;
    }

    modifier onlyVoucherOwner(uint256 _tokenIdVoucher, address _sender) {
        //check authorization
        require(
            IERC721(tokensContract).ownerOf(_tokenIdVoucher) == _sender,
            "UNAUTHORIZED_V"
        ); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        _;
    }

    constructor(address _tokensContract) {
        tokensContract = _tokensContract;

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
    function createTokenSupplyID(
        address _seller,
        uint256 _validFrom,
        uint256 _validTo,
        uint256 _price,
        uint256 _depositSe,
        uint256 _depositBu,
        uint256 _quantity
    ) external override onlyFromRouter returns (uint256) {
        require(_validFrom <= _validTo, "INVALID_VALIDITY_FROM"); //hex"26" FISSION.code(FISSION.Category.Find, FISSION.Status.Above_Range_Overflow)
        // solhint-disable-next-line not-rely-on-time
        require(_validTo >= block.timestamp + 5 minutes, "INVALID_VALIDITY_TO"); //"Minimum order validity is set to prevent any potential attack from flash-loans or similar." //hex"24" FISSION.code(FISSION.Category.Find, FISSION.Status.BelowRange_Underflow)

        bytes32 key;
        key = keccak256(
            abi.encodePacked(_seller, tokenNonces[_seller]++, _validFrom, _validTo)
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
        uint8 _paymentMethod,
        address _tokenPrice,
        address _tokenDeposits
    ) external override onlyFromRouter {
        require(
            _paymentMethod > 0 &&
                _paymentMethod <= 4,
            "INVALID PAYMENT METHOD"
        );
        
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
        require(_promiseId != bytes32(0), "UNSPECIFIED_PROMISE"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(promises[_promiseId].seller == _seller, "UNAUTHORIZED_CO"); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        require(_quantity > 0, "INVALID_QUANTITY"); //hex"24" FISSION.code(FISSION.Category.Find, FISSION.Status.BelowRange_Underflow)

        uint256 tokenIdSupply = generateTokenType(true); //create & assign a new non-fungible type

        ordersPromise[tokenIdSupply] = _promiseId;

        IERC1155ERC721(tokensContract).mint(
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
     * @param _correlationId           ID of the current interaction with the smart contract for a specific user
     */
    function fillOrder(
        uint256 _tokenIdSupply,
        address _issuer,
        address _holder,
        uint8 _paymentMethod,
        uint256 _correlationId
    ) external override onlyFromRouter {
        uint8 paymentMethod = getVoucherPaymentMethod(_tokenIdSupply);

        //checks
        require(paymentMethod == _paymentMethod, "Incorrect Payment Method");
        checkOrderFillable(_tokenIdSupply, _issuer, _holder);

        //close order
        uint256 voucherTokenId = extract721(_issuer, _holder, _tokenIdSupply);

        emit LogVoucherDelivered(
            _tokenIdSupply,
            voucherTokenId,
            _issuer,
            _holder,
            getPromiseIdFromVoucherId(voucherTokenId),
            _correlationId
        );
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
    ) internal view {
        require(_tokenIdSupply != 0, "UNSPECIFIED_ID"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        if (_holder.isContract()) {
            require(
                IERC165(_holder).supportsInterface(0x150b7a02),
                "UNSUPPORTED_ERC721_RECEIVED"
            ); //hex"31"
            //bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))
        }

        require(_holder != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(
            IERC1155(tokensContract).balanceOf(_issuer, _tokenIdSupply) > 0,
            "OFFER_EMPTY"
        ); //hex"40" FISSION.code(FISSION.Category.Availability, FISSION.Status.Unavailable)

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
        if (_to.isContract()) {
            require(
                ERC721TokenReceiver(_to).onERC721Received(
                    _issuer,
                    msg.sender,
                    _tokenIdSupply,
                    ""
                ) == ERC721TokenReceiver(_to).onERC721Received.selector,
                "UNSUPPORTED_ERC721_RECEIVED"
            ); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
            //bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))
        }

        IERC1155ERC721(tokensContract).burn(_issuer, _tokenIdSupply, 1); // This is hardcoded as 1 on purpose

        //calculate tokenId
        uint256 voucherTokenId =
            _tokenIdSupply | ++typeCounters[_tokenIdSupply];

        //set status
        vouchersStatus[voucherTokenId].status = determineStatus(
            vouchersStatus[voucherTokenId].status,
            IDX_COMMIT
        );
        vouchersStatus[voucherTokenId].isPaymentReleased = false;
        vouchersStatus[voucherTokenId].isDepositsReleased = false;

        //mint voucher NFT as ERC-721
        IERC1155ERC721(tokensContract).mint(_to, voucherTokenId);

        return voucherTokenId;
    }

    /**
     * @notice Extract a standard non-fungible tokens ERC-721 from a supply stored in ERC-1155
     * @dev Token ID is derived following the same principles for both ERC-1155 and ERC-721
     * @param _issuer          The address of the token issuer
     * @param _tokenIdSupply   ID of the token type
     * @param _qty   qty that should be burned
     */
    function burnSupplyOnPause(
        address _issuer,
        uint256 _tokenIdSupply,
        uint256 _qty
    ) external override whenPaused onlyFromCashier {
        IERC1155ERC721(tokensContract).burn(_issuer, _tokenIdSupply, _qty);
    }

    /**
     * @notice Creating a new token type, serving as the base for tokenID generation for NFTs, and a de facto ID for FTs.
     * @param _isNonFungible   Flag for generating NFT or FT
     * @return _tokenType   Returns a newly generated token type
     */
    function generateTokenType(bool _isNonFungible)
        internal
        returns (uint256 _tokenType)
    {
        typeId++;

        if (_isNonFungible) {
            _tokenType = TYPE_NF_BIT | (typeId << 128); //upper bit is 1, followed by sequence, leaving lower 128-bits as 0
        } else {
            _tokenType = typeId << 128; //upper bit is not set, followed by sequence, leaving lower 128-bits as 0
        }

        return _tokenType;
    }

    /* solhint-disable */

    /**
     * @notice Redemption of the vouchers promise
     * @param _tokenIdVoucher   ID of the voucher
     * @param _msgSender   account called the fn from the BR contract
     */
    function redeem(uint256 _tokenIdVoucher, address _msgSender)
        external
        override
        whenNotPaused
        onlyFromRouter
        onlyVoucherOwner(_tokenIdVoucher, _msgSender)
    {
        //check status
        require(
            isStateCommitted(vouchersStatus[_tokenIdVoucher].status),
            "ALREADY_PROCESSED"
        ); //hex"48" FISSION.code(FISSION.Category.Availability, FISSION.Status.AlreadyDone)

        //check validity period
        isInValidityPeriod(_tokenIdVoucher);
        Promise memory tPromise =
            promises[getPromiseIdFromVoucherId(_tokenIdVoucher)];

        vouchersStatus[_tokenIdVoucher].complainPeriodStart = block.timestamp;
        vouchersStatus[_tokenIdVoucher].status = determineStatus(
            vouchersStatus[_tokenIdVoucher].status,
            IDX_REDEEM
        );

        emit LogVoucherRedeemed(
            _tokenIdVoucher,
            _msgSender,
            tPromise.promiseId
        );
    }

    // // // // // // // //
    // UNHAPPY PATH
    // // // // // // // //

    /**
     * @notice Refunding a voucher
     * @param _tokenIdVoucher   ID of the voucher
     * @param _msgSender   account called the fn from the BR contract
     */
    function refund(uint256 _tokenIdVoucher, address _msgSender)
        external
        override
        whenNotPaused
        onlyFromRouter
        onlyVoucherOwner(_tokenIdVoucher, _msgSender)
    {
        require(
            isStateCommitted(vouchersStatus[_tokenIdVoucher].status),
            "INAPPLICABLE_STATUS"
        ); //hex"18" FISSION.code(FISSION.Category.Permission, FISSION.Status.NotApplicableToCurrentState)

        //check validity period
        isInValidityPeriod(_tokenIdVoucher);

        vouchersStatus[_tokenIdVoucher].complainPeriodStart = block.timestamp;
        vouchersStatus[_tokenIdVoucher].status = determineStatus(
            vouchersStatus[_tokenIdVoucher].status,
            IDX_REFUND
        );

        emit LogVoucherRefunded(_tokenIdVoucher);
    }

    /**
     * @notice Issue a complain for a voucher
     * @param _tokenIdVoucher   ID of the voucher
     * @param _msgSender   account called the fn from the BR contract
     */
    function complain(uint256 _tokenIdVoucher, address _msgSender)
        external
        override
        whenNotPaused
        onlyFromRouter
        onlyVoucherOwner(_tokenIdVoucher, _msgSender)
    {
        require(
            !isStatus(vouchersStatus[_tokenIdVoucher].status, IDX_COMPLAIN),
            "ALREADY_COMPLAINED"
        ); //hex"48" FISSION.code(FISSION.Category.Availability, FISSION.Status.AlreadyDone)
        require(
            !isStatus(vouchersStatus[_tokenIdVoucher].status, IDX_FINAL),
            "ALREADY_FINALIZED"
        ); //hex"48" FISSION.code(FISSION.Category.Availability, FISSION.Status.AlreadyDone)

        //check if still in the complain period
        Promise memory tPromise =
            promises[getPromiseIdFromVoucherId(_tokenIdVoucher)];

        //if redeemed or refunded
        if (
            isStateRedemptionSigned(vouchersStatus[_tokenIdVoucher].status) ||
            isStateRefunded(vouchersStatus[_tokenIdVoucher].status)
        ) {
            if (
                !isStatus(
                    vouchersStatus[_tokenIdVoucher].status,
                    IDX_CANCEL_FAULT
                )
            ) {
                require(
                    block.timestamp <=
                        vouchersStatus[_tokenIdVoucher].complainPeriodStart +
                            complainPeriod +
                            cancelFaultPeriod,
                    "COMPLAINPERIOD_EXPIRED"
                ); //hex"46" FISSION.code(FISSION.Category.Availability, FISSION.Status.Expired)
            } else {
                require(
                    block.timestamp <=
                        vouchersStatus[_tokenIdVoucher].complainPeriodStart +
                            complainPeriod,
                    "COMPLAINPERIOD_EXPIRED"
                ); //hex"46" FISSION.code(FISSION.Category.Availability, FISSION.Status.Expired)
            }

            vouchersStatus[_tokenIdVoucher].cancelFaultPeriodStart = block
                .timestamp;
            vouchersStatus[_tokenIdVoucher].status = determineStatus(
                vouchersStatus[_tokenIdVoucher].status,
                IDX_COMPLAIN
            );

            emit LogVoucherComplain(_tokenIdVoucher);

            //if expired
        } else if (isStateExpired(vouchersStatus[_tokenIdVoucher].status)) {
            if (
                !isStatus(
                    vouchersStatus[_tokenIdVoucher].status,
                    IDX_CANCEL_FAULT
                )
            ) {
                require(
                    block.timestamp <=
                        tPromise.validTo + complainPeriod + cancelFaultPeriod,
                    "COMPLAINPERIOD_EXPIRED"
                ); //hex"46" FISSION.code(FISSION.Category.Availability, FISSION.Status.Expired)
            } else {
                require(
                    block.timestamp <= tPromise.validTo + complainPeriod,
                    "COMPLAINPERIOD_EXPIRED"
                ); //hex"46" FISSION.code(FISSION.Category.Availability, FISSION.Status.Expired)
            }

            vouchersStatus[_tokenIdVoucher].cancelFaultPeriodStart = block
                .timestamp;
            vouchersStatus[_tokenIdVoucher].status = determineStatus(
                vouchersStatus[_tokenIdVoucher].status,
                IDX_COMPLAIN
            );

            emit LogVoucherComplain(_tokenIdVoucher);

            //if cancelOrFault
        } else if (
            isStatus(vouchersStatus[_tokenIdVoucher].status, IDX_CANCEL_FAULT)
        ) {
            require(
                block.timestamp <=
                    vouchersStatus[_tokenIdVoucher].complainPeriodStart +
                        complainPeriod,
                "COMPLAINPERIOD_EXPIRED"
            ); //hex"46" FISSION.code(FISSION.Category.Availability, FISSION.Status.Expired));

            vouchersStatus[_tokenIdVoucher].status = determineStatus(
                vouchersStatus[_tokenIdVoucher].status,
                IDX_COMPLAIN
            );

            emit LogVoucherComplain(_tokenIdVoucher);
        } else {
            revert("INAPPLICABLE_STATUS"); //hex"18" FISSION.code(FISSION.Category.Permission, FISSION.Status.NotApplicableToCurrentState)
        }
    }

    /**
     * @notice Cancel/Fault transaction by the Seller, admitting to a fault or backing out of the deal
     * @param _tokenIdVoucher   ID of the voucher
     */
    function cancelOrFault(uint256 _tokenIdVoucher, address _msgSender)
        external
        override
        whenNotPaused
    {
        uint256 tokenIdSupply = getIdSupplyFromVoucher(_tokenIdVoucher);
        require(
            getSupplyHolder(tokenIdSupply) == _msgSender,
            "UNAUTHORIZED_COF"
        ); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)

        uint8 tStatus = vouchersStatus[_tokenIdVoucher].status;

        require(!isStatus(tStatus, IDX_CANCEL_FAULT), "ALREADY_CANCELFAULT"); //hex"48" FISSION.code(FISSION.Category.Availability, FISSION.Status.AlreadyDone)
        require(!isStatus(tStatus, IDX_FINAL), "ALREADY_FINALIZED"); //hex"48" FISSION.code(FISSION.Category.Availability, FISSION.Status.AlreadyDone)

        Promise memory tPromise =
            promises[getPromiseIdFromVoucherId(_tokenIdVoucher)];

        if (isStatus(tStatus, IDX_REDEEM) || isStatus(tStatus, IDX_REFUND)) {
            //if redeemed or refunded
            if (!isStatus(tStatus, IDX_COMPLAIN)) {
                require(
                    block.timestamp <=
                        vouchersStatus[_tokenIdVoucher].complainPeriodStart +
                            complainPeriod +
                            cancelFaultPeriod,
                    "COFPERIOD_EXPIRED"
                ); //hex"46" FISSION.code(FISSION.Category.Availability, FISSION.Status.Expired)
                vouchersStatus[_tokenIdVoucher].complainPeriodStart = block
                    .timestamp; //resetting the complain period
            } else {
                require(
                    block.timestamp <=
                        vouchersStatus[_tokenIdVoucher].cancelFaultPeriodStart +
                            cancelFaultPeriod,
                    "COFPERIOD_EXPIRED"
                ); //hex"46" FISSION.code(FISSION.Category.Availability, FISSION.Status.Expired)
            }
        } else if (isStatus(tStatus, IDX_EXPIRE)) {
            //if expired
            if (!isStatus(tStatus, IDX_COMPLAIN)) {
                require(
                    block.timestamp <=
                        tPromise.validTo + complainPeriod + cancelFaultPeriod,
                    "COFPERIOD_EXPIRED"
                ); //hex"46" FISSION.code(FISSION.Category.Availability, FISSION.Status.Expired)
            } else {
                require(
                    block.timestamp <=
                        vouchersStatus[_tokenIdVoucher].cancelFaultPeriodStart +
                            cancelFaultPeriod,
                    "COFPERIOD_EXPIRED"
                ); //hex"46" FISSION.code(FISSION.Category.Availability, FISSION.Status.Expired)
            }
        } else if (isStateCommitted(tStatus)) {
            //if committed only
            require(
                block.timestamp <=
                    tPromise.validTo + complainPeriod + cancelFaultPeriod,
                "COFPERIOD_EXPIRED"
            ); //hex"46" FISSION.code(FISSION.Category.Availability, FISSION.Status.Expired)
            vouchersStatus[_tokenIdVoucher].complainPeriodStart = block
                .timestamp; //complain period starts
        } else {
            revert("INAPPLICABLE_STATUS"); //hex"18" FISSION.code(FISSION.Category.Permission, FISSION.Status.NotApplicableToCurrentState)
        }

        vouchersStatus[_tokenIdVoucher].status = determineStatus(
            tStatus,
            IDX_CANCEL_FAULT
        );

        emit LogVoucherFaultCancel(_tokenIdVoucher);
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
        whenNotPaused
        returns (uint256)
    {
        require(getSupplyHolder(_tokenIdSupply) == _issuer, "UNAUTHORIZED_COF");

        uint256 remQty = getRemQtyForSupply(_tokenIdSupply, _issuer);

        require(remQty > 0, "OFFER_EMPTY");

        IERC1155ERC721(tokensContract).burn(_issuer, _tokenIdSupply, remQty);

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
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
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
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        vouchersStatus[_tokenIdVoucher].isDepositsReleased = true;

        emit LogFundsReleased(_tokenIdVoucher, 1);
    }

    /**
     * @notice Mark voucher token as expired
     * @param _tokenIdVoucher   ID of the voucher token
     */
    function triggerExpiration(uint256 _tokenIdVoucher) external override {
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        Promise memory tPromise =
            promises[getPromiseIdFromVoucherId(_tokenIdVoucher)];

        if (
            tPromise.validTo < block.timestamp &&
            isStateCommitted(vouchersStatus[_tokenIdVoucher].status)
        ) {
            vouchersStatus[_tokenIdVoucher].status = determineStatus(
                vouchersStatus[_tokenIdVoucher].status,
                IDX_EXPIRE
            );

            emit LogExpirationTriggered(_tokenIdVoucher, msg.sender);
        }
    }

    /**
     * @notice Mark voucher token to the final status
     * @param _tokenIdVoucher   ID of the voucher token
     */
    function triggerFinalizeVoucher(uint256 _tokenIdVoucher) external override {
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        uint8 tStatus = vouchersStatus[_tokenIdVoucher].status;

        require(!isStatus(tStatus, IDX_FINAL), "ALREADY_FINALIZED"); //hex"48" FISSION.code(FISSION.Category.Availability, FISSION.Status.AlreadyDone)

        bool mark;
        Promise memory tPromise =
            promises[getPromiseIdFromVoucherId(_tokenIdVoucher)];

        if (isStatus(tStatus, IDX_COMPLAIN)) {
            if (isStatus(tStatus, IDX_CANCEL_FAULT)) {
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
            isStatus(tStatus, IDX_CANCEL_FAULT) &&
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

        if (mark) {
            vouchersStatus[_tokenIdVoucher].status = determineStatus(
                tStatus,
                IDX_FINAL
            );
            emit LogFinalizeVoucher(_tokenIdVoucher, msg.sender);
        }
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
        onlyOwner
    {
        require(_bosonRouterAddress != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        bosonRouterAddress = _bosonRouterAddress;

        emit LogBosonRouterSet(_bosonRouterAddress, msg.sender);
    }

    /**
     * @notice Set the address of the Cashier contract
     * @param _cashierAddress   The address of the BR contract
     */
    function setCashierAddress(address _cashierAddress)
        external
        override
        onlyOwner
    {
        require(_cashierAddress != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        cashierAddress = _cashierAddress;

        emit LogCashierSet(_cashierAddress, msg.sender);
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
        public
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
        return _tokenIdVoucher & MASK_TYPE;
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
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        uint256 tokenIdSupply = getIdSupplyFromVoucher(_tokenIdVoucher);
        return promises[ordersPromise[tokenIdSupply]].promiseId;
    }

    /**
     * @notice Get the remaining quantity left in supply of tokens (e.g ERC-721 left in ERC-1155) of an account
     * @param _tokenSupplyId  Token supply ID
     * @param _owner    holder of the Token Supply
     * @return          remaining quantity
     */
    function getRemQtyForSupply(uint256 _tokenSupplyId, address _owner)
        public
        view
        override
        returns (uint256)
    {
        return IERC1155(tokensContract).balanceOf(_owner, _tokenSupplyId);
    }

    /**
     * @notice Get all necessary funds for a supply token
     * @param _tokenIdSupply   ID of the supply token
     * @return                  returns a tuple (Payment amount, Seller's deposit, Buyer's deposit)
     */
    function getOrderCosts(uint256 _tokenIdSupply)
        public
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
        public
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
        public
        view
        override
        returns (uint256)
    {
        bytes32 promiseKey = ordersPromise[_tokenIdSupply];
        return promises[promiseKey].depositSe;
    }

    /**
     * @notice Get the current status of a voucher
     * @param _tokenIdVoucher   ID of the voucher token
     * @return                  Status of the voucher (via enum)
     */
    function getVoucherStatus(uint256 _tokenIdVoucher)
        public
        view
        override
        returns (
            uint8,
            bool,
            bool
        )
    {
        return (
            vouchersStatus[_tokenIdVoucher].status,
            vouchersStatus[_tokenIdVoucher].isPaymentReleased,
            vouchersStatus[_tokenIdVoucher].isDepositsReleased
        );
    }

    /**
     * @notice Get the holder of a voucher
     * @param _tokenIdVoucher   ID of the voucher token
     * @return                  Address of the holder
     */
    function getVoucherHolder(uint256 _tokenIdVoucher)
        public
        view
        override
        returns (address)
    {
        return IERC721(tokensContract).ownerOf(_tokenIdVoucher);
    }

    /**
     * @notice Get the holder of a supply
     * @param _tokenIdSupply        ID of a promise which is mapped to the corresponding Promise
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
     * @notice Get the address of the token where the price for the supply is held
     * @param _tokenIdSupply   ID of the voucher supply token
     * @return                  Address of the token
     */
    function getVoucherPriceToken(uint256 _tokenIdSupply)
        public
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
        public
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
        returns (uint8)
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
        require(tPromise.validFrom <= block.timestamp, "INVALID_VALIDITY_FROM"); //hex"26" FISSION.code(FISSION.Category.Find, FISSION.Status.Above_Range_Overflow)
        require(tPromise.validTo >= block.timestamp, "INVALID_VALIDITY_TO"); //hex"24" FISSION.code(FISSION.Category.Find, FISSION.Status.BelowRange_Underflow)

        return true;
    }

    /**
     * @notice Checks whether a voucher is in valid state to be transferred. If either payments or deposits are released, voucher could not be transferred
     * @param _tokenIdVoucher ID of the voucher token
     */
    function isVoucherTransferable(uint256 _tokenIdVoucher)
        public
        view
        override
        returns (bool)
    {
        return
            !(vouchersStatus[_tokenIdVoucher].isPaymentReleased ||
                vouchersStatus[_tokenIdVoucher].isDepositsReleased);
    }
}
