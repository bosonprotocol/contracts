// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.6 <0.7.0;

/**
 * @title Utility contract to enable access to common structures
 */
contract usingHelpers {
    uint8 internal constant ONE = 1;
    uint8 internal constant idxCommit = 7;
    uint8 internal constant idxRedeem = 6;
    uint8 internal constant idxRefund = 5;
    uint8 internal constant idxExpire = 4;
    uint8 internal constant idxComplain = 3;
    uint8 internal constant idxCancelFault = 2;
    uint8 internal constant idxFinal = 1;
    
    /*  Status of the voucher in 8 bits:
        [7:COMMITTED] [6:REDEEMED] [5:REFUNDED] [4:EXPIRED] [3:COMPLAINED] [2:CANCELORFAULT] [1:FINAL] [1:/]
    */

    // TODO Chris - add comment what is this?
    uint8 internal constant ETH_ETH = 1;
    uint8 internal constant ETH_TKN = 2;
    uint8 internal constant TKN_ETH = 3;
    uint8 internal constant TKN_TKN = 4;

    struct VoucherStatus {
        uint8 status;
        bool isPaymentReleased;
        bool isDepositsReleased;
        uint256 complainPeriodStart;
        uint256 cancelFaultPeriodStart;
    }
    
    
    function isStateCommitted(uint8 _status)
        internal pure
        returns (bool)
    {
        return _status == setChange(0, idxCommit);
    }
    
    
    function isStateRedemptionSigned(uint8 _status)
        internal pure
        returns (bool)
    {
        return _status == setChange(setChange(0, idxCommit), idxRedeem);
    }    
    
    
    function isStateRefunded(uint8 _status)
        internal pure
        returns (bool)
    {
        return _status == setChange(setChange(0, idxCommit), idxRefund);
    }    
    

    function isStateExpired(uint8 _status)
        internal pure
        returns (bool)
    {
        return _status == setChange(setChange(0, idxCommit), idxExpire);
    }      
    
    
    function isStatus(uint8 _status, uint8 _idx)
        internal pure
        returns (bool)
    {
        return _status >> _idx & ONE == 1;
    }
    
    
    function setChange(uint8 _status, uint8 _changeIdx) 
        internal pure 
        returns (uint8) 
    {
        return _status | ONE << _changeIdx;
    }  
}
