// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IVoucherKernel.sol";
import "./interfaces/ICashier.sol";
import {Entity, PaymentMethod, VoucherState, VoucherDetails, isStatus, determineStatus} from "./UsingHelpers.sol";


/**
 * @title Contract for managing funds
 * Roughly following OpenZeppelin's Escrow at https://github.com/OpenZeppelin/openzeppelin-solidity/contracts/payment/
 */
contract Cashier is ICashier, ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;
    using Address for address payable;
    using SafeMath for uint256;

    address private voucherKernel;
    address private bosonRouterAddress;
    address private voucherSetTokenAddress;   //ERC1155 contract representing voucher sets    
    address private voucherTokenAddress;     //ERC721 contract representing vouchers;
    bool private disasterState;

    enum PaymentType {PAYMENT, DEPOSIT_SELLER, DEPOSIT_BUYER}
    enum Role {ISSUER, HOLDER}

    mapping(address => uint256) private escrow; // both types of deposits AND payments >> can be released token-by-token if checks pass
    // slashedDepositPool can be obtained through getEscrowAmount(poolAddress)
    mapping(address => mapping(address => uint256)) private escrowTokens; //token address => mgsSender => amount

    uint256 internal constant CANCELFAULT_SPLIT = 2; //for POC purposes, this is hardcoded; e.g. each party gets depositSe / 2

    event LogBosonRouterSet(address _newBosonRouter, address _triggeredBy);

    event LogVoucherTokenContractSet(address _newTokenContract, address _triggeredBy);

    event LogVoucherSetTokenContractSet(address _newTokenContract, address _triggeredBy);

    event LogVoucherKernelSet(address _newVoucherKernel, address _triggeredBy);

    event LogWithdrawal(address _caller, address _payee, uint256 _payment);

    event LogAmountDistribution(
        uint256 indexed _tokenIdVoucher,
        address _to,
        uint256 _payment,
        PaymentType _type
    );

    event LogDisasterStateSet(bool _disasterState, address _triggeredBy);
    event LogWithdrawEthOnDisaster(uint256 _amount, address _triggeredBy);
    event LogWithdrawTokensOnDisaster(
        uint256 _amount,
        address _tokenAddress,
        address _triggeredBy
    );

    modifier onlyFromRouter() {
        require(msg.sender == bosonRouterAddress, "UNAUTHORIZED_BR");
        _;
    }

    modifier notZeroAddress(address _addressToCheck) {
        require(_addressToCheck != address(0), "0A");
        _;
    }

    /**
     * @notice The caller must be the Vouchers token contract, otherwise reverts.
     */
    modifier onlyVoucherTokenContract() {
        require(msg.sender == voucherTokenAddress, "UNAUTHORIZED_VOUCHER_TOKEN_ADDRESS"); // Unauthorized token address
        _;
    }

     /**
     * @notice The caller must be the Voucher Sets token contract, otherwise reverts.
     */
    modifier onlyVoucherSetTokenContract() {
        require(msg.sender == voucherSetTokenAddress, "UNAUTHORIZED_VOUCHER_SET_TOKEN_ADDRESS"); // Unauthorized token address
        _;
    }

    /**
     * @notice Construct and initialze the contract. Iniialises associated contract addresses. Iniialises disaster state to false.    
     * @param _bosonRouterAddress address of the associated BosonRouter contract
     * @param _voucherKernel address of the associated VocherKernal contract instance
     * @param _voucherSetTokenAddress address of the associated ERC1155 contract instance
     * @param _voucherTokenAddress address of the associated ERC721 contract instance

     */
    constructor(address _bosonRouterAddress, address _voucherKernel, address _voucherSetTokenAddress, address _voucherTokenAddress) 
        notZeroAddress(_bosonRouterAddress)
        notZeroAddress(_voucherKernel)
        notZeroAddress(_voucherSetTokenAddress)
        notZeroAddress(_voucherTokenAddress)
    {
        bosonRouterAddress = _bosonRouterAddress;
        voucherKernel = _voucherKernel;
        voucherSetTokenAddress = _voucherSetTokenAddress;
        voucherTokenAddress = _voucherTokenAddress;
        emit LogBosonRouterSet(_bosonRouterAddress, msg.sender);
        emit LogVoucherKernelSet(_voucherKernel, msg.sender);
        emit LogVoucherSetTokenContractSet(_voucherSetTokenAddress, msg.sender);
        emit LogVoucherTokenContractSet(_voucherTokenAddress, msg.sender);
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
     * @notice If once disaster state has been set to true, the contract could never be unpaused.
     */
    function canUnpause() external view override returns (bool) {
        return !disasterState;
    }

    /**
     * @notice Once this functions is triggered, contracts cannot be unpaused anymore
     * Only BR contract is in control of this function.
     */
    function setDisasterState() external onlyOwner whenPaused {
        require(!disasterState, "Disaster state is already set");
        disasterState = true;
        emit LogDisasterStateSet(disasterState, msg.sender);
    }

    /**
     * @notice In case of a disaster this function allow the caller to withdraw all pooled funds kept in the escrow for the address provided. Funds are sent in ETH
     */
    function withdrawEthOnDisaster() external whenPaused nonReentrant {
        require(disasterState, "Owner did not allow manual withdraw");

        uint256 amount = escrow[msg.sender];

        require(amount > 0, "ESCROW_EMPTY");
        escrow[msg.sender] = 0;
        msg.sender.sendValue(amount);

        emit LogWithdrawEthOnDisaster(amount, msg.sender);
    }

    /**
     * @notice In case of a disaster this function allow the caller to withdraw all pooled funds kept in the escrowTokens for the address provided.
     * @param _token address of a token, that the caller sent the funds, while interacting with voucher or voucher-set
     */
    function withdrawTokensOnDisaster(address _token)
        external
        whenPaused
        nonReentrant
        notZeroAddress(_token)
    {
        require(disasterState, "Owner did not allow manual withdraw");

        uint256 amount = escrowTokens[_token][msg.sender];
        require(amount > 0, "ESCROW_EMPTY");
        escrowTokens[_token][msg.sender] = 0;

        SafeERC20.safeTransfer(IERC20(_token), msg.sender, amount);
        emit LogWithdrawTokensOnDisaster(amount, _token, msg.sender);
    }

    /**
     * @notice Trigger withdrawals of what funds are releasable
     * The caller of this function triggers transfers to all involved entities (pool, issuer, token holder), also paying for gas.
     * @param _tokenIdVoucher  ID of a voucher token (ERC-721) to try withdraw funds from
     */
    function withdraw(uint256 _tokenIdVoucher)
        external
        override
        nonReentrant
        whenNotPaused
    {
        bool released = distributeAndWithdraw(_tokenIdVoucher, Entity.ISSUER);
        released = distributeAndWithdraw(_tokenIdVoucher, Entity.HOLDER) || released;
        released = distributeAndWithdraw(_tokenIdVoucher, Entity.POOL) || released;
        require (released, "NOTHING_TO_WITHDRAW");
    }

    /**
     * @notice Trigger withdrawals of what funds are releasable for chosen entity {ISSUER, HOLDER, POOL}
     * @param _tokenIdVoucher  ID of a voucher token (ERC-721) to try withdraw funds from
     * @param _to               recipient, one of {ISSUER, HOLDER, POOL}
     */
     function withdrawSingle(uint256 _tokenIdVoucher, Entity _to)
        external
        override
        nonReentrant
        whenNotPaused
    {
        require (distributeAndWithdraw(_tokenIdVoucher, _to),
            "NOTHING_TO_WITHDRAW");

    }

    /**
     * @notice Calcuate how much should entity receive and transfer funds to its address
     * @param _tokenIdVoucher  ID of a voucher token (ERC-721) to try withdraw funds from
     * @param _to recipient, one of {ISSUER, HOLDER, POOL}
     */
    function distributeAndWithdraw(uint256 _tokenIdVoucher, Entity _to)
        internal
        returns (bool)
    {
        VoucherDetails memory voucherDetails;

        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID");

        voucherDetails.tokenIdVoucher = _tokenIdVoucher;
        voucherDetails.tokenIdSupply = IVoucherKernel(voucherKernel)
            .getIdSupplyFromVoucher(voucherDetails.tokenIdVoucher);
        voucherDetails.paymentMethod = IVoucherKernel(voucherKernel)
            .getVoucherPaymentMethod(voucherDetails.tokenIdSupply);

        (
            voucherDetails.currStatus.status,
            voucherDetails.currStatus.isPaymentReleased,
            voucherDetails.currStatus.isDepositsReleased,
            ,
        ) = IVoucherKernel(voucherKernel).getVoucherStatus(
            voucherDetails.tokenIdVoucher
        );

        (
            voucherDetails.price,
            voucherDetails.depositSe,
            voucherDetails.depositBu
        ) = IVoucherKernel(voucherKernel).getOrderCosts(
            voucherDetails.tokenIdSupply
        );

        voucherDetails.issuer = payable(
            IVoucherKernel(voucherKernel).getVoucherSeller(
                _tokenIdVoucher
            )
        );
        voucherDetails.holder = payable(
            IVoucherKernel(voucherKernel).getVoucherHolder(
                voucherDetails.tokenIdVoucher
            )
        );

        bool paymentReleased;
        //process the RELEASE OF PAYMENTS - only depends on the redeemed/not-redeemed, a voucher need not be in the final status
        if (!voucherDetails.currStatus.isPaymentReleased) {
            paymentReleased = releasePayments(voucherDetails, _to);
        }

        //process the RELEASE OF DEPOSITS - only when vouchers are in the FINAL status
        bool depositReleased;
        uint256 releasedAmount;
        if (
            !IVoucherKernel(voucherKernel).isDepositReleased(_tokenIdVoucher, _to) &&
            isStatus(voucherDetails.currStatus.status, VoucherState.FINAL)
        ) {
            (depositReleased, releasedAmount) = releaseDeposits(voucherDetails, _to);
        }

        // WITHDRAW
        if (paymentReleased) {
            _withdrawPayments(
                _to == Entity.ISSUER ? voucherDetails.issuer : voucherDetails.holder,
                voucherDetails.price,
                voucherDetails.paymentMethod,
                voucherDetails.tokenIdSupply
            );
        }
                    
        if (depositReleased) {
            _withdrawDeposits(
                _to == Entity.ISSUER ? voucherDetails.issuer : _to == Entity.HOLDER ? voucherDetails.holder : owner(),
                releasedAmount,
                voucherDetails.paymentMethod,
                voucherDetails.tokenIdSupply
            );
        }

        return paymentReleased || depositReleased;
    }

    /**
     * @notice Release of payments, for a voucher which payments had not been released already.
     * Based on the voucher status(e.g. redeemed, refunded, etc), the voucher price will be sent to either buyer or seller.
     * @param _voucherDetails keeps all required information of the voucher which the payment should be released for.
     * @param _to             recipient, one of {ISSUER, HOLDER, POOL}
     */
    function releasePayments(VoucherDetails memory _voucherDetails, Entity _to) internal returns (bool){
        if (_to == Entity.ISSUER &&
            isStatus(_voucherDetails.currStatus.status, VoucherState.REDEEM)) {
            releasePayment(_voucherDetails, Role.ISSUER);
            return true;
        } 
        
        if (
            _to == Entity.HOLDER &&
            (isStatus(_voucherDetails.currStatus.status, VoucherState.REFUND) ||
            isStatus(_voucherDetails.currStatus.status, VoucherState.EXPIRE) ||
            (isStatus(_voucherDetails.currStatus.status, VoucherState.CANCEL_FAULT) &&
                !isStatus(_voucherDetails.currStatus.status, VoucherState.REDEEM)))
        ) { 
            releasePayment(_voucherDetails, Role.HOLDER);
            return true;
        }
        return false;
    }

    /**
     * @notice Following function `releasePayments`, if certain conditions for the voucher status are met, the voucher price will be sent to the seller or the buyer
     * @param _voucherDetails keeps all required information of the voucher which the payment should be released for.
     */
    function releasePayment(VoucherDetails memory _voucherDetails, Role _role) internal {
        if (
            _voucherDetails.paymentMethod == PaymentMethod.ETHETH ||
            _voucherDetails.paymentMethod == PaymentMethod.ETHTKN
        ) {
            escrow[_voucherDetails.holder] = escrow[_voucherDetails.holder].sub(
                _voucherDetails.price
            );
        }

        if (
            _voucherDetails.paymentMethod == PaymentMethod.TKNETH ||
            _voucherDetails.paymentMethod == PaymentMethod.TKNTKN
        ) {
            address addressTokenPrice =
                IVoucherKernel(voucherKernel).getVoucherPriceToken(
                    _voucherDetails.tokenIdSupply
                );

            escrowTokens[addressTokenPrice][
                _voucherDetails.holder
            ] = escrowTokens[addressTokenPrice][_voucherDetails.holder].sub(
                _voucherDetails.price
            );
        }

        IVoucherKernel(voucherKernel).setPaymentReleased(
            _voucherDetails.tokenIdVoucher
        );

        emit LogAmountDistribution(
            _voucherDetails.tokenIdVoucher,
            _role == Role.ISSUER ? _voucherDetails.issuer : _voucherDetails.holder,
            _voucherDetails.price,
            PaymentType.PAYMENT
        );
    }

    /**
     * @notice Release of deposits, for a voucher which deposits had not been released already, and had been marked as `finalized`
     * Based on the voucher status(e.g. complained, redeemed, refunded, etc), the voucher deposits will be sent to either buyer, seller, or pool owner.
     * Depending on the payment type (e.g ETH, or Token) escrow funds will be held in the `escrow` || escrowTokens mappings
     * @param _voucherDetails keeps all required information of the voucher which the deposits should be released for.
     * @param _to             recipient, one of {ISSUER, HOLDER, POOL}
     */
    function releaseDeposits(VoucherDetails memory _voucherDetails, Entity _to) internal returns (bool _released, uint256 _amount){
        //first, depositSe
        if (isStatus(_voucherDetails.currStatus.status, VoucherState.COMPLAIN)) {
            //slash depositSe
            _amount = distributeIssuerDepositOnHolderComplain(_voucherDetails, _to);
            
        } else if(_to != Entity.POOL) {
            if (                
                isStatus(_voucherDetails.currStatus.status, VoucherState.CANCEL_FAULT)) {
                //slash depositSe
                _amount = distributeIssuerDepositOnIssuerCancel(_voucherDetails, _to);
            } else if (_to == Entity.ISSUER) { // happy path, seller gets the whole seller deposit
                //release depositSe
                _amount = distributeFullIssuerDeposit(_voucherDetails);
            }
            
        }

        //second, depositBu
        if (            
            isStatus(_voucherDetails.currStatus.status, VoucherState.REDEEM) ||
            isStatus(_voucherDetails.currStatus.status, VoucherState.CANCEL_FAULT)
        ) {
            //release depositBu
            if (_to == Entity.HOLDER) {
            _amount = _amount.add(distributeFullHolderDeposit(_voucherDetails));
            }
        } else if (_to == Entity.POOL){
            //slash depositBu
            _amount = _amount.add(distributeHolderDepositOnNotRedeemedNotCancelled(_voucherDetails));
        }

        _released = _amount > 0;

        if (_released) {
            IVoucherKernel(voucherKernel).setDepositsReleased(
                _voucherDetails.tokenIdVoucher, _to, _amount
            );
        }
    }

    /**
     * @notice Release of deposits, for a voucher which deposits had not been released already, and had been marked as `finalized`
     * Based on the voucher status(e.g. complained, redeemed, refunded, etc), the voucher deposits will be sent to either buyer, seller, or pool owner.
     * Depending on the payment type (e.g ETH, or Token) escrow funds will be held in the `escrow` || escrowTokens mappings
     * @param _paymentMethod payment method that should be used to determine, how to do the payouts
     * @param _entity        address which ecrows is reduced
     * @param _amount        amount to be released from escrow
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) which will be burned and deposits will be returned for
     */
    function reduceEscrowAmountDeposits(PaymentMethod _paymentMethod, address _entity, uint256 _amount, uint256 _tokenIdSupply) internal {
            if (
                _paymentMethod == PaymentMethod.ETHETH ||
                _paymentMethod == PaymentMethod.TKNETH
            ) {
                escrow[_entity] = escrow[_entity]
                    .sub(_amount);
            }

            if (
                _paymentMethod == PaymentMethod.ETHTKN ||
                _paymentMethod == PaymentMethod.TKNTKN
            ) {
                address addressTokenDeposits =
                    IVoucherKernel(voucherKernel).getVoucherDepositToken(
                        _tokenIdSupply
                    );

                escrowTokens[addressTokenDeposits][
                    _entity
                ] = escrowTokens[addressTokenDeposits][_entity]
                    .sub(_amount);
            }
    }

    /**
     * @notice Following function `releaseDeposits` this function will be triggered if a voucher had been complained by the buyer.
     * Also checks if the voucher had been cancelled
     * @param _voucherDetails keeps all required information of the voucher which the payment should be released for.
     * @param _to             recipient, one of {ISSUER, HOLDER, POOL}
     */
    function distributeIssuerDepositOnHolderComplain(
        VoucherDetails memory _voucherDetails,
        Entity _to
    ) internal 
        returns (uint256){
        uint256 toDistribute;
        address recipient;
        if (isStatus(_voucherDetails.currStatus.status, VoucherState.CANCEL_FAULT)) {
            //appease the conflict three-ways
            uint256 tFraction = _voucherDetails.depositSe.div(CANCELFAULT_SPLIT);


            if (_to == Entity.HOLDER) { //Bu gets, say, a half                
                toDistribute = tFraction;
                recipient = _voucherDetails.holder;
            } else if (_to == Entity.ISSUER) {  //Se gets, say, a quarter
                toDistribute = tFraction.div(CANCELFAULT_SPLIT);
                recipient = _voucherDetails.issuer;
            } else { //slashing the rest
                toDistribute = (_voucherDetails.depositSe.sub(tFraction)).sub(
                    tFraction.div(CANCELFAULT_SPLIT)
                );
                recipient = owner();
            }

        } else if (_to == Entity.POOL){
            //slash depositSe
            toDistribute = _voucherDetails.depositSe;
            recipient = owner();
        } else {
            return 0;
        }

        reduceEscrowAmountDeposits(_voucherDetails.paymentMethod, _voucherDetails.issuer, toDistribute, _voucherDetails.tokenIdSupply);

        emit LogAmountDistribution(
            _voucherDetails.tokenIdVoucher,
            recipient,
            toDistribute,
            PaymentType.DEPOSIT_SELLER
        );

        return toDistribute;
    }

    /**
     * @notice Following function `releaseDeposits` this function will be triggered if a voucher had been cancelled by the seller.
     * Will be triggered if the voucher had not been complained.
     * @param _voucherDetails keeps all required information of the voucher which the deposits should be released for.
     * @param _to             recipient, one of {ISSUER, HOLDER, POOL}
     */
    function distributeIssuerDepositOnIssuerCancel(
        VoucherDetails memory _voucherDetails,
        Entity _to
    ) internal 
        returns (uint256)
    {
        uint256 toDistribute;
        address recipient;
        if (_to == Entity.HOLDER) { //Bu gets, say, a half                
        toDistribute = _voucherDetails.depositSe.sub(
                _voucherDetails.depositSe.div(CANCELFAULT_SPLIT)
            );
            recipient = _voucherDetails.holder;
        } else {  //Se gets, say, a half
            toDistribute = _voucherDetails.depositSe.div(CANCELFAULT_SPLIT);
            recipient = _voucherDetails.issuer;
        } 

        reduceEscrowAmountDeposits(_voucherDetails.paymentMethod, _voucherDetails.issuer, toDistribute, _voucherDetails.tokenIdSupply);

        emit LogAmountDistribution(
            _voucherDetails.tokenIdVoucher,
            recipient,
            toDistribute,
            PaymentType.DEPOSIT_SELLER
        );

        return toDistribute;   
    }

    /**
     * @notice Following function `releaseDeposits` this function will be triggered if no complain, nor cancel had been made.
     * All seller deposit is returned to seller.
     * @param _voucherDetails keeps all required information of the voucher which the deposits should be released for.
     */
    function distributeFullIssuerDeposit(VoucherDetails memory _voucherDetails)
        internal returns (uint256)
    {
        reduceEscrowAmountDeposits(_voucherDetails.paymentMethod, _voucherDetails.issuer, _voucherDetails.depositSe, _voucherDetails.tokenIdSupply);
      
        emit LogAmountDistribution(
            _voucherDetails.tokenIdVoucher,
            _voucherDetails.issuer,
            _voucherDetails.depositSe,
            PaymentType.DEPOSIT_SELLER
        );

        return _voucherDetails.depositSe;
    }

    /**
     * @notice Following function `releaseDeposits` this function will be triggered if voucher had been redeemed, or the seller had cancelled.
     * All buyer deposit is returned to buyer.
     * @param _voucherDetails keeps all required information of the voucher which the deposits should be released for.
     */
    function distributeFullHolderDeposit(VoucherDetails memory _voucherDetails)
        internal
        returns (uint256)
    {
        reduceEscrowAmountDeposits(_voucherDetails.paymentMethod, _voucherDetails.holder, _voucherDetails.depositBu, _voucherDetails.tokenIdSupply);
        
        emit LogAmountDistribution(
            _voucherDetails.tokenIdVoucher,
            _voucherDetails.holder,
            _voucherDetails.depositBu,
            PaymentType.DEPOSIT_BUYER
        );

        return _voucherDetails.depositBu;
    }

    /**
     * @notice Following function `releaseDeposits` this function will be triggered if voucher had not been redeemed or cancelled after finalization.
     * @param _voucherDetails keeps all required information of the voucher which the deposits should be released for.
     * All buyer deposit goes to Boson.
     */
    function distributeHolderDepositOnNotRedeemedNotCancelled(
        VoucherDetails memory _voucherDetails        
    ) internal returns (uint256){
        reduceEscrowAmountDeposits(_voucherDetails.paymentMethod, _voucherDetails.holder, _voucherDetails.depositBu, _voucherDetails.tokenIdSupply);       

        emit LogAmountDistribution(
            _voucherDetails.tokenIdVoucher,
            owner(),
            _voucherDetails.depositBu,
            PaymentType.DEPOSIT_BUYER
        );

        return _voucherDetails.depositBu;
    }

    /**
     * @notice External function for withdrawing deposits. Caller must be the seller of the goods, otherwise reverts.
     * @notice Seller triggers withdrawals of remaining deposits for a given supply, in case the voucher set is no longer in exchange.
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) which will be burned and deposits will be returned for
     * @param _burnedQty burned quantity that the deposits should be withdrawn for
     * @param _messageSender owner of the voucher set
     */
    function withdrawDepositsSe(
        uint256 _tokenIdSupply,
        uint256 _burnedQty,
        address payable _messageSender
    ) external override nonReentrant onlyFromRouter notZeroAddress(_messageSender) {
        require(IVoucherKernel(voucherKernel).getSupplyHolder(_tokenIdSupply) == _messageSender, "UNAUTHORIZED_V");

        uint256 deposit =
            IVoucherKernel(voucherKernel).getSellerDeposit(_tokenIdSupply);

        uint256 depositAmount = deposit.mul(_burnedQty);

        PaymentMethod paymentMethod =
            IVoucherKernel(voucherKernel).getVoucherPaymentMethod(
                _tokenIdSupply
            );

        if (paymentMethod == PaymentMethod.ETHETH || paymentMethod == PaymentMethod.TKNETH) {
            escrow[_messageSender] = escrow[_messageSender].sub(depositAmount);
        }

        if (paymentMethod == PaymentMethod.ETHTKN || paymentMethod == PaymentMethod.TKNTKN) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    _tokenIdSupply
                );

            escrowTokens[addressTokenDeposits][_messageSender] = escrowTokens[
                addressTokenDeposits
            ][_messageSender]
                .sub(depositAmount);
        }

        _withdrawDeposits(
            _messageSender,
            depositAmount,
            paymentMethod,
            _tokenIdSupply
        );
    }

    /**
     * @notice Internal function for withdrawing payments.
     * As unbelievable as it is, neither .send() nor .transfer() are now secure to use due to EIP-1884
     *  So now transferring funds via the last remaining option: .call()
     *  See https://diligence.consensys.net/posts/2019/09/stop-using-soliditys-transfer-now/
     * @param _recipient    address of the account receiving funds from the escrow
     * @param _amount       amount to be released from escrow
     * @param _paymentMethod payment method that should be used to determine, how to do the payouts
     * @param _tokenIdSupply       _tokenIdSupply of the voucher set this is related to
     */
    function _withdrawPayments(
        address _recipient,
        uint256 _amount,
        PaymentMethod _paymentMethod,
        uint256 _tokenIdSupply
    ) internal
      notZeroAddress(_recipient)
    {
        if (_paymentMethod == PaymentMethod.ETHETH || _paymentMethod == PaymentMethod.ETHTKN) {
            payable(_recipient).sendValue(_amount);
            emit LogWithdrawal(msg.sender, _recipient, _amount);
        }

        if (_paymentMethod == PaymentMethod.TKNETH || _paymentMethod == PaymentMethod.TKNTKN) {
            address addressTokenPrice =
                IVoucherKernel(voucherKernel).getVoucherPriceToken(
                    _tokenIdSupply
                );

            SafeERC20.safeTransfer(
                IERC20(addressTokenPrice),
                _recipient,
                _amount
            );
        }
    }

    /**
     * @notice Internal function for withdrawing deposits.
     * @param _recipient    address of the account receiving funds from the escrow
     * @param _amount       amount to be released from escrow
     * @param _paymentMethod       payment method that should be used to determine, how to do the payouts
     * @param _tokenIdSupply       _tokenIdSupply of the voucher set this is related to
     */
    function _withdrawDeposits(
        address _recipient,
        uint256 _amount,
        PaymentMethod _paymentMethod,
        uint256 _tokenIdSupply
    ) internal    
      notZeroAddress(_recipient)
    {
        require(_amount > 0, "NO_FUNDS_TO_WITHDRAW");

        if (_paymentMethod == PaymentMethod.ETHETH || _paymentMethod == PaymentMethod.TKNETH) {
            payable(_recipient).sendValue(_amount);
            emit LogWithdrawal(msg.sender, _recipient, _amount);
        }

        if (_paymentMethod == PaymentMethod.ETHTKN || _paymentMethod == PaymentMethod.TKNTKN) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    _tokenIdSupply
                );

            SafeERC20.safeTransfer(
                IERC20(addressTokenDeposits),
                _recipient,
                _amount
            );
        }
    }

    /**
     * @notice Set the address of the BR contract
     * @param _bosonRouterAddress   The address of the Boson Route contract
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
     * @notice Update the amount in escrow of an address with the new value, based on VoucherSet/Voucher interaction
     * @param _account  The address of an account to update
     */
    function addEscrowAmount(address _account)
        external
        override
        payable
        onlyFromRouter
    {
        escrow[_account] = escrow[_account].add(msg.value);
    }

    /**
     * @notice Update the amount in escrowTokens of an address with the new value, based on VoucherSet/Voucher interaction
     * @param _token  The address of a token to query
     * @param _account  The address of an account to query
     * @param _newAmount  New amount to be set
     */
    function addEscrowTokensAmount(
        address _token,
        address _account,
        uint256 _newAmount
    ) external override onlyFromRouter {
        escrowTokens[_token][_account] =  escrowTokens[_token][_account].add(_newAmount);
    }

    /**
     * @notice Hook which will be triggered when a _tokenIdVoucher will be transferred. Escrow funds should be allocated to the new owner.
     * @param _from prev owner of the _tokenIdVoucher
     * @param _to next owner of the _tokenIdVoucher
     * @param _tokenIdVoucher _tokenIdVoucher that has been transferred
     */
    function onVoucherTransfer(
        address _from,
        address _to,
        uint256 _tokenIdVoucher
    ) external override nonReentrant onlyVoucherTokenContract {
        address tokenAddress;

        uint256 tokenSupplyId =
            IVoucherKernel(voucherKernel).getIdSupplyFromVoucher(
                _tokenIdVoucher
            );

        PaymentMethod paymentType =
            IVoucherKernel(voucherKernel).getVoucherPaymentMethod(
                tokenSupplyId
            );

        (uint256 price, uint256 depositBu) =
            IVoucherKernel(voucherKernel).getBuyerOrderCosts(tokenSupplyId);

        if (paymentType == PaymentMethod.ETHETH) {
            uint256 totalAmount = price.add(depositBu);

            //Reduce _from escrow amount and increase _to escrow amount
            escrow[_from] = escrow[_from].sub(totalAmount);
            escrow[_to] = escrow[_to].add(totalAmount);
        }

        if (paymentType == PaymentMethod.ETHTKN) {
            //Reduce _from escrow amount and increase _to escrow amount - price
            escrow[_from] = escrow[_from].sub(price);
            escrow[_to] = escrow[_to].add(price);

            tokenAddress = IVoucherKernel(voucherKernel).getVoucherDepositToken(
                tokenSupplyId
            );

            //Reduce _from escrow token amount and increase _to escrow token amount - deposit
            escrowTokens[tokenAddress][_from] = escrowTokens[tokenAddress][_from].sub(depositBu);
            escrowTokens[tokenAddress][_to] = escrowTokens[tokenAddress][_to].add(depositBu);

        }

        if (paymentType == PaymentMethod.TKNETH) {
            tokenAddress = IVoucherKernel(voucherKernel).getVoucherPriceToken(
                tokenSupplyId
            );        

            //Reduce _from escrow token amount and increase _to escrow token amount - price 
            escrowTokens[tokenAddress][_from] = escrowTokens[tokenAddress][_from].sub(price);
            escrowTokens[tokenAddress][_to] = escrowTokens[tokenAddress][_to].add(price);

            //Reduce _from escrow amount and increase _to escrow amount - deposit
            escrow[_from] = escrow[_from].sub(depositBu);
            escrow[_to] = escrow[_to].add(depositBu);
        }

        if (paymentType == PaymentMethod.TKNTKN) {
            tokenAddress = IVoucherKernel(voucherKernel).getVoucherPriceToken(
                tokenSupplyId
            );

            //Reduce _from escrow token amount and increase _to escrow token amount - price 
            escrowTokens[tokenAddress][_from] = escrowTokens[tokenAddress][_from].sub(price);
            escrowTokens[tokenAddress][_to] = escrowTokens[tokenAddress][_to].add(price);

            tokenAddress = IVoucherKernel(voucherKernel).getVoucherDepositToken(
                tokenSupplyId
            );

            //Reduce _from escrow token amount and increase _to escrow token amount - deposit 
            escrowTokens[tokenAddress][_from] = escrowTokens[tokenAddress][_from].sub(depositBu);
            escrowTokens[tokenAddress][_to] = escrowTokens[tokenAddress][_to].add(depositBu);

        }
    }

    /**
     * @notice After the transfer happens the _tokenSupplyId should be updated in the promise. Escrow funds for the seller's deposits (If in ETH) should be allocated to the new owner as well.
     * @param _from prev owner of the _tokenSupplyId
     * @param _to nex owner of the _tokenSupplyId
     * @param _tokenSupplyId _tokenSupplyId for transfer
     * @param _value qty which has been transferred
     */
    function onVoucherSetTransfer(
        address _from,
        address _to,
        uint256 _tokenSupplyId,
        uint256 _value
    ) external override nonReentrant onlyVoucherSetTokenContract {
        PaymentMethod paymentType =
            IVoucherKernel(voucherKernel).getVoucherPaymentMethod(
                _tokenSupplyId
            );

        uint256 depositSe;
        uint256 totalAmount;

        if (paymentType == PaymentMethod.ETHETH || paymentType == PaymentMethod.TKNETH) {
            depositSe = IVoucherKernel(voucherKernel).getSellerDeposit(
                _tokenSupplyId
            );
            totalAmount = depositSe.mul(_value);

            //Reduce _from escrow amount and increase _to escrow amount
            escrow[_from] = escrow[_from].sub(totalAmount);
            escrow[_to] = escrow[_to].add(totalAmount);
        }

        if (paymentType == PaymentMethod.ETHTKN || paymentType == PaymentMethod.TKNTKN) {
            address tokenDepositAddress =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    _tokenSupplyId
                );

            depositSe = IVoucherKernel(voucherKernel).getSellerDeposit(
                _tokenSupplyId
            );
            totalAmount = depositSe.mul(_value);

            //Reduce _from escrow token amount and increase _to escrow token amount - deposit
            escrowTokens[tokenDepositAddress][_from] = escrowTokens[tokenDepositAddress][_from].sub(totalAmount);
            escrowTokens[tokenDepositAddress][_to] = escrowTokens[tokenDepositAddress][_to].add(totalAmount);
        }

        IVoucherKernel(voucherKernel).setSupplyHolderOnTransfer(
            _tokenSupplyId,
            _to
        );
    }

    // // // // // // // //
    // GETTERS
    // // // // // // // //

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
     * @notice Get the address of Boson Router contract
     * @return Address of Boson Router contract
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

    /**
     * @notice Ensure whether or not contract has been set to disaster state 
     * @return disasterState
     */
    function isDisasterStateSet() external view override returns(bool) {
        return disasterState;
    }

    /**
     * @notice Get the amount in escrow of an address
     * @param _account  The address of an account to query
     * @return          The balance in escrow
     */
    function getEscrowAmount(address _account)
        external
        view
        override
        returns (uint256)
    {
        return escrow[_account];
    }

    /**
     * @notice Get the amount in escrow of an address
     * @param _token  The address of a token to query
     * @param _account  The address of an account to query
     * @return          The balance in escrow
     */
    function getEscrowTokensAmount(address _token, address _account)
        external
        view
        override
        returns (uint256)
    {
        return escrowTokens[_token][_account];
    }

    /**
     * @notice Set the address of the VoucherKernel contract
     * @param _voucherKernelAddress   The address of the VoucherKernel contract
     */
    function setVoucherKernelAddress(address _voucherKernelAddress)
        external
        override
        onlyOwner
        notZeroAddress(_voucherKernelAddress)
        whenPaused
    {
        voucherKernel = _voucherKernelAddress;

        emit LogVoucherKernelSet(_voucherKernelAddress, msg.sender);
    }
}
