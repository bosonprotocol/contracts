const {assert} = require('chai');
const {ecsign} = require('ethereumjs-util');
const truffleAssert = require('truffle-assertions');

const constants = require('../testHelpers/constants');
const timemachine = require('../testHelpers/timemachine');
const Utils = require('../testHelpers/utils');
const Users = require('../testHelpers/users');
const UtilsBuilder = require('../testHelpers/utilsBuilder');
const {toWei, getApprovalDigest} = require('../testHelpers/permitUtils');

const ERC1155ERC721 = artifacts.require('ERC1155ERC721');
const VoucherKernel = artifacts.require('VoucherKernel');
const Cashier = artifacts.require('Cashier');
const BosonRouter = artifacts.require('BosonRouter');
const MockERC20Permit = artifacts.require('MockERC20Permit');
const FundLimitsOracle = artifacts.require('FundLimitsOracle');

const BN = web3.utils.BN;

let utils;

contract('Cashier and VoucherKernel', async (addresses) => {
  const users = new Users(addresses);

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractBSNTokenPrice,
    contractBSNTokenDeposit,
    contractFundLimitsOracle;
  let tokenSupplyKey, tokenVoucherKey, tokenVoucherKey1;

  const ZERO = new BN(0);
  const ONE_VOUCHER = 1;

  const deadline = toWei(1);

  let timestamp;

  let distributedAmounts = {
    buyerAmount: new BN(0),
    sellerAmount: new BN(0),
    escrowAmount: new BN(0),
  };

  async function deployContracts() {
    const sixtySeconds = 60;

    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    contractFundLimitsOracle = await FundLimitsOracle.new();
    contractERC1155ERC721 = await ERC1155ERC721.new();
    contractVoucherKernel = await VoucherKernel.new(
      contractERC1155ERC721.address
    );
    contractCashier = await Cashier.new(contractVoucherKernel.address);
    contractBosonRouter = await BosonRouter.new(
      contractVoucherKernel.address,
      contractFundLimitsOracle.address,
      contractCashier.address
    );

    contractBSNTokenPrice = await MockERC20Permit.new(
      'BosonTokenPrice',
      'BPRC'
    );
    contractBSNTokenDeposit = await MockERC20Permit.new(
      'BosonTokenDeposit',
      'BDEP'
    );

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address,
      'true'
    );

    await contractERC1155ERC721.setVoucherKernelAddress(
      contractVoucherKernel.address
    );

    await contractERC1155ERC721.setCashierAddress(contractCashier.address);

    await contractVoucherKernel.setBosonRouterAddress(
      contractBosonRouter.address
    );
    await contractVoucherKernel.setCashierAddress(contractCashier.address);

    await contractCashier.setBosonRouterAddress(contractBosonRouter.address);
    await contractCashier.setTokenContractAddress(
      contractERC1155ERC721.address
    );

    await contractVoucherKernel.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds);

    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenPrice.address,
      constants.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenDeposit.address,
      constants.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setETHLimit(constants.ETHER_LIMIT);
  }

  describe('TOKEN SUPPLY CREATION (Voucher batch creation)', () => {
    let remQty = constants.QTY_10;
    let vouchersToBuy = 5;

    const paymentMethods = {
      ETHETH: 1,
      ETHTKN: 2,
      TKNETH: 3,
      TKNTKN: 4,
    };

    afterEach(() => {
      remQty = constants.QTY_10;
    });

    describe('ETHETH', () => {
      before(async () => {
        await deployContracts();

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        timestamp = await Utils.getCurrTimestamp();

        const correlationId = await contractBosonRouter.correlationIds(
          users.seller.address
        );
        assert.equal(
          correlationId.toString(),
          0,
          'Seller correlationId is not as expected'
        );

        tokenSupplyKey = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
        await truffleAssert.reverts(
          utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.ONE_MINUTE,
            constants.seller_deposit,
            constants.QTY_10
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Seller correlationId should be incremented after order is created', async () => {
        const correlationId = await contractBosonRouter.correlationIds(
          users.seller.address
        );

        assert.equal(
          correlationId.toString(),
          1,
          'Seller correlationId is not as expected'
        );
      });

      it('ESCROW has correct initial balance', async () => {
        const expectedBalance = new BN(constants.seller_deposit).mul(
          new BN(remQty)
        );
        const escrowAmount = await contractCashier.getEscrowAmount(
          users.seller.address
        );

        assert.isTrue(
          escrowAmount.eq(expectedBalance),
          'Escrow amount is incorrect'
        );
      });

      it('Cashier Contract has correct amount of ETH', async () => {
        const expectedBalance = new BN(constants.seller_deposit).mul(
          new BN(remQty)
        );
        const cashierBalance = await web3.eth.getBalance(
          contractCashier.address
        );

        assert.isTrue(
          new BN(cashierBalance).eq(expectedBalance),
          'Escrow amount is incorrect'
        );
      });

      it('Get correct remaining qty for supply', async () => {
        let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
          tokenSupplyKey,
          users.seller.address
        );

        assert.equal(
          remainingQtyInContract,
          remQty,
          'Remaining qty is not correct'
        );

        for (let i = 0; i < vouchersToBuy; i++) {
          await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey);
          remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            tokenSupplyKey,
            users.seller.address
          );

          assert.equal(
            remainingQtyInContract,
            --remQty,
            'Remaining qty is not correct'
          );
        }
      });

      it('Should create payment method ETHETH', async () => {
        timestamp = await Utils.getCurrTimestamp();
        let tokenSupplyKey = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10
        );

        const paymentDetails = await contractVoucherKernel.paymentDetails(
          tokenSupplyKey
        );

        assert.equal(
          paymentDetails.paymentMethod.toString(),
          paymentMethods.ETHETH,
          'Payment Method ETHETH not set correctly'
        );
        assert.equal(
          paymentDetails.addressTokenPrice.toString(),
          constants.ZERO_ADDRESS,
          'ETHETH Method Price Token Address mismatch'
        );
        assert.equal(
          paymentDetails.addressTokenDeposits.toString(),
          constants.ZERO_ADDRESS,
          'ETHETH Method Deposit Token Address mismatch'
        );
      });

      it('[NEGATIVE] Should fail if additional token address is provided', async () => {
        const txValue = new BN(constants.seller_deposit).mul(
          new BN(ONE_VOUCHER)
        );
        timestamp = await Utils.getCurrTimestamp();

        await truffleAssert.fails(
          contractBosonRouter.requestCreateOrderETHETH(
            contractBSNTokenDeposit.address,
            [
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.PROMISE_PRICE1,
              constants.seller_deposit,
              constants.PROMISE_DEPOSITBU1,
              constants.ORDER_QUANTITY1,
            ],
            {from: users.seller.address, value: txValue}
          )
        );
      });

      it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
        const txValue = new BN(constants.seller_deposit).mul(
          new BN(ONE_VOUCHER)
        );

        await truffleAssert.reverts(
          contractBosonRouter.requestCreateOrderETHETH(
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.ABOVE_ETH_LIMIT,
              constants.seller_deposit,
              constants.PROMISE_DEPOSITBU1,
              constants.ORDER_QUANTITY1,
            ],
            {from: users.seller.address, value: txValue}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
        const txValue = new BN(constants.seller_deposit).mul(
          new BN(ONE_VOUCHER)
        );

        await truffleAssert.reverts(
          contractBosonRouter.requestCreateOrderETHETH(
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.seller_deposit,
              constants.ABOVE_ETH_LIMIT,
              constants.ORDER_QUANTITY1,
            ],
            {from: users.seller.address, value: txValue}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
        const txValue = new BN(constants.seller_deposit).mul(
          new BN(ONE_VOUCHER)
        );

        await truffleAssert.reverts(
          contractBosonRouter.requestCreateOrderETHETH(
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.ABOVE_ETH_LIMIT,
              constants.PROMISE_DEPOSITBU1,
              constants.ORDER_QUANTITY1,
            ],
            {from: users.seller.address, value: txValue}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', () => {
        before(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const tokensToMint = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_20)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            tokensToMint
          );

          const correlationId = await contractBosonRouter.correlationIds(
            users.seller.address
          );
          assert.equal(
            correlationId.toString(),
            0,
            'Seller correlationId is not as expected'
          );

          timestamp = await Utils.getCurrTimestamp();
          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );
        });

        it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
          await truffleAssert.reverts(
            utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.ONE_MINUTE,
              constants.seller_deposit,
              constants.QTY_10
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Seller correlationId should be incremented after order is created', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.seller.address
          );

          assert.equal(
            correlationId.toString(),
            1,
            'Seller correlationId is not as expected'
          );
        });

        it('Cashier has correct balance in Deposit Contract', async () => {
          const expectedBalance = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_10)
          );
          const escrowAmount = await contractBSNTokenDeposit.balanceOf(
            contractCashier.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('escrowTokens has correct balance', async () => {
          const expectedBalance = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_10)
          );
          const escrowTokens = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          );

          assert.isTrue(
            escrowTokens.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Get correct remaining qty for supply', async () => {
          let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            tokenSupplyKey,
            users.seller.address
          );
          assert.equal(
            remainingQtyInContract,
            remQty,
            'Remaining qty is not correct'
          );

          for (let i = 0; i < vouchersToBuy; i++) {
            await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey);
            remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
              tokenSupplyKey,
              users.seller.address
            );

            assert.equal(
              remainingQtyInContract,
              --remQty,
              'Remaining qty is not correct'
            );
          }
        });

        it('Should create payment method ETHTKN', async () => {
          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );

          const paymentDetails = await contractVoucherKernel.paymentDetails(
            tokenSupplyKey
          );

          assert.equal(
            paymentDetails.paymentMethod.toString(),
            paymentMethods.ETHTKN,
            'Payment Method ETHTKN not set correctly'
          );
          assert.equal(
            paymentDetails.addressTokenPrice.toString(),
            constants.ZERO_ADDRESS,
            'ETHTKN Method Price Token Address mismatch'
          );
          assert.equal(
            paymentDetails.addressTokenDeposits.toString(),
            contractBSNTokenDeposit.address,
            'ETHTKN Method Deposit Token Address mismatch'
          );
        });

        it('[NEGATIVE] Should fail if token deposit contract address is not provided', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.fails(
            contractBosonRouter.requestCreateOrderETHTKNWithPermit(
              '',
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            )
          );
        });

        it('[NEGATIVE] Should revert if token deposit contract address is zero address', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderETHTKNWithPermit(
              constants.ZERO_ADDRESS,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );
          const deadline = toWei(1);

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderETHTKNWithPermit(
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.ABOVE_ETH_LIMIT,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );
          const deadline = toWei(1);

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderETHTKNWithPermit(
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.ABOVE_TOKEN_LIMIT,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );
          const deadline = toWei(1);

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderETHTKNWithPermit(
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.ABOVE_TOKEN_LIMIT,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('TKNETH', () => {
        before(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              ''
            );

          const correlationId = await contractBosonRouter.correlationIds(
            users.seller.address
          );
          assert.equal(
            correlationId.toString(),
            0,
            'Seller correlationIds is not as expected'
          );

          timestamp = await Utils.getCurrTimestamp();

          const tokensToMint = new BN(constants.product_price).mul(
            new BN(constants.QTY_10)
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMint
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );
        });

        it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
          await truffleAssert.reverts(
            utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.ONE_MINUTE,
              constants.seller_deposit,
              constants.QTY_10
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Seller correlationId should be incremented after order is created', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.seller.address
          );

          assert.equal(
            correlationId.toString(),
            1,
            'Seller correlationId is not as expected'
          );
        });

        it('ESCROW has correct balance', async () => {
          const expectedBalance = new BN(constants.seller_deposit).mul(
            new BN(remQty)
          );
          const escrowAmount = await contractCashier.getEscrowAmount(
            users.seller.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Cashier Contract has correct amount of ETH', async () => {
          const expectedBalance = new BN(constants.seller_deposit).mul(
            new BN(remQty)
          );
          const cashierBalance = await web3.eth.getBalance(
            contractCashier.address
          );

          assert.isTrue(
            new BN(cashierBalance).eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Get correct remaining qty for supply', async () => {
          let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            tokenSupplyKey,
            users.seller.address
          );

          assert.equal(
            remainingQtyInContract,
            remQty,
            'Remaining qty is not correct'
          );

          for (let i = 0; i < vouchersToBuy; i++) {
            await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey);
            remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
              tokenSupplyKey,
              users.seller.address
            );

            assert.equal(
              remainingQtyInContract,
              --remQty,
              'Remaining qty is not correct'
            );
          }
        });

        it('Should create payment method TKNETH', async () => {
          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );

          const paymentDetails = await contractVoucherKernel.paymentDetails(
            tokenSupplyKey
          );

          assert.equal(
            paymentDetails.paymentMethod.toString(),
            paymentMethods.TKNETH,
            'Payment Method TKNETH not set correctly'
          );
          assert.equal(
            paymentDetails.addressTokenPrice.toString(),
            contractBSNTokenPrice.address,
            'TKNETH Method Price Token Address mismatch'
          );
          assert.equal(
            paymentDetails.addressTokenDeposits.toString(),
            constants.ZERO_ADDRESS,
            'TKNETH Method Deposit Token Address mismatch'
          );
        });

        it('[NEGATIVE] Should fail if price token contract address is not provided', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );

          await truffleAssert.fails(
            contractBosonRouter.requestCreateOrderTKNETH(
              '',
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address, value: txValue.toString()}
            )
          );
        });

        it('[NEGATIVE] Should fail if token price contract is zero address', async () => {
          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderTKNETH(
              constants.ZERO_ADDRESS,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderTKNETH(
              contractBSNTokenPrice.address,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.ABOVE_TOKEN_LIMIT,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address, value: txValue.toString()}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderTKNETH(
              contractBSNTokenPrice.address,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.ABOVE_ETH_LIMIT,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address, value: txValue.toString()}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderTKNETH(
              contractBSNTokenPrice.address,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.ABOVE_ETH_LIMIT,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address, value: txValue.toString()}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('TKNTKN', () => {
        before(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const correlationId = await contractBosonRouter.correlationIds(
            users.seller.address
          );
          assert.equal(
            correlationId.toString(),
            0,
            'Seller correlationId is not as expected'
          );

          timestamp = await Utils.getCurrTimestamp();

          const tokensToMint = new BN(constants.product_price).mul(
            new BN(constants.QTY_20)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            tokensToMint
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );
        });

        it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
          await truffleAssert.reverts(
            utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.ONE_MINUTE,
              constants.seller_deposit,
              constants.QTY_10
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Seller correlationId should be incremented after order is created', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.seller.address
          );

          assert.equal(
            correlationId.toString(),
            1,
            'Seller correlationId is not as expected'
          );
        });

        it('Cashier has correct balance in Deposit Contract', async () => {
          const expectedBalance = new BN(constants.seller_deposit).mul(
            new BN(remQty)
          );
          const escrowAmount = await contractBSNTokenDeposit.balanceOf(
            contractCashier.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('escrowTokens has correct balance', async () => {
          const expectedBalance = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_10)
          );
          const escrowTokens = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          );

          assert.isTrue(
            escrowTokens.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Get correct remaining qty for supply', async () => {
          let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            tokenSupplyKey,
            users.seller.address
          );

          assert.equal(
            remainingQtyInContract,
            remQty,
            'Remaining qty is not correct'
          );

          for (let i = 0; i < vouchersToBuy; i++) {
            await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey);
            remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
              tokenSupplyKey,
              users.seller.address
            );

            assert.equal(
              remainingQtyInContract,
              --remQty,
              'Remaining qty is not correct'
            );
          }
        });

        it('Should create payment method TKNTKN', async () => {
          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );

          const paymentDetails = await contractVoucherKernel.paymentDetails(
            tokenSupplyKey
          );

          assert.equal(
            paymentDetails.paymentMethod.toString(),
            paymentMethods.TKNTKN,
            'Payment Method TKNTKN not set correctly'
          );
          assert.equal(
            paymentDetails.addressTokenPrice.toString(),
            contractBSNTokenPrice.address,
            'TKNTKN Method Price Token Address mismatch'
          );
          assert.equal(
            paymentDetails.addressTokenDeposits.toString(),
            contractBSNTokenDeposit.address,
            'TKNTKN Method Deposit Token Address mismatch'
          );
        });

        it('[NEGATIVE] Should fail if token price contract address is not provided', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.fails(
            contractBosonRouter.requestCreateOrderTKNTKNWithPermit(
              '',
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            )
          );
        });

        it('[NEGATIVE] Should fail if token deposit contract address is not provided', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.fails(
            contractBosonRouter.requestCreateOrderTKNTKNWithPermit(
              contractBSNTokenPrice.address,
              '',
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            )
          );
        });

        it('[NEGATIVE] Should revert if token price contract address is zero address', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderTKNTKNWithPermit(
              constants.ZERO_ADDRESS,
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should revert if token deposit contract address is zero address', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(ONE_VOUCHER)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );
          const deadline = toWei(1);

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderTKNTKNWithPermit(
              contractBSNTokenPrice.address,
              constants.ZERO_ADDRESS,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_1)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderTKNTKNWithPermit(
              contractBSNTokenPrice.address,
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.ABOVE_TOKEN_LIMIT,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_1)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderTKNTKNWithPermit(
              contractBSNTokenPrice.address,
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.ABOVE_TOKEN_LIMIT,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
          const txValue = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_1)
          );
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestCreateOrderTKNTKNWithPermit(
              contractBSNTokenPrice.address,
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.ABOVE_TOKEN_LIMIT,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {from: users.seller.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });
    });
  });

  describe('TOKEN SUPPLY CANCELLATION', () => {
    before(async () => {
      await deployContracts();

      utils = UtilsBuilder.create()
        .ETHETH()
        .build(
          contractERC1155ERC721,
          contractVoucherKernel,
          contractCashier,
          contractBosonRouter
        );

      timestamp = await Utils.getCurrTimestamp();

      const correlationId = await contractBosonRouter.correlationIds(
        users.seller.address
      );
      assert.equal(
        correlationId.toString(),
        0,
        'Seller correlationId is not as expected'
      );

      tokenSupplyKey = await utils.createOrder(
        users.seller,
        timestamp,
        timestamp + constants.SECONDS_IN_DAY,
        constants.seller_deposit,
        constants.QTY_10
      );
    });

    it('Seller correlationId should be incremented after supply is cancelled', async () => {
      let prevCorrId = await contractBosonRouter.correlationIds(
        users.seller.address
      );

      await contractBosonRouter.requestCancelOrFaultVoucherSet(tokenSupplyKey, {
        from: users.seller.address,
      });
      let nextCorrId = await contractBosonRouter.correlationIds(
        users.seller.address
      );

      assert.equal(
        new BN(prevCorrId).add(new BN(1)).toString(),
        nextCorrId.toString(),
        'correlationId not incremented!'
      );
    });
  });

  describe('VOUCHER CREATION (Commit to buy)', () => {
    const ORDER_QTY = 5;
    let TOKEN_SUPPLY_ID;

    describe('ETHETH', async () => {
      before(async () => {
        await deployContracts();
        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('Buyer correlationId should be zero initially', async () => {
        const correlationId = await contractBosonRouter.correlationIds(
          users.buyer.address
        );

        assert.equal(
          correlationId.toString(),
          0,
          'Buyer correlationId is not as expected'
        );
      });

      it('Should create order', async () => {
        const txValue = new BN(constants.buyer_deposit).add(
          new BN(constants.product_price)
        );
        let txFillOrder = await contractBosonRouter.requestVoucherETHETH(
          TOKEN_SUPPLY_ID,
          users.seller.address,
          {
            from: users.buyer.address,
            value: txValue,
          }
        );

        let internalTx = await truffleAssert.createTransactionResult(
          contractVoucherKernel,
          txFillOrder.tx
        );

        truffleAssert.eventEmitted(
          internalTx,
          'LogVoucherDelivered',
          (ev) => {
            tokenVoucherKey = ev._tokenIdVoucher;
            return ev._issuer === users.seller.address;
          },
          'order1 not created successfully'
        );
      });

      it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
        let utilsTknEth = UtilsBuilder.create()
          .ERC20withPermit()
          .TKNETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenPrice,
            contractBSNTokenDeposit
          );

        await truffleAssert.reverts(
          utilsTknEth.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Buyer correlationId should be incremented after requesting a voucher', async () => {
        const correlationId = await contractBosonRouter.correlationIds(
          users.buyer.address
        );

        assert.equal(
          correlationId.toString(),
          1,
          'Buyer correlationId is not as expected'
        );
      });

      it('Cashier Contract has correct amount of funds', async () => {
        const sellerDeposits = new BN(constants.seller_deposit).mul(
          new BN(constants.QTY_10)
        );
        const buyerETHSent = new BN(constants.product_price).add(
          new BN(constants.buyer_deposit)
        );
        const expectedBalance = sellerDeposits.add(buyerETHSent);

        const cashierBalance = await web3.eth.getBalance(
          contractCashier.address
        );

        assert.isTrue(
          new BN(cashierBalance).eq(expectedBalance),
          'Escrow amount is incorrect'
        );
      });

      it('Escrow should be updated', async () => {
        const sellerDeposits = new BN(constants.seller_deposit).mul(
          new BN(constants.QTY_10)
        );
        const buyerETHSent = new BN(constants.product_price).add(
          new BN(constants.buyer_deposit)
        );

        const escrowSeller = await contractCashier.getEscrowAmount(
          users.seller.address
        );
        const escrowBuyer = await contractCashier.getEscrowAmount(
          users.buyer.address
        );

        assert.isTrue(
          new BN(sellerDeposits).eq(escrowSeller),
          'Escrow amount is incorrect'
        );

        assert.isTrue(
          new BN(buyerETHSent).eq(escrowBuyer),
          'Escrow amount is incorrect'
        );
      });

      it('[NEGATIVE] Should not create order with incorrect price', async () => {
        const txValue = new BN(constants.buyer_deposit).add(
          new BN(constants.incorrect_product_price)
        );

        await truffleAssert.reverts(
          contractBosonRouter.requestVoucherETHETH(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            {
              from: users.buyer.address,
              value: txValue,
            }
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
        const txValue = new BN(constants.buyer_incorrect_deposit).add(
          new BN(constants.product_price)
        );

        await truffleAssert.reverts(
          contractBosonRouter.requestVoucherETHETH(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            {
              from: users.buyer.address,
              value: txValue,
            }
          ),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', async () => {
        before(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const tokensToMintSeller = new BN(constants.seller_deposit).mul(
            new BN(ORDER_QTY)
          );
          const tokensToMintBuyer = new BN(constants.buyer_deposit).mul(
            new BN(ORDER_QTY)
          );

          await contractBSNTokenDeposit.mint(
            users.seller.address,
            tokensToMintSeller
          );
          await contractBSNTokenDeposit.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          );
        });

        it('Buyer correlationId should be zero initially', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.buyer.address
          );

          assert.equal(
            correlationId.toString(),
            0,
            'Buyer correlationId is not as expected'
          );
        });

        it('Should create order', async () => {
          const nonce = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractBosonRouter.address,
            constants.buyer_deposit,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const txFillOrder = await contractBosonRouter.requestVoucherETHTKNWithPermit(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            constants.buyer_deposit,
            deadline,
            v,
            r,
            s,
            {from: users.buyer.address, value: constants.product_price}
          );

          let internalTx = await truffleAssert.createTransactionResult(
            contractVoucherKernel,
            txFillOrder.tx
          );

          truffleAssert.eventEmitted(
            internalTx,
            'LogVoucherDelivered',
            (ev) => {
              tokenVoucherKey = ev._tokenIdVoucher;
              return ev._issuer === users.seller.address;
            },
            'order1 not created successfully'
          );
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          let utilsEthEth = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await truffleAssert.reverts(
            utilsEthEth.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Buyer correlationId should be incremented after requesting a voucher', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.buyer.address
          );

          assert.equal(
            correlationId.toString(),
            1,
            'Buyer correlationId is not as expected'
          );
        });

        it('Cashier Contract has correct amount of funds', async () => {
          const expectedETHBalance = new BN(constants.product_price);
          const cashierETHBalance = await web3.eth.getBalance(
            contractCashier.address
          );

          const cashierDepositTokenBalance = await contractBSNTokenDeposit.balanceOf(
            contractCashier.address
          );
          const sellerTokenDeposits = new BN(constants.seller_deposit).mul(
            new BN(ORDER_QTY)
          );
          const expectedTokenBalance = new BN(constants.buyer_deposit).add(
            sellerTokenDeposits
          );

          assert.isTrue(
            new BN(cashierETHBalance).eq(expectedETHBalance),
            'Escrow amount is incorrect'
          );
          assert.isTrue(
            expectedTokenBalance.eq(cashierDepositTokenBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Escrows should be updated', async () => {
          const sellerDeposits = new BN(constants.seller_deposit).mul(
            new BN(ORDER_QTY)
          );
          const buyerETHSent = new BN(constants.product_price);
          const buyerTKNSent = new BN(constants.buyer_deposit);

          const escrowSellerTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          );
          const escrowBuyerEth = await contractCashier.getEscrowAmount(
            users.buyer.address
          );
          const escrowBuyerTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.buyer.address
          );

          assert.isTrue(
            new BN(sellerDeposits).eq(escrowSellerTkn),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            new BN(buyerETHSent).eq(escrowBuyerEth),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            new BN(buyerTKNSent).eq(escrowBuyerTkn),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          const nonce = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractCashier.address,
            constants.buyer_deposit,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestVoucherETHTKNWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              constants.buyer_deposit,
              deadline,
              v,
              r,
              s,
              {
                from: users.buyer.address,
                value: constants.incorrect_product_price,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          const nonce = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractCashier.address,
            constants.buyer_deposit,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestVoucherETHTKNWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              constants.buyer_incorrect_deposit,
              deadline,
              v,
              r,
              s,
              {from: users.buyer.address, value: constants.product_price}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('TKNTKN', () => {
        before(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const tokensToMintSeller = new BN(constants.seller_deposit).mul(
            new BN(ORDER_QTY)
          );
          const tokensToMintBuyer = new BN(constants.product_price).mul(
            new BN(ORDER_QTY)
          );

          await contractBSNTokenDeposit.mint(
            users.seller.address,
            tokensToMintSeller
          );
          await contractBSNTokenDeposit.mint(
            users.buyer.address,
            tokensToMintBuyer
          );
          await contractBSNTokenPrice.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          );
        });

        it('Buyer correlationId should be zero initially', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.buyer.address
          );

          assert.equal(
            correlationId.toString(),
            0,
            'Buyer correlationId is not as expected'
          );
        });

        it('Should create order', async () => {
          const nonce1 = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const tokensToSend = new BN(constants.product_price).add(
            new BN(constants.buyer_deposit)
          );

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractBosonRouter.address,
            constants.buyer_deposit,
            nonce1,
            deadline
          );

          let VRS_DEPOSIT = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let vDeposit = VRS_DEPOSIT.v;
          let rDeposit = VRS_DEPOSIT.r;
          let sDeposit = VRS_DEPOSIT.s;

          const nonce2 = await contractBSNTokenPrice.nonces(
            users.buyer.address
          );

          const digestPrice = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractBosonRouter.address,
            constants.product_price,
            nonce2,
            deadline
          );

          let VRS_PRICE = ecsign(
            Buffer.from(digestPrice.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let vPrice = VRS_PRICE.v;
          let rPrice = VRS_PRICE.r;
          let sPrice = VRS_PRICE.s;

          let txFillOrder = await contractBosonRouter.requestVoucherTKNTKNWithPermit(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            tokensToSend,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit,
            {from: users.buyer.address}
          );

          let internalTx = await truffleAssert.createTransactionResult(
            contractVoucherKernel,
            txFillOrder.tx
          );

          truffleAssert.eventEmitted(
            internalTx,
            'LogVoucherDelivered',
            (ev) => {
              tokenVoucherKey = ev._tokenIdVoucher;
              return ev._issuer === users.seller.address;
            },
            'order1 not created successfully'
          );
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          let utilsEthTkn = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await truffleAssert.reverts(
            utilsEthTkn.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Buyer correlationId should be incremented after requesting a voucher', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.buyer.address
          );

          assert.equal(
            correlationId.toString(),
            1,
            'Buyer correlationId is not as expected'
          );
        });

        it('Cashier Contract has correct amount of funds', async () => {
          const cashierPriceTokenBalance = await contractBSNTokenPrice.balanceOf(
            contractCashier.address
          );
          const cashierDepositTokenBalance = await contractBSNTokenDeposit.balanceOf(
            contractCashier.address
          );
          const sellerDeposit = new BN(constants.seller_deposit).mul(
            new BN(ORDER_QTY)
          );
          const expectedDepositBalance = new BN(constants.buyer_deposit).add(
            sellerDeposit
          );

          assert.isTrue(
            new BN(cashierPriceTokenBalance).eq(
              new BN(constants.product_price)
            ),
            'Escrow amount is incorrect'
          );
          assert.isTrue(
            new BN(cashierDepositTokenBalance).eq(expectedDepositBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Escrows should be updated', async () => {
          const sellerDeposits = new BN(constants.seller_deposit).mul(
            new BN(ORDER_QTY)
          );
          const buyerTknPriceSent = new BN(constants.product_price);
          const buyerTknDepositSent = new BN(constants.buyer_deposit);

          const escrowSellerTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          );
          const escrowBuyerTknPrice = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.buyer.address
          );
          const escrowBuyerTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.buyer.address
          );

          assert.isTrue(
            new BN(sellerDeposits).eq(escrowSellerTknDeposit),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            new BN(buyerTknPriceSent).eq(escrowBuyerTknPrice),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            new BN(buyerTknDepositSent).eq(escrowBuyerTknDeposit),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          const nonce1 = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const tokensToSend = new BN(constants.incorrect_product_price).add(
            new BN(constants.buyer_deposit)
          );

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractCashier.address,
            constants.buyer_deposit,
            nonce1,
            deadline
          );

          let VRS_DEPOSIT = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let vDeposit = VRS_DEPOSIT.v;
          let rDeposit = VRS_DEPOSIT.r;
          let sDeposit = VRS_DEPOSIT.s;

          const nonce2 = await contractBSNTokenPrice.nonces(
            users.buyer.address
          );

          const digestPrice = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractCashier.address,
            constants.product_price,
            nonce2,
            deadline
          );

          let VRS_PRICE = ecsign(
            Buffer.from(digestPrice.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let vPrice = VRS_PRICE.v;
          let rPrice = VRS_PRICE.r;
          let sPrice = VRS_PRICE.s;

          await truffleAssert.reverts(
            contractBosonRouter.requestVoucherTKNTKNWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              tokensToSend,
              deadline,
              vPrice,
              rPrice,
              sPrice,
              vDeposit,
              rDeposit,
              sDeposit,
              {from: users.buyer.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          const nonce1 = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const tokensToSend = new BN(constants.product_price).add(
            new BN(constants.buyer_incorrect_deposit)
          );

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractCashier.address,
            constants.buyer_deposit,
            nonce1,
            deadline
          );

          let VRS_DEPOSIT = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let vDeposit = VRS_DEPOSIT.v;
          let rDeposit = VRS_DEPOSIT.r;
          let sDeposit = VRS_DEPOSIT.s;

          const nonce2 = await contractBSNTokenPrice.nonces(
            users.buyer.address
          );

          const digestPrice = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractCashier.address,
            constants.product_price,
            nonce2,
            deadline
          );

          let VRS_PRICE = ecsign(
            Buffer.from(digestPrice.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let vPrice = VRS_PRICE.v;
          let rPrice = VRS_PRICE.r;
          let sPrice = VRS_PRICE.s;

          await truffleAssert.reverts(
            contractBosonRouter.requestVoucherTKNTKNWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              tokensToSend,
              deadline,
              vPrice,
              rPrice,
              sPrice,
              vDeposit,
              rDeposit,
              sDeposit,
              {from: users.buyer.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('TKNTKN Same', () => {
        const tokensToMintSeller = new BN(constants.seller_deposit).mul(
          new BN(ORDER_QTY)
        );
        const tokensToMintBuyer = new BN(constants.product_price).mul(
          new BN(ORDER_QTY)
        );

        before(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKNSame()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await utils.contractBSNTokenSame.mint(
            users.seller.address,
            tokensToMintSeller
          );
          await utils.contractBSNTokenSame.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          );
        });

        it('Buyer correlationId should be zero initially', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.buyer.address
          );

          assert.equal(
            correlationId.toString(),
            0,
            'Buyer correlationId is not as expected'
          );
        });

        it('Should create voucher', async () => {
          const nonce = await utils.contractBSNTokenSame.nonces(
            users.buyer.address
          );
          const tokensToSend = new BN(constants.product_price).add(
            new BN(constants.buyer_deposit)
          );

          const digestTokens = await getApprovalDigest(
            utils.contractBSNTokenSame,
            users.buyer.address,
            contractBosonRouter.address,
            tokensToSend,
            nonce,
            deadline
          );

          let VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let v = VRS_TOKENS.v;
          let r = VRS_TOKENS.r;
          let s = VRS_TOKENS.s;

          let txFillOrder = await contractBosonRouter.requestVoucherTKNTKNSameWithPermit(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            tokensToSend,
            deadline,
            v,
            r,
            s,
            {from: users.buyer.address}
          );

          let internalTx = await truffleAssert.createTransactionResult(
            contractVoucherKernel,
            txFillOrder.tx
          );

          truffleAssert.eventEmitted(
            internalTx,
            'LogVoucherDelivered',
            (ev) => {
              tokenVoucherKey1 = ev._tokenIdVoucher;
              return ev._issuer === users.seller.address;
            },
            'order1 not created successfully'
          );

          assert.isDefined(tokenVoucherKey1);
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          let utilsEthEth = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await truffleAssert.reverts(
            utilsEthEth.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Buyer correlationId should be incremented after requesting a voucher', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.buyer.address
          );

          assert.equal(
            correlationId.toString(),
            1,
            'Buyer correlationId is not as expected'
          );
        });

        it('Cashier Contract has correct amount of funds', async () => {
          const cashierTokenBalanceSame = await utils.contractBSNTokenSame.balanceOf(
            contractCashier.address
          );
          const sellerDeposits = new BN(constants.seller_deposit).mul(
            new BN(ORDER_QTY)
          );
          const buyerTokensSent = new BN(constants.product_price).add(
            new BN(constants.buyer_deposit)
          );
          const expectedDepositBalance = buyerTokensSent.add(sellerDeposits);

          assert.isTrue(
            new BN(cashierTokenBalanceSame).eq(expectedDepositBalance),
            'Cashier amount is incorrect'
          );
        });

        it('Escrows should be updated', async () => {
          const sellerDeposits = new BN(constants.seller_deposit).mul(
            new BN(ORDER_QTY)
          );
          const buyerTknSent = new BN(constants.product_price).add(
            new BN(constants.buyer_deposit)
          );

          const escrowSellerTknDeposit = await contractCashier.getEscrowTokensAmount(
            utils.contractBSNTokenSame.address,
            users.seller.address
          );
          const escrowBuyerTkn = await contractCashier.getEscrowTokensAmount(
            utils.contractBSNTokenSame.address,
            users.buyer.address
          );

          assert.isTrue(
            new BN(sellerDeposits).eq(escrowSellerTknDeposit),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            new BN(buyerTknSent).eq(escrowBuyerTkn),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          const nonce = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const incorrectTokensToSign = new BN(
            constants.incorrect_product_price
          ).add(new BN(constants.buyer_deposit));
          const digestTokens = await getApprovalDigest(
            utils.contractBSNTokenSame,
            users.buyer.address,
            contractCashier.address,
            incorrectTokensToSign,
            nonce,
            deadline
          );

          let VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let v = VRS_TOKENS.v;
          let r = VRS_TOKENS.r;
          let s = VRS_TOKENS.s;

          await truffleAssert.reverts(
            contractBosonRouter.requestVoucherTKNTKNSameWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              incorrectTokensToSign,
              deadline,
              v,
              r,
              s,
              {from: users.buyer.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          const nonce = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const incorrectTokensToSign = new BN(constants.product_price).add(
            new BN(constants.buyer_incorrect_deposit)
          );
          const digestTokens = await getApprovalDigest(
            utils.contractBSNTokenSame,
            users.buyer.address,
            contractCashier.address,
            incorrectTokensToSign,
            nonce,
            deadline
          );

          let VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let v = VRS_TOKENS.v;
          let r = VRS_TOKENS.r;
          let s = VRS_TOKENS.s;

          await truffleAssert.reverts(
            contractBosonRouter.requestVoucherTKNTKNSameWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              incorrectTokensToSign,
              deadline,
              v,
              r,
              s,
              {from: users.buyer.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should revert if Price Token and Deposit Token are diff contracts', async () => {
          //get instance with different Price token and Deposit Token addresses
          let utilsTKNTKN = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await contractBSNTokenDeposit.mint(
            users.seller.address,
            tokensToMintSeller
          );
          await contractBSNTokenDeposit.mint(
            users.buyer.address,
            tokensToMintBuyer
          );
          await contractBSNTokenPrice.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utilsTKNTKN.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          );

          const nonce = await utils.contractBSNTokenSame.nonces(
            users.buyer.address
          );
          const tokensToSend = new BN(constants.product_price).add(
            new BN(constants.buyer_deposit)
          );

          const digestTokens = await getApprovalDigest(
            utils.contractBSNTokenSame,
            users.buyer.address,
            contractBosonRouter.address,
            tokensToSend,
            nonce,
            deadline
          );

          let VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let v = VRS_TOKENS.v;
          let r = VRS_TOKENS.r;
          let s = VRS_TOKENS.s;

          await truffleAssert.reverts(
            contractBosonRouter.requestVoucherTKNTKNSameWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              tokensToSend,
              deadline,
              v,
              r,
              s,
              {from: users.buyer.address}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('TKNETH', () => {
        before(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const tokensToMintBuyer = new BN(constants.product_price).mul(
            new BN(ORDER_QTY)
          );

          await contractBSNTokenPrice.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          );
        });

        it('Buyer correlationId should be zero initially', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.buyer.address
          );

          assert.equal(
            correlationId.toString(),
            0,
            'Buyer correlationId is not as expected'
          );
        });

        it('Should create order', async () => {
          const nonce = await contractBSNTokenPrice.nonces(users.buyer.address);

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractBosonRouter.address,
            constants.product_price,
            nonce,
            deadline
          );

          let {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          let txFillOrder = await contractBosonRouter.requestVoucherTKNETHWithPermit(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            constants.product_price,
            deadline,
            v,
            r,
            s,
            {from: users.buyer.address, value: constants.buyer_deposit}
          );

          let internalTx = await truffleAssert.createTransactionResult(
            contractVoucherKernel,
            txFillOrder.tx
          );

          truffleAssert.eventEmitted(
            internalTx,
            'LogVoucherDelivered',
            (ev) => {
              tokenVoucherKey = ev._tokenIdVoucher;
              return ev._issuer === users.seller.address;
            },
            'order1 not created successfully'
          );

          assert.isDefined(tokenVoucherKey);
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          let utilsEthEth = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await truffleAssert.reverts(
            utilsEthEth.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Buyer correlationId should be incremented after requesting a voucher', async () => {
          const correlationId = await contractBosonRouter.correlationIds(
            users.buyer.address
          );

          assert.equal(
            correlationId.toString(),
            1,
            'Buyer correlationId is not as expected'
          );
        });

        it('Cashier Contract has correct amount of funds', async () => {
          const cashierDepositETH = await web3.eth.getBalance(
            contractCashier.address
          );
          const sellerDeposits = new BN(constants.seller_deposit).mul(
            new BN(ORDER_QTY)
          );
          const expectedDepositBalance = new BN(constants.buyer_deposit).add(
            sellerDeposits
          );

          const cashierPriceTokenBalance = await contractBSNTokenPrice.balanceOf(
            contractCashier.address
          );

          assert.isTrue(
            new BN(cashierDepositETH).eq(expectedDepositBalance),
            'Cashier amount is incorrect'
          );
          assert.isTrue(
            new BN(cashierPriceTokenBalance).eq(
              new BN(constants.product_price)
            ),
            'Cashier amount is incorrect'
          );
        });

        it('Escrow should be updated', async () => {
          const sellerDeposits = new BN(constants.seller_deposit).mul(
            new BN(ORDER_QTY)
          );

          const buyerTknSent = new BN(constants.product_price);
          const buyerEthSent = new BN(constants.buyer_deposit);

          const escrowSeller = await contractCashier.getEscrowAmount(
            users.seller.address
          );
          const escrowBuyerEth = await contractCashier.getEscrowAmount(
            users.buyer.address
          );
          const escrowBuyerTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.buyer.address
          );

          assert.isTrue(
            new BN(sellerDeposits).eq(escrowSeller),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            new BN(buyerEthSent).eq(escrowBuyerEth),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            new BN(buyerTknSent).eq(escrowBuyerTkn),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          const nonce = await contractBSNTokenPrice.nonces(users.buyer.address);

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractCashier.address,
            constants.product_price,
            nonce,
            deadline
          );

          let {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestVoucherTKNETHWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              constants.product_price,
              deadline,
              v,
              r,
              s,
              {
                from: users.buyer.address,
                value: constants.buyer_incorrect_deposit,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          const nonce = await contractBSNTokenPrice.nonces(users.buyer.address);

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractCashier.address,
            constants.product_price,
            nonce,
            deadline
          );

          let {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            contractBosonRouter.requestVoucherTKNETHWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              constants.incorrect_product_price,
              deadline,
              v,
              r,
              s,
              {from: users.buyer.address, value: constants.buyer_deposit}
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });
    });

    describe('[NEGATIVE] Common voucher interactions after expiry', () => {
      const TEN_MINUTES = 10 * constants.ONE_MINUTE;
      const cancelPeriod = constants.ONE_MINUTE;
      const complainPeriod = constants.ONE_MINUTE;
      let snapshot;

      beforeEach(async () => {
        await deployContracts();
        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        snapshot = await timemachine.takeSnapshot();

        const timestamp = await Utils.getCurrTimestamp();

        constants.PROMISE_VALID_FROM = timestamp;
        constants.PROMISE_VALID_TO = timestamp + TEN_MINUTES;

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      afterEach(async () => {
        await timemachine.revertToSnapShot(snapshot.id);
      });

      it('[!COMMIT] Buyer should not be able to commit after expiry date has passed', async () => {
        await timemachine.advanceTimeSeconds(
          constants.PROMISE_VALID_TO + constants.ONE_MINUTE
        );

        await truffleAssert.reverts(
          utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->!CANCEL] Seller should not be able to cancel after complain and expiry periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await timemachine.advanceTimeSeconds(
          constants.PROMISE_VALID_TO + cancelPeriod + complainPeriod
        );

        await truffleAssert.reverts(
          utils.cancel(voucherID, users.seller.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->CANCEL->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(
          complainPeriod + constants.ONE_MINUTE
        );

        await truffleAssert.reverts(
          utils.complain(voucherID, users.buyer.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->!REFUND] Buyer should not be able to refund after expiry date has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await timemachine.advanceTimeSeconds(
          constants.PROMISE_VALID_TO + constants.ONE_MINUTE
        );

        await truffleAssert.reverts(
          utils.refund(voucherID, users.buyer.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->!REDEEM] Buyer should not be able to redeem after expiry date has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await timemachine.advanceTimeSeconds(
          constants.PROMISE_VALID_TO + constants.ONE_MINUTE
        );

        await truffleAssert.reverts(
          utils.redeem(voucherID, users.buyer.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->REDEEM->!COMPLAIN] Buyer should not be able to complain after complain and cancel periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(
          complainPeriod + cancelPeriod + constants.ONE_MINUTE
        );

        await truffleAssert.reverts(
          utils.complain(voucherID, users.buyer.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->REDEEM->!CANCEL] Seller should not be able to cancel after complain and cancel periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(
          complainPeriod + cancelPeriod + constants.ONE_MINUTE
        );

        await truffleAssert.reverts(
          utils.cancel(voucherID, users.seller.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->REDEEM->CANCEL->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address),
          await timemachine.advanceTimeSeconds(
            complainPeriod + constants.ONE_MINUTE
          );

        await truffleAssert.reverts(
          utils.complain(voucherID, users.buyer.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->REDEEM->COMPLAIN->!CANCEL] Seller should not be able to cancel after cancel period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address),
          await timemachine.advanceTimeSeconds(
            cancelPeriod + constants.ONE_MINUTE
          );

        await truffleAssert.reverts(
          utils.cancel(voucherID, users.seller.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->REFUND->!CANCEL] Seller should not be able to cancel after cancel & complain periods expire', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(
          complainPeriod + cancelPeriod + constants.ONE_MINUTE
        );

        await truffleAssert.reverts(
          utils.cancel(voucherID, users.seller.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->REFUND->!COMPLAIN] Buyer should not be able to complain after complain and expiry periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(
          complainPeriod + cancelPeriod + constants.ONE_MINUTE
        );

        await truffleAssert.reverts(
          utils.complain(voucherID, users.buyer.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->REFUND->COMPLAIN->!CANCEL] Seller should not be able to cancel after cancel period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(
          cancelPeriod + constants.ONE_MINUTE
        );

        await truffleAssert.reverts(
          utils.cancel(voucherID, users.seller.address),
          truffleAssert.ErrorType.reverts
        );
      });

      it('[COMMIT->REFUND->CANCEL->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(
          complainPeriod + constants.ONE_MINUTE
        );

        await truffleAssert.reverts(
          utils.complain(voucherID, users.buyer.address),
          truffleAssert.ErrorType.reverts
        );
      });
    });
  });

  describe('TOKEN SUPPLY TRANSFER', () => {
    let actualOldOwnerBalanceFromEscrow = new BN(0);
    let actualNewOwnerBalanceFromEscrow = new BN(0);
    let expectedBalanceInEscrow = new BN(0);

    afterEach(() => {
      distributedAmounts = {
        buyerAmount: new BN(0),
        sellerAmount: new BN(0),
        escrowAmount: new BN(0),
      };
    });

    describe('Common transfer', () => {
      beforeEach(async () => {
        await deployContracts();
        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        const timestamp = await Utils.getCurrTimestamp();

        tokenSupplyKey = await utils.createOrder(
          users.other1,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('Should transfer voucher supply', async () => {
        let transferTx = await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_10,
          {from: users.other1.address}
        );

        truffleAssert.eventEmitted(
          transferTx,
          'TransferSingle',
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other2.address);
            assert.equal(ev._id.toString(), tokenSupplyKey);
            assert.equal(ev._value.toString(), constants.QTY_10);

            return true;
          },
          'TransferSingle not emitted'
        );
      });

      it('Should transfer voucher supply to self and balance should be the same', async () => {
        let balanceBeforeTransfer = await contractERC1155ERC721.balanceOf(
          users.other1.address,
          tokenSupplyKey
        );

        let transferTx = await utils.safeTransfer1155(
          users.other1.address,
          users.other1.address,
          tokenSupplyKey,
          constants.QTY_10,
          {from: users.other1.address}
        );

        let balanceAfterTransfer = await contractERC1155ERC721.balanceOf(
          users.other1.address,
          tokenSupplyKey
        );

        assert.isTrue(
          balanceBeforeTransfer.eq(balanceAfterTransfer),
          'Balance mismatch!'
        );

        truffleAssert.eventEmitted(
          transferTx,
          'TransferSingle',
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other1.address);
            assert.equal(ev._id.toString(), tokenSupplyKey);
            assert.equal(ev._value.toString(), constants.QTY_10);

            return true;
          },
          'TransferSingle not emitted'
        );
      });

      it('[NEGATIVE] Should revert if owner tries to transfer voucher supply partially', async () => {
        await truffleAssert.reverts(
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Should revert if Attacker tries to transfer voucher supply', async () => {
        await truffleAssert.reverts(
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_10,
            {from: users.attacker.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Should transfer batch voucher supply', async () => {
        let transferTx = await utils.safeBatchTransfer1155(
          users.other1.address,
          users.other2.address,
          [tokenSupplyKey],
          [constants.QTY_10],
          {from: users.other1.address}
        );

        truffleAssert.eventEmitted(
          transferTx,
          'TransferBatch',
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other2.address);
            assert.equal(
              JSON.stringify(ev._ids),
              JSON.stringify([new BN(tokenSupplyKey)])
            );
            assert.equal(
              JSON.stringify(ev._values),
              JSON.stringify([new BN(constants.QTY_10)])
            );

            return true;
          },
          'TransferSingle not emitted'
        );
      });

      it('Should transfer batch voucher supply to self and balance should be the same', async () => {
        let balanceBeforeTransfer = await contractERC1155ERC721.balanceOf(
          users.other1.address,
          tokenSupplyKey
        );

        let transferTx = await utils.safeBatchTransfer1155(
          users.other1.address,
          users.other1.address,
          [tokenSupplyKey],
          [constants.QTY_10],
          {from: users.other1.address}
        );

        let balanceAfterTransfer = await contractERC1155ERC721.balanceOf(
          users.other1.address,
          tokenSupplyKey
        );

        assert.isTrue(
          balanceBeforeTransfer.eq(balanceAfterTransfer),
          'Balance mismatch!'
        );

        truffleAssert.eventEmitted(
          transferTx,
          'TransferBatch',
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other1.address);
            assert.equal(
              JSON.stringify(ev._ids),
              JSON.stringify([new BN(tokenSupplyKey)])
            );
            assert.equal(
              JSON.stringify(ev._values),
              JSON.stringify([new BN(constants.QTY_10)])
            );

            return true;
          },
          'TransferSingle not emitted'
        );
      });

      it('[NEGATIVE] Should revert if owner tries to transfer voucher supply batch partially', async () => {
        await truffleAssert.reverts(
          utils.safeBatchTransfer1155(
            users.other1.address,
            users.other2.address,
            [tokenSupplyKey],
            [constants.QTY_1],
            {from: users.other1.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Should revert if Attacker tries to transfer batch voucher supply', async () => {
        await truffleAssert.reverts(
          utils.safeBatchTransfer1155(
            users.other1.address,
            users.other2.address,
            [tokenSupplyKey],
            [constants.QTY_10],
            {from: users.attacker.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('ETHETH', () => {
      beforeEach(async () => {
        await deployContracts();

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        tokenSupplyKey = await utils.createOrder(
          users.other1,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_1
        );
      });

      it('New Supply Owner correlationId should be incremented properly', async () => {
        let correlationId = await contractBosonRouter.correlationIds(
          users.other2.address
        );
        assert.equal(
          correlationId.toString(),
          0,
          'New Supply Owner correlationId is not as expected'
        );

        await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          {from: users.other1.address}
        );

        correlationId = await contractBosonRouter.correlationIds(
          users.other2.address
        );

        assert.equal(
          correlationId.toString(),
          1,
          'New Supply Owner correlationId is not as expected'
        );
      });

      it('Should update escrow amounts after transfer', async () => {
        expectedBalanceInEscrow = new BN(constants.seller_deposit).mul(
          new BN(constants.QTY_1)
        );

        actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(
          users.other1.address
        );
        actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(ZERO),
          'New owner balance from escrow does not match'
        );

        await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          {
            from: users.other1.address,
          }
        ),
          (actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(
            users.other1.address
          ));
        actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(ZERO),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'New owner balance from escrow does not match'
        );
      });

      it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
        const expectedBuyerAmount = new BN(constants.buyer_deposit); // 0.04
        const expectedSellerAmount = new BN(constants.seller_deposit).add(
          new BN(constants.product_price)
        ); // 0.35
        const expectedEscrowAmount = new BN(0); // 0

        utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          {
            from: users.other1.address,
          }
        );

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.other2,
          tokenSupplyKey
        );

        await utils.redeem(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        let withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        truffleAssert.eventEmitted(
          withdrawTx,
          'LogAmountDistribution',
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.other2.address
            );
            return true;
          },
          'Amounts not distributed successfully'
        );

        assert.isTrue(
          distributedAmounts.buyerAmount.eq(expectedBuyerAmount),
          'Buyer Amount is not as expected'
        );
        assert.isTrue(
          distributedAmounts.sellerAmount.eq(expectedSellerAmount),
          'Seller Amount is not as expected'
        );
        assert.isTrue(
          distributedAmounts.escrowAmount.eq(expectedEscrowAmount),
          'Escrow Amount is not as expected'
        );
      });

      it('New owner should be able to COF', async () => {
        utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          {
            from: users.other1.address,
          }
        );

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.other2,
          tokenSupplyKey
        );

        await utils.redeem(voucherID, users.buyer.address);

        await utils.cancel(voucherID, users.other2.address);
      });

      it('[NEGATIVE] Old owner should not be able to COF', async () => {
        utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          {
            from: users.other1.address,
          }
        );

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.other2,
          tokenSupplyKey
        );

        await utils.redeem(voucherID, users.buyer.address);

        await truffleAssert.reverts(
          utils.cancel(voucherID, users.other1.address),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', () => {
        let balanceBuyerFromDeposits = new BN(0);

        let balanceSellerFromDeposits = new BN(0);

        let escrowBalanceFromDeposits = new BN(0);

        let cashierPaymentLeft = new BN(0);
        let cashierDepositLeft = new BN(0);

        beforeEach(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const timestamp = await Utils.getCurrTimestamp();

          const tokensToMint = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_1)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            constants.buyer_deposit
          );

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );
        });

        async function getBalancesDepositToken() {
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.buyer.address
          );
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.other2.address
          );
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.deployer.address
          );
          cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          );
        }

        it('New Supply Owner correlationId should be incremented properly', async () => {
          let correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );
          assert.equal(
            correlationId.toString(),
            0,
            'New Supply Owner correlationId is not as expected'
          );

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );

          assert.equal(
            correlationId.toString(),
            1,
            'New Supply Owner correlationId is not as expected'
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          expectedBalanceInEscrow = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_1)
          );

          actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );
          actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {
              from: users.other1.address,
            }
          ),
            (actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            ));
          actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(ZERO),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerDeposit = new BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = new BN(constants.product_price); //// 0.3
          const expectedSellerDeposit = new BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = new BN(0);

          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.address);

          await timemachine.advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.address);

          let withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.address
          );

          await getBalancesDepositToken();

          // Payment should have been sent to seller
          truffleAssert.eventEmitted(
            withdrawTx,
            'LogWithdrawal',
            (ev) => {
              assert.equal(ev._payee, users.other2.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerPrice));

              return true;
            },
            'Event LogWithdrawal was not emitted'
          );

          //Deposits
          assert.isTrue(
            balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
            'Buyer did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            balanceSellerFromDeposits.eq(expectedSellerDeposit),
            'Seller did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
            'Escrow did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(new BN(0)),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(new BN(0)),
            'Cashier Contract is not empty'
          );

          truffleAssert.eventEmitted(
            withdrawTx,
            'LogAmountDistribution',
            () => {
              return true;
            },
            'Event LogAmountDistribution was not emitted'
          );
        });

        it('New owner should be able to COF', async () => {
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.address);

          await utils.cancel(voucherID, users.other2.address);
        });

        it('[NEGATIVE] Old owner should not be able to COF', async () => {
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.address);

          await truffleAssert.reverts(
            utils.cancel(voucherID, users.other1.address),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('TKNTKN', () => {
        let balanceBuyerFromPayment = new BN(0);
        let balanceBuyerFromDeposits = new BN(0);

        let balanceSellerFromPayment = new BN(0);
        let balanceSellerFromDeposits = new BN(0);

        let escrowBalanceFromPayment = new BN(0);
        let escrowBalanceFromDeposits = new BN(0);

        let cashierPaymentLeft = new BN(0);
        let cashierDepositLeft = new BN(0);

        beforeEach(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const timestamp = await Utils.getCurrTimestamp();

          const supplyQty = 1;
          const tokensToMint = new BN(constants.seller_deposit).mul(
            new BN(supplyQty)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            constants.product_price
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            constants.buyer_deposit
          );

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            supplyQty
          );
        });

        async function getBalancesFromPiceTokenAndDepositToken() {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.buyer.address
          );
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.buyer.address
          );

          balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.other2.address
          );
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.other2.address
          );

          escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.deployer.address
          );
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.deployer.address
          );

          cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          );
          cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          );
        }

        it('New Supply Owner correlationId should be incremented properly', async () => {
          let correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );
          assert.equal(
            correlationId.toString(),
            0,
            'New Supply Owner correlationId is not as expected'
          );

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );

          assert.equal(
            correlationId.toString(),
            1,
            'New Supply Owner correlationId is not as expected'
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          expectedBalanceInEscrow = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_1)
          );

          actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );
          actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {
              from: users.other1.address,
            }
          ),
            (actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            ));
          actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(ZERO),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = new BN(0);
          const expectedBuyerDeposit = new BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = new BN(constants.product_price); //// 0.3
          const expectedSellerDeposit = new BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = new BN(0);
          const expectedEscrowAmountPrice = new BN(0);

          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.address);

          await timemachine.advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.address
          );

          await getBalancesFromPiceTokenAndDepositToken();

          //Payments
          assert.isTrue(
            balanceBuyerFromPayment.eq(expectedBuyerPrice),
            'Buyer did not get expected tokens from PriceTokenContract'
          );
          assert.isTrue(
            balanceSellerFromPayment.eq(expectedSellerPrice),
            'Seller did not get expected tokens from PriceTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromPayment.eq(expectedEscrowAmountPrice),
            'Escrow did not get expected tokens from PriceTokenContract'
          );

          //Deposits
          assert.isTrue(
            balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
            'Buyer did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            balanceSellerFromDeposits.eq(expectedSellerDeposit),
            'Seller did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
            'Escrow did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(ZERO),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(ZERO),
            'Cashier Contract is not empty'
          );

          truffleAssert.eventEmitted(
            withdrawTx,
            'LogAmountDistribution',
            () => {
              return true;
            },
            'Event LogAmountDistribution was not emitted'
          );
        });

        it('New owner should be able to COF', async () => {
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.address);

          await utils.cancel(voucherID, users.other2.address);
        });

        it('[NEGATIVE] Old owner should not be able to COF', async () => {
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.address);

          await truffleAssert.reverts(
            utils.cancel(voucherID, users.other1.address),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('TKNETH', () => {
        let balanceBuyerFromPayment = new BN(0);
        let balanceSellerFromPayment = new BN(0);
        let escrowBalanceFromPayment = new BN(0);

        let cashierPaymentLeft = new BN(0);
        let cashierDepositLeft = new BN(0);

        beforeEach(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              ''
            );

          const timestamp = await Utils.getCurrTimestamp();

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            constants.product_price
          );

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );
        });

        async function getBalancesPriceToken() {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.buyer.address
          );
          balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.other2.address
          );
          escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.deployer.address
          );
          cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          );
        }

        it('New Supply Owner correlationId should be incremented properly', async () => {
          let correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );
          assert.equal(
            correlationId.toString(),
            0,
            'New Supply Owner correlationId is not as expected'
          );

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );

          assert.equal(
            correlationId.toString(),
            1,
            'New Supply Owner correlationId is not as expected'
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          expectedBalanceInEscrow = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_1)
          );

          actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(
            users.other1.address
          );
          actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(
            users.other1.address
          );
          actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(ZERO),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = new BN(0);
          const expectedSellerPrice = new BN(constants.product_price); // 0.3
          const expectedEscrowPrice = new BN(0);
          const expectedBuyerDeposit = new BN(constants.buyer_deposit); // 0.04
          const expectedSellerDeposit = new BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = new BN(0);

          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );
          await utils.redeem(voucherID, users.buyer.address);

          await timemachine.advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.address);

          let withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.address
          );

          await getBalancesPriceToken();

          // Payments in TKN
          // Payment should have been sent to seller
          assert.isTrue(
            balanceBuyerFromPayment.eq(expectedBuyerPrice),
            'Buyer did not get expected tokens from PaymentTokenContract'
          );
          assert.isTrue(
            balanceSellerFromPayment.eq(expectedSellerPrice),
            'Seller did not get expected tokens from PaymentTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromPayment.eq(expectedEscrowPrice),
            'Escrow did not get expected tokens from PaymentTokenContract'
          );

          //Deposits in ETH
          truffleAssert.eventEmitted(
            withdrawTx,
            'LogWithdrawal',
            (ev) => {
              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_payee',
                users.buyer.address,
                users.other2.address
              );
              return true;
            },
            'Amounts not distributed successfully'
          );

          assert.isTrue(
            distributedAmounts.buyerAmount.eq(expectedBuyerDeposit),
            'Buyer Amount is not as expected'
          );
          assert.isTrue(
            distributedAmounts.sellerAmount.eq(expectedSellerDeposit),
            'Seller Amount is not as expected'
          );
          assert.isTrue(
            distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit),
            'Escrow Amount is not as expected'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(new BN(0)),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(new BN(0)),
            'Cashier Contract is not empty'
          );

          truffleAssert.eventEmitted(
            withdrawTx,
            'LogAmountDistribution',
            () => {
              return true;
            },
            'Event LogAmountDistribution was not emitted'
          );
        });

        it('New owner should be able to COF', async () => {
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.address);

          await utils.cancel(voucherID, users.other2.address);
        });

        it('[NEGATIVE] Old owner should not be able to COF', async () => {
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            {from: users.other1.address}
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.address);

          await truffleAssert.reverts(
            utils.cancel(voucherID, users.other1.address),
            truffleAssert.ErrorType.REVERT
          );
        });
      });
    });
  });

  describe('VOUCHER TRANSFER', () => {
    let actualOldOwnerBalanceFromEscrowEth = new BN(0);
    let actualOldOwnerBalanceFromEscrowTkn = new BN(0);
    let actualNewOwnerBalanceFromEscrowEth = new BN(0);
    let actualNewOwnerBalanceFromEscrowTkn = new BN(0);

    afterEach(() => {
      distributedAmounts = {
        buyerAmount: new BN(0),
        sellerAmount: new BN(0),
        escrowAmount: new BN(0),
      };

      actualOldOwnerBalanceFromEscrowEth = new BN(0);
      actualOldOwnerBalanceFromEscrowTkn = new BN(0);
      actualNewOwnerBalanceFromEscrowEth = new BN(0);
      actualNewOwnerBalanceFromEscrowTkn = new BN(0);
    });

    describe('Common transfer', () => {
      before(async () => {
        await deployContracts();

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        tokenSupplyKey = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('Should transfer a voucher', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        let transferTx = await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          {
            from: users.other1.address,
          }
        );

        truffleAssert.eventEmitted(
          transferTx,
          'Transfer',
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other2.address);
            assert.equal(ev._tokenId.toString(), voucherID);

            return true;
          },
          'Transfer not emitted'
        );
      });

      it('Should transfer voucher to self and balance should be the same', async () => {
        const methodSignature = 'balanceOf(' + 'address)';
        const balanceOf = contractERC1155ERC721.methods[methodSignature];

        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        let balanceBeforeTransfer = await balanceOf(users.other1.address);

        let transferTx = await utils.safeTransfer721(
          users.other1.address,
          users.other1.address,
          voucherID,
          {
            from: users.other1.address,
          }
        );

        let balanceAfterTransfer = await balanceOf(users.other1.address);

        assert.isTrue(
          balanceBeforeTransfer.eq(balanceAfterTransfer),
          'Balance mismatch!'
        );

        truffleAssert.eventEmitted(
          transferTx,
          'Transfer',
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other1.address);
            assert.equal(ev._tokenId.toString(), voucherID);

            return true;
          },
          'Transfer not emitted'
        );
      });
    });

    describe('ETHETH', async () => {
      beforeEach(async () => {
        await deployContracts();

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        tokenSupplyKey = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('New Voucher Owner correlationId should be incremented properly', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        let correlationId = await contractBosonRouter.correlationIds(
          users.other2.address
        );
        assert.equal(
          correlationId.toString(),
          0,
          'New Voucher Owner correlationId is not as expected'
        );

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          {from: users.other1.address}
        );

        correlationId = await contractBosonRouter.correlationIds(
          users.other2.address
        );
        assert.equal(
          correlationId.toString(),
          1,
          'New Voucher Owner correlationId is not as expected'
        );
      });

      it('Should update escrow amounts after transfer', async () => {
        const expectedBalanceInEscrow = new BN(constants.product_price).add(
          new BN(constants.buyer_deposit)
        );
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        actualOldOwnerBalanceFromEscrowEth = await contractCashier.escrow(
          users.other1.address
        );
        actualNewOwnerBalanceFromEscrowEth = await contractCashier.escrow(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrowEth.eq(ZERO),
          'New owner balance from escrow does not match'
        );

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          {
            from: users.other1.address,
          }
        );

        actualOldOwnerBalanceFromEscrowEth = await contractCashier.escrow(
          users.other1.address
        );
        actualNewOwnerBalanceFromEscrowEth = await contractCashier.escrow(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrowEth.eq(ZERO),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrow),
          'New owner balance from escrow does not match'
        );
      });

      it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
        const expectedBuyerAmount = new BN(constants.buyer_deposit)
          .add(new BN(constants.product_price))
          .add(new BN(constants.seller_deposit).div(new BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = new BN(constants.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmount = new BN(constants.seller_deposit).div(
          new BN(4)
        ); // 0.0125

        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          {
            from: users.other1.address,
          }
        );

        await utils.refund(voucherID, users.other2.address);
        await utils.complain(voucherID, users.other2.address);
        await utils.cancel(voucherID, users.seller.address);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        truffleAssert.eventEmitted(
          withdrawTx,
          'LogAmountDistribution',
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.other2.address,
              users.seller.address
            );
            return true;
          },
          'Amounts not distributed successfully'
        );

        assert.isTrue(
          distributedAmounts.buyerAmount.eq(expectedBuyerAmount),
          'Buyer Amount is not as expected'
        );
        assert.isTrue(
          distributedAmounts.sellerAmount.eq(expectedSellerAmount),
          'Seller Amount is not as expected'
        );
        assert.isTrue(
          distributedAmounts.escrowAmount.eq(expectedEscrowAmount),
          'Escrow Amount is not as expected'
        );
      });

      it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        await utils.refund(voucherID, users.other1.address);
        await utils.complain(voucherID, users.other1.address);
        await utils.cancel(voucherID, users.seller.address);
        await utils.finalize(voucherID, users.deployer.address);

        await utils.withdraw(voucherID, users.deployer.address);

        await truffleAssert.reverts(
          utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {
              from: users.other1.address,
            }
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          {
            from: users.other1.address,
          }
        );

        await truffleAssert.reverts(
          utils.redeem(voucherID, users.other1.address),
          truffleAssert.ErrorType.REVERT
        );

        await truffleAssert.reverts(
          utils.refund(voucherID, users.other1.address),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        await truffleAssert.reverts(
          utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {
              from: users.attacker.address,
            }
          ),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', () => {
        let balanceBuyerFromDeposits = new BN(0);
        let balanceSellerFromDeposits = new BN(0);
        let escrowBalanceFromDeposits = new BN(0);

        let cashierPaymentLeft = new BN(0);
        let cashierDepositLeft = new BN(0);

        async function getBalancesDepositToken() {
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.other2.address
          );
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.seller.address
          );
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.deployer.address
          );
          cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          );
        }

        beforeEach(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const timestamp = await Utils.getCurrTimestamp();

          const supplyQty = 1;
          const tokensToMint = new BN(constants.seller_deposit).mul(
            new BN(supplyQty)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            constants.buyer_deposit
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            supplyQty
          );
        });

        afterEach(async () => {
          distributedAmounts = {
            buyerAmount: new BN(0),
            sellerAmount: new BN(0),
            escrowAmount: new BN(0),
          };

          balanceBuyerFromDeposits = new BN(0);
          balanceSellerFromDeposits = new BN(0);
          escrowBalanceFromDeposits = new BN(0);

          cashierPaymentLeft = new BN(0);
          cashierDepositLeft = new BN(0);

          const isPaused = await contractCashier.paused();
          if (isPaused) {
            await contractCashier.unpause();
          }
        });

        it('New Voucher Owner correlationId should be incremented properly', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          let correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );
          assert.equal(
            correlationId.toString(),
            0,
            'New Voucher Owner correlationId is not as expected'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {from: users.other1.address}
          );

          correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );
          assert.equal(
            correlationId.toString(),
            1,
            'New Voucher Owner correlationId is not as expected'
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          const expectedBalanceInEscrowEth = new BN(constants.product_price);
          const expectedBalanceInEscrowTkn = new BN(constants.buyer_deposit);

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          actualOldOwnerBalanceFromEscrowEth = await contractCashier.escrow(
            users.other1.address
          );

          actualOldOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );

          actualNewOwnerBalanceFromEscrowEth = await contractCashier.escrow(
            users.other2.address
          );

          actualNewOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrowEth),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTkn.eq(expectedBalanceInEscrowTkn),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowEth.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTkn.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {
              from: users.other1.address,
            }
          );

          actualOldOwnerBalanceFromEscrowEth = await contractCashier.escrow(
            users.other1.address
          );

          actualOldOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );

          actualNewOwnerBalanceFromEscrowEth = await contractCashier.escrow(
            users.other2.address
          );

          actualNewOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowEth.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTkn.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrowEth),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTkn.eq(expectedBalanceInEscrowTkn),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = new BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
            new BN(constants.seller_deposit).div(new BN(2))
          ); // 0.065
          const expectedSellerDeposit = new BN(constants.seller_deposit).div(
            new BN(4)
          ); // 0.0125
          const expectedEscrowAmountDeposit = new BN(
            constants.seller_deposit
          ).div(new BN(4)); // 0.0125

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {
              from: users.other1.address,
            }
          );

          await utils.refund(voucherID, users.other2.address);
          await utils.complain(voucherID, users.other2.address);
          await utils.cancel(voucherID, users.seller.address);
          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.address
          );

          await getBalancesDepositToken();

          // Payment should have been returned to buyer
          truffleAssert.eventEmitted(
            withdrawTx,
            'LogWithdrawal',
            (ev) => {
              assert.equal(ev._payee, users.other2.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));

              return true;
            },
            'Event LogAmountDistribution was not emitted'
          );

          //Deposits
          assert.isTrue(
            balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
            'NewVoucherOwner did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            balanceSellerFromDeposits.eq(expectedSellerDeposit),
            'Seller did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
            'Escrow did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(new BN(0)),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(new BN(0)),
            'Cashier Contract is not empty'
          );

          truffleAssert.eventEmitted(
            withdrawTx,
            'LogAmountDistribution',
            (ev) => {
              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.other2.address,
                users.seller.address
              );
              return true;
            },
            'Amounts not distributed successfully'
          );
        });

        it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.refund(voucherID, users.other1.address);
          await utils.complain(voucherID, users.other1.address);
          await utils.cancel(voucherID, users.seller.address);
          await utils.finalize(voucherID, users.deployer.address);

          await utils.withdraw(voucherID, users.deployer.address);

          await truffleAssert.reverts(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              {
                from: users.other1.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {
              from: users.other1.address,
            }
          );

          await truffleAssert.reverts(
            utils.redeem(voucherID, users.other1.address),
            truffleAssert.ErrorType.REVERT
          );

          await truffleAssert.reverts(
            utils.refund(voucherID, users.other1.address),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await truffleAssert.reverts(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              {
                from: users.attacker.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('TKNTKN', () => {
        let balanceBuyerFromPayment = new BN(0);
        let balanceBuyerFromDeposits = new BN(0);

        let balanceSellerFromPayment = new BN(0);
        let balanceSellerFromDeposits = new BN(0);

        let escrowBalanceFromPayment = new BN(0);
        let escrowBalanceFromDeposits = new BN(0);

        let cashierPaymentLeft = new BN(0);
        let cashierDepositLeft = new BN(0);

        async function getBalancesFromPiceTokenAndDepositToken() {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.other2.address
          );
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.other2.address
          );

          balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.seller.address
          );
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.seller.address
          );

          escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.deployer.address
          );
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.deployer.address
          );

          cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          );
          cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          );
        }

        beforeEach(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const timestamp = await Utils.getCurrTimestamp();

          const supplyQty = 1;
          const tokensToMint = new BN(constants.seller_deposit).mul(
            new BN(supplyQty)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.other1.address,
            constants.product_price
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            constants.buyer_deposit
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            supplyQty
          );
        });

        it('New Voucher Owner correlationId should be incremented properly', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          let correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );
          assert.equal(
            correlationId.toString(),
            0,
            'New Voucher Owner correlationId is not as expected'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {from: users.other1.address}
          );

          correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );
          assert.equal(
            correlationId.toString(),
            1,
            'New Voucher Owner correlationId is not as expected'
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          let expectedBalanceInEscrowTknPrice = new BN(constants.product_price);
          let expectedBalanceInEscrowTknDeposit = new BN(
            constants.buyer_deposit
          );
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          let actualOldOwnerBalanceFromEscrowTknPrice = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other1.address
          );

          let actualOldOwnerBalanceFromEscrowTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );

          let actualNewOwnerBalanceFromEscrowTknPrice = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other2.address
          );

          let actualNewOwnerBalanceFromEscrowTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTknPrice.eq(
              expectedBalanceInEscrowTknPrice
            ),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTknDeposit.eq(
              expectedBalanceInEscrowTknDeposit
            ),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTknPrice.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTknDeposit.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {
              from: users.other1.address,
            }
          ),
            (actualOldOwnerBalanceFromEscrowTknPrice = await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.other1.address
            ));

          actualOldOwnerBalanceFromEscrowTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );

          actualNewOwnerBalanceFromEscrowTknPrice = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other2.address
          );

          actualNewOwnerBalanceFromEscrowTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTknPrice.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTknDeposit.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTknPrice.eq(
              expectedBalanceInEscrowTknPrice
            ),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTknDeposit.eq(
              expectedBalanceInEscrowTknDeposit
            ),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = new BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
            new BN(constants.seller_deposit).div(new BN(2))
          ); // 0.065
          const expectedSellerPrice = new BN(0);
          const expectedSellerDeposit = new BN(constants.seller_deposit).div(
            new BN(4)
          ); // 0.0125
          const expectedEscrowAmountDeposit = new BN(
            constants.seller_deposit
          ).div(new BN(4)); // 0.0125
          const expectedEscrowAmountPrice = new BN(0);

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {from: users.other1.address}
          );

          await utils.refund(voucherID, users.other2.address);
          await utils.complain(voucherID, users.other2.address);
          await utils.cancel(voucherID, users.seller.address);
          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.address
          );

          await getBalancesFromPiceTokenAndDepositToken();

          //Payments
          assert.isTrue(
            balanceBuyerFromPayment.eq(expectedBuyerPrice),
            'Buyer did not get expected tokens from PriceTokenContract'
          );
          assert.isTrue(
            balanceSellerFromPayment.eq(expectedSellerPrice),
            'Seller did not get expected tokens from PriceTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromPayment.eq(expectedEscrowAmountPrice),
            'Escrow did not get expected tokens from PriceTokenContract'
          );

          //Deposits
          assert.isTrue(
            balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
            'Buyer did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            balanceSellerFromDeposits.eq(expectedSellerDeposit),
            'Seller did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
            'Buyer did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(new BN(0)),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(new BN(0)),
            'Cashier Contract is not empty'
          );

          truffleAssert.eventEmitted(
            withdrawTx,
            'LogAmountDistribution',
            () => {
              return true;
            },
            'Event LogAmountDistribution was not emitted'
          );
        });

        it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.refund(voucherID, users.other1.address);
          await utils.complain(voucherID, users.other1.address);
          await utils.cancel(voucherID, users.seller.address);
          await utils.finalize(voucherID, users.deployer.address);

          await utils.withdraw(voucherID, users.deployer.address);

          await truffleAssert.reverts(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              {
                from: users.other1.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {
              from: users.other1.address,
            }
          );

          await truffleAssert.reverts(
            utils.redeem(voucherID, users.other1.address),
            truffleAssert.ErrorType.REVERT
          );

          await truffleAssert.reverts(
            utils.refund(voucherID, users.other1.address),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await truffleAssert.reverts(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              {
                from: users.attacker.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('TKNETH', () => {
        let balanceBuyerFromPayment = new BN(0);
        let balanceSellerFromPayment = new BN(0);
        let escrowBalanceFromPayment = new BN(0);

        let cashierPaymentLeft = new BN(0);
        let cashierDepositLeft = new BN(0);

        beforeEach(async () => {
          await deployContracts();

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              ''
            );

          const timestamp = await Utils.getCurrTimestamp();

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.other1.address,
            constants.product_price
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );
        });

        async function getBalancesPriceToken() {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.other2.address
          );
          balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.seller.address
          );
          escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.deployer.address
          );
          cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          );
        }

        it('New Voucher Owner correlationId should be incremented properly', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          let correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );
          assert.equal(
            correlationId.toString(),
            0,
            'New Voucher Owner correlationId is not as expected'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {from: users.other1.address}
          );

          correlationId = await contractBosonRouter.correlationIds(
            users.other2.address
          );
          assert.equal(
            correlationId.toString(),
            1,
            'New Voucher Owner correlationId is not as expected'
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          const expectedBalanceInEscrowEth = new BN(constants.buyer_deposit);
          const expectedBalanceInEscrowTkn = new BN(constants.product_price);
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          actualOldOwnerBalanceFromEscrowEth = await contractCashier.escrow(
            users.other1.address
          );

          actualOldOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other1.address
          );

          actualNewOwnerBalanceFromEscrowEth = await contractCashier.escrow(
            users.other2.address
          );

          actualNewOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrowEth),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTkn.eq(expectedBalanceInEscrowTkn),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowEth.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTkn.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {
              from: users.other1.address,
            }
          ),
            (actualOldOwnerBalanceFromEscrowEth = await contractCashier.escrow(
              users.other1.address
            ));

          actualOldOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other1.address
          );

          actualNewOwnerBalanceFromEscrowEth = await contractCashier.escrow(
            users.other2.address
          );

          actualNewOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowEth.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTkn.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrowEth),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTkn.eq(expectedBalanceInEscrowTkn),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = new BN(constants.product_price); // 0.3
          const expectedSellerPrice = new BN(0);
          const expectedEscrowPrice = new BN(0);
          const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
            new BN(constants.seller_deposit).div(new BN(2))
          ); // 0.065
          const expectedSellerDeposit = new BN(constants.seller_deposit).div(
            new BN(4)
          ); // 0.0125
          const expectedEscrowAmountDeposit = new BN(
            constants.seller_deposit
          ).div(new BN(4)); // 0.0125

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {
              from: users.other1.address,
            }
          ),
            await utils.refund(voucherID, users.other2.address);
          await utils.complain(voucherID, users.other2.address);
          await utils.cancel(voucherID, users.seller.address);
          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.address
          );

          await getBalancesPriceToken();

          // Payments in TKN
          // Payment should have been returned to buyer
          assert.isTrue(
            balanceBuyerFromPayment.eq(expectedBuyerPrice),
            'Buyer did not get expected tokens from PaymentTokenContract'
          );
          assert.isTrue(
            balanceSellerFromPayment.eq(expectedSellerPrice),
            'Seller did not get expected tokens from PaymentTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromPayment.eq(expectedEscrowPrice),
            'Escrow did not get expected tokens from PaymentTokenContract'
          );

          //Deposits in ETH
          truffleAssert.eventEmitted(
            withdrawTx,
            'LogWithdrawal',
            (ev) => {
              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_payee',
                users.other2.address,
                users.seller.address
              );
              return true;
            },
            'Amounts not distributed successfully'
          );

          assert.isTrue(
            distributedAmounts.buyerAmount.eq(expectedBuyerDeposit),
            'Buyer Amount is not as expected'
          );
          assert.isTrue(
            distributedAmounts.sellerAmount.eq(expectedSellerDeposit),
            'Seller Amount is not as expected'
          );
          assert.isTrue(
            distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit),
            'Escrow Amount is not as expected'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(new BN(0)),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(new BN(0)),
            'Cashier Contract is not empty'
          );

          truffleAssert.eventEmitted(
            withdrawTx,
            'LogAmountDistribution',
            () => {
              return true;
            },
            'Event LogAmountDistribution was not emitted'
          );
        });

        it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.refund(voucherID, users.other1.address);
          await utils.complain(voucherID, users.other1.address);
          await utils.cancel(voucherID, users.seller.address);
          await utils.finalize(voucherID, users.deployer.address);

          await utils.withdraw(voucherID, users.deployer.address);

          await truffleAssert.reverts(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              {
                from: users.other1.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            {
              from: users.other1.address,
            }
          ),
            await truffleAssert.reverts(
              utils.redeem(voucherID, users.other1.address),
              truffleAssert.ErrorType.REVERT
            );

          await truffleAssert.reverts(
            utils.refund(voucherID, users.other1.address),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await truffleAssert.reverts(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              {
                from: users.attacker.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });
    });
  });
});
