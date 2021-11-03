// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

// Those are the payment methods we are using throughout the system.
// Depending on how to user choose to interact with it's funds we store the method, so we could distribute its tokens afterwise
enum PaymentMethod {
    ETHETH,
    ETHTKN,
    TKNETH,
    TKNTKN
}

enum VoucherState {FINAL, CANCEL_FAULT, COMPLAIN, EXPIRE, REFUND, REDEEM, COMMIT}
/*  Status of the voucher in 8 bits:
    [6:COMMITTED] [5:REDEEMED] [4:REFUNDED] [3:EXPIRED] [2:COMPLAINED] [1:CANCELORFAULT] [0:FINAL]
*/

uint8 constant ONE = 1;

struct VoucherDetails {
    uint256 tokenIdSupply;
    uint256 tokenIdVoucher;
    address issuer;
    address holder;
    uint256 price;
    uint256 depositSe;
    uint256 depositBu;
    uint256 price2pool;
    uint256 deposit2pool;
    uint256 price2issuer;
    uint256 deposit2issuer;
    uint256 price2holder;
    uint256 deposit2holder;
    PaymentMethod paymentMethod;
    VoucherStatus currStatus;
}

struct VoucherStatus {
    uint8 status;
    bool isPaymentReleased;
    bool isDepositsReleased;
    uint256 complainPeriodStart;
    uint256 cancelFaultPeriodStart;
}

/**
    * @notice Based on its lifecycle, voucher can have many different statuses. Checks whether a voucher is in Committed state.
    * @param _status current status of a voucher.
    */
function isStateCommitted(uint8 _status) pure returns (bool) {
    return _status == determineStatus(0, VoucherState.COMMIT);
}

/**
    * @notice Based on its lifecycle, voucher can have many different statuses. Checks whether a voucher is in RedemptionSigned state.
    * @param _status current status of a voucher.
    */
function isStateRedemptionSigned(uint8 _status)
    pure
    returns (bool)
{
    return _status == determineStatus(determineStatus(0, VoucherState.COMMIT), VoucherState.REDEEM);
}

/**
    * @notice Based on its lifecycle, voucher can have many different statuses. Checks whether a voucher is in Refunded state.
    * @param _status current status of a voucher.
    */
function isStateRefunded(uint8 _status) pure returns (bool) {
    return _status == determineStatus(determineStatus(0, VoucherState.COMMIT), VoucherState.REFUND);
}

/**
    * @notice Based on its lifecycle, voucher can have many different statuses. Checks whether a voucher is in Expired state.
    * @param _status current status of a voucher.
    */
function isStateExpired(uint8 _status) pure returns (bool) {
    return _status == determineStatus(determineStatus(0, VoucherState.COMMIT), VoucherState.EXPIRE);
}

/**
    * @notice Based on its lifecycle, voucher can have many different statuses. Checks the current status a voucher is at.
    * @param _status current status of a voucher.
    * @param _idx status to compare.
    */
function isStatus(uint8 _status, VoucherState _idx) pure returns (bool) {
    return (_status >> uint8(_idx)) & ONE == 1;
}

/**
    * @notice Set voucher status.
    * @param _status previous status.
    * @param _changeIdx next status.
    */
function determineStatus(uint8 _status, VoucherState _changeIdx)
    pure
    returns (uint8)
{
    return _status | (ONE << uint8(_changeIdx));
}
