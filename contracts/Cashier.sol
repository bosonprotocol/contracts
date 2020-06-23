// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.2 <0.7.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
//import "@openzeppelin/contracts/math/SafeMath.sol";
import "./VoucherKernel.sol";
import "./usingHelpers.sol";

/**
 * @title Contract for managing funds
 * @dev Warning: the contract hasn't been audited yet!
 *  Roughly following OpenZeppelin's Escrow at https://github.com/OpenZeppelin/openzeppelin-solidity/contracts/payment/
 */
contract Cashier is usingHelpers, ReentrancyGuard {
    using Address for address payable;
    using SafeMath for uint;
    
    VoucherKernel voucherKernel;
    
    address payable poolAddress;                //the account receiving slashed funds
        
    mapping(address => uint256) public escrow;  //both types of deposits AND payments >> can be released token-by-token if checks pass
    //slashedDepositPool can be obtained through getEscrowAmount(poolAddress)
    
    uint256 internal constant CANCELFAULT_SPLIT = 2; //for demo purposes, this is fixed; e.g. each party gets depositSe / 2
    
    event LogOrderCreated(
        uint256 indexed _tokenIdSupply,
        address _seller,
        bytes32 _promiseId, 
        uint256 _quantity
    );
    
    event LogVoucherDelivered(
        uint256 indexed _tokenIdSupply,
        uint256 _tokenIdVoucher,
        address _issuer,
        address _holder,
        bytes32 _promiseId
    );   
    
    event LogWithdrawal(
        address _caller,
        address _payee, 
        uint256 _payment
    );
    

    modifier onlyPoolManager() {
        require(msg.sender == poolAddress, "UNAUTHORIZED_P"); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        _;
    }
    
   
    constructor(
        address _voucherKernel
    ) 
        public 
    {
        voucherKernel = VoucherKernel(_voucherKernel);
        poolAddress = msg.sender;   //address(uint160( address(this) ));
    }
    
    
    /**
     * @notice Issuer/Seller offers promises as supply tokens and needs to escrow the deposit
        @param _assetTitle  Name of the asset
        @param _validFrom   Start of valid period
        @param _validTo     End of valid period
        @param _price       Price (payment amount)
        @param _depositSe   Seller's deposit
        @param _depositBu   Buyer's deposit
        @param _complainPeriod Complain period, also adding to the end-of-lifetime mark
        @param _cancelFaultPeriod   Cancel or Fault tx period, also adding to the end-of-lifetime mark     
     * @param _quantity     Quantity on offer
     */
    function requestCreateOrder(
        string calldata _assetTitle, 
        //bytes32 _value, 
        uint256 _validFrom,
        uint256 _validTo,
        uint256 _price,
        uint256 _depositSe,
        uint256 _depositBu,
        uint256 _complainPeriod,
        uint256 _cancelFaultPeriod,
        //bytes32 _promiseId, 
        uint256 _quantity
        )
        external
        payable
    {
        bytes32 promiseId;
        
        uint256 weiReceived = msg.value;
        
        //create a promise for an asset first (simplified for prototype)
        promiseId = voucherKernel.createAssetPromise(msg.sender, _assetTitle, _validFrom, _validTo, _price, _depositSe, _depositBu, _complainPeriod, _cancelFaultPeriod);
        
        //checks
        //(i) this is for separate promise allocation, not in prototype
        //uint256 depositSe = voucherKernel.getPromiseDepositSe(promiseId); 
        //require(depositSe * _quantity == weiReceived, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        //(ii) prototype check
        require(_depositSe * _quantity == weiReceived, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        
        
        uint256 tokenIdSupply = voucherKernel.createOrder(msg.sender, promiseId, _quantity);
        
        //record funds in escrow ...
        escrow[msg.sender] += weiReceived;     
        
        emit LogOrderCreated(tokenIdSupply, msg.sender, promiseId, _quantity);        
    }
    
    
    /**
     * @notice Consumer requests/buys a voucher by filling an order and receiving a Voucher Token in return
     * @param _tokenIdSupply    ID of the supply token
     * @param _issuer           Address of the issuer of the supply token
     */
    function requestVoucher(uint256 _tokenIdSupply, address _issuer)
        external 
        payable
        nonReentrant
    {
        uint256 weiReceived = msg.value;

        //checks
        (uint256 price, uint256 depositSe, uint256 depositBu) = voucherKernel.getOrderCosts(_tokenIdSupply); 
        require(price + depositBu == weiReceived, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        //get voucher token - extract ERC721 from _voucherOrderId to msg.sender
        uint256 voucherTokenId = voucherKernel.fillOrder(_tokenIdSupply, _issuer, msg.sender);

        //record funds in escrow ...
        escrow[msg.sender] += weiReceived;
        
        emit LogVoucherDelivered(_tokenIdSupply, voucherTokenId, _issuer, msg.sender, voucherKernel.getPromiseIdFromVoucherId(voucherTokenId));
    }


    /**
     * @notice Trigger withdrawals of what funds are releasable
     * The caller of this function triggers transfers to all involved entities (pool, issuer, token holder), also paying for gas.
     * @dev This function would be optimized a lot, here verbose for readability.
     * @param _tokenIdVouchers  an array of voucher tokens (ERC-721) to try withdraw funds from
     */
    function withdraw(uint256[] calldata _tokenIdVouchers)
        external
        nonReentrant
    {
        //TODO: more checks
        require(_tokenIdVouchers.length > 0, "EMPTY_LIST"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        
        uint256 amount2pool;
        uint256 amount2issuer;
        uint256 amount2holder;
        address payable issuer;
        address payable holder;
        
        uint256 price;
        uint256 depositSe;
        uint256 depositBu;
        uint256 tFraction;
        
        uint256 tokenIdSupply;
        VoucherStatus memory currStatus;
        //uint256 tPartDepositSe; //Can't use, because of "Stack Too Deep" Error ... this in real life needs to be optimized, but kept here for readability.
        
        //in the future might want to (i) check the gasleft() (but UNGAS proposal might make it impossible), and/or (ii) set upper loop limit to sth like .length < 2**15
        for(uint256 i = 0; i < _tokenIdVouchers.length; i++) {
            require(_tokenIdVouchers[i] != 0, "UNSPECIFIED_ID");    //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
            
            (currStatus.status, currStatus.isPaymentReleased, currStatus.isDepositsReleased) = voucherKernel.getVoucherStatus(_tokenIdVouchers[i]);
            tokenIdSupply = voucherKernel.getIdSupplyFromVoucher(_tokenIdVouchers[i]);
            (price, depositSe, depositBu) = voucherKernel.getOrderCosts(tokenIdSupply);
            issuer = address(uint160( voucherKernel.getVoucherIssuer(_tokenIdVouchers[i]) ));
            holder = address(uint160( voucherKernel.getVoucherHolder(_tokenIdVouchers[i]) ));
            
            
            //process the RELEASE OF PAYMENTS - only depends on the redeemed/not-redeemed, a voucher need not be in the final status
            if (!currStatus.isPaymentReleased && (
                    isStatus(currStatus.status, idxRedeem)
                    )) {
                //release payment to the Seller, because redemption happened
                escrow[holder] -= price;
                amount2issuer += price; 
                voucherKernel.setPaymentReleased(_tokenIdVouchers[i]);
                
            } else if (!currStatus.isPaymentReleased && (
                    isStatus(currStatus.status, idxRefund) ||
                    isStatus(currStatus.status, idxExpire) ||
                    (isStatus(currStatus.status, idxCancelFault) && 
                        !isStatus(currStatus.status, idxRedeem))
                    )) {
                //release payment back to the Buyer as the redemption didn't happen
                escrow[holder] -= price;
                amount2holder += price;
                voucherKernel.setPaymentReleased(_tokenIdVouchers[i]);
            }    
                
                
            //process the RELEASE OF DEPOSITS - only when vouchers are in the FINAL status 
            if (!currStatus.isDepositsReleased && 
                isStatus(currStatus.status, idxFinal)) {
                    
                    
                //first, depositSe
                if (isStatus(currStatus.status, idxComplain)) {
                    if (isStatus(currStatus.status, idxCancelFault)) {
                        //appease the conflict three-ways
                        escrow[issuer] -= depositSe;
                        tFraction = depositSe.div(CANCELFAULT_SPLIT);
                        amount2holder += tFraction; //Bu gets, say, a half
                        amount2issuer += tFraction.div(CANCELFAULT_SPLIT);   //Se gets, say, a quarter
                        amount2pool += depositSe - tFraction - tFraction.div(CANCELFAULT_SPLIT);    //slashing the rest
                        tFraction = 0;
                    } else {
                        //slash depositSe
                        escrow[issuer] -= depositSe;
                        amount2pool += depositSe;
                    }
                } else {
                    if (isStatus(currStatus.status, idxCancelFault)) {
                        //part depositSe to Bu, part to Se
                        escrow[issuer] -= depositSe;
                        amount2issuer += depositSe.div(CANCELFAULT_SPLIT);
                        amount2holder += depositSe - depositSe.div(CANCELFAULT_SPLIT);
                        //Can't use the code below, because of "Stack Too Deep" Error ... this in real life would be optimized, but kept the code above for readability.
                        //tPartDepositSe = depositSe.div(CANCELFAULT_SPLIT);
                        //amount2issuer += tPartDepositSe;
                        //amount2holder += depositSe.sub(tPartDepositSe);                           
                    } else {
                        //release depositSe
                        escrow[issuer] -= depositSe;
                        amount2issuer += depositSe;                         
                    }
                }
                
                
                //second, depositBu    
                if (isStatus(currStatus.status, idxRedeem) || 
                    isStatus(currStatus.status, idxCancelFault)
                    ) {
                    //release depositBu
                    escrow[holder] -= depositBu;
                    amount2holder += depositBu;
                } else {
                    //slash depositBu
                    escrow[holder] -= depositBu;
                    amount2pool += depositBu;                    
                }
                
                voucherKernel.setDepositsReleased(_tokenIdVouchers[i]);
            }
            
                        
        } //end-for   
        
        if (amount2pool > 0) {
            _withdraw(poolAddress, amount2pool);
        }
        
        if (amount2issuer > 0) {
            _withdraw(issuer, amount2issuer);
        }

        if (amount2holder > 0) {
            _withdraw(holder, amount2holder);
        }
        
    }
    
    
    /**
     * @notice Trigger withdrawals of pooled funds
     */    
    function withdrawPool()
        external 
        onlyPoolManager
        nonReentrant
    {
        //TODO: more checks needed?
        
        if (escrow[poolAddress] > 0) {
            uint256 amount = escrow[poolAddress];
            escrow[poolAddress] = 0;
            _withdraw(poolAddress,amount);
        }
    }    
    
    
    /**
     * @notice Internal function for withdrawing.
     * As unbelievable as it is, neither .send() nor .transfer() are now secure to use due to EIP-1884
     *  So now transfering funds via the last remaining option: .call()
     *  See https://diligence.consensys.net/posts/2019/09/stop-using-soliditys-transfer-now/ 
     * @param _recipient    address of the account receiving funds from the escrow
     * @param _amount       amount to be released from escrow
     */
    function _withdraw(address payable _recipient, uint256 _amount)
        internal
    {
        require(_recipient != address(0), "UNSPECIFIED_ADDRESS");   //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(_amount > 0, "");
        
        _recipient.sendValue(_amount);

        emit LogWithdrawal(msg.sender, _recipient, _amount);
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
        public view
        returns (uint256)
    {
        return escrow[_account];
    }
    
}