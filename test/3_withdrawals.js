const chai = require('chai');
const truffleAssert = require('truffle-assertions');

const constants = require('../testHelpers/constants');
const timemachine = require('../testHelpers/timemachine');
const Users = require('../testHelpers/users');
const UtilsBuilder = require('../testHelpers/utilsBuilder');
const Utils = require('../testHelpers/utils');

const assert = chai.assert;

const BN = web3.utils.BN;

const ERC1155ERC721 = artifacts.require('ERC1155ERC721');
const VoucherKernel = artifacts.require('VoucherKernel');
const Cashier = artifacts.require('Cashier');
const BosonTKN = artifacts.require('BosonTokenPrice');
const FundLimitsOracle = artifacts.require('FundLimitsOracle');

let utils;

let TOKEN_SUPPLY_ID;

contract('Cashier withdrawals ', async (addresses) => {
  const users = new Users(addresses);

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBSNTokenPrice,
    contractBSNTokenDeposit,
    contractFundLimitsOracle;

  const PAUSED_WITH_PERMIT = 1;
  const PAUSED_LABEL = '[PAUSED]';

  let distributedAmounts = {
    buyerAmount: new BN(0),
    sellerAmount: new BN(0),
    escrowAmount: new BN(0),
  };

  async function deployContracts() {
    const sixtySeconds = 60;

    contractFundLimitsOracle = await FundLimitsOracle.new();
    contractERC1155ERC721 = await ERC1155ERC721.new();
    contractVoucherKernel = await VoucherKernel.new(
      contractERC1155ERC721.address
    );
    contractCashier = await Cashier.new(
      contractVoucherKernel.address,
      contractERC1155ERC721.address,
      contractFundLimitsOracle.address
    );
    contractBSNTokenPrice = await BosonTKN.new('BosonTokenPrice', 'BPRC');
    contractBSNTokenDeposit = await BosonTKN.new('BosonTokenDeposit', 'BDEP');

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address,
      'true'
    );
    await contractERC1155ERC721.setVoucherKernelAddress(
      contractVoucherKernel.address
    );
    await contractVoucherKernel.setCashierAddress(contractCashier.address);

    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenPrice.address,
      constants.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenDeposit.address,
      constants.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setETHLimit(constants.ETHER_LIMIT);

    await contractVoucherKernel.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds);
  }

  // this functions is used after each interaction with tokens to clear
  // balances
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

  async function withdraw(utils, index, voucherID) {
    if (index === 1) {
      await utils.pause(users.deployer.address);
      return await utils.withdrawWhenPaused(voucherID, users.seller.address);
    } else {
      return await utils.withdraw(voucherID, users.deployer.address);
    }
  }

  for (let i = 0; i <= PAUSED_WITH_PERMIT; i++) {
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

        const isPaused = await contractCashier.paused();
        if (isPaused) {
          await contractCashier.unpause();
        }
      });

      describe(`ETH - ETH${
        i === PAUSED_WITH_PERMIT ? PAUSED_LABEL : ''
      }`, async () => {
        before(async () => {
          utils = UtilsBuilder.create()
            .ETHETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier
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

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          // 0.3 + 0.04 + 0.025
          const expectedBuyerAmount = new BN(constants.buyer_deposit)
            .add(new BN(constants.product_price))
            .add(new BN(constants.seller_deposit).div(new BN(2)));
          // 0.0125
          const expectedSellerAmount = new BN(constants.seller_deposit).div(
            new BN(4)
          );
          // 0.0125
          const expectedEscrowAmount = new BN(constants.seller_deposit).div(
            new BN(4)
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );

          await utils.refund(voucherID, users.buyer.address);
          await utils.complain(voucherID, users.buyer.address);
          await utils.cancel(voucherID, users.seller.address);
          await utils.finalize(voucherID, users.deployer.address);
          const withdrawTx = await withdraw(utils, i, voucherID);

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
          // 0.3
          const expectedBuyerAmount = new BN(constants.product_price);
          // 0
          const expectedSellerAmount = new BN(0);
          // 0.09
          const expectedEscrowAmount = new BN(constants.seller_deposit).add(
            new BN(constants.buyer_deposit)
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );
          await utils.refund(voucherID, users.buyer.address);
          await utils.complain(voucherID, users.buyer.address);
          await timemachine.advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await withdraw(utils, i, voucherID);

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
          // 0.3 + 0.04 + 0.025
          const expectedBuyerAmount = new BN(constants.buyer_deposit)
            .add(new BN(constants.product_price))
            .add(new BN(constants.seller_deposit).div(new BN(2)));
          // 0.025
          const expectedSellerAmount = new BN(constants.seller_deposit).div(
            new BN(2)
          );
          // 0
          const expectedEscrowAmount = new BN(0);

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );
          await utils.refund(voucherID, users.buyer.address);
          await utils.cancel(voucherID, users.seller.address);

          await timemachine.advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await withdraw(utils, i, voucherID);

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
          // 0.3
          const expectedBuyerAmount = new BN(constants.product_price);
          // 0.05
          const expectedSellerAmount = new BN(constants.seller_deposit);
          // 0.04
          const expectedEscrowAmount = new BN(constants.buyer_deposit);

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );
          await utils.refund(voucherID, users.buyer.address);

          await timemachine.advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await withdraw(utils, i, voucherID);

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
          // 0.3 + 0.04 + 0.025
          const expectedBuyerAmount = new BN(constants.buyer_deposit)
            .add(new BN(constants.product_price))
            .add(new BN(constants.seller_deposit).div(new BN(2)));
          // 0.025
          const expectedSellerAmount = new BN(constants.seller_deposit).div(
            new BN(2)
          );
          // 0
          const expectedEscrowAmount = new BN(0);

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );
          await utils.cancel(voucherID, users.seller.address);

          await timemachine.advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await withdraw(utils, i, voucherID);

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
          // 0.04
          const expectedBuyerAmount = new BN(constants.buyer_deposit);
          // 0.35
          const expectedSellerAmount = new BN(constants.seller_deposit).add(
            new BN(constants.product_price)
          );
          // 0
          const expectedEscrowAmount = new BN(0);

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );
          await utils.redeem(voucherID, users.buyer.address);

          await timemachine.advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await withdraw(utils, i, voucherID);

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
          // 0.04
          const expectedBuyerAmount = new BN(constants.buyer_deposit);
          // 0.3
          const expectedSellerAmount = new BN(constants.product_price);
          // 0.05
          const expectedEscrowAmount = new BN(constants.seller_deposit);

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );
          await utils.redeem(voucherID, users.buyer.address);
          await utils.complain(voucherID, users.buyer.address);

          await timemachine.advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await withdraw(utils, i, voucherID);

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
          // 0.065
          const expectedBuyerAmount = new BN(constants.buyer_deposit).add(
            new BN(constants.seller_deposit).div(new BN(2))
          );
          // 0.3125
          const expectedSellerAmount = new BN(constants.product_price).add(
            new BN(constants.seller_deposit).div(new BN(4))
          );
          // 0.0125
          const expectedEscrowAmount = new BN(constants.seller_deposit).div(
            new BN(4)
          );

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

          const withdrawTx = await withdraw(utils, i, voucherID);

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
          // 0.065
          const expectedBuyerAmount = new BN(constants.buyer_deposit).add(
            new BN(constants.seller_deposit).div(new BN(2))
          );
          // 0.325
          const expectedSellerAmount = new BN(constants.product_price).add(
            new BN(constants.seller_deposit).div(new BN(2))
          );
          // 0
          const expectedEscrowAmount = new BN(0);

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID
          );
          await utils.redeem(voucherID, users.buyer.address);
          await utils.cancel(voucherID, users.seller.address);

          await timemachine.advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.address);

          const withdrawTx = await withdraw(utils, i, voucherID);

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

      describe(
        'TKN - TKN [WITH PERMIT]' +
          `${i === PAUSED_WITH_PERMIT ? PAUSED_LABEL : ''}`,
        async () => {
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
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              supplyQty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            const expectedSellerPrice = new BN(0);
            // 0.0125
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(4)
            );
            // 0.0125
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).div(new BN(4));
            const expectedEscrowAmountPrice = new BN(0);

            await getBalancesFromPriceTokenAndDepositToken();

            // Payments
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

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedBuyerDeposit = new BN(0);
            const expectedSellerPrice = new BN(0);
            const expectedSellerDeposit = new BN(0);
            // 0.09
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).add(new BN(constants.buyer_deposit));
            const expectedEscrowAmountPrice = new BN(0);

            await getBalancesFromPriceTokenAndDepositToken();

            // Payments
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

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            const expectedSellerPrice = new BN(0);
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
            const expectedEscrowAmountDeposit = new BN(0);
            const expectedEscrowAmountPrice = new BN(0);

            await getBalancesFromPriceTokenAndDepositToken();

            // Payments
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

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedBuyerDeposit = new BN(0);
            const expectedSellerPrice = new BN(0);
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit);
            // 0.04
            const expectedEscrowAmountDeposit = new BN(constants.buyer_deposit);
            const expectedEscrowAmountPrice = new BN(0);

            await getBalancesFromPriceTokenAndDepositToken();

            // Payments
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            const expectedSellerPrice = new BN(0);
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
            const expectedEscrowAmountPrice = new BN(0);
            const expectedEscrowAmountDeposit = new BN(0);

            await getBalancesFromPriceTokenAndDepositToken();

            // Payments
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

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit);
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit);
            const expectedEscrowAmountDeposit = new BN(0);
            const expectedEscrowAmountPrice = new BN(0);

            await getBalancesFromPriceTokenAndDepositToken();

            // Payments
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

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit);
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            const expectedSellerDeposit = new BN(0);
            const expectedEscrowAmountPrice = new BN(0);
            // 0.05
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            );

            await getBalancesFromPriceTokenAndDepositToken();

            // Payments
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

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            // 0.0125
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(4)
            );
            const expectedEscrowAmountPrice = new BN(0);
            // 0.0125
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).div(new BN(4));

            await getBalancesFromPriceTokenAndDepositToken();

            // Payments
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

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
            const expectedEscrowAmountPrice = new BN(0);
            const expectedEscrowAmountDeposit = new BN(0);

            await getBalancesFromPriceTokenAndDepositToken();

            // Payments
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

            // Deposits
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

            // Cashier Should be Empty
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
            balanceBuyerFromDeposits = new BN(0);

            balanceSellerFromPayment = new BN(0);
            balanceSellerFromDeposits = new BN(0);

            escrowBalanceFromPayment = new BN(0);
            escrowBalanceFromDeposits = new BN(0);

            cashierPaymentLeft = new BN(0);
            cashierDepositLeft = new BN(0);

            await giveAwayToRandom();

            const isPaused = await contractCashier.paused();
            if (isPaused) {
              await contractCashier.unpause();
            }
          });
        }
      );

      // Ignored due to deployment failure.
      xdescribe(
        'TKN - TKN SAME [WITH PERMIT]' +
          `${i === PAUSED_WITH_PERMIT ? PAUSED_LABEL : ''}`,
        async () => {
          let balanceBuyer = new BN(0);
          let balanceSeller = new BN(0);
          let escrowBalance = new BN(0);
          let cashierBalance = new BN(0);

          async function getBalancesFromSameTokenContract() {
            balanceBuyer = await utils.contractBSNTokenSAME.balanceOf(
              users.buyer.address
            );
            balanceSeller = await utils.contractBSNTokenSAME.balanceOf(
              users.seller.address
            );
            escrowBalance = await utils.contractBSNTokenSAME.balanceOf(
              users.deployer.address
            );
            cashierBalance = await utils.contractBSNTokenSAME.balanceOf(
              utils.contractCashier.address
            );
          }

          beforeEach(async () => {
            utils = UtilsBuilder.create()
              .ERC20withPermit()
              .TKNTKNSAME()
              .build(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBSNTokenPrice,
                contractBSNTokenDeposit
              );

            const timestamp = await Utils.getCurrTimestamp();

            const supplyQty = 1;
            const tokensToMintSeller = new BN(constants.seller_deposit).mul(
              new BN(supplyQty)
            );
            const tokensToMintBuyer = new BN(constants.product_price).add(
              new BN(constants.buyer_deposit)
            );

            await utils.mintTokens(
              'contractBSNTokenSAME',
              users.seller.address,
              tokensToMintSeller
            );
            await utils.mintTokens(
              'contractBSNTokenSAME',
              users.buyer.address,
              tokensToMintBuyer
            );

            TOKEN_SUPPLY_ID = await utils.createOrder(
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

            balanceBuyer = new BN(0);
            balanceSeller = new BN(0);
            escrowBalance = new BN(0);
            cashierBalance = new BN(0);

            await giveAwayToRandom();

            const isPaused = await contractCashier.paused();
            if (isPaused) {
              await contractCashier.unpause();
            }
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            const expectedSellerPrice = new BN(0);
            // 0.0125
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(4)
            );
            // 0.0125
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).div(new BN(4));
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

            // Cashier Should be Empty
            assert.isTrue(
              cashierBalance.eq(new BN(0)),
              'Cashier Contract is not empty'
            );

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedBuyerDeposit = new BN(0);
            const expectedSellerPrice = new BN(0);
            const expectedSellerDeposit = new BN(0);
            // 0.09
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).add(new BN(constants.buyer_deposit));
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

            // Cashier Should be Empty
            assert.isTrue(
              cashierBalance.eq(new BN(0)),
              'Cashier Contract is not empty'
            );

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            const expectedSellerPrice = new BN(0);
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
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

            // Cashier Should be Empty
            assert.isTrue(
              cashierBalance.eq(new BN(0)),
              'Cashier Contract is not empty'
            );

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedBuyerDeposit = new BN(0);
            const expectedSellerPrice = new BN(0);
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit);
            // 0.04
            const expectedEscrowAmountDeposit = new BN(constants.buyer_deposit);
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

            // Cashier Should be Empty
            assert.isTrue(
              cashierBalance.eq(new BN(0)),
              'Cashier Contract is not empty'
            );

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            const expectedSellerPrice = new BN(0);
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
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

            // Cashier Should be Empty
            assert.isTrue(
              cashierBalance.eq(new BN(0)),
              'Cashier Contract is not empty'
            );

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit);
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit);
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

            // Cashier Should be Empty
            assert.isTrue(
              cashierBalance.eq(new BN(0)),
              'Cashier Contract is not empty'
            );

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit);
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            const expectedSellerDeposit = new BN(0);
            const expectedEscrowAmountPrice = new BN(0);
            // 0.05
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            );

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

            // Cashier Should be Empty
            assert.isTrue(
              cashierBalance.eq(new BN(0)),
              'Cashier Contract is not empty'
            );

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            // 0.0125
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(4)
            );
            const expectedEscrowAmountPrice = new BN(0);
            // 0.0125
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).div(new BN(4));

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

            // Cashier Should be Empty
            assert.isTrue(
              cashierBalance.eq(new BN(0)),
              'Cashier Contract is not empty'
            );

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
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

            // Cashier Should be Empty
            assert.isTrue(
              cashierBalance.eq(new BN(0)),
              'Cashier Contract is not empty'
            );

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
                return true;
              },
              'Event LogAmountDistribution was not emitted'
            );
          });
        }
      );

      describe(
        'ETH - TKN [WITH PERMIT]' +
          `${i === PAUSED_WITH_PERMIT ? PAUSED_LABEL : ''}`,
        async () => {
          let balanceBuyerFromPayment = new BN(0);
          let balanceBuyerFromDeposits = new BN(0);

          let balanceSellerFromPayment = new BN(0);
          let balanceSellerFromDeposits = new BN(0);

          let escrowBalanceFromPayment = new BN(0);
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
              users.buyer.address,
              constants.buyer_deposit
            );

            TOKEN_SUPPLY_ID = await utils.createOrder(
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

            balanceBuyerFromPayment = new BN(0);
            balanceBuyerFromDeposits = new BN(0);

            balanceSellerFromPayment = new BN(0);
            balanceSellerFromDeposits = new BN(0);

            escrowBalanceFromPayment = new BN(0);
            escrowBalanceFromDeposits = new BN(0);

            cashierPaymentLeft = new BN(0);
            cashierDepositLeft = new BN(0);

            await giveAwayToRandom();

            const isPaused = await contractCashier.paused();
            if (isPaused) {
              await contractCashier.unpause();
            }
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.0125
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(4)
            );
            // 0.0125
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).div(new BN(4));

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

            // Deposits
            assert.isTrue(
              balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
              'Buyer did not get expected tokens from ' + 'DepositTokenContract'
            );
            assert.isTrue(
              balanceSellerFromDeposits.eq(expectedSellerDeposit),
              'Seller did not get expected tokens from ' +
                'DepositTokenContract'
            );
            assert.isTrue(
              escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
              'Escrow did not get expected tokens from ' +
                'DepositTokenContract'
            );

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedBuyerDeposit = new BN(0);
            const expectedSellerDeposit = new BN(0);
            // 0.09
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).add(new BN(constants.buyer_deposit));

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

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
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

            // Deposits
            assert.isTrue(
              balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
              'Buyer did not get expected tokens from ' + 'DepositTokenContract'
            );
            assert.isTrue(
              balanceSellerFromDeposits.eq(expectedSellerDeposit),
              'Seller did not get expected tokens from ' +
                'DepositTokenContract'
            );
            assert.isTrue(
              escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
              'Escrow did not get expected tokens from ' +
                'DepositTokenContract'
            );

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedBuyerDeposit = new BN(0);
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit);
            // 0.04
            const expectedEscrowAmountDeposit = new BN(constants.buyer_deposit);

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

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
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

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit);
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit);
            const expectedEscrowAmountDeposit = new BN(0);

            await getBalancesDepositToken();

            // Payment should have been sent to seller
            truffleAssert.eventEmitted(
              withdrawTx,
              'LogWithdrawal',
              (ev) => {
                assert.equal(
                  ev._payee,
                  users.seller.address,
                  'Incorrect Payee'
                );
                assert.isTrue(ev._payment.eq(expectedSellerPrice));

                return true;
              },
              'Event LogWithdrawal was not emitted'
            );

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit);
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            const expectedSellerDeposit = new BN(0);
            // 0.05
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            );

            await getBalancesDepositToken();

            // Payment should have been sent to seller
            truffleAssert.eventEmitted(
              withdrawTx,
              'LogWithdrawal',
              (ev) => {
                assert.equal(
                  ev._payee,
                  users.seller.address,
                  'Incorrect Payee'
                );
                assert.isTrue(ev._payment.eq(expectedSellerPrice));

                return true;
              },
              'Event LogWithdrawal was not emitted'
            );

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            // 0.0125
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(4)
            );
            // 0.0125
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).div(new BN(4));

            await getBalancesDepositToken();

            // Payment should have been sent to seller
            truffleAssert.eventEmitted(
              withdrawTx,
              'LogWithdrawal',
              (ev) => {
                assert.equal(
                  ev._payee,
                  users.seller.address,
                  'Incorrect Payee'
                );
                assert.isTrue(ev._payment.eq(expectedSellerPrice));

                return true;
              },
              'Event LogWithdrawal was not emitted'
            );

            // Deposits
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
            const expectedEscrowAmountDeposit = new BN(0);

            await getBalancesDepositToken();

            // Payment should have been sent to seller
            truffleAssert.eventEmitted(
              withdrawTx,
              'LogWithdrawal',
              (ev) => {
                assert.equal(
                  ev._payee,
                  users.seller.address,
                  'Incorrect Payee'
                );
                assert.isTrue(ev._payment.eq(expectedSellerPrice));

                return true;
              },
              'Event LogWithdrawal was not emitted'
            );

            // Deposits
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

            // Cashier Should be Empty
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
                return true;
              },
              'Event LogAmountDistribution was not emitted'
            );
          });
        }
      );

      describe(
        'TKN - ETH [WITH PERMIT]' +
          `${i === PAUSED_WITH_PERMIT ? PAUSED_LABEL : ''}`,
        async () => {
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
                contractBSNTokenPrice,
                ''
              );

            const timestamp = await Utils.getCurrTimestamp();

            await utils.mintTokens(
              'contractBSNTokenPrice',
              users.buyer.address,
              constants.product_price
            );

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedSellerPrice = new BN(0);
            const expectedEscrowPrice = new BN(0);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.0125
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(4)
            );
            // 0.0125
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).div(new BN(4));

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

            // Deposits in ETH
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedSellerPrice = new BN(0);
            const expectedEscrowPrice = new BN(0);
            const expectedBuyerDeposit = new BN(0);
            const expectedSellerDeposit = new BN(0);
            // 0.09
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).add(new BN(constants.buyer_deposit));

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

            // Deposits in ETH
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedSellerPrice = new BN(0);
            const expectedEscrowPrice = new BN(0);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
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

            // Deposits in ETH
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedSellerPrice = new BN(0);
            const expectedEscrowPrice = new BN(0);
            const expectedBuyerDeposit = new BN(0);
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit);
            // 0.04
            const expectedEscrowAmountDeposit = new BN(constants.buyer_deposit);

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

            // Deposits in ETH
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price);
            const expectedSellerPrice = new BN(0);
            const expectedEscrowPrice = new BN(0);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
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

            // Deposits in ETH
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            const expectedEscrowPrice = new BN(0);
            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit);
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit);
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

            // Deposits in ETH
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            const expectedEscrowPrice = new BN(0);
            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit);
            const expectedSellerDeposit = new BN(0);
            // 0.05
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
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

            // Deposits in ETH
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            const expectedEscrowPrice = new BN(0);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.0125
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(4)
            );
            // 0.0125
            const expectedEscrowAmountDeposit = new BN(
              constants.seller_deposit
            ).div(new BN(4));

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

            // Deposits in ETH
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

            // Cashier Should be Empty
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

            const withdrawTx = await withdraw(utils, i, voucherID);

            const expectedBuyerPrice = new BN(0);
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price);
            const expectedEscrowPrice = new BN(0);
            // 0.065
            const expectedBuyerDeposit = new BN(constants.buyer_deposit).add(
              new BN(constants.seller_deposit).div(new BN(2))
            );
            // 0.025
            const expectedSellerDeposit = new BN(constants.seller_deposit).div(
              new BN(2)
            );
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

            // Deposits in ETH
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

            // Cashier Should be Empty
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
        }
      );
    });
  }

  describe('[WHEN PAUSED] Seller withdraws deposit locked in escrow', async () => {
    let remQty = 10;
    let voucherToBuyBeforeBurn = 5;
    let tokensToMintSeller, tokensToMintBuyer;

    describe('ETH ETH', () => {
      before(async () => {
        await deployContracts();

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(contractERC1155ERC721, contractVoucherKernel, contractCashier);

        const timestamp = await Utils.getCurrTimestamp();

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      after(() => {
        remQty = 10;
        voucherToBuyBeforeBurn = 5;
      });

      it('[NEGATIVE] Should revert if called when contract is not paused', async () => {
        await truffleAssert.reverts(
          contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
            from: users.seller.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Should pause the contract', async () => {
        // Does nothing in particular ..
        // Buys 5 vouchers before pausing the contract so as to test if the
        // locked seller deposit should be returned correctly
        // Pauses contract as below tests are dependant to paused contract

        for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
          await utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID);
          remQty--;
        }

        await contractCashier.pause();
      });

      it('[NEGATIVE] should revert if not called from the seller', async () => {
        await truffleAssert.reverts(
          contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
            from: users.attacker.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });

      it(
        'Seller should be able to withdraw deposits for the ' +
          'remaining QTY in Token Supply',
        async () => {
          let withdrawTx = await contractCashier.withdrawDeposits(
            TOKEN_SUPPLY_ID,
            {
              from: users.seller.address,
            }
          );

          const expectedSellerDeposit = new BN(constants.seller_deposit).mul(
            new BN(remQty)
          );

          truffleAssert.eventEmitted(
            withdrawTx,
            'LogWithdrawal',
            (ev) => {
              assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerDeposit));

              return true;
            },
            'Event LogWithdrawal was not emitted'
          );
        }
      );

      it(
        'Escrow should have correct balance after burning the ' +
          'rest of the supply',
        async () => {
          const expectedBalance = new BN(constants.seller_deposit).mul(
            new BN(voucherToBuyBeforeBurn)
          );
          const escrowAmount = await contractCashier.getEscrowAmount(
            users.seller.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        }
      );

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

      it(
        '[NEGATIVE] Buyer should not be able to commit to buy ' +
          'anything from the burnt supply',
        async () => {
          await truffleAssert.reverts(
            utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
            truffleAssert.ErrorType.REVERT
          );
        }
      );

      it(
        '[NEGATIVE] Seller should not be able withdraw its deposit ' +
          'for the Token Supply twice',
        async () => {
          await truffleAssert.reverts(
            contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
              from: users.seller.address,
            }),
            truffleAssert.ErrorType.REVERT
          );
        }
      );
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
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const timestamp = await Utils.getCurrTimestamp();

          tokensToMintSeller = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_10)
          );
          tokensToMintBuyer = new BN(constants.product_price).mul(
            new BN(constants.QTY_10)
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
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );
        });

        after(() => {
          remQty = 10;
          voucherToBuyBeforeBurn = 5;
        });

        it('[NEGATIVE] Should revert if called when contract is not paused', async () => {
          await truffleAssert.reverts(
            contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
              from: users.seller.address,
            }),
            truffleAssert.ErrorType.REVERT
          );
        });

        it('Should pause the contract', async () => {
          // Does nothing in particular ..
          // Buys 5 vouchers before pausing the contract so as to test if
          // the locked seller deposit should be returned correctly
          // Pauses contract as below tests are dependant to paused contract

          for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
            await utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID);
            remQty--;
          }

          await contractCashier.pause();
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          await truffleAssert.reverts(
            contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
              from: users.attacker.address,
            }),
            truffleAssert.ErrorType.REVERT
          );
        });

        it(
          'Seller should be able to withdraw deposits for the ' +
            'remaining QTY in Token Supply',
          async () => {
            let withdrawTx = await contractCashier.withdrawDeposits(
              TOKEN_SUPPLY_ID,
              {
                from: users.seller.address,
              }
            );
            const expectedSellerDeposit = new BN(constants.seller_deposit).mul(
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
          }
        );

        it(
          'Escrow should have correct balance after burning the ' +
            'rest of the supply',
          async () => {
            const expectedBalance = new BN(constants.seller_deposit).mul(
              new BN(voucherToBuyBeforeBurn)
            );
            const escrowAmount = await contractBSNTokenDeposit.balanceOf(
              users.seller.address
            );

            assert.isTrue(
              escrowAmount.eq(expectedBalance),
              'Escrow amount is incorrect'
            );
          }
        );

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

        it(
          '[NEGATIVE] Buyer should not be able to commit to buy ' +
            'anything from the burnt supply',
          async () => {
            await truffleAssert.reverts(
              utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
              truffleAssert.ErrorType.REVERT
            );
          }
        );

        it(
          '[NEGATIVE] Seller should not be able withdraw its ' +
            'deposit for the Token Supply twice',
          async () => {
            await truffleAssert.reverts(
              contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
                from: users.seller.address,
              }),
              truffleAssert.ErrorType.REVERT
            );
          }
        );
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
              contractBSNTokenPrice,
              ''
            );

          const timestamp = await Utils.getCurrTimestamp();

          tokensToMintBuyer = new BN(constants.product_price).mul(
            new BN(constants.QTY_10)
          );

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );
        });

        after(() => {
          remQty = 10;
          voucherToBuyBeforeBurn = 5;
        });

        it(
          '[NEGATIVE] Should revert if called when contract is ' + 'not paused',
          async () => {
            await truffleAssert.reverts(
              contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
                from: users.seller.address,
              }),
              truffleAssert.ErrorType.REVERT
            );
          }
        );

        it('Should pause the contract', async () => {
          // Does nothing in particular ..
          // Buys 5 vouchers before pausing the contract so as to test if
          // the locked seller deposit should be returned correctly
          // Pauses contract as below tests are dependant to paused contract

          for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
            await utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID);
            remQty--;
          }

          await contractCashier.pause();
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          await truffleAssert.reverts(
            contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
              from: users.attacker.address,
            }),
            truffleAssert.ErrorType.REVERT
          );
        });

        it(
          'Seller should be able to withdraw deposits for the ' +
            'remaining QTY in Token Supply',
          async () => {
            let withdrawTx = await contractCashier.withdrawDeposits(
              TOKEN_SUPPLY_ID,
              {
                from: users.seller.address,
              }
            );
            const expectedSellerDeposit = new BN(constants.seller_deposit).mul(
              new BN(remQty)
            );

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogWithdrawal',
              (ev) => {
                assert.equal(
                  ev._payee,
                  users.seller.address,
                  'Incorrect Payee'
                );
                assert.isTrue(ev._payment.eq(expectedSellerDeposit));

                return true;
              },
              'Event LogWithdrawal was not emitted'
            );
          }
        );

        it(
          'Escrow should have correct balance after burning the ' +
            'rest of the supply',
          async () => {
            const expectedBalance = new BN(constants.seller_deposit).mul(
              new BN(voucherToBuyBeforeBurn)
            );
            const escrowAmount = await contractCashier.getEscrowAmount(
              users.seller.address
            );

            assert.isTrue(
              escrowAmount.eq(expectedBalance),
              'Escrow amount is incorrect'
            );
          }
        );

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

        it(
          '[NEGATIVE] Buyer should not be able to commit to buy ' +
            'anything from the burnt supply',
          async () => {
            await truffleAssert.reverts(
              utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
              truffleAssert.ErrorType.REVERT
            );
          }
        );

        it(
          '[NEGATIVE] Seller should not be able withdraw its ' +
            'deposit for the Token Supply twice',
          async () => {
            await truffleAssert.reverts(
              contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
                from: users.seller.address,
              }),
              truffleAssert.ErrorType.REVERT
            );
          }
        );
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
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const timestamp = await Utils.getCurrTimestamp();

          tokensToMintSeller = new BN(constants.seller_deposit).mul(
            new BN(constants.QTY_10)
          );
          tokensToMintBuyer = new BN(constants.product_price).mul(
            new BN(constants.QTY_10)
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
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );
        });

        after(() => {
          remQty = 10;
          voucherToBuyBeforeBurn = 5;
        });

        it(
          '[NEGATIVE] Should revert if called when contract ' + 'is not paused',
          async () => {
            await truffleAssert.reverts(
              contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
                from: users.seller.address,
              }),
              truffleAssert.ErrorType.REVERT
            );
          }
        );

        it('Should pause the contract', async () => {
          // Does nothing in particular ..
          // Buys 5 vouchers before pausing the contract so as to test if
          // the locked seller deposit should be returned correctly
          // Pauses contract as below tests are dependant to paused contract

          for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
            await utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID);
            remQty--;
          }

          await contractCashier.pause();
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          await truffleAssert.reverts(
            contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
              from: users.attacker.address,
            }),
            truffleAssert.ErrorType.REVERT
          );
        });

        it(
          'Seller should be able to withdraw deposits for the ' +
            'remaining QTY in Token Supply',
          async () => {
            let withdrawTx = await contractCashier.withdrawDeposits(
              TOKEN_SUPPLY_ID,
              {
                from: users.seller.address,
              }
            );
            const expectedSellerDeposit = new BN(constants.seller_deposit).mul(
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
          }
        );

        it(
          'Escrow should have correct balance after burning the ' +
            'rest of the supply',
          async () => {
            const expectedBalance = new BN(constants.seller_deposit).mul(
              new BN(voucherToBuyBeforeBurn)
            );
            const escrowAmount = await contractBSNTokenDeposit.balanceOf(
              users.seller.address
            );

            assert.isTrue(
              escrowAmount.eq(expectedBalance),
              'Escrow amount is incorrect'
            );
          }
        );

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

        it(
          '[NEGATIVE] Buyer should not be able to commit to buy ' +
            'anything from the burnt supply',
          async () => {
            await truffleAssert.reverts(
              utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
              truffleAssert.ErrorType.REVERT
            );
          }
        );

        it(
          '[NEGATIVE] Seller should not be able withdraw its deposit ' +
            'for the Token Supply twice',
          async () => {
            await truffleAssert.reverts(
              contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {
                from: users.seller.address,
              }),
              truffleAssert.ErrorType.REVERT
            );
          }
        );
      });
    });
  });
});
