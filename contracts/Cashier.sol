// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.1;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IVoucherKernel.sol";
import "./interfaces/IERC20WithPermit.sol";
import "./interfaces/ICashier.sol";
import "./UsingHelpers.sol";

/**
 * @title Contract for managing funds
 * Roughly following OpenZeppelin's Escrow at https://github.com/OpenZeppelin/openzeppelin-solidity/contracts/payment/
 */
contract Cashier is ICashier, UsingHelpers, ReentrancyGuard, Ownable, Pausable {
    using Address for address payable;
    using SafeMath for uint256;

    address public voucherKernel;
    address public bosonRouterAddress;
    bool public disasterState;

    enum PaymentType {PAYMENT, DEPOSIT_SELLER, DEPOSIT_BUYER}

    mapping(address => uint256) public escrow; // both types of deposits AND payments >> can be released token-by-token if checks pass
    // slashedDepositPool can be obtained through getEscrowAmount(poolAddress)
    mapping(address => mapping(address => uint256)) public escrowTokens; //token address => mgsSender => amount

    uint256 internal constant CANCELFAULT_SPLIT = 2; //for POC purposes, this is hardcoded; e.g. each party gets depositSe / 2

    event LogBosonRouterSet(address _newBosonRouter, address _triggeredBy);

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
        require(bosonRouterAddress != address(0), "UNSPECIFIED_BR"); // hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(msg.sender == bosonRouterAddress, "UNAUTHORIZED_BR"); // hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        _;
    }

    modifier notZeroAddress(address tokenAddress) {
        require(tokenAddress != address(0), "INVALID_TOKEN_ADDRESS");
        _;
    }

    constructor(address _voucherKernel) {
        voucherKernel = _voucherKernel;
        disasterState = false;
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
        disasterState = true;
        LogDisasterStateSet(disasterState, msg.sender);
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

        LogWithdrawEthOnDisaster(amount, msg.sender);
    }

    /**
     * @notice In case of a disaster this function allow the caller to withdraw all pooled funds kept in the escrowTokens for the address provided.
     * @param token address of a token, that the caller sent the funds, while interacting with voucher or voucher-set
     */
    function withdrawTokensOnDisaster(address token)
        external
        whenPaused
        nonReentrant
        notZeroAddress(token)
    {
        require(disasterState, "Owner did not allow manual withdraw");

        uint256 amount = escrowTokens[token][msg.sender];
        require(amount > 0, "ESCROW_EMPTY");
        escrowTokens[token][msg.sender] = 0;

        IERC20WithPermit(token).transfer(msg.sender, amount);
        LogWithdrawTokensOnDisaster(amount, token, msg.sender);
    }

    /**
     * @notice Trigger withdrawals of what funds are releasable
     * The caller of this function triggers transfers to all involved entities (pool, issuer, token holder), also paying for gas.
     * @dev This function would be optimized a lot, here verbose for readability.
     * @param _tokenIdVoucher  ID of a voucher token (ERC-721) to try withdraw funds from
     */
    function withdraw(uint256 _tokenIdVoucher)
        external
        override
        nonReentrant
        whenNotPaused
    {
        //TODO: more checks
        //TODO: check to pass 2 diff holders and how the amounts will be distributed

        VoucherDetails memory voucherDetails;

        //in the future might want to (i) check the gasleft() (but UNGAS proposal might make it impossible), and/or (ii) set upper loop limit to sth like .length < 2**15
        require(_tokenIdVoucher != 0, "UNSPECIFIED_ID"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        voucherDetails.tokenIdVoucher = _tokenIdVoucher;
        voucherDetails.tokenIdSupply = IVoucherKernel(voucherKernel)
            .getIdSupplyFromVoucher(voucherDetails.tokenIdVoucher);
        voucherDetails.paymentMethod = IVoucherKernel(voucherKernel)
            .getVoucherPaymentMethod(voucherDetails.tokenIdSupply);

        require(
            voucherDetails.paymentMethod > 0 &&
                voucherDetails.paymentMethod <= 4,
            "INVALID PAYMENT METHOD"
        );

        (
            voucherDetails.currStatus.status,
            voucherDetails.currStatus.isPaymentReleased,
            voucherDetails.currStatus.isDepositsReleased
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
            IVoucherKernel(voucherKernel).getSupplyHolder(
                voucherDetails.tokenIdSupply
            )
        );
        voucherDetails.holder = payable(
            IVoucherKernel(voucherKernel).getVoucherHolder(
                voucherDetails.tokenIdVoucher
            )
        );

        //process the RELEASE OF PAYMENTS - only depends on the redeemed/not-redeemed, a voucher need not be in the final status
        if (!voucherDetails.currStatus.isPaymentReleased) {
            releasePayments(voucherDetails);
        }

        //process the RELEASE OF DEPOSITS - only when vouchers are in the FINAL status
        if (
            !voucherDetails.currStatus.isDepositsReleased &&
            isStatus(voucherDetails.currStatus.status, IDX_FINAL)
        ) {
            releaseDeposits(voucherDetails);
        }

        if (voucherDetails.deposit2pool > 0) {
            _withdrawDeposits(
                owner(),
                voucherDetails.deposit2pool,
                voucherDetails.paymentMethod,
                voucherDetails.tokenIdSupply
            );
        }

        if (voucherDetails.price2issuer > 0) {
            _withdrawPayments(
                voucherDetails.issuer,
                voucherDetails.price2issuer,
                voucherDetails.paymentMethod,
                voucherDetails.tokenIdSupply
            );
        }

        if (voucherDetails.deposit2issuer > 0) {
            _withdrawDeposits(
                voucherDetails.issuer,
                voucherDetails.deposit2issuer,
                voucherDetails.paymentMethod,
                voucherDetails.tokenIdSupply
            );
        }

        if (voucherDetails.price2holder > 0) {
            _withdrawPayments(
                voucherDetails.holder,
                voucherDetails.price2holder,
                voucherDetails.paymentMethod,
                voucherDetails.tokenIdSupply
            );
        }

        if (voucherDetails.deposit2holder > 0) {
            _withdrawDeposits(
                voucherDetails.holder,
                voucherDetails.deposit2holder,
                voucherDetails.paymentMethod,
                voucherDetails.tokenIdSupply
            );
        }

        delete voucherDetails;
    }

    /**
     * @notice Release of payments, for a voucher which payments had not been released already.
     * Based on the voucher status(e.g. redeemed, refunded, etc), the voucher price will be sent to either buyer or seller.
     * @param voucherDetails keeps all required information of the voucher which the payment should be released for.
     */
    function releasePayments(VoucherDetails memory voucherDetails) internal {
        if (isStatus(voucherDetails.currStatus.status, IDX_REDEEM)) {
            releasePaymentToSeller(voucherDetails);
        } else if (
            isStatus(voucherDetails.currStatus.status, IDX_REFUND) ||
            isStatus(voucherDetails.currStatus.status, IDX_EXPIRE) ||
            (isStatus(voucherDetails.currStatus.status, IDX_CANCEL_FAULT) &&
                !isStatus(voucherDetails.currStatus.status, IDX_REDEEM))
        ) {
            releasePaymentToBuyer(voucherDetails);
        }
    }

    /**
     * @notice Following function `releasePayments`, if certain conditions for the voucher status are met, the voucher price will be sent to the seller
     * @param voucherDetails keeps all required information of the voucher which the payment should be released for.
     */
    function releasePaymentToSeller(VoucherDetails memory voucherDetails)
        internal
    {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == ETHTKN
        ) {
            escrow[voucherDetails.holder] -= voucherDetails.price;
        }
        if (
            voucherDetails.paymentMethod == TKNETH ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenPrice =
                IVoucherKernel(voucherKernel).getVoucherPriceToken(
                    voucherDetails.tokenIdSupply
                );

            escrowTokens[addressTokenPrice][
                voucherDetails.holder
            ] -= voucherDetails.price;
        }

        voucherDetails.price2issuer += voucherDetails.price;

        IVoucherKernel(voucherKernel).setPaymentReleased(
            voucherDetails.tokenIdVoucher
        );

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher,
            voucherDetails.issuer,
            voucherDetails.price,
            PaymentType.PAYMENT
        );
    }

    /**
     * @notice Following function `releasePayments`, if certain conditions for the voucher status are met, the voucher price will be sent to the buyer
     * @param voucherDetails keeps all required information of the voucher, which the payment should be released for.
     */
    function releasePaymentToBuyer(VoucherDetails memory voucherDetails)
        internal
    {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == ETHTKN
        ) {
            escrow[voucherDetails.holder] -= voucherDetails.price;
        }

        if (
            voucherDetails.paymentMethod == TKNETH ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenPrice =
                IVoucherKernel(voucherKernel).getVoucherPriceToken(
                    voucherDetails.tokenIdSupply
                );

            escrowTokens[addressTokenPrice][
                voucherDetails.holder
            ] -= voucherDetails.price;
        }

        voucherDetails.price2holder += voucherDetails.price;

        IVoucherKernel(voucherKernel).setPaymentReleased(
            voucherDetails.tokenIdVoucher
        );

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher,
            voucherDetails.holder,
            voucherDetails.price,
            PaymentType.PAYMENT
        );
    }

    /**
     * @notice Release of deposits, for a voucher which deposits had not been released already, and had been marked as `finalized`
     * Based on the voucher status(e.g. complained, redeemed, refunded, etc), the voucher deposits will be sent to either buyer, seller, or pool owner.
     * Depending on the payment type (e.g ETH, or Token) escrow funds will be held in the `escrow` || escrowTokens mappings
     * @param voucherDetails keeps all required information of the voucher which the deposits should be released for.
    */
    function releaseDeposits(VoucherDetails memory voucherDetails) internal {
        //first, depositSe
        if (isStatus(voucherDetails.currStatus.status, IDX_COMPLAIN)) {
            //slash depositSe
            distributeIssuerDepositOnHolderComplain(voucherDetails);
        } else {
            if (isStatus(voucherDetails.currStatus.status, IDX_CANCEL_FAULT)) {
                //slash depositSe
                distributeIssuerDepositOnIssuerCancel(voucherDetails);
            } else {
                //release depositSe
                distributeFullIssuerDeposit(voucherDetails);
            }
        }

        //second, depositBu
        if (
            isStatus(voucherDetails.currStatus.status, IDX_REDEEM) ||
            isStatus(voucherDetails.currStatus.status, IDX_CANCEL_FAULT)
        ) {
            //release depositBu
            distributeFullHolderDeposit(voucherDetails);
        } else {
            //slash depositBu
            distributeHolderDepositOnNotRedeemedNotCancelled(voucherDetails);
        }

        IVoucherKernel(voucherKernel).setDepositsReleased(
            voucherDetails.tokenIdVoucher
        );
    }

    /**
     * @notice Following function `releaseDeposits` this function will be triggered if a voucher had been complained by the buyer.
     * Also checks if the voucher had been cancelled
     * @param voucherDetails keeps all required information of the voucher which the payment should be released for.
    */
    function distributeIssuerDepositOnHolderComplain(
        VoucherDetails memory voucherDetails
    ) internal {
        uint256 tFraction;

        if (isStatus(voucherDetails.currStatus.status, IDX_CANCEL_FAULT)) {
            //appease the conflict three-ways
            if (
                voucherDetails.paymentMethod == ETHETH ||
                voucherDetails.paymentMethod == TKNETH
            ) {
                escrow[voucherDetails.issuer] -= voucherDetails.depositSe;
            }

            if (
                voucherDetails.paymentMethod == ETHTKN ||
                voucherDetails.paymentMethod == TKNTKN
            ) {
                address addressTokenDeposits =
                    IVoucherKernel(voucherKernel).getVoucherDepositToken(
                        voucherDetails.tokenIdSupply
                    );

                escrowTokens[addressTokenDeposits][
                    voucherDetails.issuer
                ] -= voucherDetails.depositSe;
            }

            tFraction = voucherDetails.depositSe.div(CANCELFAULT_SPLIT);
            voucherDetails.deposit2holder += tFraction; //Bu gets, say, a half
            voucherDetails.deposit2issuer += tFraction.div(CANCELFAULT_SPLIT); //Se gets, say, a quarter
            voucherDetails.deposit2pool +=
                voucherDetails.depositSe -
                tFraction -
                tFraction.div(CANCELFAULT_SPLIT); //slashing the rest

            LogAmountDistribution(
                voucherDetails.tokenIdVoucher,
                voucherDetails.holder,
                tFraction,
                PaymentType.DEPOSIT_SELLER
            );
            LogAmountDistribution(
                voucherDetails.tokenIdVoucher,
                voucherDetails.issuer,
                tFraction.div(CANCELFAULT_SPLIT),
                PaymentType.DEPOSIT_SELLER
            );
            LogAmountDistribution(
                voucherDetails.tokenIdVoucher,
                owner(),
                voucherDetails.depositSe -
                    tFraction -
                    tFraction.div(CANCELFAULT_SPLIT),
                PaymentType.DEPOSIT_SELLER
            );

            tFraction = 0;
        } else {
            //slash depositSe
            if (
                voucherDetails.paymentMethod == ETHETH ||
                voucherDetails.paymentMethod == TKNETH
            ) {
                escrow[voucherDetails.issuer] -= voucherDetails.depositSe;
            } else {
                address addressTokenDeposits =
                    IVoucherKernel(voucherKernel).getVoucherDepositToken(
                        voucherDetails.tokenIdSupply
                    );

                escrowTokens[addressTokenDeposits][
                    voucherDetails.issuer
                ] -= voucherDetails.depositSe;
            }

            voucherDetails.deposit2pool += voucherDetails.depositSe;

            LogAmountDistribution(
                voucherDetails.tokenIdVoucher,
                owner(),
                voucherDetails.depositSe,
                PaymentType.DEPOSIT_SELLER
            );
        }
    }

    /**
     * @notice Following function `releaseDeposits` this function will be triggered if a voucher had been cancelled by the seller.
     * Will be triggered if the voucher had not been complained.
     * @param voucherDetails keeps all required information of the voucher which the deposits should be released for.
    */
    function distributeIssuerDepositOnIssuerCancel(
        VoucherDetails memory voucherDetails
    ) internal {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == TKNETH
        ) {
            escrow[voucherDetails.issuer] -= voucherDetails.depositSe;
        }

        if (
            voucherDetails.paymentMethod == ETHTKN ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    voucherDetails.tokenIdSupply
                );

            escrowTokens[addressTokenDeposits][
                voucherDetails.issuer
            ] -= voucherDetails.depositSe;
        }

        voucherDetails.deposit2issuer += voucherDetails.depositSe.div(
            CANCELFAULT_SPLIT
        );
        voucherDetails.deposit2holder +=
            voucherDetails.depositSe -
            voucherDetails.depositSe.div(CANCELFAULT_SPLIT);

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher,
            voucherDetails.issuer,
            voucherDetails.depositSe.div(CANCELFAULT_SPLIT),
            PaymentType.DEPOSIT_SELLER
        );

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher,
            voucherDetails.holder,
            voucherDetails.depositSe -
                voucherDetails.depositSe.div(CANCELFAULT_SPLIT),
            PaymentType.DEPOSIT_SELLER
        );
    }

    /**
     * @notice Following function `releaseDeposits` this function will be triggered if no complain, nor cancel had been made.
     * All seller deposit is returned to seller.
     * @param voucherDetails keeps all required information of the voucher which the deposits should be released for.
    */
    function distributeFullIssuerDeposit(VoucherDetails memory voucherDetails)
        internal
    {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == TKNETH
        ) {
            escrow[voucherDetails.issuer] -= voucherDetails.depositSe;
        }

        if (
            voucherDetails.paymentMethod == ETHTKN ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    voucherDetails.tokenIdSupply
                );

            escrowTokens[addressTokenDeposits][
                voucherDetails.issuer
            ] -= voucherDetails.depositSe;
        }

        voucherDetails.deposit2issuer += voucherDetails.depositSe;

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher,
            voucherDetails.issuer,
            voucherDetails.depositSe,
            PaymentType.DEPOSIT_SELLER
        );
    }

    /**
     * @notice Following function `releaseDeposits` this function will be triggered if voucher had been redeemed, or the seller had cancelled.
     * All buyer deposit is returned to buyer.
     * @param voucherDetails keeps all required information of the voucher which the deposits should be released for.
    */
    function distributeFullHolderDeposit(VoucherDetails memory voucherDetails)
        internal
    {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == TKNETH
        ) {
            escrow[voucherDetails.holder] -= voucherDetails.depositBu;
        }

        if (
            voucherDetails.paymentMethod == ETHTKN ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    voucherDetails.tokenIdSupply
                );

            escrowTokens[addressTokenDeposits][
                voucherDetails.holder
            ] -= voucherDetails.depositBu;
        }

        voucherDetails.deposit2holder += voucherDetails.depositBu;

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher,
            voucherDetails.holder,
            voucherDetails.depositBu,
            PaymentType.DEPOSIT_BUYER
        );
    }

    /**
     * @notice Following function `releaseDeposits` this function will be triggered if voucher had not been redeemed or cancelled after finalization.
     * @param voucherDetails keeps all required information of the voucher which the deposits should be released for.
     * All buyer deposit goes to Boson.
    */
    function distributeHolderDepositOnNotRedeemedNotCancelled(
        VoucherDetails memory voucherDetails
    ) internal {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == TKNETH
        ) {
            escrow[voucherDetails.holder] -= voucherDetails.depositBu;
        }

        if (
            voucherDetails.paymentMethod == ETHTKN ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    voucherDetails.tokenIdSupply
                );

            escrowTokens[addressTokenDeposits][
                voucherDetails.holder
            ] -= voucherDetails.depositBu;
        }

        voucherDetails.deposit2pool += voucherDetails.depositBu;

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher,
            owner(),
            voucherDetails.depositBu,
            PaymentType.DEPOSIT_BUYER
        );
    }

    /**
     * @notice External function for withdrawing deposits. Caller must be the seller of the goods, otherwise reverts. 
     * @notice Seller triggers withdrawals of remaining deposits for a given supply, in case the voucher set is no longer in exchange.
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) which will be burned and deposits will be returned for
     * @param _burnedQty burned quantity that the deposits should be withdrawn for
     * @param _msgSender owner of the voucher set
     */
    function withdrawDepositsSe(
        uint256 _tokenIdSupply,
        uint256 _burnedQty,
        address payable _msgSender
    ) external override nonReentrant onlyFromRouter {
        uint256 deposit =
            IVoucherKernel(voucherKernel).getSellerDeposit(_tokenIdSupply);

        uint256 depositAmount = deposit.mul(_burnedQty);

        uint8 paymentMethod =
            IVoucherKernel(voucherKernel).getVoucherPaymentMethod(
                _tokenIdSupply
            );

        require(
            paymentMethod > 0 && paymentMethod <= 4,
            "INVALID PAYMENT METHOD"
        );

        if (paymentMethod == ETHETH || paymentMethod == TKNETH) {
            escrow[_msgSender] = escrow[_msgSender].sub(depositAmount);
        }

        if (paymentMethod == ETHTKN || paymentMethod == TKNTKN) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    _tokenIdSupply
                );

            escrowTokens[addressTokenDeposits][_msgSender] = escrowTokens[
                addressTokenDeposits
            ][_msgSender]
                .sub(depositAmount);
        }

        _withdrawDeposits(
            _msgSender,
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
        uint8 _paymentMethod,
        uint256 _tokenIdSupply
    ) internal {
        require(_recipient != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(_amount > 0, "");

        if (_paymentMethod == ETHETH || _paymentMethod == ETHTKN) {
            payable(_recipient).sendValue(_amount);
            emit LogWithdrawal(msg.sender, _recipient, _amount);
        }

        if (_paymentMethod == TKNETH || _paymentMethod == TKNTKN) {
            address addressTokenPrice =
                IVoucherKernel(voucherKernel).getVoucherPriceToken(
                    _tokenIdSupply
                );

            IERC20WithPermit(addressTokenPrice).transfer(_recipient, _amount);
        }
    }

    /**
     * @notice Internal function for withdrawing deposits.
     * @param _recipient    address of the account receiving funds from the escrow
     * @param _amount       amount to be released from escrow
     * @param _paymentMethod       ampayment method that should be used to determine, how to do the payouts
     * @param _tokenIdSupply       _tokenIdSupply of the voucher set this is related to
     */
    function _withdrawDeposits(
        address _recipient,
        uint256 _amount,
        uint8 _paymentMethod,
        uint256 _tokenIdSupply
    ) internal {
        require(_recipient != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(_amount > 0, "");

        if (_paymentMethod == ETHETH || _paymentMethod == TKNETH) {
            payable(_recipient).sendValue(_amount);
            emit LogWithdrawal(msg.sender, _recipient, _amount);
        }

        if (_paymentMethod == ETHTKN || _paymentMethod == TKNTKN) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    _tokenIdSupply
                );
            IERC20WithPermit(addressTokenDeposits).transfer(
                _recipient,
                _amount
            );
        }
    }

    /**
     * @notice Set the address of the BR contract
     * @param _bosonRouterAddress   The address of the Cashier contract
     */
    function setBosonRouterAddress(address _bosonRouterAddress)
        external
        override
        onlyOwner
    {
        require(_bosonRouterAddress != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        bosonRouterAddress = _bosonRouterAddress;

        emit LogBosonRouterSet(_bosonRouterAddress, msg.sender);
    }

    /**
     * @notice Update the amount in escrow of an address with the new value, based on VoucherSet/Voucher interaction
     * @param _account  The address of an account to query
     * @param _newAmount  New amount to be set
     */
    function updateEscrowAmount(address _account, uint256 _newAmount)
        external
        override
        onlyFromRouter
    {
        escrow[_account] = _newAmount;
    }

    /**
     * @notice Update the amount in escrowTokens of an address with the new value, based on VoucherSet/Voucher interaction
     * @param _token  The address of a token to query
     * @param _account  The address of an account to query
     * @param _newAmount  New amount to be set
     */
    function updateEscrowTokensAmount(
        address _token,
        address _account,
        uint256 _newAmount
    ) external override onlyFromRouter {
        escrowTokens[_token][_account] = _newAmount;
    }

    /**
     * @notice Only accept ETH via fallback from the BR Contract
     */
    receive() external payable {
        assert(msg.sender == bosonRouterAddress);
    }

    // // // // // // // //
    // GETTERS
    // // // // // // // //

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
}
