// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.1;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./IVoucherKernel.sol";
import "./UsingHelpers.sol";
import "./IERC20WithPermit.sol";
import "./ERC1155ERC721.sol";
import "./IFundLimitsOracle.sol";
import "./IBosonRouter.sol";
import "./ICashier.sol";

/**
 * @title Contract for managing funds
 *  Roughly following OpenZeppelin's Escrow at https://github.com/OpenZeppelin/openzeppelin-solidity/contracts/payment/
 */
contract BosonRouter is
    IBosonRouter,
    UsingHelpers,
    Pausable,
    ReentrancyGuard,
    Ownable
{
    using Address for address payable;
    using SafeMath for uint256;

    mapping(address => uint256) public correlationIds; // whenever a seller or a buyer interacts with the smart contract, a personal txID is emitted from an event.

    using SafeMath for uint256;

    address public cashierAddress;
    address public voucherKernel;
    address public tokensContractAddress;
    address public fundLimitsOracle;

    event LogOrderCreated(
        uint256 indexed _tokenIdSupply,
        address _seller,
        uint256 _quantity,
        uint8 _paymentType,
        uint256 _correlationId
    );

    event LogTokenContractSet(address _newTokenContract, address _triggeredBy);

    function notZeroAddress(address tokenAddress) private pure {
        require(tokenAddress != address(0), "0_A"); //zero address
    }

    function onlyTokensContract() private view {
        require(msg.sender == tokensContractAddress, "UN_TK"); // Unauthorized token address
    }

    function notAboveETHLimit(uint256 value) internal view {
        require(
            value <= IFundLimitsOracle(fundLimitsOracle).getETHLimit(),
            "AB_L" // above limit
        );
    }

    function onlyRouterOwner() internal view {
        require(owner() == _msgSender(), "NOTO"); //not owner
    }

    function notAboveTokenLimit(address _tokenAddress, uint256 value)
        internal
        view
    {
        require(
            value <=
                IFundLimitsOracle(fundLimitsOracle).getTokenLimit(
                    _tokenAddress
                ),
            "AB_L" //above limit
        );
    }

    constructor(
        address _voucherKernel,
        address _tokensContractAddress,
        address _fundLimitsOracle,
        address _cashierAddress
    ) {
        voucherKernel = _voucherKernel;
        tokensContractAddress = _tokensContractAddress;
        fundLimitsOracle = _fundLimitsOracle;
        cashierAddress = _cashierAddress;
    }

    /**
     * @notice Pause the Cashier && the Voucher Kernel contracts in case of emergency.
     * All functions related to creating new batch, requestVoucher or withdraw will be paused, hence cannot be executed.
     * There is special function for withdrawing funds if contract is paused.
     */
    function pause() external override {
        onlyRouterOwner();
        _pause();
        IVoucherKernel(voucherKernel).pause();
        ICashier(cashierAddress).pause();
    }

    /**
     * @notice Unpause the Cashier && the Voucher Kernel contracts.
     * All functions related to creating new batch, requestVoucher or withdraw will be unpaused.
     */
    function unpause() external override {
        onlyRouterOwner();
        require(ICashier(cashierAddress).canUnpause(), "UP_NA"); //unpaused not allowed

        _unpause();
        IVoucherKernel(voucherKernel).unpause();
        ICashier(cashierAddress).unpause();
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
    function requestCreateOrderETHETH(uint256[] calldata metadata)
        external
        payable
        override
        whenNotPaused
    {
        notAboveETHLimit(metadata[2].mul(metadata[5]));
        notAboveETHLimit(metadata[3].mul(metadata[5]));
        notAboveETHLimit(metadata[4].mul(metadata[5]));
        require(metadata[3].mul(metadata[5]) == msg.value, "IN_FU"); //invalid funds
        //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        uint256 tokenIdSupply =
            IVoucherKernel(voucherKernel).createTokenSupplyID(
                msg.sender,
                metadata[0],
                metadata[1],
                metadata[2],
                metadata[3],
                metadata[4],
                metadata[5]
            );

        IVoucherKernel(voucherKernel).createPaymentMethod(
            tokenIdSupply,
            ETHETH,
            address(0),
            address(0)
        );

        //checks
        //(i) this is for separate promise allocation, not in prototype
        //uint256 depositSe = IVoucherKernel(voucherKernel).getPromiseDepositSe(promiseId);
        //require(depositSe * _quantity == weiReceived, "IN_FU");   //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        //(ii) prototype check

        //record funds in escrow ...
        uint256 amount = ICashier(cashierAddress).getEscrowAmount(msg.sender);
        ICashier(cashierAddress).updateEscrowAmount(
            msg.sender,
            amount.add(msg.value)
        );

        payable(cashierAddress).sendValue(msg.value);

        emit LogOrderCreated(
            tokenIdSupply,
            msg.sender,
            metadata[5],
            ETHETH,
            correlationIds[msg.sender]++
        );
    }

    function requestCreateOrderTKNTKNWithPermit(
        address _tokenPriceAddress,
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
    ) external override whenNotPaused {
        notZeroAddress(_tokenPriceAddress);
        notZeroAddress(_tokenDepositAddress);
        notAboveTokenLimit(_tokenPriceAddress, metadata[2].mul(metadata[5]));
        notAboveTokenLimit(_tokenDepositAddress, metadata[3].mul(metadata[5]));
        notAboveTokenLimit(_tokenDepositAddress, metadata[4].mul(metadata[5]));

        require(metadata[3].mul(metadata[5]) == _tokensSent, "IN_FU"); //invalid funds
        //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        IERC20WithPermit(_tokenDepositAddress).permit(
            msg.sender,
            address(this),
            _tokensSent,
            deadline,
            v,
            r,
            s
        );

        uint256 tokenIdSupply =
            IVoucherKernel(voucherKernel).createTokenSupplyID(
                msg.sender,
                metadata[0],
                metadata[1],
                metadata[2],
                metadata[3],
                metadata[4],
                metadata[5]
            );

        IVoucherKernel(voucherKernel).createPaymentMethod(
            tokenIdSupply,
            TKNTKN,
            _tokenPriceAddress,
            _tokenDepositAddress
        );

        IERC20WithPermit(_tokenDepositAddress).transferFrom(
            msg.sender,
            address(cashierAddress),
            _tokensSent
        );

        //record funds in escrowTokens ...
        uint256 amount =
            ICashier(cashierAddress).getEscrowTokensAmount(
                _tokenDepositAddress,
                msg.sender
            );
        ICashier(cashierAddress).updateEscrowTokensAmount(
            _tokenDepositAddress,
            msg.sender,
            amount.add(_tokensSent)
        );

        emit LogOrderCreated(
            tokenIdSupply,
            msg.sender,
            metadata[5],
            TKNTKN,
            correlationIds[msg.sender]++
        );
    }

    function requestCreateOrderETHTKNWithPermit(
        address _tokenDepositAddress,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256[] calldata metadata
    ) external override whenNotPaused {
        notZeroAddress(_tokenDepositAddress);
        notAboveETHLimit(metadata[2].mul(metadata[5]));
        notAboveTokenLimit(_tokenDepositAddress, metadata[3].mul(metadata[5]));
        notAboveTokenLimit(_tokenDepositAddress, metadata[4].mul(metadata[5]));

        require(metadata[3].mul(metadata[5]) == _tokensSent, "IN_FU"); //invalid funds
        //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        IERC20WithPermit(_tokenDepositAddress).permit(
            msg.sender,
            address(this),
            _tokensSent,
            deadline,
            v,
            r,
            s
        );

        uint256 tokenIdSupply =
            IVoucherKernel(voucherKernel).createTokenSupplyID(
                msg.sender,
                metadata[0],
                metadata[1],
                metadata[2],
                metadata[3],
                metadata[4],
                metadata[5]
            );

        IVoucherKernel(voucherKernel).createPaymentMethod(
            tokenIdSupply,
            ETHTKN,
            address(0),
            _tokenDepositAddress
        );

        IERC20WithPermit(_tokenDepositAddress).transferFrom(
            msg.sender,
            address(cashierAddress),
            _tokensSent
        );

        //record funds in escrowTokens ...
        uint256 amount =
            ICashier(cashierAddress).getEscrowTokensAmount(
                _tokenDepositAddress,
                msg.sender
            );
        ICashier(cashierAddress).updateEscrowTokensAmount(
            _tokenDepositAddress,
            msg.sender,
            amount.add(_tokensSent)
        );

        emit LogOrderCreated(
            tokenIdSupply,
            msg.sender,
            metadata[5],
            ETHTKN,
            correlationIds[msg.sender]++
        );
    }

    function requestCreateOrderTKNETH(
        address _tokenPriceAddress,
        uint256[] calldata metadata
    ) external payable override whenNotPaused {
        notZeroAddress(_tokenPriceAddress);
        notAboveTokenLimit(_tokenPriceAddress, metadata[2].mul(metadata[5]));
        notAboveETHLimit(metadata[3].mul(metadata[5]));
        notAboveETHLimit(metadata[4].mul(metadata[5]));

        require(metadata[3].mul(metadata[5]) == msg.value, "IN_FU"); //invalid funds
        //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        uint256 tokenIdSupply =
            IVoucherKernel(voucherKernel).createTokenSupplyID(
                msg.sender,
                metadata[0],
                metadata[1],
                metadata[2],
                metadata[3],
                metadata[4],
                metadata[5]
            );
        IVoucherKernel(voucherKernel).createPaymentMethod(
            tokenIdSupply,
            TKNETH,
            _tokenPriceAddress,
            address(0)
        );

        uint256 amount = ICashier(cashierAddress).getEscrowAmount(msg.sender);
        ICashier(cashierAddress).updateEscrowAmount(
            msg.sender,
            amount.add(msg.value)
        );

        payable(cashierAddress).sendValue(msg.value);

        emit LogOrderCreated(
            tokenIdSupply,
            msg.sender,
            metadata[5],
            TKNETH,
            correlationIds[msg.sender]++
        );
    }

    /**
     * @notice Consumer requests/buys a voucher by filling an order and receiving a Voucher Token in return
     * @param _tokenIdSupply    ID of the supply token
     * @param _issuer           Address of the issuer of the supply token
     */
    function requestVoucherETHETH(uint256 _tokenIdSupply, address _issuer)
        external
        payable
        override
        nonReentrant
        whenNotPaused
    {
        uint256 weiReceived = msg.value;

        //checks
        (uint256 price, , uint256 depositBu) =
            IVoucherKernel(voucherKernel).getOrderCosts(_tokenIdSupply);
        require(price.add(depositBu) == weiReceived, "IN_FU"); //invalid funds
        //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            correlationIds[msg.sender]++
        );

        //record funds in escrow ...
        uint256 amount = ICashier(cashierAddress).getEscrowAmount(msg.sender);
        ICashier(cashierAddress).updateEscrowAmount(
            msg.sender,
            amount.add(weiReceived)
        );

        payable(cashierAddress).sendValue(msg.value);
    }

    function requestVoucherTKNTKNWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 vPrice,
        bytes32 rPrice,
        bytes32 sPrice, // tokenPrice
        uint8 vDeposit,
        bytes32 rDeposit,
        bytes32 sDeposit // tokenDeposits
    ) external override nonReentrant whenNotPaused {
        //checks
        (uint256 price, uint256 depositBu) =
            IVoucherKernel(voucherKernel).getBuyerOrderCosts(_tokenIdSupply);
        require(_tokensSent.sub(depositBu) == price, "IN_FU"); //invalid funds

        address tokenPriceAddress =
            IVoucherKernel(voucherKernel).getVoucherPriceToken(_tokenIdSupply);
        address tokenDepositAddress =
            IVoucherKernel(voucherKernel).getVoucherDepositToken(
                _tokenIdSupply
            );

        IERC20WithPermit(tokenPriceAddress).permit(
            msg.sender,
            address(this),
            price,
            deadline,
            vPrice,
            rPrice,
            sPrice
        );
        IERC20WithPermit(tokenDepositAddress).permit(
            msg.sender,
            address(this),
            depositBu,
            deadline,
            vDeposit,
            rDeposit,
            sDeposit
        );

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            correlationIds[msg.sender]++
        );

        IERC20WithPermit(tokenPriceAddress).transferFrom(
            msg.sender,
            address(cashierAddress),
            price
        );
        IERC20WithPermit(tokenDepositAddress).transferFrom(
            msg.sender,
            address(cashierAddress),
            depositBu
        );

        //record funds in escrowTokens for the Price token...
        uint256 amount =
            ICashier(cashierAddress).getEscrowTokensAmount(
                tokenPriceAddress,
                msg.sender
            );
        ICashier(cashierAddress).updateEscrowTokensAmount(
            tokenPriceAddress,
            msg.sender,
            amount.add(price)
        );

        //record funds in escrowTokens for the Deposit token...
        amount = ICashier(cashierAddress).getEscrowTokensAmount(
            tokenDepositAddress,
            msg.sender
        );
        ICashier(cashierAddress).updateEscrowTokensAmount(
            tokenDepositAddress,
            msg.sender,
            amount.add(depositBu)
        );
    }

    function requestVoucherTKNTKNSameWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensSent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override nonReentrant whenNotPaused {
        //checks
        (uint256 price, uint256 depositBu) =
            IVoucherKernel(voucherKernel).getBuyerOrderCosts(_tokenIdSupply);
        require(_tokensSent.sub(depositBu) == price, "IN_FU"); //invalid funds

        address tokenPriceAddress =
            IVoucherKernel(voucherKernel).getVoucherPriceToken(_tokenIdSupply);
        address tokenDepositAddress =
            IVoucherKernel(voucherKernel).getVoucherDepositToken(
                _tokenIdSupply
            );

        require(tokenPriceAddress == tokenDepositAddress, "IN_C"); //invalid caller

        // If tokenPriceAddress && tokenPriceAddress are the same
        // practically it's not of importance to each we are sending the funds
        IERC20WithPermit(tokenPriceAddress).permit(
            msg.sender,
            address(this),
            _tokensSent,
            deadline,
            v,
            r,
            s
        );

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            correlationIds[msg.sender]++
        );

        IERC20WithPermit(tokenPriceAddress).transferFrom(
            msg.sender,
            address(cashierAddress),
            _tokensSent
        );

        //record funds in escrowTokens ...
        uint256 amount =
            ICashier(cashierAddress).getEscrowTokensAmount(
                tokenPriceAddress,
                msg.sender
            );
        ICashier(cashierAddress).updateEscrowTokensAmount(
            tokenPriceAddress,
            msg.sender,
            amount.add(_tokensSent)
        );
    }

    function requestVoucherETHTKNWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensDeposit,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable override nonReentrant whenNotPaused {
        //checks
        (uint256 price, uint256 depositBu) =
            IVoucherKernel(voucherKernel).getBuyerOrderCosts(_tokenIdSupply);
        require(price == msg.value, "IN_P"); //invalid price
        //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        require(depositBu == _tokensDeposit, "IN_D"); // invalid deposit
        //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        address tokenDepositAddress =
            IVoucherKernel(voucherKernel).getVoucherDepositToken(
                _tokenIdSupply
            );
        IERC20WithPermit(tokenDepositAddress).permit(
            msg.sender,
            address(this),
            _tokensDeposit,
            deadline,
            v,
            r,
            s
        );

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            correlationIds[msg.sender]++
        );

        IERC20WithPermit(tokenDepositAddress).transferFrom(
            msg.sender,
            address(cashierAddress),
            _tokensDeposit
        );

        //record funds in escrow ...
        uint256 amount = ICashier(cashierAddress).getEscrowAmount(msg.sender);
        ICashier(cashierAddress).updateEscrowAmount(
            msg.sender,
            amount.add(msg.value)
        );

        //record funds in escrowTokens ...
        amount = ICashier(cashierAddress).getEscrowTokensAmount(
            tokenDepositAddress,
            msg.sender
        );
        ICashier(cashierAddress).updateEscrowTokensAmount(
            tokenDepositAddress,
            msg.sender,
            amount.add(_tokensDeposit)
        );

        payable(cashierAddress).sendValue(msg.value);
    }

    function requestVoucherTKNETHWithPermit(
        uint256 _tokenIdSupply,
        address _issuer,
        uint256 _tokensPrice,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable override nonReentrant whenNotPaused {
        //checks
        (uint256 price, uint256 depositBu) =
            IVoucherKernel(voucherKernel).getBuyerOrderCosts(_tokenIdSupply);
        require(price == _tokensPrice, "IN_P"); //invalid price
        //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)
        require(depositBu == msg.value, "IN_DE"); // invalid deposit
        //hex"54" FISSION.code(FISSION.Category.Finance, FISSION.Status.InsufficientFunds)

        address tokenPriceAddress =
            IVoucherKernel(voucherKernel).getVoucherPriceToken(_tokenIdSupply);
        IERC20WithPermit(tokenPriceAddress).permit(
            msg.sender,
            address(this),
            price,
            deadline,
            v,
            r,
            s
        );

        IVoucherKernel(voucherKernel).fillOrder(
            _tokenIdSupply,
            _issuer,
            msg.sender,
            correlationIds[msg.sender]++
        );

        IERC20WithPermit(tokenPriceAddress).transferFrom(
            msg.sender,
            address(cashierAddress),
            price
        );

        //record funds in escrow ...
        uint256 amount = ICashier(cashierAddress).getEscrowAmount(msg.sender);
        ICashier(cashierAddress).updateEscrowAmount(
            msg.sender,
            amount.add(msg.value)
        );

        //record funds in escrowTokens ...
        amount = ICashier(cashierAddress).getEscrowTokensAmount(
            tokenPriceAddress,
            msg.sender
        );
        ICashier(cashierAddress).updateEscrowTokensAmount(
            tokenPriceAddress,
            msg.sender,
            amount.add(price)
        );

        payable(cashierAddress).sendValue(msg.value);
    }

    /**
     * @notice Seller burns the remaining supply in case it's no longer in exchange and withdrawal of the locked deposits for them are being sent back.
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) which will be burned and deposits will be returned for
     */
    function requestCancelOrFaultVoucherSet(uint256 _tokenIdSupply)
        external
        override
        nonReentrant
        whenNotPaused
    {
        uint256 _burnedSupplyQty =
            IVoucherKernel(voucherKernel).cancelOrFaultVoucherSet(
                _tokenIdSupply,
                msg.sender
            );
        ICashier(cashierAddress).withdrawDepositsSe(
            _tokenIdSupply,
            _burnedSupplyQty,
            msg.sender
        );

        correlationIds[msg.sender]++;
    }

    /**
     * @notice Redemption of the vouchers promise
     * @param _tokenIdVoucher   ID of the voucher
     */
    function redeem(uint256 _tokenIdVoucher) external override {
        IVoucherKernel(voucherKernel).redeem(_tokenIdVoucher, msg.sender);
    }

    /**
     * @notice Refunding a voucher
     * @param _tokenIdVoucher   ID of the voucher
     */
    function refund(uint256 _tokenIdVoucher) external override {
        IVoucherKernel(voucherKernel).refund(_tokenIdVoucher, msg.sender);
    }

    /**
     * @notice Issue a complain for a voucher
     * @param _tokenIdVoucher   ID of the voucher
     */
    function complain(uint256 _tokenIdVoucher) external override {
        IVoucherKernel(voucherKernel).complain(_tokenIdVoucher, msg.sender);
    }

    /**
     * @notice Cancel/Fault transaction by the Seller, admitting to a fault or backing out of the deal
     * @param _tokenIdVoucher   ID of the voucher
     */
    function cancelOrFault(uint256 _tokenIdVoucher) external override {
        IVoucherKernel(voucherKernel).cancelOrFault(
            _tokenIdVoucher,
            msg.sender
        );
    }

    /**
     * @notice Hook which will be triggered when a _tokenIdVoucher will be transferred. Escrow funds should be allocated to the new owner.
     * @param _from prev owner of the _tokenIdVoucher
     * @param _to next owner of the _tokenIdVoucher
     * @param _tokenIdVoucher _tokenIdVoucher that has been transferred
     */
    function _onERC721Transfer(
        address _from,
        address _to,
        uint256 _tokenIdVoucher
    ) external override {
        onlyTokensContract();
        uint256 tokenSupplyId =
            IVoucherKernel(voucherKernel).getIdSupplyFromVoucher(
                _tokenIdVoucher
            );
        uint8 paymentType =
            IVoucherKernel(voucherKernel).getVoucherPaymentMethod(
                tokenSupplyId
            );

        uint256 amount;
        address tokenAddress;

        (uint256 price, uint256 depositBu) =
            IVoucherKernel(voucherKernel).getBuyerOrderCosts(tokenSupplyId);

        if (paymentType == ETHETH) {
            uint256 totalAmount = price.add(depositBu);

            amount = ICashier(cashierAddress).getEscrowAmount(_from);
            ICashier(cashierAddress).updateEscrowAmount(
                _from,
                amount.sub(totalAmount)
            );

            amount = ICashier(cashierAddress).getEscrowAmount(_to);
            ICashier(cashierAddress).updateEscrowAmount(
                _to,
                amount.add(totalAmount)
            );
        }

        if (paymentType == ETHTKN) {
            amount = ICashier(cashierAddress).getEscrowAmount(_from);
            ICashier(cashierAddress).updateEscrowAmount(
                _from,
                amount.sub(price)
            );

            amount = ICashier(cashierAddress).getEscrowAmount(_to);
            ICashier(cashierAddress).updateEscrowAmount(_to, amount.add(price));

            tokenAddress = IVoucherKernel(voucherKernel).getVoucherDepositToken(
                tokenSupplyId
            );

            amount = ICashier(cashierAddress).getEscrowTokensAmount(
                tokenAddress,
                _from
            );
            ICashier(cashierAddress).updateEscrowTokensAmount(
                tokenAddress,
                _from,
                amount.sub(depositBu)
            );

            amount = ICashier(cashierAddress).getEscrowTokensAmount(
                tokenAddress,
                _to
            );
            ICashier(cashierAddress).updateEscrowTokensAmount(
                tokenAddress,
                _to,
                amount.add(depositBu)
            );
        }

        if (paymentType == TKNETH) {
            tokenAddress = IVoucherKernel(voucherKernel).getVoucherPriceToken(
                tokenSupplyId
            );

            amount = ICashier(cashierAddress).getEscrowTokensAmount(
                tokenAddress,
                _from
            );
            ICashier(cashierAddress).updateEscrowTokensAmount(
                tokenAddress,
                _from,
                amount.sub(price)
            );

            amount = ICashier(cashierAddress).getEscrowTokensAmount(
                tokenAddress,
                _to
            );
            ICashier(cashierAddress).updateEscrowTokensAmount(
                tokenAddress,
                _to,
                amount.add(price)
            );

            amount = ICashier(cashierAddress).getEscrowAmount(_from);
            ICashier(cashierAddress).updateEscrowAmount(
                _from,
                amount.sub(depositBu)
            );

            amount = ICashier(cashierAddress).getEscrowAmount(_to);
            ICashier(cashierAddress).updateEscrowAmount(
                _to,
                amount.add(depositBu)
            );
        }

        if (paymentType == TKNTKN) {
            tokenAddress = IVoucherKernel(voucherKernel).getVoucherPriceToken(
                tokenSupplyId
            );

            amount = ICashier(cashierAddress).getEscrowTokensAmount(
                tokenAddress,
                _from
            );
            ICashier(cashierAddress).updateEscrowTokensAmount(
                tokenAddress,
                _from,
                amount.sub(price)
            );

            amount = ICashier(cashierAddress).getEscrowTokensAmount(
                tokenAddress,
                _to
            );
            ICashier(cashierAddress).updateEscrowTokensAmount(
                tokenAddress,
                _to,
                amount.add(price)
            );

            tokenAddress = IVoucherKernel(voucherKernel).getVoucherDepositToken(
                tokenSupplyId
            );

            amount = ICashier(cashierAddress).getEscrowTokensAmount(
                tokenAddress,
                _from
            );
            ICashier(cashierAddress).updateEscrowTokensAmount(
                tokenAddress,
                _from,
                amount.sub(depositBu)
            );

            amount = ICashier(cashierAddress).getEscrowTokensAmount(
                tokenAddress,
                _to
            );
            ICashier(cashierAddress).updateEscrowTokensAmount(
                tokenAddress,
                _to,
                amount.add(depositBu)
            );
        }

        correlationIds[_to]++;
    }

    /**
     * @notice Pre-validation when a transfer from the the Tokens contract is triggered. Only the whole supply is allowed for transfer, otherwise reverts.
     * @param _from owner of the _tokenSupplyId
     * @param _tokenSupplyId _tokenSupplyId which will be validated
     * @param _value qty which is desired to be transferred
     */
    function _beforeERC1155Transfer(
        address _from,
        uint256 _tokenSupplyId,
        uint256 _value
    ) external view override {
        onlyTokensContract();
        uint256 _tokenSupplyQty =
            IVoucherKernel(voucherKernel).getRemQtyForSupply(
                _tokenSupplyId,
                _from
            );
        require(_tokenSupplyQty == _value, "IN_QTY"); //invalid qty
    }

    /**
     * @notice After the transfer happens the _tokenSupplyId should be updated in the promise. Escrow funds for the seller's deposits (If in ETH) should be allocated to the new owner as well.
     * @param _from prev owner of the _tokenSupplyId
     * @param _to nex owner of the _tokenSupplyId
     * @param _tokenSupplyId _tokenSupplyId for transfer
     * @param _value qty which has been transferred
     */
    function _onERC1155Transfer(
        address _from,
        address _to,
        uint256 _tokenSupplyId,
        uint256 _value
    ) external override {
        onlyTokensContract();
        uint8 paymentType =
            IVoucherKernel(voucherKernel).getVoucherPaymentMethod(
                _tokenSupplyId
            );

        uint256 depositSe;
        uint256 totalAmount;
        uint256 amount;

        if (paymentType == ETHETH || paymentType == TKNETH) {
            depositSe = IVoucherKernel(voucherKernel).getSellerDeposit(
                _tokenSupplyId
            );
            totalAmount = depositSe.mul(_value);

            amount = ICashier(cashierAddress).getEscrowAmount(_from);
            ICashier(cashierAddress).updateEscrowAmount(
                _from,
                amount.sub(totalAmount)
            );

            amount = ICashier(cashierAddress).getEscrowAmount(_to);
            ICashier(cashierAddress).updateEscrowAmount(
                _to,
                amount.add(totalAmount)
            );
        }

        if (paymentType == ETHTKN || paymentType == TKNTKN) {
            address tokenDepositAddress =
                IVoucherKernel(voucherKernel).getVoucherDepositToken(
                    _tokenSupplyId
                );

            depositSe = IVoucherKernel(voucherKernel).getSellerDeposit(
                _tokenSupplyId
            );
            totalAmount = depositSe.mul(_value);

            amount = ICashier(cashierAddress).getEscrowTokensAmount(
                tokenDepositAddress,
                _from
            );
            ICashier(cashierAddress).updateEscrowTokensAmount(
                tokenDepositAddress,
                _from,
                amount.sub(totalAmount)
            );

            amount = ICashier(cashierAddress).getEscrowTokensAmount(
                tokenDepositAddress,
                _to
            );
            ICashier(cashierAddress).updateEscrowTokensAmount(
                tokenDepositAddress,
                _to,
                amount.add(totalAmount)
            );
        }

        IVoucherKernel(voucherKernel).setSupplyHolderOnTransfer(
            _tokenSupplyId,
            _to
        );

        correlationIds[_to]++;
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
        override
    {
        onlyRouterOwner();
        notZeroAddress(_tokensContractAddress);
        tokensContractAddress = _tokensContractAddress;
        emit LogTokenContractSet(_tokensContractAddress, msg.sender);
    }
}
