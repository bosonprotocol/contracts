const {assert} = require('chai');
const truffleAssert = require('truffle-assertions');

const constants = require('../testHelpers/constants');
const timemachine = require('../testHelpers/timemachine');
const Users = require('../testHelpers/users');
const UtilsBuilder = require('../testHelpers/utilsBuilder');
const Utils = require('../testHelpers/utils');

const ERC1155ERC721 = artifacts.require('ERC1155ERC721');
const VoucherKernel = artifacts.require('VoucherKernel');
const Cashier = artifacts.require('Cashier');
const BosonRouter = artifacts.require('BosonRouter');
const MockERC20Permit = artifacts.require('MockERC20Permit');
const FundLimitsOracle = artifacts.require('FundLimitsOracle');

const BN = web3.utils.BN;

let utils;

let TOKEN_SUPPLY_ID;
let VOUCHER_ID;

contract('Cashier && VK', async (addresses) => {
  const users = new Users(addresses);

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractBSNTokenPrice,
    contractBSNTokenDeposit,
    contractFundLimitsOracle;

  let tokensToMint;
  let timestamp;

  async function deployContracts() {
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

    await contractVoucherKernel.setComplainPeriod(60); //60 seconds
    await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds

    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenPrice.address,
      constants.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenDeposit.address,
      constants.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setETHLimit(constants.ETHER_LIMIT);

    utils = UtilsBuilder.create()
      .ETHETH()
      .build(
        contractERC1155ERC721,
        contractVoucherKernel,
        contractCashier,
        contractBosonRouter
      );
    timestamp = await Utils.getCurrTimestamp();
  }

  describe('Pausing Scenarios', function () {
    describe('BOSON ROUTER', () => {
      describe('COMMON PAUSING', () => {
        before(async () => {
          await deployContracts();
        });

        it('Should not be paused on deployment', async () => {
          const isPaused = await contractBosonRouter.paused();
          assert.isFalse(isPaused);
        });

        it('Owner should pause the contract', async () => {
          await contractBosonRouter.pause();

          const isPaused = await contractBosonRouter.paused();
          assert.isTrue(isPaused);
        });

        it('Owner should unpause the contract', async () => {
          await contractBosonRouter.pause();
          await contractBosonRouter.unpause();

          const isPaused = await contractBosonRouter.paused();
          assert.isFalse(isPaused);
        });

        it('[NEGATIVE] Attacker should not be able to pause the contract', async () => {
          await truffleAssert.reverts(
            contractBosonRouter.pause({from: users.attacker.address}),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Attacker should not be able to unpause the contract', async () => {
          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            contractBosonRouter.unpause({from: users.attacker.address}),
            truffleAssert.ErrorType.REVERT
          );
        });
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
        });

        it('[NEGATIVE] Should not create voucher supply when contract is paused', async () => {
          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Should create voucher supply when contract is unpaused', async () => {
          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );

          assert.isNotEmpty(TOKEN_SUPPLY_ID);
        });

        it('[NEGATIVE] Should not create voucherID from Buyer when paused', async () => {
          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );

          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
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

            tokensToMint = new BN(constants.product_price).mul(
              new BN(constants.QTY_10)
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
          });

          it('[NEGATIVE] Should not create voucher supply when contract is paused', async () => {
            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1
              ),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('Should create voucher supply when contract is unpaused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            );

            assert.isNotEmpty(TOKEN_SUPPLY_ID);
          });

          it('[NEGATIVE] Should not create voucherID for Buyer when paused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
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

            const timestamp = await Utils.getCurrTimestamp();

            tokensToMint = new BN(constants.product_price).mul(
              new BN(constants.QTY_10)
            );

            await utils.mintTokens(
              'contractBSNTokenPrice',
              users.buyer.address,
              tokensToMint
            );

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10
            );
          });

          it('[NEGATIVE] Should not create voucher supply when contract is paused', async () => {
            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1
              ),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('Should create voucher supply when contract is unpaused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            );

            assert.isNotEmpty(TOKEN_SUPPLY_ID);
          });

          it('[NEGATIVE] Should not create voucherID for Buyer when paused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
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

            tokensToMint = new BN(constants.seller_deposit).mul(
              new BN(constants.QTY_10)
            );
            tokensToMint = new BN(constants.product_price).mul(
              new BN(constants.QTY_10)
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
          });

          it('[NEGATIVE] Should not create voucher supply when contract is paused', async () => {
            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1
              ),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('Should create voucher supply when contract is unpaused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            );

            assert.isNotEmpty(TOKEN_SUPPLY_ID);
          });

          it('[NEGATIVE] Should not create voucherID for Buyer when paused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
              truffleAssert.ErrorType.REVERT
            );
          });
        });
      });
    });

    describe('VOUCHER KERNEL', () => {
      describe('COMMON PAUSING', () => {
        before(async () => {
          await deployContracts();
        });

        it('Should not be paused on deployment', async () => {
          const isPaused = await contractVoucherKernel.paused();
          assert.isFalse(isPaused);
        });

        it('Should be paused from BR', async () => {
          await contractBosonRouter.pause();

          const isPaused = await contractVoucherKernel.paused();
          assert.isTrue(isPaused);
        });

        it('Should be unpaused from BR', async () => {
          await contractBosonRouter.pause();
          await contractBosonRouter.unpause();

          const isPaused = await contractVoucherKernel.paused();
          assert.isFalse(isPaused);
        });

        it('[NEGATIVE] Pause should not be called directly', async () => {
          await truffleAssert.reverts(
            contractVoucherKernel.pause(),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Unpause should not be called directly', async () => {
          await truffleAssert.reverts(
            contractVoucherKernel.unpause(),
            truffleAssert.ErrorType.REVERT
          );
        });
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

          const timestamp = await Utils.getCurrTimestamp();

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );
        });

        it('[NEGATIVE] Should not process refund when paused', async () => {
          VOUCHER_ID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );

          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            utils.refund(VOUCHER_ID, users.buyer.address),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not process complain when paused', async () => {
          VOUCHER_ID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );

          await utils.refund(VOUCHER_ID, users.buyer.address);

          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            utils.complain(VOUCHER_ID, users.buyer.address),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not process redeem when paused', async () => {
          VOUCHER_ID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );

          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            utils.redeem(VOUCHER_ID, users.buyer.address),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should not process cancel when paused', async () => {
          VOUCHER_ID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );
          await utils.redeem(VOUCHER_ID, users.buyer.address);

          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            utils.cancel(VOUCHER_ID, users.seller.address),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('[WITH PERMIT]', () => {
        describe('ETHTKN', () => {
          before(async () => {
            await deployContracts();
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

            tokensToMint = new BN(constants.product_price).mul(
              new BN(constants.QTY_10)
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

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10
            );
          });

          it('[NEGATIVE] Should not process refund when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.refund(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process complain when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await utils.refund(VOUCHER_ID, users.buyer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.complain(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process redeem when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.redeem(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process cancel when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.redeem(VOUCHER_ID, users.buyer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.cancel(VOUCHER_ID, users.seller.address),
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

            const timestamp = await Utils.getCurrTimestamp();

            tokensToMint = new BN(constants.product_price).mul(
              new BN(constants.QTY_10)
            );

            await utils.mintTokens(
              'contractBSNTokenPrice',
              users.buyer.address,
              tokensToMint
            );

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10
            );
          });

          it('[NEGATIVE] Should not process refund when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.refund(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process complain when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await utils.refund(VOUCHER_ID, users.buyer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.complain(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process redeem when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.redeem(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process cancel when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.redeem(VOUCHER_ID, users.buyer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.cancel(VOUCHER_ID, users.seller.address),
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

            const timestamp = await Utils.getCurrTimestamp();

            tokensToMint = new BN(constants.product_price).mul(
              new BN(constants.QTY_10)
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

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10
            );
          });

          it('[NEGATIVE] Should not process refund when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.refund(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process complain when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await utils.refund(VOUCHER_ID, users.buyer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.complain(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process redeem when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.redeem(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process cancel when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.redeem(VOUCHER_ID, users.buyer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.cancel(VOUCHER_ID, users.seller.address),
              truffleAssert.ErrorType.REVERT
            );
          });
        });

        describe('TKNTKN Same', () => {
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

            const timestamp = await Utils.getCurrTimestamp();

            tokensToMint = new BN(constants.product_price).mul(
              new BN(constants.QTY_10)
            );

            await utils.mintTokens(
              'contractBSNTokenSame',
              users.seller.address,
              tokensToMint
            );
            await utils.mintTokens(
              'contractBSNTokenSame',
              users.buyer.address,
              tokensToMint
            );

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10
            );
          });

          it('[NEGATIVE] Should not process refund when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.refund(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process complain when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await utils.refund(VOUCHER_ID, users.buyer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.complain(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process redeem when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.redeem(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            );
          });

          it('[NEGATIVE] Should not process cancel when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.redeem(VOUCHER_ID, users.buyer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.cancel(VOUCHER_ID, users.seller.address),
              truffleAssert.ErrorType.REVERT
            );
          });
        });
      });
    });

    describe('CASHIER', () => {
      describe('COMMON PAUSING', () => {
        before(async () => {
          await deployContracts();
        });

        it('Should not be paused on deployment', async () => {
          const isPaused = await contractCashier.paused();
          assert.isFalse(isPaused);
        });

        it('Should be paused from BR', async () => {
          await contractBosonRouter.pause();

          const isPaused = await contractCashier.paused();
          assert.isTrue(isPaused);
        });

        it('Should be unpaused from BR', async () => {
          await contractBosonRouter.pause();
          await contractBosonRouter.unpause();

          const isPaused = await contractCashier.paused();
          assert.isFalse(isPaused);
        });

        it('[NEGATIVE] Pause should not be called directly', async () => {
          await truffleAssert.reverts(
            contractCashier.pause(),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Unpause should not be called directly', async () => {
          await truffleAssert.reverts(
            contractCashier.unpause(),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Owner should set the Cashier to disaster state', async () => {
          await contractBosonRouter.pause();
          const tx = await contractCashier.setDisasterState();

          truffleAssert.eventEmitted(tx, 'LogDisasterStateSet', (ev) => {
            return ev._triggeredBy == users.deployer.address;
          });
        });

        it('Should not be unpaused after disaster', async () => {
          await truffleAssert.reverts(
            contractBosonRouter.unpause(),
            truffleAssert.ErrorType.REVERT
          );
        });
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
        });

        it('[NEGATIVE] Should not process withdrawals when paused', async () => {
          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );
          await utils.refund(voucherID, users.buyer.address);

          await timemachine.advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.address);

          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            utils.withdraw(voucherID, users.deployer.address),
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

            tokensToMint = new BN(constants.product_price).mul(
              new BN(constants.QTY_10)
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
          });

          it('[NEGATIVE] Should not process withdrawals when paused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            );

            const voucherID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.refund(voucherID, users.buyer.address);

            await timemachine.advanceTimeSeconds(60);
            await utils.finalize(voucherID, users.deployer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.withdraw(voucherID, users.deployer.address),
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

            tokensToMint = new BN(constants.product_price).mul(
              new BN(constants.QTY_10)
            );

            await utils.mintTokens(
              'contractBSNTokenPrice',
              users.buyer.address,
              tokensToMint
            );
          });

          it('[NEGATIVE] Should not process withdrawals when paused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            );

            const voucherID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.refund(voucherID, users.buyer.address);

            await timemachine.advanceTimeSeconds(60);
            await utils.finalize(voucherID, users.deployer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.withdraw(voucherID, users.deployer.address),
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

            tokensToMint = new BN(constants.seller_deposit).mul(
              new BN(constants.QTY_10)
            );
            tokensToMint = new BN(constants.product_price).mul(
              new BN(constants.QTY_10)
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
          });

          it('[NEGATIVE] Should not process withdrawals when paused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            );

            const voucherID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.refund(voucherID, users.buyer.address);

            await timemachine.advanceTimeSeconds(60);
            await utils.finalize(voucherID, users.deployer.address);

            await contractBosonRouter.pause();

            await truffleAssert.reverts(
              utils.withdraw(voucherID, users.deployer.address),
              truffleAssert.ErrorType.REVERT
            );
          });
        });
      });
    });

    afterEach(async () => {
      const isPaused = await contractBosonRouter.paused();
      const isUnpauseable = await contractCashier.canUnpause();

      if (isPaused && isUnpauseable) {
        await contractBosonRouter.unpause();
      }
    });
  });
});
