import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

import {assert, expect} from 'chai';

import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
import constants from '../testHelpers/constants';
import {advanceTimeSeconds} from '../testHelpers/timemachine';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';

import {
  BosonRouter,
  VoucherSets,
  Vouchers,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
} from '../typechain';

let VoucherSets_Factory: ContractFactory;
let Vouchers_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
const eventNames = eventUtils.eventNames;

const BN = ethers.BigNumber.from;

let utils: Utils;

let TOKEN_SUPPLY_ID;
let VOUCHER_ID;

let users;

describe('Cashier && VK', () => {
  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    VoucherSets_Factory = await ethers.getContractFactory('VoucherSets');
    Vouchers_Factory = await ethers.getContractFactory('Vouchers');
    VoucherKernel_Factory = await ethers.getContractFactory('VoucherKernel');
    Cashier_Factory = await ethers.getContractFactory('Cashier');
    BosonRouter_Factory = await ethers.getContractFactory('BosonRouter');
    TokenRegistry_Factory = await ethers.getContractFactory('TokenRegistry');
    MockERC20Permit_Factory = await ethers.getContractFactory(
      'MockERC20Permit'
    );
  });

  let contractVoucherSets: VoucherSets,
    contractVouchers: Vouchers,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractBSNTokenPrice: MockERC20Permit,
    contractBSNTokenDeposit: MockERC20Permit,
    contractTokenRegistry: TokenRegistry;

  let tokensToMint;
  let timestamp;

  async function deployContracts() {
    const sixtySeconds = 60;
    const contractAddresses = await calculateDeploymentAddresses(
      users.deployer.address,
      [
        'TokenRegistry',
        'VoucherSets',
        'Vouchers',
        'VoucherKernel',
        'Cashier',
        'BosonRouter',
      ]
    );

    contractTokenRegistry = (await TokenRegistry_Factory.deploy()) as Contract &
      TokenRegistry;
    contractVoucherSets = (await VoucherSets_Factory.deploy(
      'https://token-cdn-domain/{id}.json',
      contractAddresses.Cashier,
      contractAddresses.VoucherKernel
    )) as Contract & VoucherSets;
    contractVouchers = (await Vouchers_Factory.deploy(
      'https://token-cdn-domain/orders/metadata/',
      'Boson Smart Voucher',
      'BSV',
      contractAddresses.Cashier,
      contractAddresses.VoucherKernel
    )) as Contract & Vouchers;
    contractVoucherKernel = (await VoucherKernel_Factory.deploy(
      contractAddresses.BosonRouter,
      contractAddresses.Cashier,
      contractAddresses.VoucherSets,
      contractAddresses.Vouchers
    )) as Contract & VoucherKernel;
    contractCashier = (await Cashier_Factory.deploy(
      contractAddresses.BosonRouter,
      contractAddresses.VoucherKernel,
      contractAddresses.VoucherSets,
      contractAddresses.Vouchers
    )) as Contract & Cashier;
    contractBosonRouter = (await BosonRouter_Factory.deploy(
      contractAddresses.VoucherKernel,
      contractAddresses.TokenRegistry,
      contractAddresses.Cashier
    )) as Contract & BosonRouter;

    contractBSNTokenPrice = (await MockERC20Permit_Factory.deploy(
      'BosonTokenPrice',
      'BPRC'
    )) as Contract & MockERC20Permit;

    contractBSNTokenDeposit = (await MockERC20Permit_Factory.deploy(
      'BosonTokenDeposit',
      'BDEP'
    )) as Contract & MockERC20Permit;

    await contractTokenRegistry.deployed();
    await contractVoucherSets.deployed();
    await contractVouchers.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();

    await contractVoucherSets.setApprovalForAll(
      contractAddresses.VoucherKernel,
      true
    );
    await contractVouchers.setApprovalForAll(
      contractAddresses.VoucherKernel,
      true
    );

    await contractVoucherKernel.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds);

    await contractTokenRegistry.setTokenLimit(
      contractBSNTokenPrice.address,
      constants.TOKEN_LIMIT
    );
    await contractTokenRegistry.setTokenLimit(
      contractBSNTokenDeposit.address,
      constants.TOKEN_LIMIT
    );
    await contractTokenRegistry.setETHLimit(constants.ETHER_LIMIT);

    //Set Boson Token as it's own wrapper so that the same interface can be called in the code
    await contractTokenRegistry.setTokenWrapperAddress(
      contractBSNTokenPrice.address,
      contractBSNTokenPrice.address
    );

    await contractTokenRegistry.setTokenWrapperAddress(
      contractBSNTokenDeposit.address,
      contractBSNTokenDeposit.address
    );

    utils = await UtilsBuilder.create()
      .ETHETH()
      .buildAsync(
        contractVoucherSets,
        contractVouchers,
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
              contractVoucherSets,
              contractVouchers,
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
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_1
            )
          ).to.be.revertedWith(revertReasons.PAUSED);
        });

        it('Should create voucher supply when contract is unpaused', async () => {
          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.product_price,
            constants.seller_deposit,
            constants.buyer_deposit,
            constants.QTY_1
          );

          assert.isNotEmpty(TOKEN_SUPPLY_ID);
        });

        it('[NEGATIVE] Should not create voucherID from Buyer when paused', async () => {
          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.product_price,
            constants.seller_deposit,
            constants.buyer_deposit,
            constants.QTY_1
          );

          await contractBosonRouter.pause();

          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
            )
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
                contractVoucherSets,
                contractVouchers,
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
                constants.product_price,
                constants.seller_deposit,
                constants.buyer_deposit,
                constants.QTY_1
              )
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('Should create voucher supply when contract is unpaused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_1
            );

            assert.isNotEmpty(TOKEN_SUPPLY_ID);
          });

          it('[NEGATIVE] Should not create voucherID for Buyer when paused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_1
            );

            await contractBosonRouter.pause();

            await expect(
              utils.commitToBuy(
                users.buyer,
                users.seller,
                TOKEN_SUPPLY_ID,
                constants.product_price,
                constants.buyer_deposit
              )
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
                contractVoucherSets,
                contractVouchers,
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
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
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
                constants.product_price,
                constants.seller_deposit,
                constants.buyer_deposit,
                constants.QTY_1
              )
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('Should create voucher supply when contract is unpaused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_1
            );

            assert.isNotEmpty(TOKEN_SUPPLY_ID);
          });

          it('[NEGATIVE] Should not create voucherID for Buyer when paused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_1
            );

            await contractBosonRouter.pause();

            await expect(
              utils.commitToBuy(
                users.buyer,
                users.seller,
                TOKEN_SUPPLY_ID,
                constants.product_price,
                constants.buyer_deposit
              )
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
                contractVoucherSets,
                contractVouchers,
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
                constants.product_price,
                constants.seller_deposit,
                constants.buyer_deposit,
                constants.QTY_1
              )
            ).to.be.revertedWith(revertReasons.PAUSED);
          });

          it('Should create voucher supply when contract is unpaused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_1
            );

            assert.isNotEmpty(TOKEN_SUPPLY_ID);
          });

          it('[NEGATIVE] Should not create voucherID for Buyer when paused', async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_1
            );

            await contractBosonRouter.pause();

            await expect(
              utils.commitToBuy(
                users.buyer,
                users.seller,
                TOKEN_SUPPLY_ID,
                constants.product_price,
                constants.buyer_deposit
              )
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
              contractVoucherSets,
              contractVouchers,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter
            );

          const timestamp = await Utils.getCurrTimestamp();

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.product_price,
            constants.seller_deposit,
            constants.buyer_deposit,
            constants.QTY_10
          );
        });

        it('[NEGATIVE] Should not process refund when paused', async () => {
          VOUCHER_ID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
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
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
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
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
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
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
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
                contractVoucherSets,
                contractVouchers,
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
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_10
            );
          });

          it('[NEGATIVE] Should not process refund when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
                contractVoucherSets,
                contractVouchers,
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
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_10
            );
          });

          it('[NEGATIVE] Should not process refund when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
                contractVoucherSets,
                contractVouchers,
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
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_10
            );
          });

          it('[NEGATIVE] Should not process refund when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
                contractVoucherSets,
                contractVouchers,
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
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_10
            );
          });

          it('[NEGATIVE] Should not process refund when paused', async () => {
            VOUCHER_ID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
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
            Cashier_Factory,
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
              contractVoucherSets,
              contractVouchers,
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
            constants.product_price,
            constants.seller_deposit,
            constants.buyer_deposit,
            constants.QTY_1
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
          );
          await utils.refund(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
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
                contractVoucherSets,
                contractVouchers,
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
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_1
            );

            const voucherID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
            );
            await utils.refund(voucherID, users.buyer.signer);

            await advanceTimeSeconds(60);
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
                contractVoucherSets,
                contractVouchers,
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
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_1
            );

            const voucherID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
            );
            await utils.refund(voucherID, users.buyer.signer);

            await advanceTimeSeconds(60);
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
                contractVoucherSets,
                contractVouchers,
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
              constants.product_price,
              constants.seller_deposit,
              constants.buyer_deposit,
              constants.QTY_1
            );

            const voucherID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
            );
            await utils.refund(voucherID, users.buyer.signer);

            await advanceTimeSeconds(60);
            await utils.finalize(voucherID, users.deployer.signer);

            await contractBosonRouter.pause();

            await expect(
              utils.withdraw(voucherID, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.PAUSED);
          });
        });
      });
    });

    describe('VOUCHERSETS', () => {
      describe('COMMON PAUSING', () => {
        beforeEach(async () => {
          await deployContracts();
        });

        it('Should not be paused on deployment', async () => {
          const isPaused = await contractVoucherSets.paused();
          assert.isFalse(isPaused);
        });

        it('Owner should pause the contract', async () => {
          await contractVoucherSets.pause();

          const isPaused = await contractVoucherSets.paused();
          assert.isTrue(isPaused);
        });

        it('Owner should unpause the contract', async () => {
          await contractVoucherSets.pause();
          await contractVoucherSets.unpause();

          const isPaused = await contractVoucherSets.paused();
          assert.isFalse(isPaused);
        });

        it('[NEGATIVE] Attacker should not be able to pause the contract', async () => {
          const attackerInstance = contractVoucherSets.connect(
            users.attacker.signer
          );
          await expect(attackerInstance.pause()).to.be.revertedWith(
            revertReasons.UNAUTHORIZED_OWNER
          );
        });

        it('[NEGATIVE] Attacker should not be able to unpause the contract', async () => {
          await contractVoucherSets.pause();

          const attackerInstance = contractVoucherSets.connect(
            users.attacker.signer
          );

          await expect(attackerInstance.unpause()).to.be.revertedWith(
            revertReasons.UNAUTHORIZED_OWNER
          );
        });
      });
    });

    describe('VOUCHERS', () => {
      describe('COMMON PAUSING', () => {
        beforeEach(async () => {
          await deployContracts();
        });

        it('Should not be paused on deployment', async () => {
          const isPaused = await contractVouchers.paused();
          assert.isFalse(isPaused);
        });

        it('Owner should pause the contract', async () => {
          await contractVouchers.pause();

          const isPaused = await contractVouchers.paused();
          assert.isTrue(isPaused);
        });

        it('Owner should unpause the contract', async () => {
          await contractVouchers.pause();
          await contractVouchers.unpause();

          const isPaused = await contractVouchers.paused();
          assert.isFalse(isPaused);
        });

        it('[NEGATIVE] Attacker should not be able to pause the contract', async () => {
          const attackerInstance = contractVouchers.connect(
            users.attacker.signer
          );
          await expect(attackerInstance.pause()).to.be.revertedWith(
            revertReasons.UNAUTHORIZED_OWNER
          );
        });

        it('[NEGATIVE] Attacker should not be able to unpause the contract', async () => {
          await contractVouchers.pause();

          const attackerInstance = contractVoucherSets.connect(
            users.attacker.signer
          );

          await expect(attackerInstance.unpause()).to.be.revertedWith(
            revertReasons.UNAUTHORIZED_OWNER
          );
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
