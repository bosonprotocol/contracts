// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity >=0.6.6 <0.7.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
// import "@openzeppelin/contracts/access/Ownable.sol";
// import "@openzeppelin/contracts/utils/Pausable.sol";
// import "@openzeppelin/contracts/utils/Address.sol";
import "./IVoucherKernel.sol";
// import "./usingHelpers.sol";
import "./IERC20WithPermit.sol";
import "./ERC1155ERC721.sol";
import "./IFundLimitsOracle.sol";
import "./ICashier.sol";
import "./CashierEscrow.sol";

/**
 * @title Contract for managing funds
 * @dev Warning: the contract hasn't been audited yet!
 *  Roughly following OpenZeppelin's Escrow at https://github.com/OpenZeppelin/openzeppelin-solidity/contracts/payment/
 */
contract Cashier is usingHelpers, Pausable, ReentrancyGuard, Ownable
    // ReentrancyGuard, 
    
    // Pausable
    {
    // using Address for address payable;
    using SafeMath for uint;
    
    CashierEscrow escrowContractAddress;
    address public voucherKernel;
    address public tokensContractAddress;
    address public fundLimitsOracle;

        

    event LogOrderCreated(
        uint256 indexed _tokenIdSupply,
        address _seller,
        uint256 _quantity,
        uint8 _paymentType
    );
    
    event LogTokenContractSet(
        address _newTokenContract,
        address _triggeredBy
    );

    modifier notZeroAddress(address tokenAddress) {
        require(tokenAddress != address(0), "INVALID_TOKEN_ADDRESS");
        _;
    }

    modifier onlyTokensContract() {
        require(msg.sender == tokensContractAddress, "UNAUTHORIZED_TK");
        _;
    }
    
    function notAboveETHLimit(uint256 value) internal view{
        require(value <= IFundLimitsOracle(fundLimitsOracle).getETHLimit(), "VALUE_ABOVE_ETH_LIMIT");    
    }

    function notAboveTokenLimit(address _tokenAddress, uint256 value) internal view{
        require(value <= IFundLimitsOracle(fundLimitsOracle).getTokenLimit(_tokenAddress), "VALUE_ABOVE_TKN_LIMIT");    
    }

    constructor(
        address _tokensContractAddress,
        address _fundLimitsOracle,
        address _voucherKernel,
        address _escrowContractAddress
    ) 
        public 
    {
        voucherKernel = _voucherKernel;
        tokensContractAddress = _tokensContractAddress;
        escrowContractAddress = CashierEscrow(_escrowContractAddress);
        fundLimitsOracle = _fundLimitsOracle;
    }
    

    /**
    * @notice Pause the Cashier && the Voucher Kernel contracts in case of emergency.
    * All functions related to creating new batch, requestVoucher or withdraw will be paused, hence cannot be executed. 
    * There is special function for withdrawing funds if contract is paused.
    */
    function pause() external onlyOwner {
        _pause();
        IVoucherKernel(voucherKernel).pause();
    }

    /**
    * @notice Unpause the Cashier && the Voucher Kernel contracts.
    * All functions related to creating new batch, requestVoucher or withdraw will be unpaused.
    */
    function unpause() external onlyOwner {
        _unpause();
        IVoucherKernel(voucherKernel).unpause();
    } 

    /**
     * @notice Issuer/Seller offers promises as supply tokens and needs to escrow the deposit
        @param metadata metadata which is required for creation of a voucher
        Metadata array is used as in some scenarios we need several more params, as we need to recover 
        owner address in order to permit the contract to transfer funds in his behalf. 
        Since the params get too many, we end up in situation that the stack is too deep.
        
        uint256 _validFrom = metadata[0];
        uint256 _validTo = metadata[1];
        uint256 _price = metadata[2];
        uint256 _depositSe = metadata[3];
        uint256 _depositBu = metadata[4];
        uint256 _quantity = metadata[5];
     */
    function requestCreateOrder_ETH_ETH(uint256[] calldata metadata)
        external
        payable
        whenNotPaused
    {
        notAboveETHLimit(metadata[2]); 
        notAboveETHLimit(metadata[3]);
        notAboveETHLimit(metadata[4]);
        require(metadata[3].mul(metadata[5])  == msg.value, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        uint256 tokenIdSupply = IVoucherKernel(voucherKernel).createTokenSupplyID(msg.sender, metadata[0], metadata[1], metadata[2], metadata[3], metadata[4], metadata[5]);
        
        IVoucherKernel(voucherKernel).createPaymentMethod(tokenIdSupply, ETH_ETH, address(0), address(0));

        //checks
        //(i) this is for separate promise allocation, not in prototype
        //uint256 depositSe = IVoucherKernel(voucherKernel).getPromiseDepositSe(promiseId);
        //require(depositSe * _quantity == weiReceived, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        //(ii) prototype check
        
        
        //record funds in escrow ...
        // escrowContractAddress.escrow[msg.sender] += msg.value;
        uint256 amount = escrowContractAddress.getEscrowAmount(msg.sender);
        escrowContractAddress.updateEscrowAmount(msg.sender, amount + msg.value);

        emit LogOrderCreated(tokenIdSupply, msg.sender, metadata[5], ETH_ETH);
    }

    function requestCreateOrder_TKN_TKN_WithPermit(
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
        whenNotPaused
    {
        notAboveTokenLimit(_tokenPriceAddress, metadata[2]);
        notAboveTokenLimit(_tokenDepositAddress, metadata[3]);
        notAboveTokenLimit(_tokenDepositAddress, metadata[4]);

        require(metadata[3].mul(metadata[5]) == _tokensSent, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        
        IERC20WithPermit(_tokenDepositAddress).permit(msg.sender, address(this), _tokensSent, deadline, v, r, s);
        
        uint256 tokenIdSupply = IVoucherKernel(voucherKernel).createTokenSupplyID(msg.sender, metadata[0], metadata[1], metadata[2], metadata[3], metadata[4], metadata[5]);
        
        IVoucherKernel(voucherKernel).createPaymentMethod(tokenIdSupply, TKN_TKN, _tokenPriceAddress, _tokenDepositAddress);

        IERC20WithPermit(_tokenDepositAddress).transferFrom(msg.sender, address(this), _tokensSent);
        
        emit LogOrderCreated(tokenIdSupply, msg.sender, metadata[5], TKN_TKN);
    }

    function requestCreateOrder_ETH_TKN_WithPermit(
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
        whenNotPaused
    {
        notAboveETHLimit(metadata[2]); 
        notAboveTokenLimit(_tokenDepositAddress, metadata[3]);
        notAboveTokenLimit(_tokenDepositAddress, metadata[4]);

        require(metadata[3].mul(metadata[5]) == _tokensSent, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        
        IERC20WithPermit(_tokenDepositAddress).permit(msg.sender, address(this), _tokensSent, deadline, v, r, s);
        
        uint256 tokenIdSupply = IVoucherKernel(voucherKernel).createTokenSupplyID(msg.sender, metadata[0], metadata[1], metadata[2], metadata[3], metadata[4], metadata[5]);
        
        IVoucherKernel(voucherKernel).createPaymentMethod(tokenIdSupply, ETH_TKN, address(0), _tokenDepositAddress);

        IERC20WithPermit(_tokenDepositAddress).transferFrom(msg.sender, address(this), _tokensSent);
        
        emit LogOrderCreated(tokenIdSupply, msg.sender, metadata[5], ETH_TKN);
    }

    function requestCreateOrder_TKN_ETH(
        address _tokenPriceAddress,
        uint256[] calldata metadata
        )
        notZeroAddress(_tokenPriceAddress)
        external
        payable
        whenNotPaused
    {
        notAboveTokenLimit(_tokenPriceAddress, metadata[2]);
        notAboveETHLimit(metadata[3]);
        notAboveETHLimit(metadata[4]);

        require(metadata[3].mul(metadata[5]) == msg.value, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        
        uint256 tokenIdSupply = IVoucherKernel(voucherKernel).createTokenSupplyID(msg.sender, metadata[0], metadata[1], metadata[2], metadata[3], metadata[4], metadata[5]);
        IVoucherKernel(voucherKernel).createPaymentMethod(tokenIdSupply, TKN_ETH, _tokenPriceAddress, address(0));

        // escrowContractAddress.escrow[msg.sender] += msg.value;

        uint256 amount = escrowContractAddress.getEscrowAmount(msg.sender);
        escrowContractAddress.updateEscrowAmount(msg.sender, amount + msg.value);


        emit LogOrderCreated(tokenIdSupply, msg.sender, metadata[5], TKN_ETH);
    }
    
    /**
     * @notice Consumer requests/buys a voucher by filling an order and receiving a Voucher Token in return
     * @param _tokenIdSupply    ID of the supply token
     * @param _issuer           Address of the issuer of the supply token
     */
    function requestVoucher_ETH_ETH(uint256 _tokenIdSupply, address _issuer)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        uint256 weiReceived = msg.value;

        //checks
        (uint256 price, uint256 depositSe, uint256 depositBu) = IVoucherKernel(voucherKernel).getOrderCosts(_tokenIdSupply);
        require(price.add(depositBu) == weiReceived, "INCORRECT_FUNDS");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        IVoucherKernel(voucherKernel).fillOrder(_tokenIdSupply, _issuer, msg.sender);

        //record funds in escrow ...
        // escrowContractAddress.escrow[msg.sender] += weiReceived;
        uint256 amount = escrowContractAddress.getEscrowAmount(msg.sender);
        escrowContractAddress.updateEscrowAmount(msg.sender, amount + weiReceived);
    }
    
    function requestVoucher_TKN_TKN_WithPermit(
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
        whenNotPaused
    {

        //checks
        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel).getBuyerOrderCosts(_tokenIdSupply);
        require(_tokensSent.sub(depositBu) == price, "INCORRECT_FUNDS");

        address tokenPriceAddress = IVoucherKernel(voucherKernel).getVoucherPriceToken(_tokenIdSupply);
        address tokenDepositAddress = IVoucherKernel(voucherKernel).getVoucherDepositToken(_tokenIdSupply);

        IERC20WithPermit(tokenPriceAddress).permit(msg.sender, address(this), price, deadline, vPrice, rPrice, sPrice);
        IERC20WithPermit(tokenDepositAddress).permit(msg.sender, address(this), depositBu, deadline, vDeposit, rDeposit, sDeposit);

        IVoucherKernel(voucherKernel).fillOrder(_tokenIdSupply, _issuer, msg.sender);

        IERC20WithPermit(tokenPriceAddress).transferFrom(msg.sender, address(this), price);
        IERC20WithPermit(tokenDepositAddress).transferFrom(msg.sender, address(this), depositBu);
    }

    function requestVoucher_TKN_TKN_Same_WithPermit(
        uint256 _tokenIdSupply, 
        address _issuer,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
        )
        external
        payable
        nonReentrant
        whenNotPaused
    {
        //checks
        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel).getBuyerOrderCosts(_tokenIdSupply);
        require(_tokensSent.sub(depositBu) == price, "INCORRECT_FUNDS");

        address tokenPriceAddress = IVoucherKernel(voucherKernel).getVoucherPriceToken(_tokenIdSupply);
        address tokenDepositAddress = IVoucherKernel(voucherKernel).getVoucherDepositToken(_tokenIdSupply);

        require(tokenPriceAddress == tokenDepositAddress, "INVALID_CALL");

        // If tokenPriceAddress && tokenPriceAddress are the same 
        // practically it's not of importance to each we are sending the funds
        IERC20WithPermit(tokenPriceAddress).permit(msg.sender, address(this), _tokensSent, deadline, v, r, s);

        IVoucherKernel(voucherKernel).fillOrder(_tokenIdSupply, _issuer, msg.sender);

        IERC20WithPermit(tokenPriceAddress).transferFrom(msg.sender, address(this), _tokensSent);
    }

    function requestVoucher_ETH_TKN_WithPermit(
        uint256 _tokenIdSupply, 
        address _issuer,
        uint256 _tokensDeposit,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
        )
        external
        payable
        nonReentrant
        whenNotPaused
    {

        //checks
        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel).getBuyerOrderCosts(_tokenIdSupply);
        require(price == msg.value, "INCORRECT_PRICE");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        require(depositBu == _tokensDeposit, "INCORRECT_DE");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        address tokenDepositAddress = IVoucherKernel(voucherKernel).getVoucherDepositToken(_tokenIdSupply);
        IERC20WithPermit(tokenDepositAddress).permit(msg.sender, address(this), _tokensDeposit, deadline, v, r, s);

        IVoucherKernel(voucherKernel).fillOrder(_tokenIdSupply, _issuer, msg.sender);

        IERC20WithPermit(tokenDepositAddress).transferFrom(msg.sender, address(this), _tokensDeposit);

         //record funds in escrow ...
        // escrowContractAddress.escrow[msg.sender] += msg.value;

        uint256 amount = escrowContractAddress.getEscrowAmount(msg.sender);
        escrowContractAddress.updateEscrowAmount(msg.sender, amount + msg.value);
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
        whenNotPaused
    {

        //checks
        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel).getBuyerOrderCosts(_tokenIdSupply);
        require(price == _tokensPrice, "INCORRECT_PRICE");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        require(depositBu == msg.value, "INCORRECT_DE");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        address tokenPriceAddress = IVoucherKernel(voucherKernel).getVoucherPriceToken(_tokenIdSupply);
        IERC20WithPermit(tokenPriceAddress).permit(msg.sender, address(this), price, deadline, v, r, s);

        IVoucherKernel(voucherKernel).fillOrder(_tokenIdSupply, _issuer, msg.sender);

        IERC20WithPermit(tokenPriceAddress).transferFrom(msg.sender, address(this), price);

         //record funds in escrow ...
        // escrowContractAddress.escrow[msg.sender] += msg.value;

        uint256 amount = escrowContractAddress.getEscrowAmount(msg.sender);
        escrowContractAddress.updateEscrowAmount(msg.sender, amount + msg.value);
    }


    /**
    * @notice Hook which will be triggered when a _tokenIdVoucher will be transferred. Escrow funds should be allocated to the new owner.
    * @param _from prev owner of the _tokenIdVoucher
    * @param _to next owner of the _tokenIdVoucher
    * @param _tokenIdVoucher _tokenIdVoucher that has been transferred
    */
    function _onERC721Transfer(address _from, address _to, uint256 _tokenIdVoucher) 
        external
        onlyTokensContract
    {
        uint256 tokenSupplyId = IVoucherKernel(voucherKernel).getIdSupplyFromVoucher(_tokenIdVoucher);
        uint8 paymentType = IVoucherKernel(voucherKernel).getVoucherPaymentMethod(tokenSupplyId);

        (uint256 price, uint256 depositBu) = IVoucherKernel(voucherKernel).getBuyerOrderCosts(tokenSupplyId);

        if(paymentType == ETH_ETH)
        {
            uint256 totalAmount = price.add(depositBu);

            // escrowContractAddress.escrow[_from] = escrowContractAddress.escrow[_from].sub(totalAmount);
            uint256 amount = escrowContractAddress.getEscrowAmount(_from);
            escrowContractAddress.updateEscrowAmount(_from, amount.sub(totalAmount));


            // escrowContractAddress.escrow[_to] = escrowContractAddress.escrow[_to].add(totalAmount);
            amount = escrowContractAddress.getEscrowAmount(_to);
            escrowContractAddress.updateEscrowAmount(_to, amount.add(totalAmount));
        }

        if(paymentType == ETH_TKN) {
            // escrowContractAddress.escrow[_from] = escrowContractAddress.escrow[_from].sub(price);

            uint256 amount = escrowContractAddress.getEscrowAmount(_from);
            escrowContractAddress.updateEscrowAmount(_from, amount.sub(price));

            
            // escrowContractAddress.escrow[_to] = escrowContractAddress.escrow[_to].add(price);
            amount = escrowContractAddress.getEscrowAmount(_to);
            escrowContractAddress.updateEscrowAmount(_to, amount.add(price));
        }

        if(paymentType == TKN_ETH) {
            // escrowContractAddress.escrow[_from] = escrowContractAddress.escrow[_from].sub(depositBu);

            uint256 amount = escrowContractAddress.getEscrowAmount(_from);
            escrowContractAddress.updateEscrowAmount(_from, amount.sub(depositBu));

            // escrowContractAddress.escrow[_to] = escrowContractAddress.escrow[_to].add(depositBu);

            amount = escrowContractAddress.getEscrowAmount(_to);
            escrowContractAddress.updateEscrowAmount(_to, amount.add(depositBu));
        }
    }


    /**
    * @notice Pre-validation when a transfer from the the Tokens contract is triggered. Only the whole supply is allowed for transfer, otherwise reverts.
    * @param _from owner of the _tokenSupplyId
    * @param _tokenSupplyId _tokenSupplyId which will be validated
    * @param _value qty which is desired to be transferred
    */
    function _beforeERC1155Transfer(address _from, uint256 _tokenSupplyId, uint256 _value) 
        external
        view
        onlyTokensContract
    {
        uint256 _tokenSupplyQty = IVoucherKernel(voucherKernel).getRemQtyForSupply(_tokenSupplyId, _from);
        require(_tokenSupplyQty == _value, "INVALID_QTY");
    }

    /**
    * @notice After the transfer happens the _tokenSupplyId should be updated in the promise. Escrow funds for the seller's deposits (If in ETH) should be allocated to the new owner as well.
    * @param _from prev owner of the _tokenSupplyId
    * @param _to nex owner of the _tokenSupplyId
    * @param _tokenSupplyId _tokenSupplyId for transfer
    * @param _value qty which has been transferred
    */
    function _onERC1155Transfer(address _from, address _to, uint256 _tokenSupplyId, uint256 _value) 
        external
        onlyTokensContract
    {
        uint8 paymentType = IVoucherKernel(voucherKernel).getVoucherPaymentMethod(_tokenSupplyId);

        if(paymentType == ETH_ETH || paymentType == TKN_ETH) {
            uint256 depositSe = IVoucherKernel(voucherKernel).getSellerDeposit(_tokenSupplyId);
            uint256 totalAmount = depositSe.mul(_value);

            // escrowContractAddress.escrow[_from] = escrowContractAddress.escrow[_from].sub(totalAmount);
            uint256 amount = escrowContractAddress.getEscrowAmount(_from);
            escrowContractAddress.updateEscrowAmount(_from, amount.sub(totalAmount));


            // escrowContractAddress.escrow[_to] = escrowContractAddress.escrow[_to].add(totalAmount);

            amount = escrowContractAddress.getEscrowAmount(_to);
            escrowContractAddress.updateEscrowAmount(_to, amount.add(totalAmount));
        }

        IVoucherKernel(voucherKernel).setSupplyHolderOnTransfer(_tokenSupplyId, _to);
    }

    // // // // // // // //
    // UTILS 
    // // // // // // // //  
        
    /**
     * @notice Set the address of the ERC1155ERC721 contract
     * @param _tokensContractAddress   The address of the ERC1155ERC721 contract
     */
    function setTokenContractAddress(address _tokensContractAddress)
        external
        onlyOwner
        notZeroAddress(_tokensContractAddress)
    {
        tokensContractAddress = _tokensContractAddress;
        emit LogTokenContractSet(_tokensContractAddress, msg.sender);
    }
}
