const {assert} = require('chai');

const helpers = require('../testHelpers/constants');
const timemachine = require('../testHelpers/timemachine');
const truffleAssert = require('truffle-assertions');
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

contract('Cashier withdrawals ', async (addresses) => {
  const users = new Users(addresses);

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractBSNTokenPrice,
    contractBSNTokenDeposit,
    contractFundLimitsOracle;

  let distributedAmounts = {
    buyerAmount: new BN(0),
    sellerAmount: new BN(0),
    escrowAmount: new BN(0),
  };

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

    await contractVoucherKernel.setBosonRouterAddress(
      contractBosonRouter.address
    );

    await contractERC1155ERC721.setCashierAddress(contractCashier.address);

    await contractVoucherKernel.setCashierAddress(contractCashier.address);

    await contractCashier.setBosonRouterAddress(contractBosonRouter.address);
    await contractCashier.setTokenContractAddress(
      contractERC1155ERC721.address
    );

    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenPrice.address,
      helpers.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenDeposit.address,
      helpers.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setETHLimit(helpers.ETHER_LIMIT);

    await contractVoucherKernel.setComplainPeriod(60); //60 seconds
    await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds
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

    await contractBSNTokenPrice.transfer(
      users.other1.address,
      balanceBuyerFromPayment,
      {
        from: users.buyer.address,
      }
    );
    await contractBSNTokenDeposit.transfer(
      users.other1.address,
      balanceBuyerFromDesosits,
      {
        from: users.buyer.address,
      }
    );
    await contractBSNTokenPrice.transfer(
      users.other1.address,
      balanceSellerFromPayment,
      {
        from: users.seller.address,
      }
    );
    await contractBSNTokenDeposit.transfer(
      users.other1.address,
      balanceSellerFromDesosits,
      {
        from: users.seller.address,
      }
    );
    await contractBSNTokenPrice.transfer(
      users.other1.address,
      escrowBalanceFromPayment,
      {
        from: users.deployer.address,
      }
    );
    await contractBSNTokenDeposit.transfer(
      users.other1.address,
      escrowBalanceFromDeposits,
      {
        from: users.deployer.address,
      }
    );
  }

  describe('Withdraw scenarios', async () => {
    before(async () => {
      await deployContracts();
    });

    afterEach(async () => {
      distributedAmounts = {
        buyerAmount: new BN(0),
        sellerAmount: new BN(0),
        escrowAmount: new BN(0),
      };

      const isPaused = await contractBosonRouter.paused();
      if (isPaused) {
        await contractBosonRouter.unpause();
      }
    });

    describe(`ETHETH`, async () => {
      before(async () => {
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
          timestamp + helpers.SECONDS_IN_DAY,
          helpers.seller_deposit,
          helpers.QTY_15
        );
      });

      it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.buyer_deposit)
          .add(new BN(helpers.product_price))
          .add(new BN(helpers.seller_deposit).div(new BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmount = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
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
              users.buyer.address,
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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.buyer_deposit)
          .add(new BN(helpers.product_price))
          .add(new BN(helpers.seller_deposit).div(new BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmount = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.address);
        await utils.complain(voucherID, users.buyer.address);
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
              users.buyer.address,
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

      it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.product_price); // 0.3
        const expectedSellerAmount = new BN(0); // 0
        const expectedEscrowAmount = new BN(helpers.seller_deposit).add(
          new BN(helpers.buyer_deposit)
        ); // 0.09

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await timemachine.advanceTimeSeconds(60);

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
              users.buyer.address,
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

      it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.buyer_deposit)
          .add(new BN(helpers.product_price))
          .add(new BN(helpers.seller_deposit).div(new BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmount = new BN(0); //0

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.refund(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);

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
              users.buyer.address,
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

      it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.product_price); // 0.3
        const expectedSellerAmount = new BN(helpers.seller_deposit); // 0.05
        const expectedEscrowAmount = new BN(helpers.buyer_deposit); // 0.04

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.refund(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
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
              users.buyer.address,
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

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.buyer_deposit)
          .add(new BN(helpers.product_price))
          .add(new BN(helpers.seller_deposit).div(new BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmount = new BN(0); // 0

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
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
              users.buyer.address,
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

      it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.buyer_deposit); // 0.04
        const expectedSellerAmount = new BN(helpers.seller_deposit).add(
          new BN(helpers.product_price)
        ); // 0.35
        const expectedEscrowAmount = new BN(0); // 0

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
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
              users.buyer.address,
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

      it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.buyer_deposit); // 0.04
        const expectedSellerAmount = new BN(helpers.product_price); // 0.3
        const expectedEscrowAmount = new BN(helpers.seller_deposit); // 0.05

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
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
              users.buyer.address,
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

      it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerAmount = new BN(helpers.product_price).add(
          new BN(helpers.seller_deposit).div(new BN(4))
        ); // 0.3125
        const expectedEscrowAmount = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
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
              users.buyer.address,
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

      it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerAmount = new BN(helpers.product_price).add(
          new BN(helpers.seller_deposit).div(new BN(4))
        ); // 0.3125
        const expectedEscrowAmount = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
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
              users.buyer.address,
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

      it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerAmount = new BN(helpers.product_price).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.325
        const expectedEscrowAmount = new BN(0); // 0

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
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
              users.buyer.address,
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
    });

    describe(`TKNTKN [WITH PERMIT]`, async () => {
      let balanceBuyerFromPayment = new BN(0);
      let balanceBuyerFromDeposits = new BN(0);

      let balanceSellerFromPayment = new BN(0);
      let balanceSellerFromDeposits = new BN(0);

      let escrowBalanceFromPayment = new BN(0);
      let escrowBalanceFromDeposits = new BN(0);

      let cashierPaymentLeft = new BN(0);
      let cashierDepositLeft = new BN(0);

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
        const tokensToMint = new BN(helpers.seller_deposit).mul(
          new BN(supplyQty)
        );

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.seller.address,
          tokensToMint
        );
        await utils.mintTokens(
          'contractBSNTokenPrice',
          users.buyer.address,
          helpers.product_price
        );
        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.buyer.address,
          helpers.buyer_deposit
        );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + helpers.SECONDS_IN_DAY,
          helpers.seller_deposit,
          supplyQty
        );
      });

      afterEach(async () => {
        distributedAmounts = {
          buyerAmount: new BN(0),
          sellerAmount: new BN(0),
          escrowAmount: new BN(0),
        };

        balanceBuyerFromPayment = new BN(0);
        balanceBuyerFromDeposits = new BN(0);

        balanceSellerFromPayment = new BN(0);
        balanceSellerFromDeposits = new BN(0);

        escrowBalanceFromPayment = new BN(0);
        escrowBalanceFromDeposits = new BN(0);

        cashierPaymentLeft = new BN(0);
        cashierDepositLeft = new BN(0);

        await giveAwayToRandom();
      });

      it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = new BN(0);

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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = new BN(0);

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

      it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(0);
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).add(
          new BN(helpers.buyer_deposit)
        ); // 0.09
        const expectedEscrowAmountPrice = new BN(0);

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

      it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);

        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountDeposit = new BN(0);
        const expectedEscrowAmountPrice = new BN(0);

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

      it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.refund(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(0);
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = new BN(helpers.buyer_deposit); // 0.04
        const expectedEscrowAmountPrice = new BN(0);

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

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountPrice = new BN(0);
        const expectedEscrowAmountDeposit = new BN(0);

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

      it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit); // 0.04
        const expectedSellerPrice = new BN(helpers.product_price); //// 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = new BN(0);
        const expectedEscrowAmountPrice = new BN(0);

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

      it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit); // 0.04
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(0);
        const expectedEscrowAmountPrice = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit); // 0.05

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

      it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
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

      it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
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

      it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.redeem(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountPrice = new BN(0);
        const expectedEscrowAmountDeposit = new BN(0);

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
    });

    describe(`TKNTKN SAME [WITH PERMIT]`, async () => {
      let balanceBuyer = new BN(0);
      let balanceSeller = new BN(0);
      let escrowBalance = new BN(0);
      let cashierBalance = new BN(0);

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

        const supplyQty = 1;
        const tokensToMintSeller = new BN(helpers.seller_deposit).mul(
          new BN(supplyQty)
        );
        const tokensToMintBuyer = new BN(helpers.product_price).add(
          new BN(helpers.buyer_deposit)
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
          timestamp,
          timestamp + helpers.SECONDS_IN_DAY,
          helpers.seller_deposit,
          supplyQty
        );
      });

      afterEach(async () => {
        distributedAmounts = {
          buyerAmount: new BN(0),
          sellerAmount: new BN(0),
          escrowAmount: new BN(0),
        };

        balanceBuyer = new BN(0);
        balanceSeller = new BN(0);
        escrowBalance = new BN(0);
        cashierBalance = new BN(0);

        await giveAwayToRandom();
      });

      it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = new BN(0);

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
          cashierBalance.eq(new BN(0)),
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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = new BN(0);

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
          cashierBalance.eq(new BN(0)),
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

      it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(0);
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).add(
          new BN(helpers.buyer_deposit)
        ); // 0.09
        const expectedEscrowAmountPrice = new BN(0);

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
          cashierBalance.eq(new BN(0)),
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

      it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);

        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountDeposit = new BN(0);
        const expectedEscrowAmountPrice = new BN(0);

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
          cashierBalance.eq(new BN(0)),
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

      it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.refund(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(0);
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = new BN(helpers.buyer_deposit); // 0.04
        const expectedEscrowAmountPrice = new BN(0);

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
          cashierBalance.eq(new BN(0)),
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

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountPrice = new BN(0);
        const expectedEscrowAmountDeposit = new BN(0);

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
          cashierBalance.eq(new BN(0)),
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

      it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit); // 0.04
        const expectedSellerPrice = new BN(helpers.product_price); //// 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = new BN(0);
        const expectedEscrowAmountPrice = new BN(0);
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
          cashierBalance.eq(new BN(0)),
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

      it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit); // 0.04
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(0);
        const expectedEscrowAmountPrice = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit); // 0.05

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
          cashierBalance.eq(new BN(0)),
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

      it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
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
          cashierBalance.eq(new BN(0)),
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

      it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountPrice = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
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
          cashierBalance.eq(new BN(0)),
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

      it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.redeem(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountPrice = new BN(0);
        const expectedEscrowAmountDeposit = new BN(0);

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
          cashierBalance.eq(new BN(0)),
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
    });

    describe(`ETHTKN [WITH PERMIT]`, async () => {
      let balanceBuyerFromDeposits = new BN(0);
      let balanceSellerFromDeposits = new BN(0);
      let escrowBalanceFromDeposits = new BN(0);

      let cashierPaymentLeft = new BN(0);
      let cashierDepositLeft = new BN(0);

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
        const tokensToMint = new BN(helpers.seller_deposit).mul(
          new BN(supplyQty)
        );

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.seller.address,
          tokensToMint
        );
        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.buyer.address,
          helpers.buyer_deposit
        );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + helpers.SECONDS_IN_DAY,
          helpers.seller_deposit,
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

        await giveAwayToRandom();
      });

      it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));

            return true;
          },
          'Event LogAmountDistribution was not emitted'
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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));

            return true;
          },
          'Event LogAmountDistribution was not emitted'
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

      it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(0);
        const expectedSellerDeposit = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).add(
          new BN(helpers.buyer_deposit)
        ); // 0.09

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));

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

      it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);

        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountDeposit = new BN(0);

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));

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

      it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.refund(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = new BN(helpers.buyer_deposit); // 0.04

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));

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

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountDeposit = new BN(0);

        await getBalancesDepositToken();

        // Payment should have been returned to buyer
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));

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

      it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerDeposit = new BN(helpers.buyer_deposit); // 0.04
        const expectedSellerPrice = new BN(helpers.product_price); //// 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = new BN(0);

        await getBalancesDepositToken();

        // Payment should have been sent to seller
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
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

      it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerDeposit = new BN(helpers.buyer_deposit); // 0.04
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit); // 0.05

        await getBalancesDepositToken();

        // Payment should have been sent to seller
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
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

      it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125

        await getBalancesDepositToken();

        // Payment should have been sent to seller
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
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

      it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125

        await getBalancesDepositToken();

        // Payment should have been sent to seller
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
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

      it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.redeem(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountDeposit = new BN(0);

        await getBalancesDepositToken();

        // Payment should have been sent to seller
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
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
    });

    describe(`TKNETH [WITH PERMIT]`, async () => {
      let balanceBuyerFromPayment = new BN(0);
      let balanceSellerFromPayment = new BN(0);
      let escrowBalanceFromPayment = new BN(0);

      let cashierPaymentLeft = new BN(0);
      let cashierDepositLeft = new BN(0);

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
          helpers.product_price
        );

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + helpers.SECONDS_IN_DAY,
          helpers.seller_deposit,
          helpers.QTY_1
        );
      });

      it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerPrice = new BN(0);
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
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
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerPrice = new BN(0);
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
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
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
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

      it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerPrice = new BN(0);
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(0);
        const expectedSellerDeposit = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).add(
          new BN(helpers.buyer_deposit)
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
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
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

      it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);

        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerPrice = new BN(0);
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountDeposit = new BN(0);

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
              users.buyer.address,
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

      it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.refund(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerPrice = new BN(0);
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(0);
        const expectedSellerDeposit = new BN(helpers.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = new BN(helpers.buyer_deposit); // 0.04

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
              users.buyer.address,
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

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(helpers.product_price); // 0.3
        const expectedSellerPrice = new BN(0);
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountDeposit = new BN(0);

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
              users.buyer.address,
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

      it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit); // 0.04
        const expectedSellerDeposit = new BN(helpers.seller_deposit); // 0.05
        const expectedEscrowAmountDeposit = new BN(0);

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

      it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit); // 0.04
        const expectedSellerDeposit = new BN(0);
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit); // 0.05

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

      it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.complain(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
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
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
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

      it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);
        await utils.complain(voucherID, users.buyer.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
        ); // 0.0125
        const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(
          new BN(4)
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
        truffleAssert.eventEmitted(
          withdrawTx,
          'LogWithdrawal',
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_payee',
              users.buyer.address,
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

      it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.redeem(voucherID, users.buyer.address);
        await utils.cancel(voucherID, users.seller.address);

        await timemachine.advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.address);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.address
        );

        const expectedBuyerPrice = new BN(0);
        const expectedSellerPrice = new BN(helpers.product_price); // 0.3
        const expectedEscrowPrice = new BN(0);
        const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(
          new BN(helpers.seller_deposit).div(new BN(2))
        ); // 0.065
        const expectedSellerDeposit = new BN(helpers.seller_deposit).div(
          new BN(2)
        ); // 0.025
        const expectedEscrowAmountDeposit = new BN(0);

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

      afterEach(async () => {
        distributedAmounts = {
          buyerAmount: new BN(0),
          sellerAmount: new BN(0),
          escrowAmount: new BN(0),
        };

        balanceBuyerFromPayment = new BN(0);
        balanceSellerFromPayment = new BN(0);
        escrowBalanceFromPayment = new BN(0);

        cashierPaymentLeft = new BN(0);
        cashierDepositLeft = new BN(0);

        await giveAwayToRandom();
      });
    });
  });

  describe('Seller cancels uncommitted voucher set', () => {
    let remQty = 10;
    let voucherToBuyBeforeBurn = 5;
    let tokensToMintSeller, tokensToMintBuyer;

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

        const timestamp = await Utils.getCurrTimestamp();

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + helpers.SECONDS_IN_DAY,
          helpers.seller_deposit,
          helpers.QTY_10
        );

        for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
          await utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID);
          remQty--;
        }
      });

      after(() => {
        remQty = 10;
        voucherToBuyBeforeBurn = 5;
      });

      it('[NEGATIVE] should revert if not called from the seller', async () => {
        await truffleAssert.reverts(
          contractBosonRouter.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID, {
            from: users.attacker.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
        let withdrawTx = await contractBosonRouter.requestCancelOrFaultVoucherSet(
          TOKEN_SUPPLY_ID,
          {
            from: users.seller.address,
          }
        );

        let internalTx = await truffleAssert.createTransactionResult(
          contractCashier,
          withdrawTx.tx
        );

        const expectedSellerDeposit = new BN(helpers.seller_deposit).mul(
          new BN(remQty)
        );
        truffleAssert.eventEmitted(
          internalTx,
          'LogWithdrawal',
          (ev) => {
            assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedSellerDeposit));

            return true;
          },
          'Event LogWithdrawal was not emitted'
        );
      });

      it('Escrow should have correct balance after burning the rest of the supply', async () => {
        const expectedBalance = new BN(helpers.seller_deposit).mul(
          new BN(voucherToBuyBeforeBurn)
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
        let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
          TOKEN_SUPPLY_ID,
          users.seller.address
        );

        assert.isTrue(
          remainingQtyInContract.eq(new BN(0)),
          'Escrow amount is incorrect'
        );
      });

      it('[NEGATIVE] Buyer should not be able to commit to buy anything from the burnt supply', async () => {
        await truffleAssert.reverts(
          utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Seller should not be able withdraw its deposit for the Token Supply twice', async () => {
        await truffleAssert.reverts(
          contractBosonRouter.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID, {
            from: users.seller.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Should revert if called when contract is paused', async () => {
        await contractBosonRouter.pause();

        await truffleAssert.reverts(
          contractBosonRouter.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID, {
            from: users.seller.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('TKNTKN', async () => {
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

          tokensToMintSeller = new BN(helpers.seller_deposit).mul(
            new BN(helpers.QTY_10)
          );
          tokensToMintBuyer = new BN(helpers.product_price).mul(
            new BN(helpers.QTY_10)
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
            timestamp,
            timestamp + helpers.SECONDS_IN_DAY,
            helpers.seller_deposit,
            helpers.QTY_10
          );

          for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
            await utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID);
            remQty--;
          }
        });

        after(() => {
          remQty = 10;
          voucherToBuyBeforeBurn = 5;
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          await truffleAssert.reverts(
            contractBosonRouter.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID,
              {
                from: users.attacker.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
          let withdrawTx = await contractBosonRouter.requestCancelOrFaultVoucherSet(
            TOKEN_SUPPLY_ID,
            {
              from: users.seller.address,
            }
          );

          const expectedSellerDeposit = new BN(helpers.seller_deposit).mul(
            new BN(remQty)
          );

          const internalTx = await truffleAssert.createTransactionResult(
            contractBSNTokenDeposit,
            withdrawTx.tx
          );

          truffleAssert.eventEmitted(
            internalTx,
            'Transfer',
            (ev) => {
              assert.equal(ev.to, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev.value.eq(expectedSellerDeposit));

              return true;
            },
            'Event Transfer was not emitted'
          );
        });

        it('Tokens should be returned to seller after burning the rest of the supply', async () => {
          const expectedBalance = new BN(helpers.seller_deposit).mul(
            new BN(voucherToBuyBeforeBurn)
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
          const expectedBalance = new BN(helpers.seller_deposit).mul(
            new BN(voucherToBuyBeforeBurn)
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
          let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            TOKEN_SUPPLY_ID,
            users.seller.address
          );

          assert.isTrue(
            remainingQtyInContract.eq(new BN(0)),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Buyer should not be able to commit to buy anything from the burnt supply', async () => {
          await truffleAssert.reverts(
            utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Seller should not be able withdraw its deposit for the Token Supply twice', async () => {
          await truffleAssert.reverts(
            contractBosonRouter.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID,
              {
                from: users.seller.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should revert if called when contract is paused', async () => {
          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            contractBosonRouter.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID,
              {
                from: users.seller.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

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

          const timestamp = await Utils.getCurrTimestamp();

          tokensToMintSeller = new BN(helpers.seller_deposit).mul(
            new BN(helpers.QTY_10)
          );
          tokensToMintBuyer = new BN(helpers.product_price).mul(
            new BN(helpers.QTY_10)
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
            timestamp,
            timestamp + helpers.SECONDS_IN_DAY,
            helpers.seller_deposit,
            helpers.QTY_10
          );

          for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
            await utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID);
            remQty--;
          }
        });

        after(() => {
          remQty = 10;
          voucherToBuyBeforeBurn = 5;
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          await truffleAssert.reverts(
            contractBosonRouter.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID,
              {
                from: users.attacker.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
          let withdrawTx = await contractBosonRouter.requestCancelOrFaultVoucherSet(
            TOKEN_SUPPLY_ID,
            {
              from: users.seller.address,
            }
          );

          const expectedSellerDeposit = new BN(helpers.seller_deposit).mul(
            new BN(remQty)
          );

          const internalTx = await truffleAssert.createTransactionResult(
            contractBSNTokenDeposit,
            withdrawTx.tx
          );

          truffleAssert.eventEmitted(
            internalTx,
            'Transfer',
            (ev) => {
              assert.equal(ev.to, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev.value.eq(expectedSellerDeposit));

              return true;
            },
            'Event Transfer was not emitted'
          );
        });

        it('Tokens should be returned to seller after burning the rest of the supply', async () => {
          const expectedBalance = new BN(helpers.seller_deposit).mul(
            new BN(voucherToBuyBeforeBurn)
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
          const expectedBalance = new BN(helpers.seller_deposit).mul(
            new BN(voucherToBuyBeforeBurn)
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
          let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            TOKEN_SUPPLY_ID,
            users.seller.address
          );

          assert.isTrue(
            remainingQtyInContract.eq(new BN(0)),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Buyer should not be able to commit to buy anything from the burnt supply', async () => {
          await truffleAssert.reverts(
            utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Seller should not be able withdraw its deposit for the Token Supply twice', async () => {
          await truffleAssert.reverts(
            contractBosonRouter.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID,
              {
                from: users.seller.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should revert if called when contract is paused', async () => {
          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            contractBosonRouter.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID,
              {
                from: users.seller.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });

      describe('TKNETH', async () => {
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

          tokensToMintBuyer = new BN(helpers.product_price).mul(
            new BN(helpers.QTY_10)
          );

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + helpers.SECONDS_IN_DAY,
            helpers.seller_deposit,
            helpers.QTY_10
          );

          for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
            await utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID);
            remQty--;
          }
        });

        after(() => {
          remQty = 10;
          voucherToBuyBeforeBurn = 5;
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          await truffleAssert.reverts(
            contractBosonRouter.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID,
              {
                from: users.attacker.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
          let withdrawTx = await contractBosonRouter.requestCancelOrFaultVoucherSet(
            TOKEN_SUPPLY_ID,
            {
              from: users.seller.address,
            }
          );

          const internalTx = await truffleAssert.createTransactionResult(
            contractCashier,
            withdrawTx.tx
          );
          const expectedSellerDeposit = new BN(helpers.seller_deposit).mul(
            new BN(remQty)
          );
          truffleAssert.eventEmitted(
            internalTx,
            'LogWithdrawal',
            (ev) => {
              assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerDeposit));

              return true;
            },
            'Event LogWithdrawal was not emitted'
          );
        });

        it('Escrow should have correct balance after burning the rest of the supply', async () => {
          const expectedBalance = new BN(helpers.seller_deposit).mul(
            new BN(voucherToBuyBeforeBurn)
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
          let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            TOKEN_SUPPLY_ID,
            users.seller.address
          );

          assert.isTrue(
            remainingQtyInContract.eq(new BN(0)),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Buyer should not be able to commit to buy anything from the burnt supply', async () => {
          await truffleAssert.reverts(
            utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Seller should not be able withdraw its deposit for the Token Supply twice', async () => {
          await truffleAssert.reverts(
            contractBosonRouter.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID,
              {
                from: users.seller.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('[NEGATIVE] Should revert if called when contract is paused', async () => {
          await contractBosonRouter.pause();

          await truffleAssert.reverts(
            contractBosonRouter.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID,
              {
                from: users.seller.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        });
      });
    });
  });

  describe('Withdraw on disaster', () => {
    let vouchersToBuy = 4;

    describe('Common', () => {
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
          timestamp + helpers.SECONDS_IN_DAY,
          helpers.seller_deposit,
          helpers.QTY_10
        );
      });

      it('[NEGATIVE] Disaster state should not be set when contract is not paused', async () => {
        await truffleAssert.reverts(
          contractCashier.setDisasterState(),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Disaster state should not be set from attacker', async () => {
        await contractBosonRouter.pause();

        await truffleAssert.reverts(
          contractCashier.setDisasterState({from: users.attacker.address}),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('Withdraw ETH', () => {
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
          timestamp + helpers.SECONDS_IN_DAY,
          helpers.seller_deposit,
          helpers.QTY_10
        );

        for (let i = 0; i < vouchersToBuy; i++) {
          await utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID);
        }

        await contractBosonRouter.pause();
      });

      it('[NEGATIVE] withdrawEthOnDisaster should not be executable before admin allows to', async () => {
        await truffleAssert.reverts(
          contractCashier.withdrawEthOnDisaster({from: users.buyer.address}),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Admin should be able to set the Cashier at disaster state', async () => {
        const tx = await contractCashier.setDisasterState();

        truffleAssert.eventEmitted(tx, 'LogDisasterStateSet', (ev) => {
          return ev._triggeredBy == users.deployer.address;
        });
      });

      it('Buyer should be able to withdraw all the funds locked in escrow', async () => {
        const expectedBuyerBalance = new BN(helpers.product_price)
          .add(new BN(helpers.buyer_deposit))
          .mul(new BN(vouchersToBuy));
        const tx = await contractCashier.withdrawEthOnDisaster({
          from: users.buyer.address,
        });

        truffleAssert.eventEmitted(tx, 'LogWithdrawEthOnDisaster', (ev) => {
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

          return true;
        });
      });

      it('Seller should be able to withdraw all the funds locked in escrow', async () => {
        const expectedSellerBalance = new BN(helpers.seller_deposit).mul(
          new BN(helpers.QTY_10)
        );
        const tx = await contractCashier.withdrawEthOnDisaster({
          from: users.seller.address,
        });

        truffleAssert.eventEmitted(tx, 'LogWithdrawEthOnDisaster', (ev) => {
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

          return true;
        });
      });

      it('[NEGATIVE] withdrawEthOnDisaster should revert if funds already withdrawn for an account', async () => {
        await truffleAssert.reverts(
          contractCashier.withdrawEthOnDisaster({from: users.buyer.address}),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('Withdraw TKN', () => {
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

        const tokensToMintSeller = new BN(helpers.seller_deposit).mul(
          new BN(helpers.QTY_10)
        );
        const tokensToMintBuyer = new BN(helpers.product_price).mul(
          new BN(helpers.QTY_10)
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
          timestamp,
          timestamp + helpers.SECONDS_IN_DAY,
          helpers.seller_deposit,
          helpers.QTY_10
        );

        for (let i = 0; i < vouchersToBuy; i++) {
          await utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID);
        }

        await contractBosonRouter.pause();
      });

      it('[NEGATIVE] withdrawTokensOnDisaster should not be executable before admin allows to', async () => {
        await truffleAssert.reverts(
          contractCashier.withdrawTokensOnDisaster(
            contractBSNTokenPrice.address,
            {from: users.buyer.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Admin should be able to set the Cashier at disaster state', async () => {
        const tx = await contractCashier.setDisasterState();

        truffleAssert.eventEmitted(tx, 'LogDisasterStateSet', (ev) => {
          return ev._triggeredBy == users.deployer.address;
        });
      });

      it('Buyer should be able to withdraw all the funds locked in escrow', async () => {
        const expectedTknPrice = new BN(helpers.product_price).mul(
          new BN(vouchersToBuy)
        );
        const expectedTknDeposit = new BN(helpers.buyer_deposit).mul(
          new BN(vouchersToBuy)
        );

        const txTknPrice = await contractCashier.withdrawTokensOnDisaster(
          contractBSNTokenPrice.address,
          {from: users.buyer.address}
        );
        const txTknDeposit = await contractCashier.withdrawTokensOnDisaster(
          contractBSNTokenDeposit.address,
          {from: users.buyer.address}
        );

        truffleAssert.eventEmitted(
          txTknPrice,
          'LogWithdrawTokensOnDisaster',
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

            return true;
          }
        );

        truffleAssert.eventEmitted(
          txTknDeposit,
          'LogWithdrawTokensOnDisaster',
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

            return true;
          }
        );
      });

      it('Seller should be able to withdraw all the funds locked in escrow', async () => {
        const expectedSellerBalance = new BN(helpers.seller_deposit).mul(
          new BN(helpers.QTY_10)
        );
        const tx = await contractCashier.withdrawTokensOnDisaster(
          contractBSNTokenDeposit.address,
          {from: users.seller.address}
        );

        truffleAssert.eventEmitted(tx, 'LogWithdrawTokensOnDisaster', (ev) => {
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

          return true;
        });
      });

      it('Escrow amount should revert if funds already withdrawn for an account', async () => {
        await truffleAssert.reverts(
          contractCashier.withdrawTokensOnDisaster(
            contractBSNTokenPrice.address,
            {from: users.buyer.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });
    });
  });
});
