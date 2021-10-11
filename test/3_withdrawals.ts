import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

import {assert, expect} from 'chai';
import constants from '../testHelpers/constants';

import {advanceTimeSeconds} from '../testHelpers/timemachine';

import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
const eventNames = eventUtils.eventNames;

import {
  BosonRouter,
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
} from '../typechain';

let ERC1155ERC721_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;

const BN = ethers.BigNumber.from;

let utils: Utils;

let TOKEN_SUPPLY_ID;

let users;

describe('Cashier withdrawals ', () => {
  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721_Factory = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel_Factory = await ethers.getContractFactory('VoucherKernel');
    Cashier_Factory = await ethers.getContractFactory('Cashier');
    BosonRouter_Factory = await ethers.getContractFactory('BosonRouter');
    TokenRegistry_Factory = await ethers.getContractFactory('TokenRegistry');
    MockERC20Permit_Factory = await ethers.getContractFactory(
      'MockERC20Permit'
    );
  });

  let contractERC1155ERC721: ERC1155ERC721,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractBSNTokenPrice: MockERC20Permit,
    contractBSNTokenDeposit: MockERC20Permit,
    contractTokenRegistry: TokenRegistry;

  let distributedAmounts = {
    buyerAmount: BN(0),
    sellerAmount: BN(0),
    escrowAmount: BN(0),
  };

  async function deployContracts() {
    const sixtySeconds = 60;

    contractTokenRegistry = (await TokenRegistry_Factory.deploy()) as Contract &
      TokenRegistry;
    contractERC1155ERC721 = (await ERC1155ERC721_Factory.deploy()) as Contract &
      ERC1155ERC721;
    contractVoucherKernel = (await VoucherKernel_Factory.deploy(
      contractERC1155ERC721.address
    )) as Contract & VoucherKernel;
    contractCashier = (await Cashier_Factory.deploy(
      contractVoucherKernel.address
    )) as Contract & Cashier;
    contractBosonRouter = (await BosonRouter_Factory.deploy(
      contractVoucherKernel.address,
      contractTokenRegistry.address,
      contractCashier.address
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
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address,
      true
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
  }

  async function setPeriods() {
    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;
  }

  // this function is used after each interaction with tokens to clear balances
  async function giveAwayToRandom() {
    const balanceBuyerFromPayment = await contractBSNTokenPrice.balanceOf(
      users.buyer.address
    );
    const balanceBuyerFromDesosits = await contractBSNTokenDeposit.balanceOf(
      users.buyer.address
    );

    const balanceSellerFromPayment = await contractBSNTokenPrice.balanceOf(
      users.seller.address
    );
    const balanceSellerFromDesosits = await contractBSNTokenDeposit.balanceOf(
      users.seller.address
    );

    const escrowBalanceFromPayment = await contractBSNTokenPrice.balanceOf(
      users.deployer.address
    );
    const escrowBalanceFromDeposits = await contractBSNTokenDeposit.balanceOf(
      users.deployer.address
    );

    const buyerPriceInstance = contractBSNTokenPrice.connect(
      users.buyer.signer
    );
    const buyerDepositInstance = contractBSNTokenDeposit.connect(
      users.buyer.signer
    );
    const sellerPriceInstance = contractBSNTokenPrice.connect(
      users.seller.signer
    );
    const sellerDepositInstance = contractBSNTokenDeposit.connect(
      users.seller.signer
    );
    const deployerPriceInstance = contractBSNTokenPrice.connect(
      users.deployer.signer
    );
    const deployerDepositInstance = contractBSNTokenDeposit.connect(
      users.deployer.signer
    );

    await buyerPriceInstance.transfer(
      users.other1.address,
      balanceBuyerFromPayment
    );
    await buyerDepositInstance.transfer(
      users.other1.address,
      balanceBuyerFromDesosits
    );
    await sellerPriceInstance.transfer(
      users.other1.address,
      balanceSellerFromPayment
    );
    await sellerDepositInstance.transfer(
      users.other1.address,
      balanceSellerFromDesosits
    );
    await deployerPriceInstance.transfer(
      users.other1.address,
      escrowBalanceFromPayment
    );
    await deployerDepositInstance.transfer(
      users.other1.address,
      escrowBalanceFromDeposits
    );
  }

  describe('Withdraw scenarios', () => {
    before(async () => {
      await deployContracts();
      await setPeriods();
    });

    afterEach(async () => {
      distributedAmounts = {
        buyerAmount: BN(0),
        sellerAmount: BN(0),
        escrowAmount: BN(0),
      };

      const isPaused = await contractBosonRouter.paused();
      if (isPaused) {
        await contractBosonRouter.unpause();
      }
    });

    describe(`ETHETH`, () => {
      before(async () => {
        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_15
        );
      });

      it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit)
          .add(BN(constants.product_price))
          .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.finalize(voucherID, users.deployer.signer);
        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit)
          .add(BN(constants.product_price))
          .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.finalize(voucherID, users.deployer.signer);
        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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

      it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.product_price); // 0.3
        const expectedSellerAmount = BN(0); // 0
        const expectedEscrowAmount = BN(constants.seller_deposit).add(
          BN(constants.buyer_deposit)
        ); // 0.09

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await advanceTimeSeconds(60);

        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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

      it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit)
          .add(BN(constants.product_price))
          .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmount = BN(0); //0

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.refund(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);

        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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

      it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.product_price); // 0.3
        const expectedSellerAmount = BN(constants.seller_deposit); // 0.05
        const expectedEscrowAmount = BN(constants.buyer_deposit); // 0.04

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

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit)
          .add(BN(constants.product_price))
          .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmount = BN(0); // 0

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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

      it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit); // 0.04
        const expectedSellerAmount = BN(constants.seller_deposit).add(
          BN(constants.product_price)
        ); // 0.35
        const expectedEscrowAmount = BN(0); // 0

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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

      it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit); // 0.04
        const expectedSellerAmount = BN(constants.product_price); // 0.3
        const expectedEscrowAmount = BN(constants.seller_deposit); // 0.05

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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

      it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerAmount = BN(constants.product_price).add(
          BN(constants.seller_deposit).div(BN(4))
        ); // 0.3125
        const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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

      it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerAmount = BN(constants.product_price).add(
          BN(constants.seller_deposit).div(BN(4))
        ); // 0.3125
        const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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

      it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerAmount = BN(constants.product_price).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.325
        const expectedEscrowAmount = BN(0); // 0

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
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
    });

    describe(`TKNTKN [WITH PERMIT]`, () => {
      let balanceBuyerFromPayment = BN(0);
      let balanceBuyerFromDeposits = BN(0);

      let balanceSellerFromPayment = BN(0);
      let balanceSellerFromDeposits = BN(0);

      let escrowBalanceFromPayment = BN(0);
      let escrowBalanceFromDeposits = BN(0);

      let cashierPaymentLeft = BN(0);
      let cashierDepositLeft = BN(0);

      async function getBalancesFromPriceTokenAndDepositToken() {
        balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
          users.buyer.address
        );
        balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
          users.buyer.address
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

        const supplyQty = 1;
        const tokensToMint = BN(constants.seller_deposit).mul(BN(supplyQty));

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.seller.address,
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

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          supplyQty
        );
      });

      afterEach(async () => {
        distributedAmounts = {
          buyerAmount: BN(0),
          sellerAmount: BN(0),
          escrowAmount: BN(0),
        };

        balanceBuyerFromPayment = BN(0);
        balanceBuyerFromDeposits = BN(0);

        balanceSellerFromPayment = BN(0);
        balanceSellerFromDeposits = BN(0);

        escrowBalanceFromPayment = BN(0);
        escrowBalanceFromDeposits = BN(0);

        cashierPaymentLeft = BN(0);
        cashierDepositLeft = BN(0);

        await giveAwayToRandom();
      });

      it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(0);
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
          BN(constants.buyer_deposit)
        ); // 0.09
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);

        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountDeposit = BN(0);
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
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

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(0);
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(0);

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
        const expectedSellerPrice = BN(constants.product_price); //// 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = BN(0);
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(0);
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit); // 0.05

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(0);

        await getBalancesFromPriceTokenAndDepositToken();

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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });
    });

    describe(`TKNTKN SAME [WITH PERMIT]`, () => {
      let balanceBuyer = BN(0);
      let balanceSeller = BN(0);
      let escrowBalance = BN(0);
      let cashierBalance = BN(0);

      async function getBalancesFromSameTokenContract() {
        balanceBuyer = await utils.contractBSNTokenSame.balanceOf(
          users.buyer.address
        );
        balanceSeller = await utils.contractBSNTokenSame.balanceOf(
          users.seller.address
        );
        escrowBalance = await utils.contractBSNTokenSame.balanceOf(
          users.deployer.address
        );
        cashierBalance = await utils.contractBSNTokenSame.balanceOf(
          utils.contractCashier.address
        );
      }

      beforeEach(async () => {
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

        const supplyQty = 1;
        const tokensToMintSeller = BN(constants.seller_deposit).mul(
          BN(supplyQty)
        );
        const tokensToMintBuyer = BN(constants.product_price).add(
          BN(constants.buyer_deposit)
        );

        await utils.mintTokens(
          'contractBSNTokenSame',
          users.seller.address,
          tokensToMintSeller
        );
        await utils.mintTokens(
          'contractBSNTokenSame',
          users.buyer.address,
          tokensToMintBuyer
        );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          supplyQty
        );
      });

      afterEach(async () => {
        distributedAmounts = {
          buyerAmount: BN(0),
          sellerAmount: BN(0),
          escrowAmount: BN(0),
        };

        balanceBuyer = BN(0);
        balanceSeller = BN(0);
        escrowBalance = BN(0);
        cashierBalance = BN(0);

        await giveAwayToRandom();
      });

      it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(0);
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
          BN(constants.buyer_deposit)
        ); // 0.09
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);

        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountDeposit = BN(0);
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
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

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(0);
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04
        const expectedEscrowAmountPrice = BN(0);

        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(0);

        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
        const expectedSellerPrice = BN(constants.product_price); //// 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = BN(0);
        const expectedEscrowAmountPrice = BN(0);
        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(0);
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit); // 0.05

        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(0);

        await getBalancesFromSameTokenContract();

        assert.isTrue(
          balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)),
          'Buyer did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)),
          'Seller did not get expected tokens from SameTokenContract'
        );
        assert.isTrue(
          escrowBalance.eq(
            expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        //Cashier Should be Empty
        assert.isTrue(
          cashierBalance.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });
    });

    describe(`ETHTKN [WITH PERMIT]`, () => {
      let balanceBuyerFromDeposits = BN(0);
      let balanceSellerFromDeposits = BN(0);
      let escrowBalanceFromDeposits = BN(0);

      let cashierPaymentLeft = BN(0);
      let cashierDepositLeft = BN(0);

      async function getBalancesDepositToken() {
        balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
          users.buyer.address
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

        const supplyQty = 1;
        const tokensToMint = BN(constants.seller_deposit).mul(BN(supplyQty));

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.seller.address,
          tokensToMint
        );
        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.buyer.address,
          constants.buyer_deposit
        );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          supplyQty
        );
      });

      afterEach(async () => {
        distributedAmounts = {
          buyerAmount: BN(0),
          sellerAmount: BN(0),
          escrowAmount: BN(0),
        };

        balanceBuyerFromDeposits = BN(0);
        balanceSellerFromDeposits = BN(0);
        escrowBalanceFromDeposits = BN(0);

        cashierPaymentLeft = BN(0);
        cashierDepositLeft = BN(0);

        await giveAwayToRandom();
      });

      it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

        await getBalancesDepositToken();

        const txReceipt = await withdrawTx.wait();

        // Payment should have been returned to buyer
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(0);
        const expectedSellerDeposit = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
          BN(constants.buyer_deposit)
        ); // 0.09

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);

        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountDeposit = BN(0);

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
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

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountDeposit = BN(0);

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
        const expectedSellerPrice = BN(constants.product_price); //// 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = BN(0);

        await getBalancesDepositToken();

        // Payment should have been sent to seller
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedSellerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit); // 0.05

        await getBalancesDepositToken();

        // Payment should have been sent to seller
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedSellerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

        await getBalancesDepositToken();

        // Payment should have been sent to seller
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedSellerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

        await getBalancesDepositToken();

        // Payment should have been sent to seller
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedSellerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountDeposit = BN(0);

        await getBalancesDepositToken();

        // Payment should have been sent to seller
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedSellerPrice));
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });
    });

    describe(`TKNETH [WITH PERMIT]`, () => {
      let balanceBuyerFromPayment = BN(0);
      let balanceSellerFromPayment = BN(0);
      let escrowBalanceFromPayment = BN(0);

      let cashierPaymentLeft = BN(0);
      let cashierDepositLeft = BN(0);

      async function getBalancesPriceToken() {
        balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
          users.buyer.address
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

      beforeEach(async () => {
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

        await utils.mintTokens(
          'contractBSNTokenPrice',
          users.buyer.address,
          constants.product_price
        );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_1
        );
      });

      it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedSellerPrice = BN(0);
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedSellerPrice = BN(0);
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedSellerPrice = BN(0);
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(0);
        const expectedSellerDeposit = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
          BN(constants.buyer_deposit)
        ); // 0.09

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);

        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedSellerPrice = BN(0);
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountDeposit = BN(0);

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
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

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedSellerPrice = BN(0);
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedSellerPrice = BN(0);
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountDeposit = BN(0);

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
        const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = BN(0);

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
        const expectedSellerDeposit = BN(0);
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit); // 0.05

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const expectedBuyerPrice = BN(0);
        const expectedSellerPrice = BN(constants.product_price); // 0.3
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountDeposit = BN(0);

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
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
              users.seller.address
            );
          }
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
          cashierPaymentLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );
        assert.isTrue(
          cashierDepositLeft.eq(BN(0)),
          'Cashier Contract is not empty'
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            assert.isDefined(ev);
          }
        );
      });

      afterEach(async () => {
        distributedAmounts = {
          buyerAmount: BN(0),
          sellerAmount: BN(0),
          escrowAmount: BN(0),
        };

        balanceBuyerFromPayment = BN(0);
        balanceSellerFromPayment = BN(0);
        escrowBalanceFromPayment = BN(0);

        cashierPaymentLeft = BN(0);
        cashierDepositLeft = BN(0);

        await giveAwayToRandom();
      });
    });
  });

  describe('Seller cancels uncommitted voucher set', () => {
    let remQty = 10;
    let voucherToBuyBeforeBurn = 5;
    let tokensToMintSeller, tokensToMintBuyer;

    describe('ETHETH', () => {
      before(async () => {
        await deployContracts();
        await setPeriods();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_10
        );

        for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
          await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
          );
          remQty--;
        }
      });

      after(() => {
        remQty = 10;
        voucherToBuyBeforeBurn = 5;
      });

      it('[NEGATIVE] should revert if not called from the seller', async () => {
        const attackerInstance = contractBosonRouter.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
      });

      it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
        const sellerInstance = contractBosonRouter.connect(users.seller.signer);
        const withdrawTx = await sellerInstance.requestCancelOrFaultVoucherSet(
          TOKEN_SUPPLY_ID
        );

        const txReceipt = await withdrawTx.wait();

        const expectedSellerDeposit = BN(constants.seller_deposit).mul(
          BN(remQty)
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedSellerDeposit));
          }
        );
      });

      it('Escrow should have correct balance after burning the rest of the supply', async () => {
        const expectedBalance = BN(constants.seller_deposit).mul(
          BN(voucherToBuyBeforeBurn)
        );
        const escrowAmount = await contractCashier.getEscrowAmount(
          users.seller.address
        );

        assert.isTrue(
          escrowAmount.eq(expectedBalance),
          'Escrow amount is incorrect'
        );
      });

      it('Remaining QTY for Token Supply should be ZERO', async () => {
        const remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
          TOKEN_SUPPLY_ID,
          users.seller.address
        );

        assert.isTrue(
          remainingQtyInContract.eq(BN(0)),
          'Escrow amount is incorrect'
        );
      });

      it('[NEGATIVE] Buyer should not be able to commit to buy anything from the burnt supply', async () => {
        await expect(
          utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
          )
        ).to.be.revertedWith(revertReasons.OFFER_EMPTY);
      });

      it('[NEGATIVE] Seller should not be able withdraw its deposit for the Token Supply twice', async () => {
        const sellerInstance = contractBosonRouter.connect(users.seller.signer);

        await expect(
          sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
        ).to.be.revertedWith(revertReasons.OFFER_EMPTY);
      });

      it('[NEGATIVE] Should revert if called when contract is paused', async () => {
        const sellerInstance = contractBosonRouter.connect(users.seller.signer);
        await contractBosonRouter.pause();

        await expect(
          sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
        ).to.be.revertedWith(revertReasons.PAUSED);
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('TKNTKN', () => {
        before(async () => {
          await deployContracts();
          await setPeriods();
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

          tokensToMintSeller = BN(constants.seller_deposit).mul(
            BN(constants.QTY_10)
          );
          tokensToMintBuyer = BN(constants.product_price).mul(
            BN(constants.QTY_10)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMintSeller
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMintBuyer
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.product_price,
            constants.seller_deposit,
            constants.buyer_deposit,
            constants.QTY_10
          );

          for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
            await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
            );
            remQty--;
          }
        });

        after(() => {
          remQty = 10;
          voucherToBuyBeforeBurn = 5;
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          const attackerInstance = contractBosonRouter.connect(
            users.attacker.signer
          );

          await expect(
            attackerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
        });

        it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          const withdrawTx = await sellerInstance.requestCancelOrFaultVoucherSet(
            TOKEN_SUPPLY_ID
          );

          const txReceipt = await withdrawTx.wait();

          const expectedSellerDeposit = BN(constants.seller_deposit).mul(
            BN(remQty)
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            MockERC20Permit_Factory,
            eventNames.TRANSFER,
            (ev) => {
              assert.equal(ev.to, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev.value.eq(expectedSellerDeposit));
            }
          );
        });

        it('Tokens should be returned to seller after burning the rest of the supply', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(
            BN(voucherToBuyBeforeBurn)
          );
          const escrowAmount = await contractBSNTokenDeposit.balanceOf(
            users.seller.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Escrow should have correct balance after burning the rest of the supply', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(
            BN(voucherToBuyBeforeBurn)
          );
          const escrowAmount = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Remaining QTY for Token Supply should be ZERO', async () => {
          const remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            TOKEN_SUPPLY_ID,
            users.seller.address
          );

          assert.isTrue(
            remainingQtyInContract.eq(BN(0)),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Buyer should not be able to commit to buy anything from the burnt supply', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
            )
          ).to.be.revertedWith(revertReasons.OFFER_EMPTY);
        });

        it('[NEGATIVE] Seller should not be able withdraw its deposit for the Token Supply twice', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.OFFER_EMPTY);
        });

        it('[NEGATIVE] Should revert if called when contract is paused', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );
          await contractBosonRouter.pause();

          await expect(
            sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.PAUSED);
        });
      });

      describe('ETHTKN', () => {
        before(async () => {
          await deployContracts();
          await setPeriods();

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

          tokensToMintSeller = BN(constants.seller_deposit).mul(
            BN(constants.QTY_10)
          );
          tokensToMintBuyer = BN(constants.product_price).mul(
            BN(constants.QTY_10)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMintSeller
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.product_price,
            constants.seller_deposit,
            constants.buyer_deposit,
            constants.QTY_10
          );

          for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
            await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
            );
            remQty--;
          }
        });

        after(() => {
          remQty = 10;
          voucherToBuyBeforeBurn = 5;
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          const attackerInstance = contractBosonRouter.connect(
            users.attacker.signer
          );

          await expect(
            attackerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
        });

        it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          const withdrawTx = await sellerInstance.requestCancelOrFaultVoucherSet(
            TOKEN_SUPPLY_ID
          );

          const expectedSellerDeposit = BN(constants.seller_deposit).mul(
            BN(remQty)
          );

          const txReceipt = await withdrawTx.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            MockERC20Permit_Factory,
            eventNames.TRANSFER,
            (ev) => {
              assert.equal(ev.to, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev.value.eq(expectedSellerDeposit));
            }
          );
        });

        it('Tokens should be returned to seller after burning the rest of the supply', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(
            BN(voucherToBuyBeforeBurn)
          );
          const escrowAmount = await contractBSNTokenDeposit.balanceOf(
            users.seller.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Escrow should have correct balance after burning the rest of the supply', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(
            BN(voucherToBuyBeforeBurn)
          );
          const escrowAmount = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Remaining QTY for Token Supply should be ZERO', async () => {
          const remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            TOKEN_SUPPLY_ID,
            users.seller.address
          );

          assert.isTrue(
            remainingQtyInContract.eq(BN(0)),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Buyer should not be able to commit to buy anything from the burnt supply', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
            )
          ).to.be.revertedWith(revertReasons.OFFER_EMPTY);
        });

        it('[NEGATIVE] Seller should not be able withdraw its deposit for the Token Supply twice', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.OFFER_EMPTY);
        });

        it('[NEGATIVE] Should revert if called when contract is paused', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await contractBosonRouter.pause();

          await expect(
            sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.PAUSED);
        });
      });

      describe('TKNETH', () => {
        before(async () => {
          await deployContracts();
          await setPeriods();

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

          tokensToMintBuyer = BN(constants.product_price).mul(
            BN(constants.QTY_10)
          );

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.product_price,
            constants.seller_deposit,
            constants.buyer_deposit,
            constants.QTY_10
          );

          for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
            await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
            );
            remQty--;
          }
        });

        after(() => {
          remQty = 10;
          voucherToBuyBeforeBurn = 5;
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          const attackerInstance = contractBosonRouter.connect(
            users.attacker.signer
          );

          await expect(
            attackerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
        });

        it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          const withdrawTx = await sellerInstance.requestCancelOrFaultVoucherSet(
            TOKEN_SUPPLY_ID
          );

          const txReceipt = await withdrawTx.wait();

          const expectedSellerDeposit = BN(constants.seller_deposit).mul(
            BN(remQty)
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerDeposit));
            }
          );
        });

        it('Escrow should have correct balance after burning the rest of the supply', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(
            BN(voucherToBuyBeforeBurn)
          );
          const escrowAmount = await contractCashier.getEscrowAmount(
            users.seller.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Remaining QTY for Token Supply should be ZERO', async () => {
          const remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            TOKEN_SUPPLY_ID,
            users.seller.address
          );

          assert.isTrue(
            remainingQtyInContract.eq(BN(0)),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Buyer should not be able to commit to buy anything from the burnt supply', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.product_price,
              constants.buyer_deposit
            )
          ).to.be.revertedWith(revertReasons.OFFER_EMPTY);
        });

        it('[NEGATIVE] Seller should not be able withdraw its deposit for the Token Supply twice', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.OFFER_EMPTY);
        });

        it('[NEGATIVE] Should revert if called when contract is paused', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await contractBosonRouter.pause();

          await expect(
            sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.PAUSED);
        });
      });
    });
  });

  describe('Withdraw on disaster', () => {
    const vouchersToBuy = 4;

    describe('Common', () => {
      before(async () => {
        await deployContracts();
        await setPeriods();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_10
        );
      });

      it('[NEGATIVE] Disaster state should not be set when contract is not paused', async () => {
        await expect(contractCashier.setDisasterState()).to.be.revertedWith(
          revertReasons.NOT_PAUSED
        );
      });

      it('[NEGATIVE] Disaster state should not be set from attacker', async () => {
        const attackerInstance = contractCashier.connect(users.attacker.signer);

        await contractBosonRouter.pause();

        await expect(attackerInstance.setDisasterState()).to.be.revertedWith(
          revertReasons.UNAUTHORIZED_OWNER
        );
      });
    });

    describe('Withdraw ETH', () => {
      before(async () => {
        await deployContracts();
        await setPeriods();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_10
        );

        for (let i = 0; i < vouchersToBuy; i++) {
          await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
          );
        }

        await contractBosonRouter.pause();
      });

      it('[NEGATIVE] withdrawEthOnDisaster should not be executable before admin allows to', async () => {
        const buyerInstance = contractCashier.connect(users.buyer.signer);

        await expect(buyerInstance.withdrawEthOnDisaster()).to.be.revertedWith(
          revertReasons.MANUAL_WITHDRAW_NOT_ALLOWED
        );
      });

      it('Disaster State should be falsy value initially', async () => {
        const disasterState = await contractCashier.isDisasterStateSet();

        assert.isFalse(disasterState);
      });

      it('Admin should be able to set the Cashier at disaster state', async () => {
        let tx = await contractCashier.setDisasterState();
        let txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_DISASTER_STATE_SET,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );

        const cashier = await contractCashier.attach(
          await contractBosonRouter.getCashierAddress()
        );

        tx = await cashier.setDisasterState();
        txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_DISASTER_STATE_SET,
          (ev) => {
            assert.isTrue(ev._triggeredBy == users.deployer.address);
          }
        );

        const disasterState = await contractCashier.isDisasterStateSet();
        assert.isTrue(disasterState);
      });

      it('Buyer should be able to withdraw all the funds locked in escrow', async () => {
        const buyerInstance = contractCashier.connect(users.buyer.signer);

        const expectedBuyerBalance = BN(constants.product_price)
          .add(BN(constants.buyer_deposit))
          .mul(BN(vouchersToBuy));

        const tx = await buyerInstance.withdrawEthOnDisaster();

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAW_ETH_ON_DISASTER,
          (ev) => {
            assert.equal(
              expectedBuyerBalance.toString(),
              ev._amount.toString(),
              "Buyer withdrawn funds don't match"
            );
            assert.equal(
              users.buyer.address,
              ev._triggeredBy,
              'LogWithdrawEthOnDisaster not triggered properly'
            );
          }
        );
      });

      it('Seller should be able to withdraw all the funds locked in escrow', async () => {
        const sellerInstance = contractCashier.connect(users.seller.signer);
        const expectedSellerBalance = BN(constants.seller_deposit).mul(
          BN(constants.QTY_10)
        );
        const tx = await sellerInstance.withdrawEthOnDisaster();

        const txReceipt = await tx.wait();
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAW_ETH_ON_DISASTER,
          (ev) => {
            assert.equal(
              expectedSellerBalance.toString(),
              ev._amount.toString(),
              "Buyer withdrawn funds don't match"
            );
            assert.equal(
              users.seller.address,
              ev._triggeredBy,
              'LogWithdrawEthOnDisaster not triggered properly'
            );
          }
        );
      });

      it('[NEGATIVE] withdrawEthOnDisaster should revert if funds already withdrawn for an account', async () => {
        const buyerInstance = contractCashier.connect(users.buyer.signer);
        await expect(buyerInstance.withdrawEthOnDisaster()).to.be.revertedWith(
          revertReasons.ESCROW_EMPTY
        );
      });
    });

    describe('Withdraw TKN', () => {
      before(async () => {
        await deployContracts();
        await setPeriods();

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

        const tokensToMintSeller = BN(constants.seller_deposit).mul(
          BN(constants.QTY_10)
        );
        const tokensToMintBuyer = BN(constants.product_price).mul(
          BN(constants.QTY_10)
        );

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.seller.address,
          tokensToMintSeller
        );
        await utils.mintTokens(
          'contractBSNTokenPrice',
          users.buyer.address,
          tokensToMintBuyer
        );
        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.buyer.address,
          tokensToMintBuyer
        );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_10
        );

        for (let i = 0; i < vouchersToBuy; i++) {
          await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
          );
        }

        await contractBosonRouter.pause();
      });

      it('[NEGATIVE] withdrawTokensOnDisaster should not be executable before admin allows to', async () => {
        const buyerInstance = contractCashier.connect(users.buyer.signer);

        await expect(
          buyerInstance.withdrawTokensOnDisaster(contractBSNTokenPrice.address)
        ).to.be.revertedWith(revertReasons.MANUAL_WITHDRAW_NOT_ALLOWED);
      });

      it('Admin should be able to set the Cashier at disaster state', async () => {
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

      it('Buyer should be able to withdraw all the funds locked in escrow', async () => {
        const expectedTknPrice = BN(constants.product_price).mul(
          BN(vouchersToBuy)
        );
        const expectedTknDeposit = BN(constants.buyer_deposit).mul(
          BN(vouchersToBuy)
        );

        const buyerInstance = contractCashier.connect(users.buyer.signer);

        const txTknPrice = await buyerInstance.withdrawTokensOnDisaster(
          contractBSNTokenPrice.address
        );

        const receiptTknPrice = await txTknPrice.wait();

        eventUtils.assertEventEmitted(
          receiptTknPrice,
          Cashier_Factory,
          eventNames.LOG_WITHDRAW_TOKENS_ON_DISASTER,
          (ev) => {
            assert.equal(
              expectedTknPrice.toString(),
              ev._amount.toString(),
              "Buyer withdrawn funds don't match"
            );
            assert.equal(
              users.buyer.address,
              ev._triggeredBy,
              'LogWithdrawTokensOnDisaster not triggered properly'
            );
          }
        );

        const txTknDeposit = await buyerInstance.withdrawTokensOnDisaster(
          contractBSNTokenDeposit.address
        );

        const receiptTknDeposit = await txTknDeposit.wait();

        eventUtils.assertEventEmitted(
          receiptTknDeposit,
          Cashier_Factory,
          eventNames.LOG_WITHDRAW_TOKENS_ON_DISASTER,
          (ev) => {
            assert.equal(
              expectedTknDeposit.toString(),
              ev._amount.toString(),
              "Buyer withdrawn funds don't match"
            );
            assert.equal(
              users.buyer.address,
              ev._triggeredBy,
              'LogWithdrawTokensOnDisaster not triggered properly'
            );
          }
        );
      });

      it('Seller should be able to withdraw all the funds locked in escrow', async () => {
        const sellerInstance = contractCashier.connect(users.seller.signer);
        const expectedSellerBalance = BN(constants.seller_deposit).mul(
          BN(constants.QTY_10)
        );
        const tx = await sellerInstance.withdrawTokensOnDisaster(
          contractBSNTokenDeposit.address
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAW_TOKENS_ON_DISASTER,
          (ev) => {
            assert.equal(
              expectedSellerBalance.toString(),
              ev._amount.toString(),
              "Buyer withdrawn funds don't match"
            );
            assert.equal(
              users.seller.address,
              ev._triggeredBy,
              'LogWithdrawTokensOnDisaster not triggered properly'
            );
          }
        );
      });

      it('Escrow amount should revert if funds already withdrawn for an account', async () => {
        const buyerInstance = contractCashier.connect(users.buyer.signer);
        await expect(
          buyerInstance.withdrawTokensOnDisaster(contractBSNTokenPrice.address)
        ).to.be.revertedWith(revertReasons.ESCROW_EMPTY);
      });
    });
  });
});
