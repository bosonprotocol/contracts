const ethers = require('hardhat').ethers;

const {assert, expect} = require('chai');

const constants = require('../testHelpers/constants');
const timemachine = require('../testHelpers/timemachine');
const Users = require('../testHelpers/users');
const UtilsBuilder = require('../testHelpers/utilsBuilder');
const Utils = require('../testHelpers/utils');

let ERC1155ERC721;
let VoucherKernel;
let Cashier;
let BosonRouter;
let MockERC20Permit;
let FundLimitsOracle;

const revertReasons = require('../testHelpers/revertReasons');
const eventUtils = require('../testHelpers/events');
const {eventNames} = require('../testHelpers/events');

const BN = ethers.BigNumber.from;

let utils;

let TOKEN_SUPPLY_ID;
let VOUCHER_ID;

let users;

describe('Cashier && VK', () => {
  before(async () => {
    const signers = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel = await ethers.getContractFactory('VoucherKernel');
    Cashier = await ethers.getContractFactory('Cashier');
    BosonRouter = await ethers.getContractFactory('BosonRouter');
    FundLimitsOracle = await ethers.getContractFactory('FundLimitsOracle');
    MockERC20Permit = await ethers.getContractFactory('MockERC20Permit');
  });

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
    const sixtySeconds = 60;

    contractFundLimitsOracle = await FundLimitsOracle.deploy();
    contractERC1155ERC721 = await ERC1155ERC721.deploy();
    contractVoucherKernel = await VoucherKernel.deploy(
      contractERC1155ERC721.address
    );
    contractCashier = await Cashier.deploy(contractVoucherKernel.address);
    contractBosonRouter = await BosonRouter.deploy(
      contractVoucherKernel.address,
      contractFundLimitsOracle.address,
      contractCashier.address
    );

    contractBSNTokenPrice = await MockERC20Permit.deploy(
      'BosonTokenPrice',
      'BPRC'
    );

    contractBSNTokenDeposit = await MockERC20Permit.deploy(
      'BosonTokenDeposit',
      'BDEP'
    );

    await contractFundLimitsOracle.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();

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

    utils = await UtilsBuilder.create()
      .ETHETH()
      .buildAsync(
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
          const attackerInstance = contractBosonRouter.connect(
            users.attacker.signer
          );
          await expect(attackerInstance.pause()).to.be.revertedWith(
            revertReasons.ONLY_ROUTER_OWNER
          );
        });

        it('[NEGATIVE] Attacker should not be able to unpause the contract', async () => {
          await contractBosonRouter.pause();

          const attackerInstance = contractBosonRouter.connect(
            users.attacker.signer
          );

          await expect(attackerInstance.unpause()).to.be.revertedWith(
            revertReasons.ONLY_ROUTER_OWNER
          );
        });
      });

      describe('ETHETH', () => {
        before(async () => {
          await deployContracts();
          utils = await UtilsBuilder.create()
            .ETHETH()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter
            );
        });

        it('[NEGATIVE] Should not create voucher supply when contract is paused', async () => {
          await contractBosonRouter.pause();

          await expect(
            utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
            )
          ).to.be.revertedWith(revertReasons.PAUSED);
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

          await expect(
            utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.PAUSED);
        });
      });

      describe('[WITH PERMIT]', () => {
        describe('ETHTKN', () => {
          before(async () => {
            await deployContracts();

            utils = await UtilsBuilder.create()
              .ERC20withPermit()
              .ETHTKN()
              .buildAsync(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBosonRouter,
                contractBSNTokenPrice,
                contractBSNTokenDeposit
              );

            tokensToMint = BN(constants.product_price).mul(
              BN(constants.QTY_10)
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

            await expect(
              utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1
              )
            ).to.be.revertedWith(revertReasons.PAUSED);
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

            await expect(
              utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });
        });

        describe('TKNETH', () => {
          before(async () => {
            await deployContracts();
            utils = await UtilsBuilder.create()
              .ERC20withPermit()
              .TKNETH()
              .buildAsync(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBosonRouter,
                contractBSNTokenPrice,
                ''
              );

            const timestamp = await Utils.getCurrTimestamp();

            tokensToMint = BN(constants.product_price).mul(
              BN(constants.QTY_10)
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

            await expect(
              utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1
              )
            ).to.be.revertedWith(revertReasons.PAUSED);
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

            await expect(
              utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });
        });

        describe('TKNTKN', () => {
          before(async () => {
            await deployContracts();
            utils = await UtilsBuilder.create()
              .ERC20withPermit()
              .TKNTKN()
              .buildAsync(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBosonRouter,
                contractBSNTokenPrice,
                contractBSNTokenDeposit
              );

            tokensToMint = BN(constants.seller_deposit).mul(
              BN(constants.QTY_10)
            );
            tokensToMint = BN(constants.product_price).mul(
              BN(constants.QTY_10)
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

            await expect(
              utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1
              )
            ).to.be.revertedWith(revertReasons.PAUSED);
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

            await expect(
              utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
            ).to.be.revertedWith(revertReasons.PAUSED);
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
          await expect(contractVoucherKernel.pause()).to.be.revertedWith(
            revertReasons.ONLY_FROM_ROUTER
          );
        });

        it('[NEGATIVE] Unpause should not be called directly', async () => {
          await expect(contractVoucherKernel.unpause()).to.be.revertedWith(
            revertReasons.ONLY_FROM_ROUTER
          );
        });
      });

      describe('ETHETH', () => {
        before(async () => {
          await deployContracts();

          utils = await UtilsBuilder.create()
            .ETHETH()
            .buildAsync(
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

          await expect(
            utils.refund(VOUCHER_ID, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.PAUSED);
        });

        it('[NEGATIVE] Should not process complain when paused', async () => {
          VOUCHER_ID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );

          await utils.refund(VOUCHER_ID, users.buyer.signer);

          await contractBosonRouter.pause();

          await expect(
            utils.complain(VOUCHER_ID, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.PAUSED);
        });

        it('[NEGATIVE] Should not process redeem when paused', async () => {
          VOUCHER_ID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );

          await contractBosonRouter.pause();

          await expect(
            utils.redeem(VOUCHER_ID, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.PAUSED);
        });

        it('[NEGATIVE] Should not process cancel when paused', async () => {
          VOUCHER_ID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );
          await utils.redeem(VOUCHER_ID, users.buyer.signer);

          await contractBosonRouter.pause();

          await expect(
            utils.cancel(VOUCHER_ID, users.seller.signer)
          ).to.be.revertedWith(revertReasons.PAUSED);
        });
      });

      describe('[WITH PERMIT]', () => {
        describe('ETHTKN', () => {
          before(async () => {
            await deployContracts();
            utils = await UtilsBuilder.create()
              .ERC20withPermit()
              .ETHTKN()
              .buildAsync(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBosonRouter,
                contractBSNTokenPrice,
                contractBSNTokenDeposit
              );

            const timestamp = await Utils.getCurrTimestamp();

            tokensToMint = BN(constants.product_price).mul(
              BN(constants.QTY_10)
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

            await expect(
              utils.refund(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process complain when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await utils.refund(VOUCHER_ID, users.buyer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.complain(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process redeem when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await expect(
              utils.redeem(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process cancel when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.redeem(VOUCHER_ID, users.buyer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.cancel(VOUCHER_ID, users.seller.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });
        });

        describe('TKNETH', () => {
          before(async () => {
            await deployContracts();
            utils = await UtilsBuilder.create()
              .ERC20withPermit()
              .TKNETH()
              .buildAsync(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBosonRouter,
                contractBSNTokenPrice,
                ''
              );

            const timestamp = await Utils.getCurrTimestamp();

            tokensToMint = BN(constants.product_price).mul(
              BN(constants.QTY_10)
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

            await expect(
              utils.refund(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process complain when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await utils.refund(VOUCHER_ID, users.buyer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.complain(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process redeem when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await expect(
              utils.redeem(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process cancel when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.redeem(VOUCHER_ID, users.buyer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.cancel(VOUCHER_ID, users.seller.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });
        });

        describe('TKNTKN', () => {
          before(async () => {
            await deployContracts();
            utils = await UtilsBuilder.create()
              .ERC20withPermit()
              .TKNTKN()
              .buildAsync(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBosonRouter,
                contractBSNTokenPrice,
                contractBSNTokenDeposit
              );

            const timestamp = await Utils.getCurrTimestamp();

            tokensToMint = BN(constants.product_price).mul(
              BN(constants.QTY_10)
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

            await expect(
              utils.refund(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process complain when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await utils.refund(VOUCHER_ID, users.buyer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.complain(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process redeem when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await expect(
              utils.redeem(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process cancel when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.redeem(VOUCHER_ID, users.buyer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.cancel(VOUCHER_ID, users.seller.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });
        });

        describe('TKNTKN Same', () => {
          before(async () => {
            await deployContracts();
            utils = await UtilsBuilder.create()
              .ERC20withPermit()
              .TKNTKNSame()
              .buildAsync(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBosonRouter,
                contractBSNTokenPrice,
                contractBSNTokenDeposit
              );

            const timestamp = await Utils.getCurrTimestamp();

            tokensToMint = BN(constants.product_price).mul(
              BN(constants.QTY_10)
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

            await expect(
              utils.refund(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process complain when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await utils.refund(VOUCHER_ID, users.buyer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.complain(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process redeem when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );

            await contractBosonRouter.pause();

            await expect(
              utils.redeem(VOUCHER_ID, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('[NEGATIVE] Should not process cancel when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID
            );
            await utils.redeem(VOUCHER_ID, users.buyer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.cancel(VOUCHER_ID, users.seller.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
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
          await expect(contractCashier.pause()).to.be.revertedWith(
            revertReasons.ONLY_FROM_ROUTER
          );
        });

        it('[NEGATIVE] Unpause should not be called directly', async () => {
          await expect(contractCashier.unpause()).to.be.revertedWith(
            revertReasons.ONLY_FROM_ROUTER
          );
        });

        it('Owner should set the Cashier to disaster state', async () => {
          await contractBosonRouter.pause();
          const tx = await contractCashier.setDisasterState();
          const txReceipt = await tx.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier,
            eventNames.LOG_DISASTER_STATE_SET,
            (ev) => {
              assert.equal(ev._triggeredBy, users.deployer.address);
            }
          );
        });

        it('Should not be unpaused after disaster', async () => {
          await expect(contractBosonRouter.unpause()).to.be.revertedWith(
            revertReasons.UNPAUSED_FORBIDDEN
          );
        });
      });

      describe('ETHETH', () => {
        before(async () => {
          await deployContracts();
          utils = await UtilsBuilder.create()
            .ETHETH()
            .buildAsync(
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
          await utils.refund(voucherID, users.buyer.signer);

          await timemachine.advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await contractBosonRouter.pause();

          await expect(
            utils.withdraw(voucherID, users.deployer.signer)
          ).to.be.revertedWith(revertReasons.PAUSED);
        });
      });

      describe('[WITH PERMIT]', () => {
        describe('ETHTKN', () => {
          before(async () => {
            await deployContracts();

            utils = await UtilsBuilder.create()
              .ERC20withPermit()
              .ETHTKN()
              .buildAsync(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBosonRouter,
                contractBSNTokenPrice,
                contractBSNTokenDeposit
              );

            tokensToMint = BN(constants.product_price).mul(
              BN(constants.QTY_10)
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
            await utils.refund(voucherID, users.buyer.signer);

            await timemachine.advanceTimeSeconds(60);
            await utils.finalize(voucherID, users.deployer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.withdraw(voucherID, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });
        });

        describe('TKNETH', () => {
          before(async () => {
            await deployContracts();
            utils = await UtilsBuilder.create()
              .ERC20withPermit()
              .TKNETH()
              .buildAsync(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBosonRouter,
                contractBSNTokenPrice,
                ''
              );

            tokensToMint = BN(constants.product_price).mul(
              BN(constants.QTY_10)
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
            await utils.refund(voucherID, users.buyer.signer);

            await timemachine.advanceTimeSeconds(60);
            await utils.finalize(voucherID, users.deployer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.withdraw(voucherID, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });
        });

        describe('TKNTKN', () => {
          before(async () => {
            await deployContracts();
            utils = await UtilsBuilder.create()
              .ERC20withPermit()
              .TKNTKN()
              .buildAsync(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBosonRouter,
                contractBSNTokenPrice,
                contractBSNTokenDeposit
              );

            tokensToMint = BN(constants.seller_deposit).mul(
              BN(constants.QTY_10)
            );
            tokensToMint = BN(constants.product_price).mul(
              BN(constants.QTY_10)
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
            await utils.refund(voucherID, users.buyer.signer);

            await timemachine.advanceTimeSeconds(60);
            await utils.finalize(voucherID, users.deployer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.withdraw(voucherID, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
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
