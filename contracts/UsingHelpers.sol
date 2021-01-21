// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.6 <0.7.0;

/**
 * @title Utility contract to enable access to common structures
 */
contract UsingHelpers {
    uint8 internal constant ONE = 1;
    uint8 internal constant IDX_COMMIT = 7;
    uint8 internal constant IDX_REDEEM = 6;
    uint8 internal constant IDX_REFUND = 5;
    uint8 internal constant IDX_EXPIRE = 4;
    uint8 internal constant IDX_COMPLAIN = 3;
    uint8 internal constant IDX_CANCEL_FAULT = 2;
    uint8 internal constant IDX_FINAL = 1;

    /*  Status of the voucher in 8 bits:
        [7:COMMITTED] [6:REDEEMED] [5:REFUNDED] [4:EXPIRED] [3:COMPLAINED] [2:CANCELORFAULT] [1:FINAL] [1:/]
    */

    // Those are the payment methods we are using throughout the system.
    // Depending on how to user choose to interact with it's funds we store the method, so we could distribute its tokens afterwise
    uint8 internal constant ETHETH = 1;
    uint8 internal constant ETHTKN = 2;
    uint8 internal constant TKNETH = 3;
    uint8 internal constant TKNTKN = 4;

    struct VoucherStatus {
        uint8 status;
        bool isPaymentReleased;
        bool isDepositsReleased;
        uint256 complainPeriodStart;
        uint256 cancelFaultPeriodStart;
    }

    function isStateCommitted(uint8 _status) internal pure returns (bool) {
        return _status == setChange(0, IDX_COMMIT);
    }

    function isStateRedemptionSigned(uint8 _status)
        internal
        pure
        returns (bool)
    {
        return _status == setChange(setChange(0, IDX_COMMIT), IDX_REDEEM);
    }

    function isStateRefunded(uint8 _status) internal pure returns (bool) {
        return _status == setChange(setChange(0, IDX_COMMIT), IDX_REFUND);
    }

    function isStateExpired(uint8 _status) internal pure returns (bool) {
        return _status == setChange(setChange(0, IDX_COMMIT), IDX_EXPIRE);
    }

    function isStatus(uint8 _status, uint8 _idx) internal pure returns (bool) {
        return (_status >> _idx) & ONE == 1;
    }

    function setChange(uint8 _status, uint8 _changeIdx)
        internal
        pure
        returns (uint8)
    {
        return _status | (ONE << _changeIdx);
    }
}
