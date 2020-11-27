
// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.6 <0.7.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/Access/Ownable.sol";
import "./VoucherKernel.sol";
import "./usingHelpers.sol";
import "./IERC20WithPermit.sol";

/**
 * @title Contract for managing funds
 * @dev Warning: the contract hasn't been audited yet!
 *  Roughly following OpenZeppelin's Escrow at https://github.com/OpenZeppelin/openzeppelin-solidity/contracts/payment/
 */
contract Cashier is usingHelpers, ReentrancyGuard, Ownable {
    using Address for address payable;
    using SafeMath for uint;
    
    VoucherKernel voucherKernel;

    enum PaymentType { PAYMENT, DEPOSIT_SELLER, DEPOSIT_BUYER }
        
    mapping(address => uint256) public escrow;  //both types of deposits AND payments >> can be released token-by-token if checks pass
    //slashedDepositPool can be obtained through getEscrowAmount(poolAddress)
    
    uint256 internal constant CANCELFAULT_SPLIT = 2; //for POC purposes, this is hardcoded; e.g. each party gets depositSe / 2
    
    struct VoucherDetails {
        uint256 tokenIdSupply;
        uint256 tokenIdVoucher;
        address payable issuer;
        address payable holder;
        uint256 price;
        uint256 depositSe;
        uint256 depositBu;
        uint256 amount2pool;
        uint256 amount2issuer;
        uint256 amount2holder;
        uint8   paymentMethod;
        VoucherStatus currStatus;
    }

    event LogOrderCreated(
        uint256 indexed _tokenIdSupply,
        address _seller,
        uint256 _quantity
    );
    
    event LogWithdrawal(
        address _caller,
        address _payee, 
        uint256 _payment
    );

    event LogAmountDistribution (
        uint256 indexed _tokenIdVoucher,
        address _to, 
        uint256 _payment,
        PaymentType _type
    );

    modifier notZeroAddress(address tokenAddress) {
        require(tokenAddress != address(0), "INVALID_TOKEN_ADDRESS");
        _;
    }

    constructor(
        address _voucherKernel
    ) 
        public 
    {
        voucherKernel = VoucherKernel(_voucherKernel);
    }
    
    
    /**
     * @notice Issuer/Seller offers promises as supply tokens and needs to escrow the deposit
        @param metadata metadata which is required for creation of a voucher
     */
    // TODO Chris - add EthEth to the name
    function requestCreateOrder(uint256[] calldata metadata)
        external
        payable
    {
        // Metadata array is used as in some scenarios we need several more params, as we need to recover 
        // onwer address in order to permit the contract to transfer funds in his behalf. 
        // Since the params get too many, we end up in situation that the stack is too deep.
        
        // uint256 _validFrom = metadata[0];
        // uint256 _validTo = metadata[1];
        // uint256 _price = metadata[2];
        // uint256 _depositSe = metadata[3];
        // uint256 _depositBu = metadata[4];
        // uint256 _quantity = metadata[5];


        require(metadata[3] * metadata[5] == msg.value, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        //TODO rename this function as it returns tokenSupplyID 
        uint256 tokenIdSupply = voucherKernel.createAssetPromise(msg.sender, metadata[0], metadata[1], metadata[2], metadata[3], metadata[4], metadata[5]);
        
        voucherKernel.createPaymentMethod(tokenIdSupply, ETH_ETH, address(0), address(0));

        //checks
        //(i) this is for separate promise allocation, not in prototype
        //uint256 depositSe = voucherKernel.getPromiseDepositSe(promiseId);
        //require(depositSe * _quantity == weiReceived, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        //(ii) prototype check
        
        
        //record funds in escrow ...
        escrow[msg.sender] += msg.value;
        
        emit LogOrderCreated(tokenIdSupply, msg.sender, metadata[5]);
    }

    function requestCreateOrderTknTknWithPermit(
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
        )
        notZeroAddress(_tokenPriceAddress)
        notZeroAddress(_tokenDepositAddress)
        external
        payable
    {
        // uint256 _validFrom = metadata[0];
        // uint256 _validTo = metadata[1];
        // uint256 _price = metadata[2];
        // uint256 _depositSe = metadata[3];
        // uint256 _depositBu = metadata[4];
        // uint256 _quantity = metadata[5];
        
        require(metadata[3] * metadata[5] == _tokensSent, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        
        IERC20WithPermit(_tokenDepositAddress).permit(msg.sender, address(this), _tokensSent, deadline, v, r, s);
        
        //TODO rename this function as it returns tokenSupplyID
        uint256 tokenIdSupply = voucherKernel.createAssetPromise(msg.sender, metadata[0], metadata[1], metadata[2], metadata[3], metadata[4], metadata[5]);
        
        voucherKernel.createPaymentMethod(tokenIdSupply, TKN_TKN, _tokenPriceAddress, _tokenDepositAddress);

        IERC20WithPermit(_tokenDepositAddress).transferFrom(msg.sender, address(this), _tokensSent);
        
        emit LogOrderCreated(tokenIdSupply, msg.sender, metadata[5]);
    }

    function requestCreateOrderEthTknWithPermit(
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
        )
        notZeroAddress(_tokenDepositAddress)
        external
        payable
    {
        // uint256 _validFrom = metadata[0];
        // uint256 _validTo = metadata[1];
        // uint256 _price = metadata[2];
        // uint256 _depositSe = metadata[3];
        // uint256 _depositBu = metadata[4];
        // uint256 _quantity = metadata[5];
        
        require(metadata[3] * metadata[5] == _tokensSent, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        
        IERC20WithPermit(_tokenDepositAddress).permit(msg.sender, address(this), _tokensSent, deadline, v, r, s);
        
        //TODO rename this function as it returns tokenSupplyID
        uint256 tokenIdSupply = voucherKernel.createAssetPromise(msg.sender, metadata[0], metadata[1], metadata[2], metadata[3], metadata[4], metadata[5]);
        
        voucherKernel.createPaymentMethod(tokenIdSupply, ETH_TKN, address(0), _tokenDepositAddress);

        IERC20WithPermit(_tokenDepositAddress).transferFrom(msg.sender, address(this), _tokensSent);
        
        emit LogOrderCreated(tokenIdSupply, msg.sender, metadata[5]);
    }


    function requestCreateOrder_TKN_ETH_WithPermit(
        address _tokenPriceAddress,
        uint256[] calldata metadata
        )
        notZeroAddress(_tokenPriceAddress)
        external
        payable
    {
        // uint256 _validFrom = metadata[0];
        // uint256 _validTo = metadata[1];
        // uint256 _price = metadata[2];
        // uint256 _depositSe = metadata[3];
        // uint256 _depositBu = metadata[4];
        // uint256 _quantity = metadata[5];
        
        require(metadata[3] * metadata[5] == msg.value, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        
        //TODO rename this function as it returns tokenSupplyID
        uint256 tokenIdSupply = voucherKernel.createAssetPromise(msg.sender, metadata[0], metadata[1], metadata[2], metadata[3], metadata[4], metadata[5]);
        voucherKernel.createPaymentMethod(tokenIdSupply, TKN_ETH, _tokenPriceAddress, address(0));

        escrow[msg.sender] += msg.value;

        emit LogOrderCreated(tokenIdSupply, msg.sender, metadata[5]);
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
        // uint256 voucherTokenId = voucherKernel.fillOrder(_tokenIdSupply, _issuer, msg.sender);
        voucherKernel.fillOrder(_tokenIdSupply, _issuer, msg.sender);

        //record funds in escrow ...
        escrow[msg.sender] += weiReceived;
    }
    
    function requestVoucherTknTKnWithPermit(
        uint256 _tokenIdSupply, 
        address _issuer,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 vPrice, bytes32 rPrice, bytes32 sPrice, // tokenPrice
        uint8 vDeposit, bytes32 rDeposit, bytes32 sDeposit  // tokenDeposits
        )
        external
        payable
        nonReentrant
    {

        //checks
        (uint256 price, uint256 depositBu) = voucherKernel.getBuyerOrderCosts(_tokenIdSupply);
        require(price + depositBu == _tokensSent, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        address tokenPriceAddress = voucherKernel.getVoucherPriceToken(_tokenIdSupply);
        address tokenDepositAddress = voucherKernel.getVoucherDepositToken(_tokenIdSupply);
        // TODO Chris - Can we do it with only one v,r,s, permit and transferFrom?
        IERC20WithPermit(tokenPriceAddress).permit(msg.sender, address(this), price, deadline, vPrice, rPrice, sPrice);
        IERC20WithPermit(tokenDepositAddress).permit(msg.sender, address(this), depositBu, deadline, vDeposit, rDeposit, sDeposit);

        voucherKernel.fillOrder(_tokenIdSupply, _issuer, msg.sender);

        IERC20WithPermit(tokenPriceAddress).transferFrom(msg.sender, address(this), price);
        IERC20WithPermit(tokenDepositAddress).transferFrom(msg.sender, address(this), depositBu);
    }

    function requestVoucherEthTknWithPermit(
        uint256 _tokenIdSupply, 
        address _issuer,
        uint256 _tokensDeposit,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
        )
        external
        payable
        nonReentrant
    {

        //checks
        (uint256 price, uint256 depositBu) = voucherKernel.getBuyerOrderCosts(_tokenIdSupply);
        require(price + depositBu == _tokensDeposit + msg.value, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        address tokenDepositAddress = voucherKernel.getVoucherDepositToken(_tokenIdSupply);
        IERC20WithPermit(tokenDepositAddress).permit(msg.sender, address(this), depositBu, deadline, v, r, s);

        voucherKernel.fillOrder(_tokenIdSupply, _issuer, msg.sender);

        IERC20WithPermit(tokenDepositAddress).transferFrom(msg.sender, address(this), depositBu);

         //record funds in escrow ...
        escrow[msg.sender] += price;
    }

    function requestVoucher_TKN_ETH_WithPermit(
        uint256 _tokenIdSupply, 
        address _issuer,
        uint256 _tokensPrice,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
        )
        external
        payable
        nonReentrant
    {

        //checks
        (uint256 price, uint256 depositBu) = voucherKernel.getBuyerOrderCosts(_tokenIdSupply);
        require(price + depositBu == _tokensPrice + msg.value, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        address tokenPriceAddress = voucherKernel.getVoucherPriceToken(_tokenIdSupply);
        IERC20WithPermit(tokenPriceAddress).permit(msg.sender, address(this), price, deadline, v, r, s);

        voucherKernel.fillOrder(_tokenIdSupply, _issuer, msg.sender);

        IERC20WithPermit(tokenPriceAddress).transferFrom(msg.sender, address(this), price);

         //record funds in escrow ...
        escrow[msg.sender] += msg.value;
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
        //TODO: check to pass 2 diff holders and how the amounts will be distributed

        require(_tokenIdVouchers.length > 0, "EMPTY_LIST"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        
        VoucherDetails memory voucherDetails;
        
        //uint256 tPartDepositSe; //Can't use, because of "Stack Too Deep" Error ... this in real life needs to be optimized, but kept here for readability.
        
        //in the future might want to (i) check the gasleft() (but UNGAS proposal might make it impossible), and/or (ii) set upper loop limit to sth like .length < 2**15
        for(uint256 i = 0; i < _tokenIdVouchers.length; i++) {
            require(_tokenIdVouchers[i] != 0, "UNSPECIFIED_ID");    //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
            
            // (currStatus.status, currStatus.isPaymentReleased, currStatus.isDepositsReleased) = voucherKernel.getVoucherStatus(_tokenIdVouchers[i]);
            voucherDetails.tokenIdVoucher = _tokenIdVouchers[i];
            voucherDetails.tokenIdSupply = voucherKernel.getIdSupplyFromVoucher(voucherDetails.tokenIdVoucher);
            voucherDetails.paymentMethod = voucherKernel.getVoucherPaymentMethod(voucherDetails.tokenIdSupply);

            require(voucherDetails.paymentMethod > 0 && voucherDetails.paymentMethod <= 4, "INVALID PAYMENT METHOD");

            (voucherDetails.currStatus.status,
                voucherDetails.currStatus.isPaymentReleased,
                voucherDetails.currStatus.isDepositsReleased
            ) = voucherKernel.getVoucherStatus(voucherDetails.tokenIdVoucher);
            
            (voucherDetails.price, 
                voucherDetails.depositSe, 
                voucherDetails.depositBu
            ) = voucherKernel.getOrderCosts(voucherDetails.tokenIdSupply);
            
            voucherDetails.issuer = address(uint160( voucherKernel.getVoucherIssuer(voucherDetails.tokenIdVoucher) ));
            voucherDetails.holder = address(uint160( voucherKernel.getVoucherHolder(voucherDetails.tokenIdVoucher) ));
            
            
            //process the RELEASE OF PAYMENTS - only depends on the redeemed/not-redeemed, a voucher need not be in the final status
            if (!voucherDetails.currStatus.isPaymentReleased) 
            {
                releasePayments(voucherDetails);
            }

            //process the RELEASE OF DEPOSITS - only when vouchers are in the FINAL status 
            if (!voucherDetails.currStatus.isDepositsReleased && 
                isStatus(voucherDetails.currStatus.status, idxFinal)) 
            {
                releaseDeposits(voucherDetails);
            }
        } //end-for   
        
        if (voucherDetails.amount2pool > 0) {
            address payable poolAddress = address(uint160(owner())); // TODO Chris - Why we need uint160?
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

        if (isStatus(voucherDetails.currStatus.status, idxRedeem)) {
            releasePaymentToSeller(voucherDetails);
        } else if (isStatus(voucherDetails.currStatus.status, idxRefund) 
                || isStatus(voucherDetails.currStatus.status, idxExpire) 
                || (isStatus(voucherDetails.currStatus.status, idxCancelFault) 
                && !isStatus(voucherDetails.currStatus.status, idxRedeem))) 
        {
           releasePaymentToBuyer(voucherDetails);
        }
    }

    function releasePaymentToSeller(VoucherDetails memory voucherDetails) internal {

        if(voucherDetails.paymentMethod == ETH_ETH || voucherDetails.paymentMethod == ETH_TKN) {
            escrow[voucherDetails.holder] -= voucherDetails.price;
            voucherDetails.amount2issuer += voucherDetails.price;
        }

        // TODO Chris - Can we have the same approach as above, first collect all amounts in one variable and do the payout at the end? So we save gas from multiple transfers
        if(voucherDetails.paymentMethod == TKN_ETH || voucherDetails.paymentMethod == TKN_TKN) {
            address addressTokenPrice = voucherKernel.getVoucherPriceToken(voucherDetails.tokenIdSupply);
            IERC20WithPermit(addressTokenPrice).transfer(voucherDetails.issuer, voucherDetails.price);
        }

        voucherKernel.setPaymentReleased(voucherDetails.tokenIdVoucher);

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher, 
            voucherDetails.issuer, 
            voucherDetails.price, 
            PaymentType.PAYMENT
        );
    }

    function releasePaymentToBuyer(VoucherDetails memory voucherDetails) internal {

        if(voucherDetails.paymentMethod == ETH_ETH || voucherDetails.paymentMethod == ETH_TKN) {
            escrow[voucherDetails.holder] -= voucherDetails.price;
            voucherDetails.amount2holder += voucherDetails.price;
        }

        if(voucherDetails.paymentMethod == TKN_ETH || voucherDetails.paymentMethod == TKN_TKN) {
            address addressTokenPrice = voucherKernel.getVoucherPriceToken(voucherDetails.tokenIdSupply);
            IERC20WithPermit(addressTokenPrice).transfer(voucherDetails.holder, voucherDetails.price);
            
        }

        voucherKernel.setPaymentReleased(voucherDetails.tokenIdVoucher);

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher, 
            voucherDetails.holder, 
            voucherDetails.price, 
            PaymentType.PAYMENT
        );
    }

    function releaseDeposits(VoucherDetails memory voucherDetails) internal {

        //first, depositSe
        if (isStatus(voucherDetails.currStatus.status, idxComplain)) {
            //slash depositSe
            distributeIssuerDepositOnHolderComplain(voucherDetails);
        } else {
            if (isStatus(voucherDetails.currStatus.status, idxCancelFault)) {
                //slash depositSe
                distributeIssuerDepositOnIssuerCancel(voucherDetails);
            } else {
                //release depositSe
                distributeFullIssuerDeposit(voucherDetails);                  
            }
        }
        
        //second, depositBu    
        if (isStatus(voucherDetails.currStatus.status, idxRedeem) || 
            isStatus(voucherDetails.currStatus.status, idxCancelFault)
            ) {
            //release depositBu
            distributeFullHolderDeposit(voucherDetails);
        } else {
            //slash depositBu
            distributeHolderDepositOnNotRedeemedNotCancelled(voucherDetails);
                  
        }

        voucherKernel.setDepositsReleased(voucherDetails.tokenIdVoucher);
    }

    function distributeIssuerDepositOnHolderComplain(VoucherDetails memory voucherDetails) internal {
        
        uint256 tFraction;

        if (isStatus(voucherDetails.currStatus.status, idxCancelFault)) {
            //appease the conflict three-ways
            if(voucherDetails.paymentMethod == ETH_ETH || voucherDetails.paymentMethod == TKN_ETH) {
                escrow[voucherDetails.issuer] -= voucherDetails.depositSe;
                tFraction = voucherDetails.depositSe.div(CANCELFAULT_SPLIT);
                voucherDetails.amount2holder += tFraction; //Bu gets, say, a half
                voucherDetails.amount2issuer += tFraction.div(CANCELFAULT_SPLIT);   //Se gets, say, a quarter
                voucherDetails.amount2pool += voucherDetails.depositSe - tFraction - tFraction.div(CANCELFAULT_SPLIT);    //slashing the rest
            }

            if(voucherDetails.paymentMethod == ETH_TKN || voucherDetails.paymentMethod == TKN_TKN) {
                address addressTokenDeposits = voucherKernel.getVoucherDepositToken(voucherDetails.tokenIdSupply);
                
                tFraction = voucherDetails.depositSe.div(CANCELFAULT_SPLIT);

                IERC20WithPermit(addressTokenDeposits).transfer(voucherDetails.holder, tFraction);
                IERC20WithPermit(addressTokenDeposits).transfer(voucherDetails.issuer, tFraction.div(CANCELFAULT_SPLIT));
                IERC20WithPermit(addressTokenDeposits).transfer(owner(), voucherDetails.depositSe - tFraction - tFraction.div(CANCELFAULT_SPLIT));
            }

            LogAmountDistribution(voucherDetails.tokenIdVoucher, voucherDetails.holder, tFraction, PaymentType.DEPOSIT_SELLER);
            LogAmountDistribution(voucherDetails.tokenIdVoucher, voucherDetails.issuer, tFraction.div(CANCELFAULT_SPLIT), PaymentType.DEPOSIT_SELLER);
            LogAmountDistribution(voucherDetails.tokenIdVoucher, owner(), voucherDetails.depositSe - tFraction - tFraction.div(CANCELFAULT_SPLIT), PaymentType.DEPOSIT_SELLER);
            
            tFraction = 0;

        } else {
            //slash depositSe
            if(voucherDetails.paymentMethod == ETH_ETH || voucherDetails.paymentMethod == TKN_ETH) {
                escrow[voucherDetails.issuer] -= voucherDetails.depositSe;
                voucherDetails.amount2pool += voucherDetails.depositSe;
            } else {
                address addressTokenDeposits = voucherKernel.getVoucherDepositToken(voucherDetails.tokenIdSupply);
                IERC20WithPermit(addressTokenDeposits).transfer(owner(), voucherDetails.depositSe);
            }

            LogAmountDistribution(voucherDetails.tokenIdVoucher, owner(), voucherDetails.depositSe, PaymentType.DEPOSIT_SELLER);
        }
    }

    function distributeIssuerDepositOnIssuerCancel(VoucherDetails memory voucherDetails) internal {
        
        if(voucherDetails.paymentMethod == ETH_ETH || voucherDetails.paymentMethod == TKN_ETH) {
            escrow[voucherDetails.issuer] -= voucherDetails.depositSe;
            voucherDetails.amount2issuer += voucherDetails.depositSe.div(CANCELFAULT_SPLIT);
            voucherDetails.amount2holder += voucherDetails.depositSe - voucherDetails.depositSe.div(CANCELFAULT_SPLIT);
        }

        if (voucherDetails.paymentMethod == ETH_TKN || voucherDetails.paymentMethod == TKN_TKN) {
            address addressTokenDeposits = voucherKernel.getVoucherDepositToken(voucherDetails.tokenIdSupply);

            IERC20WithPermit(addressTokenDeposits).transfer(voucherDetails.issuer, voucherDetails.depositSe.div(CANCELFAULT_SPLIT));
            IERC20WithPermit(addressTokenDeposits).transfer(voucherDetails.holder, voucherDetails.depositSe - voucherDetails.depositSe.div(CANCELFAULT_SPLIT));
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
            voucherDetails.depositSe - voucherDetails.depositSe.div(CANCELFAULT_SPLIT), 
            PaymentType.DEPOSIT_SELLER
        );
    }

    function distributeFullIssuerDeposit(VoucherDetails memory voucherDetails) internal {

        if(voucherDetails.paymentMethod == ETH_ETH || voucherDetails.paymentMethod == TKN_ETH) {
            escrow[voucherDetails.issuer] -= voucherDetails.depositSe;
            voucherDetails.amount2issuer += voucherDetails.depositSe;
        }

        if(voucherDetails.paymentMethod == ETH_TKN || voucherDetails.paymentMethod == TKN_TKN) {
            address addressTokenDeposits = voucherKernel.getVoucherDepositToken(voucherDetails.tokenIdSupply);
            IERC20WithPermit(addressTokenDeposits).transfer(voucherDetails.issuer, voucherDetails.depositSe);
        }

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher, 
            voucherDetails.issuer, 
            voucherDetails.depositSe, 
            PaymentType.DEPOSIT_SELLER
        );   
    }

    function distributeFullHolderDeposit(VoucherDetails memory voucherDetails) internal {

        if(voucherDetails.paymentMethod == ETH_ETH || voucherDetails.paymentMethod == TKN_ETH) {
            escrow[voucherDetails.holder] -= voucherDetails.depositBu;
            voucherDetails.amount2holder += voucherDetails.depositBu;
        }

        if(voucherDetails.paymentMethod == ETH_TKN || voucherDetails.paymentMethod == TKN_TKN) {
            address addressTokenDeposits = voucherKernel.getVoucherDepositToken(voucherDetails.tokenIdSupply);
            IERC20WithPermit(addressTokenDeposits).transfer(voucherDetails.holder, voucherDetails.depositBu);
        }

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher, 
            voucherDetails.holder, 
            voucherDetails.depositBu, 
            PaymentType.DEPOSIT_BUYER
        ); 
    }

    function distributeHolderDepositOnNotRedeemedNotCancelled(VoucherDetails memory voucherDetails) internal {

        if(voucherDetails.paymentMethod == ETH_ETH || voucherDetails.paymentMethod == TKN_ETH) {
            escrow[voucherDetails.holder] -= voucherDetails.depositBu;
            voucherDetails.amount2pool += voucherDetails.depositBu; 
        }

        if(voucherDetails.paymentMethod == ETH_TKN || voucherDetails.paymentMethod == TKN_TKN) {
            address addressTokenDeposits = voucherKernel.getVoucherDepositToken(voucherDetails.tokenIdSupply);
            IERC20WithPermit(addressTokenDeposits).transfer(owner(), voucherDetails.depositBu);
        }

        LogAmountDistribution(
            voucherDetails.tokenIdVoucher, 
            owner(), 
            voucherDetails.depositBu, 
            PaymentType.DEPOSIT_BUYER
        ); 
    }

    /**
     * @notice Trigger withdrawals of pooled funds
     */    
    function withdrawPool()
        external 
        onlyOwner
        nonReentrant
    {
        //TODO: more requires needed?
        
        if (escrow[owner()] > 0) {
            address payable poolAddress = address(uint160(owner()));
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
