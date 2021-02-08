// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity >=0.6.6 <0.7.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./IVoucherKernel.sol";
import "./UsingHelpers.sol";
import "./IERC20WithPermit.sol";
import "./ICashier.sol";

/**
 * @title Contract for managing funds
 * Roughly following OpenZeppelin's Escrow at https://github.com/OpenZeppelin/openzeppelin-solidity/contracts/payment/
 */
contract Cashier is ICashier, UsingHelpers, ReentrancyGuard, Ownable, Pausable {
    using Address for address payable;
    using SafeMath for uint256;

    address public voucherKernel;
    address public bosonRouterAddress;

    enum PaymentType {PAYMENT, DEPOSIT_SELLER, DEPOSIT_BUYER}

    mapping(address => uint256) public escrow; // both types of deposits AND payments >> can be released token-by-token if checks pass
    // slashedDepositPool can be obtained through getEscrowAmount(poolAddress)

    uint256 internal constant CANCELFAULT_SPLIT = 2; //for POC purposes, this is hardcoded; e.g. each party gets depositSe / 2

    event LogBosonRouterSet(address _newBosonRouter, address _triggeredBy);

    event LogWithdrawal(address _caller, address _payee, uint256 _payment);

    event LogWithdrawDepositsSe(
        uint256 _tokenIdSupply,
        uint256 _burnedQty,
        address _triggeredBy
    );

    event LogAmountDistribution(
        uint256 indexed _tokenIdVoucher,
        address _to,
        uint256 _payment,
        PaymentType _type
    );

    event LogTokenContractSet(address _newTokenContract, address _triggeredBy);

    modifier onlyFromRouter() {
        require(bosonRouterAddress != address(0), "UNSPECIFIED_BR"); // hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(msg.sender == bosonRouterAddress, "UNAUTHORIZED_BR"); // hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        _;
    }

    modifier notZeroAddress(address tokenAddress) {
        require(tokenAddress != address(0), "INVALID_TOKEN_ADDRESS");
        _;
    }

    constructor(address _voucherKernel) public {
        voucherKernel = _voucherKernel;
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

        if (voucherDetails.amount2pool > 0) {
            address payable poolAddress = payable(owner()); //this is required as we could not implicitly cast the owner address to payable
            _withdraw(poolAddress, voucherDetails.amount2pool);
        }

        if (voucherDetails.amount2issuer > 0) {
            _withdraw(voucherDetails.issuer, voucherDetails.amount2issuer);
        }

        if (voucherDetails.amount2holder > 0) {
            _withdraw(voucherDetails.holder, voucherDetails.amount2holder);
        }

        delete voucherDetails;
    }

    /**
     * @notice Trigger withdrawals of what funds are releasable
     * The caller of this function triggers transfers to all involved entities (pool, issuer, token holder), also paying for gas.
     * @dev This function would be optimized a lot, here verbose for readability.
     * @param _tokenIdVoucher an ID of a voucher token (ERC-721) to try withdraw funds from
     */
    function withdrawWhenPaused(uint256 _tokenIdVoucher)
        external
        override
        nonReentrant
        whenPaused
    {
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

        require(
            msg.sender == voucherDetails.issuer ||
                msg.sender == voucherDetails.holder,
            "INVALID CALLER"
        ); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

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

        if (voucherDetails.amount2pool > 0) {
            address payable poolAddress = payable(owner());
            _withdraw(poolAddress, voucherDetails.amount2pool);
        }

        if (voucherDetails.amount2issuer > 0) {
            _withdraw(voucherDetails.issuer, voucherDetails.amount2issuer);
        }

        if (voucherDetails.amount2holder > 0) {
            _withdraw(voucherDetails.holder, voucherDetails.amount2holder);
        }

        delete voucherDetails;
    }

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

    function releasePaymentToSeller(VoucherDetails memory voucherDetails)
        internal
    {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == ETHTKN
        ) {
            escrow[voucherDetails.holder] -= voucherDetails.price;
            voucherDetails.amount2issuer += voucherDetails.price;
        }

        // TODO Chris - Can we have the same approach as above, first collect all amounts in one variable and do the payout at the end? So we save gas from multiple transfers
        if (
            voucherDetails.paymentMethod == TKNETH ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenPrice =
                IVoucherKernel(voucherKernel).getVoucherPriceToken(
                    voucherDetails.tokenIdSupply
                );
            IERC20WithPermit(addressTokenPrice).transfer(
                voucherDetails.issuer,
                voucherDetails.price
            );
        }

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

    function releasePaymentToBuyer(VoucherDetails memory voucherDetails)
        internal
    {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == ETHTKN
        ) {
            escrow[voucherDetails.holder] -= voucherDetails.price;
            voucherDetails.amount2holder += voucherDetails.price;
        }

        if (
            voucherDetails.paymentMethod == TKNETH ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenPrice =
                IVoucherKernel(voucherKernel).getVoucherPriceToken(
                    voucherDetails.tokenIdSupply
                );
            IERC20WithPermit(addressTokenPrice).transfer(
                voucherDetails.holder,
                voucherDetails.price
            );
        }

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
                tFraction = voucherDetails.depositSe.div(CANCELFAULT_SPLIT);
                voucherDetails.amount2holder += tFraction; //Bu gets, say, a half
                voucherDetails.amount2issuer += tFraction.div(
                    CANCELFAULT_SPLIT
                ); //Se gets, say, a quarter
                voucherDetails.amount2pool +=
                    voucherDetails.depositSe -
                    tFraction -
                    tFraction.div(CANCELFAULT_SPLIT); //slashing the rest
            }

            if (
                voucherDetails.paymentMethod == ETHTKN ||
                voucherDetails.paymentMethod == TKNTKN
            ) {
                address addressTokenDeposits =
                    IVoucherKernel(voucherKernel).getVoucherDepositToken(
                        voucherDetails.tokenIdSupply
                    );

                tFraction = voucherDetails.depositSe.div(CANCELFAULT_SPLIT);

                IERC20WithPermit(addressTokenDeposits).transfer(
                    voucherDetails.holder,
                    tFraction
                );
                IERC20WithPermit(addressTokenDeposits).transfer(
                    voucherDetails.issuer,
                    tFraction.div(CANCELFAULT_SPLIT)
                );
                IERC20WithPermit(addressTokenDeposits).transfer(
                    owner(),
                    voucherDetails.depositSe -
                        tFraction -
                        tFraction.div(CANCELFAULT_SPLIT)
                );
            }

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
                voucherDetails.amount2pool += voucherDetails.depositSe;
            } else {
                address addressTokenDeposits =
                    IVoucherKernel(voucherKernel).getVoucherDepositToken(
                        voucherDetails.tokenIdSupply
                    );
                IERC20WithPermit(addressTokenDeposits).transfer(
                    owner(),
                    voucherDetails.depositSe
                );
            }

            LogAmountDistribution(
                voucherDetails.tokenIdVoucher,
                owner(),
                voucherDetails.depositSe,
                PaymentType.DEPOSIT_SELLER
            );
        }
    }

    function distributeIssuerDepositOnIssuerCancel(
        VoucherDetails memory voucherDetails
    ) internal {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == TKNETH
        ) {
            escrow[voucherDetails.issuer] -= voucherDetails.depositSe;
            voucherDetails.amount2issuer += voucherDetails.depositSe.div(
                CANCELFAULT_SPLIT
            );
            voucherDetails.amount2holder +=
                voucherDetails.depositSe -
                voucherDetails.depositSe.div(CANCELFAULT_SPLIT);
        }

        if (
            voucherDetails.paymentMethod == ETHTKN ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    voucherDetails.tokenIdSupply
                );

            IERC20WithPermit(addressTokenDeposits).transfer(
                voucherDetails.issuer,
                voucherDetails.depositSe.div(CANCELFAULT_SPLIT)
            );
            IERC20WithPermit(addressTokenDeposits).transfer(
                voucherDetails.holder,
                voucherDetails.depositSe -
                    voucherDetails.depositSe.div(CANCELFAULT_SPLIT)
            );
        }

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

    function distributeFullIssuerDeposit(VoucherDetails memory voucherDetails)
        internal
    {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == TKNETH
        ) {
            escrow[voucherDetails.issuer] -= voucherDetails.depositSe;
            voucherDetails.amount2issuer += voucherDetails.depositSe;
        }

        if (
            voucherDetails.paymentMethod == ETHTKN ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    voucherDetails.tokenIdSupply
                );
            IERC20WithPermit(addressTokenDeposits).transfer(
                voucherDetails.issuer,
                voucherDetails.depositSe
            );
        }

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher,
            voucherDetails.issuer,
            voucherDetails.depositSe,
            PaymentType.DEPOSIT_SELLER
        );
    }

    function distributeFullHolderDeposit(VoucherDetails memory voucherDetails)
        internal
    {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == TKNETH
        ) {
            escrow[voucherDetails.holder] -= voucherDetails.depositBu;
            voucherDetails.amount2holder += voucherDetails.depositBu;
        }

        if (
            voucherDetails.paymentMethod == ETHTKN ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    voucherDetails.tokenIdSupply
                );
            IERC20WithPermit(addressTokenDeposits).transfer(
                voucherDetails.holder,
                voucherDetails.depositBu
            );
        }

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher,
            voucherDetails.holder,
            voucherDetails.depositBu,
            PaymentType.DEPOSIT_BUYER
        );
    }

    function distributeHolderDepositOnNotRedeemedNotCancelled(
        VoucherDetails memory voucherDetails
    ) internal {
        if (
            voucherDetails.paymentMethod == ETHETH ||
            voucherDetails.paymentMethod == TKNETH
        ) {
            escrow[voucherDetails.holder] -= voucherDetails.depositBu;
            voucherDetails.amount2pool += voucherDetails.depositBu;
        }

        if (
            voucherDetails.paymentMethod == ETHTKN ||
            voucherDetails.paymentMethod == TKNTKN
        ) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    voucherDetails.tokenIdSupply
                );
            IERC20WithPermit(addressTokenDeposits).transfer(
                owner(),
                voucherDetails.depositBu
            );
        }

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher,
            owner(),
            voucherDetails.depositBu,
            PaymentType.DEPOSIT_BUYER
        );
    }

    /**
     * TODO Needs further specification on how to be implemented if contract is paused. Stays here for reference.
     * @notice Seller triggers withdrawals of remaining deposits for a given supply, in case the contracts are paused.
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) which will be burned and deposits will be returned for
     */
    function withdrawDepositsSePaused(uint256 _tokenIdSupply)
        external
        override
        nonReentrant
        whenPaused
    {
        address payable seller =
            payable(
                IVoucherKernel(voucherKernel).getSupplyHolder(_tokenIdSupply)
            );

        require(msg.sender == seller, "UNAUTHORIZED_SE");

        uint256 deposit =
            IVoucherKernel(voucherKernel).getSellerDeposit(_tokenIdSupply);
        uint256 remQty =
            IVoucherKernel(voucherKernel).getRemQtyForSupply(
                _tokenIdSupply,
                seller
            );

        require(remQty > 0, "OFFER_EMPTY");

        uint256 depositAmount = deposit.mul(remQty);

        IVoucherKernel(voucherKernel).burnSupplyOnPause(
            seller,
            _tokenIdSupply,
            remQty
        );

        uint8 paymentMethod =
            IVoucherKernel(voucherKernel).getVoucherPaymentMethod(
                _tokenIdSupply
            );

        require(
            paymentMethod > 0 && paymentMethod <= 4,
            "INVALID PAYMENT METHOD"
        );

        if (paymentMethod == ETHETH || paymentMethod == TKNETH) {
            escrow[msg.sender] = escrow[msg.sender].sub(depositAmount);
            _withdraw(seller, depositAmount);
        }

        if (paymentMethod == ETHTKN || paymentMethod == TKNTKN) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    _tokenIdSupply
                );
            IERC20WithPermit(addressTokenDeposits).transfer(
                seller,
                depositAmount
            );
        }
    }

    /**
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
            _withdraw(_msgSender, depositAmount);
        }

        if (paymentMethod == ETHTKN || paymentMethod == TKNTKN) {
            address addressTokenDeposits =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    _tokenIdSupply
                );
            IERC20WithPermit(addressTokenDeposits).transfer(
                _msgSender,
                depositAmount
            );
        }

        LogWithdrawDepositsSe(_tokenIdSupply, _burnedQty, _msgSender);
    }

    /**
     * @notice Internal function for withdrawing.
     * As unbelievable as it is, neither .send() nor .transfer() are now secure to use due to EIP-1884
     *  So now transferring funds via the last remaining option: .call()
     *  See https://diligence.consensys.net/posts/2019/09/stop-using-soliditys-transfer-now/
     * @param _recipient    address of the account receiving funds from the escrow
     * @param _amount       amount to be released from escrow
     */
    function _withdraw(address payable _recipient, uint256 _amount) internal {
        require(_recipient != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(_amount > 0, "");

        _recipient.sendValue(_amount);

        emit LogWithdrawal(msg.sender, _recipient, _amount);
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
     * @notice Update the amount in escrow of an address wit the new value, based on VoucherSet/Voucher interaction
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
}
