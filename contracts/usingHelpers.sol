// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.2 <0.7.0;

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
    
    struct VoucherStatus {
        uint8 status;
        bool isPaymentReleased;
        bool isDepositsReleased;
        uint256 complainPeriodStart;
        uint256 cancelFaultPeriodStart;
    }
    
    
    /**
     * @notice Returns true if the current state of the voucher is COMMITTED
     * @param _status   Current status of the voucher
     */
    function isStateCommitted(uint8 _status)
        internal pure
        returns (bool)
    {
        return _status == setChange(0, idxCommit);
    }
    
    
    /**
     * @notice Returns true if the current state of the voucher is REDEEMED
     * @param _status   Current status of the voucher
     */    
    function isStateRedemptionSigned(uint8 _status)
        internal pure
        returns (bool)
    {
        return _status == setChange(setChange(0, idxCommit), idxRedeem);
    }    
    
    
    /**
     * @notice Returns true if the current state of the voucher is REFUNDED
     * @param _status   Current status of the voucher
     */
    function isStateRefunded(uint8 _status)
        internal pure
        returns (bool)
    {
        return _status == setChange(setChange(0, idxCommit), idxRefund);
    }    
    

    /**
     * @notice Returns true if the current state of the voucher is EXPIRED
     * @param _status   Current status of the voucher
     */
    function isStateExpired(uint8 _status)
        internal pure
        returns (bool)
    {
        return _status == setChange(setChange(0, idxCommit), idxExpire);
    }      
    
    
    /**
     * @notice Checks the bit in the voucher status at specific index
     * @param _status   Current status of the voucher
     * @param _idx      Index in the status bits to check
     */
    function isStatus(uint8 _status, uint8 _idx)
        internal pure
        returns (bool)
    {
        return _status >> _idx & ONE == 1;
    }
    
    
    /**
     * @notice Sets the flag in the voucher status at specific index
     * @param _status   Current status of the voucher
     * @param _changeIdx      Index in the status bits to set
     */
    function setChange(uint8 _status, uint8 _changeIdx) 
        internal pure 
        returns (uint8) 
    {
        return _status | ONE << _changeIdx;
    }  
}