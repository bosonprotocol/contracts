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

  const zeroDistributedAmounts = {
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

  describe('Withdraw scenarios', () => {
    const paymentType = {
      PAYMENT: 0,
      DEPOSIT_SELLER: 1,
      DEPOSIT_BUYER: 2,
    };

    function validateEmittedLogAmountDistribution(ev, expected) {
      expect(ev._type).to.be.oneOf(Object.values(paymentType));
      switch (ev._type) {
        case paymentType.PAYMENT:
          assert.equal(
            ev._tokenIdVoucher.toString(),
            expected.voucherID.toString(),
            'Wrong token id voucher'
          );
          assert.equal(
            ev._to,
            expected.payment.receiver.address,
            'Wrong payment recipient'
          );
          assert.equal(
            ev._payment,
            expected.payment.amount.toString(),
            'Wrong payment amount'
          );
          break;
        case paymentType.DEPOSIT_SELLER:
          expect(ev._to).to.be.oneOf(
            expected.sellerDeposit.receivers.map((user) => user.address),
            'Unexpected recipient'
          );

          switch (ev._to) {
            case expected.sellerDeposit.receivers[0].address:
              assert.equal(
                ev._tokenIdVoucher.toString(),
                expected.voucherID.toString(),
                'Wrong token id voucher'
              );
              assert.equal(
                ev._payment,
                expected.sellerDeposit.amounts[0].toString(),
                'Wrong seller deposit amount'
              );
              break;
            case expected.sellerDeposit.receivers[1].address:
              assert.equal(
                ev._tokenIdVoucher.toString(),
                expected.voucherID.toString(),
                'Wrong token id voucher'
              );
              assert.equal(
                ev._payment,
                expected.sellerDeposit.amounts[1].toString(),
                'Wrong seller deposit amount'
              );
              break;
            case expected.sellerDeposit.receivers[2].address:
              assert.equal(
                ev._tokenIdVoucher.toString(),
                expected.voucherID.toString(),
                'Wrong token id voucher'
              );
              assert.equal(
                ev._payment,
                expected.sellerDeposit.amounts[2].toString(),
                'Wrong seller deposit amount'
              );
              break;
          }
          break;
        case paymentType.DEPOSIT_BUYER:
          assert.equal(
            ev._tokenIdVoucher.toString(),
            expected.voucherID.toString(),
            'Wrong token id voucher'
          );
          assert.equal(
            ev._to,
            expected.buyerDeposit.receiver.address,
            'Wrong buyer deposit recipient'
          );
          assert.equal(
            ev._payment,
            expected.buyerDeposit.amount.toString(),
            'Wrong buyer deposit amount'
          );
          break;
      }
    }

    function validateEmittedLogWithdrawal(ev, expected) {
      assert.equal(ev._caller, expected.caller.address, 'Wrong caller');
      expect(ev._payee).to.be.oneOf(
        expected.payees.map((user) => user.address),
        'Incorrect Payee'
      );
      switch (ev._payee) {
        case expected.payees[0].address:
          expect(ev._payment.toString()).to.be.oneOf(
            expected.amounts[0].map((a) => a.toString())
          );
          break;
        case expected.payees[1].address:
          expect(ev._payment.toString()).to.be.oneOf(
            expected.amounts[1].map((a) => a.toString())
          );
          break;
        case expected.payees[2].address:
          expect(ev._payment.toString()).to.be.oneOf(
            expected.amounts[2].map((a) => a.toString())
          );
          break;
      }
    }

    beforeEach(async () => {
      await deployContracts();
      await setPeriods();
    });

    describe(`ETHETH`, () => {
      let voucherID;

      async function checkEscrowAmounts(stage) {
        switch (stage) {
          case 'before':
            expect(
              await contractCashier.getEscrowAmount(users.buyer.address)
            ).to.be.equal(
              BN(constants.buyer_deposit).add(constants.product_price),
              'Buyers escrow should not be zero'
            );

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15)),
              'Seller escrow mismatch'
            );
            break;
          case 'after':
            expect(
              await contractCashier.getEscrowAmount(users.buyer.address)
            ).to.be.equal(constants.ZERO, 'Buyers escrow should be zero');

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15 - 1)),
              'Seller escrow mismatch'
            );
            break;
        }
      }

      beforeEach(async () => {
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

        voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
      });

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit)
          .add(BN(constants.product_price))
          .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        await checkEscrowAmounts('before');

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const distributedAmounts = {...zeroDistributedAmounts};
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              payment: {
                receiver: users.buyer,
                amount: constants.product_price,
              },
              sellerDeposit: {
                receivers: [users.buyer, users.seller, users.deployer],
                amounts: [
                  BN(constants.seller_deposit).div(2),
                  expectedSellerAmount,
                  expectedEscrowAmount,
                ],
              },
              buyerDeposit: {
                receiver: users.buyer,
                amount: constants.buyer_deposit,
              },
            });

            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            validateEmittedLogWithdrawal(ev, {
              caller: users.deployer,
              payees: [users.deployer, users.seller, users.buyer],
              amounts: [
                [expectedEscrowAmount],
                [expectedSellerAmount],
                [
                  constants.product_price,
                  expectedBuyerAmount.sub(BN(constants.product_price)),
                ],
              ],
            });
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

        await checkEscrowAmounts('after');
      });

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit)
          .add(BN(constants.product_price))
          .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmount = BN(0); // 0

        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        await checkEscrowAmounts('before');

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        const distributedAmounts = {...zeroDistributedAmounts};
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              payment: {
                receiver: users.buyer,
                amount: constants.product_price,
              },
              sellerDeposit: {
                receivers: [users.seller, users.buyer],
                amounts: [
                  expectedSellerAmount,
                  BN(constants.seller_deposit).div(BN(2)),
                ],
              },
              buyerDeposit: {
                receiver: users.buyer,
                amount: constants.buyer_deposit,
              },
            });

            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.seller.address
            );
          }
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            validateEmittedLogWithdrawal(ev, {
              caller: users.deployer,
              payees: [users.buyer, users.seller],
              amounts: [
                [
                  constants.product_price,
                  expectedBuyerAmount.sub(constants.product_price),
                ],
                [expectedSellerAmount],
              ],
            });
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

        await checkEscrowAmounts('after');
      });

      describe('Redeem', () => {
        beforeEach(async () => {
          await utils.redeem(voucherID, users.buyer.signer);
        });

        it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit); // 0.04
          const expectedSellerAmount = BN(constants.seller_deposit).add(
            BN(constants.product_price)
          ); // 0.35
          const expectedEscrowAmount = BN(0); // 0

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller],
                amounts: [
                  [expectedBuyerAmount],
                  [
                    constants.product_price,
                    expectedSellerAmount.sub(constants.product_price),
                  ],
                ],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit); // 0.04
          const expectedSellerAmount = BN(constants.product_price); // 0.3
          const expectedEscrowAmount = BN(constants.seller_deposit); // 0.05

          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller, users.deployer],
                amounts: [
                  [expectedBuyerAmount],
                  [expectedSellerAmount],
                  [expectedEscrowAmount],
                ],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerAmount = BN(constants.product_price).add(
            BN(constants.seller_deposit).div(BN(4))
          ); // 0.3125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    BN(constants.seller_deposit).div(BN(4)),
                    expectedEscrowAmount,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller, users.deployer],
                amounts: [
                  [expectedBuyerAmount],
                  [
                    constants.product_price,
                    expectedSellerAmount.sub(constants.product_price),
                  ],
                  [expectedEscrowAmount],
                ],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerAmount = BN(constants.product_price).add(
            BN(constants.seller_deposit).div(BN(4))
          ); // 0.3125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    BN(constants.seller_deposit).div(BN(4)),
                    expectedEscrowAmount,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller, users.deployer],
                amounts: [
                  [expectedBuyerAmount],
                  [
                    constants.product_price,
                    expectedSellerAmount.sub(constants.product_price),
                  ],
                  [expectedEscrowAmount],
                ],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerAmount = BN(constants.product_price).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.325
          const expectedEscrowAmount = BN(0); // 0

          // await utils.redeem(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    BN(constants.seller_deposit).div(BN(2)),
                    BN(constants.seller_deposit).div(BN(2)),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller],
                amounts: [
                  [expectedBuyerAmount],
                  [
                    constants.product_price,
                    expectedSellerAmount.sub(constants.product_price),
                  ],
                ],
              });
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

          await checkEscrowAmounts('after');
        });
      });

      describe('Refund', () => {
        beforeEach(async () => {
          await utils.refund(voucherID, users.buyer.signer);
        });

        it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.product_price); // 0.3
          const expectedSellerAmount = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmount = BN(constants.buyer_deposit); // 0.04

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller, users.deployer],
                amounts: [
                  [expectedBuyerAmount],
                  [expectedSellerAmount],
                  [expectedEscrowAmount],
                ],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.product_price); // 0.3
          const expectedSellerAmount = BN(0); // 0
          const expectedEscrowAmount = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09

          await utils.complain(voucherID, users.buyer.signer);
          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer, users.buyer],
                amounts: [[expectedEscrowAmount], [constants.product_price]],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerAmount,
                    expectedEscrowAmount,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer, users.seller, users.buyer],
                amounts: [
                  [expectedEscrowAmount],
                  [expectedSellerAmount],
                  [
                    constants.product_price,
                    expectedBuyerAmount.sub(BN(constants.product_price)),
                  ],
                ],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerAmount,
                    expectedEscrowAmount,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer, users.seller, users.buyer],
                amounts: [
                  [expectedEscrowAmount],
                  [expectedSellerAmount],
                  [
                    constants.product_price,
                    expectedBuyerAmount.sub(BN(constants.product_price)),
                  ],
                ],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmount = BN(0); //0

          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    expectedSellerAmount,
                    BN(constants.seller_deposit).div(2),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller],
                amounts: [
                  [
                    constants.product_price,
                    expectedBuyerAmount.sub(constants.product_price),
                  ],
                  [expectedSellerAmount],
                ],
              });
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

          await checkEscrowAmounts('after');
        });
      });

      describe('Expire', () => {
        beforeEach(async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await contractVoucherKernel.triggerExpiration(voucherID);
        });

        it('COMMIT->EXPIRE->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.product_price); // 0.3
          const expectedSellerAmount = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmount = BN(constants.buyer_deposit); // 0.04

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller, users.deployer],
                amounts: [
                  [expectedBuyerAmount],
                  [expectedSellerAmount],
                  [expectedEscrowAmount],
                ],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.product_price); // 0.3
          const expectedSellerAmount = BN(0); // 0
          const expectedEscrowAmount = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09

          await utils.complain(voucherID, users.buyer.signer);
          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer, users.buyer],
                amounts: [[expectedEscrowAmount], [constants.product_price]],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerAmount,
                    expectedEscrowAmount,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer, users.seller, users.buyer],
                amounts: [
                  [expectedEscrowAmount],
                  [expectedSellerAmount],
                  [
                    constants.product_price,
                    expectedBuyerAmount.sub(BN(constants.product_price)),
                  ],
                ],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerAmount,
                    expectedEscrowAmount,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer, users.seller, users.buyer],
                amounts: [
                  [expectedEscrowAmount],
                  [expectedSellerAmount],
                  [
                    constants.product_price,
                    expectedBuyerAmount.sub(BN(constants.product_price)),
                  ],
                ],
              });
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

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->CANCEL->FINALIZE->WITHDRAW', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmount = BN(0); //0

          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    expectedSellerAmount,
                    BN(constants.seller_deposit).div(2),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.seller.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller],
                amounts: [
                  [
                    constants.product_price,
                    expectedBuyerAmount.sub(constants.product_price),
                  ],
                  [expectedSellerAmount],
                ],
              });
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

          await checkEscrowAmounts('after');
        });
      });
    });

    describe(`TKNTKN [WITH PERMIT]`, () => {
      let voucherID;

      async function validateBalancesFromPriceTokenAndDepositToken(expected) {
        //Payments
        expect(
          await utils.contractBSNTokenPrice.balanceOf(users.buyer.address)
        ).to.equal(
          expected.expectedBuyerPrice,
          'Buyer did not get expected tokens from PriceTokenContract'
        );

        expect(
          await utils.contractBSNTokenPrice.balanceOf(users.seller.address)
        ).to.equal(
          expected.expectedSellerPrice,
          'Seller did not get expected tokens from PriceTokenContract'
        );

        expect(
          await utils.contractBSNTokenPrice.balanceOf(users.deployer.address)
        ).to.equal(
          expected.expectedEscrowAmountPrice,
          'Escrow did not get expected tokens from PriceTokenContract'
        );

        //Deposits
        expect(
          await utils.contractBSNTokenDeposit.balanceOf(users.buyer.address)
        ).to.equal(
          expected.expectedBuyerDeposit,
          'Buyer did not get expected tokens from DepositTokenContract'
        );

        expect(
          await utils.contractBSNTokenDeposit.balanceOf(users.seller.address)
        ).to.equal(
          expected.expectedSellerDeposit,
          'Seller did not get expected tokens from DepositTokenContract'
        );

        expect(
          await utils.contractBSNTokenDeposit.balanceOf(users.deployer.address)
        ).to.equal(
          expected.expectedEscrowAmountDeposit,
          'Buyer did not get expected tokens from DepositTokenContract'
        );

        //Cashier Should be Empty
        expect(
          await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          )
        ).to.equal(BN(0), 'Cashier Contract is not empty');

        expect(
          await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          )
        ).to.equal(
          BN(constants.seller_deposit).mul(BN(constants.QTY_15 - 1)),
          'Cashier Contract has wrong balance'
        );
      }

      async function checkEscrowAmounts(stage) {
        switch (stage) {
          case 'before':
            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.buyer.address
              )
            ).to.be.equal(
              constants.buyer_deposit,
              'Buyers escrow should not be zero'
            );

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenPrice.address,
                users.buyer.address
              )
            ).to.be.equal(
              constants.product_price,
              'Buyers escrow should not be zero'
            );

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.seller.address
              )
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15)),
              'Seller escrow mismatch'
            );
            break;
          case 'after':
            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.buyer.address
              )
            ).to.be.equal(constants.ZERO, 'Buyers escrow should be zero');

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenPrice.address,
                users.buyer.address
              )
            ).to.be.equal(constants.ZERO, 'Buyers escrow should be zero');

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.seller.address
              )
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15 - 1)),
              'Seller escrow mismatch'
            );
            break;
        }
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

        const supplyQty = constants.QTY_15;
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

        voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
      });

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        await checkEscrowAmounts('before');

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

        await validateBalancesFromPriceTokenAndDepositToken({
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowAmountPrice,
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit,
        });

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              payment: {
                receiver: users.buyer,
                amount: constants.product_price,
              },
              sellerDeposit: {
                receivers: [users.buyer, users.seller, users.deployer],
                amounts: [
                  BN(constants.seller_deposit).div(2),
                  expectedSellerDeposit,
                  expectedEscrowAmountDeposit,
                ],
              },
              buyerDeposit: {
                receiver: users.buyer,
                amount: constants.buyer_deposit,
              },
            });
          }
        );

        await checkEscrowAmounts('after');
      });

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        await checkEscrowAmounts('before');

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

        await validateBalancesFromPriceTokenAndDepositToken({
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowAmountPrice,
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit,
        });

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              payment: {
                receiver: users.buyer,
                amount: constants.product_price,
              },
              sellerDeposit: {
                receivers: [users.seller, users.buyer],
                amounts: [
                  expectedSellerDeposit,
                  BN(constants.seller_deposit).div(BN(2)),
                ],
              },
              buyerDeposit: {
                receiver: users.buyer,
                amount: constants.buyer_deposit,
              },
            });
          }
        );

        await checkEscrowAmounts('after');
      });

      describe('Redeem', () => {
        beforeEach(async () => {
          await utils.redeem(voucherID, users.buyer.signer);
        });

        it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    BN(constants.seller_deposit).div(BN(4)),
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    BN(constants.seller_deposit).div(BN(4)),
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    BN(constants.seller_deposit).div(BN(2)),
                    BN(constants.seller_deposit).div(BN(2)),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
      });

      describe('Refund', () => {
        beforeEach(async () => {
          await utils.refund(voucherID, users.buyer.signer);
        });

        it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    expectedSellerDeposit,
                    BN(constants.seller_deposit).div(2),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
      });

      describe('Expire', () => {
        beforeEach(async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await contractVoucherKernel.triggerExpiration(voucherID);
        });

        it('COMMIT->EXPIRE->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromPriceTokenAndDepositToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    expectedSellerDeposit,
                    BN(constants.seller_deposit).div(2),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
      });
    });

    describe(`TKNTKN SAME [WITH PERMIT]`, () => {
      let voucherID;

      async function validateBalancesFromSameTokenContract(expected) {
        expect(
          await utils.contractBSNTokenSame.balanceOf(users.buyer.address)
        ).to.equal(
          expected.expectedBuyerPrice.add(expected.expectedBuyerDeposit),
          'Buyer did not get expected tokens from SameTokenContract'
        );

        expect(
          await utils.contractBSNTokenSame.balanceOf(users.seller.address)
        ).to.equal(
          expected.expectedSellerPrice.add(expected.expectedSellerDeposit),
          'Seller did not get expected tokens from SameTokenContract'
        );

        expect(
          await utils.contractBSNTokenSame.balanceOf(users.deployer.address)
        ).to.equal(
          expected.expectedEscrowAmountDeposit,
          'Escrow did not get expected tokens from SameTokenContract'
        );

        expect(
          await utils.contractBSNTokenSame.balanceOf(
            utils.contractCashier.address
          )
        ).to.equal(
          BN(constants.seller_deposit).mul(BN(constants.QTY_15 - 1)),
          'Cashier Contract balance is wrong'
        ); // should be what seller has in it
      }

      async function checkEscrowAmounts(stage) {
        switch (stage) {
          case 'before':
            expect(
              await contractCashier.getEscrowTokensAmount(
                utils.contractBSNTokenSame.address,
                users.buyer.address
              )
            ).to.be.equal(
              BN(constants.buyer_deposit).add(constants.product_price),
              'Buyers escrow should not be zero'
            );

            expect(
              await contractCashier.getEscrowTokensAmount(
                utils.contractBSNTokenSame.address,
                users.seller.address
              )
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15)),
              'Seller escrow mismatch'
            );
            break;
          case 'after':
            expect(
              await contractCashier.getEscrowTokensAmount(
                utils.contractBSNTokenSame.address,
                users.buyer.address
              )
            ).to.be.equal(constants.ZERO, 'Buyers escrow should be zero');

            expect(
              await contractCashier.getEscrowTokensAmount(
                utils.contractBSNTokenSame.address,
                users.seller.address
              )
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15 - 1)),
              'Seller escrow mismatch'
            );
            break;
        }
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

        const supplyQty = constants.QTY_15;
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

        voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
      });

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        await checkEscrowAmounts('before');

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

        await validateBalancesFromSameTokenContract({
          expectedBuyerPrice,
          expectedBuyerDeposit,
          expectedSellerPrice,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit,
        });

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              payment: {
                receiver: users.buyer,
                amount: constants.product_price,
              },
              sellerDeposit: {
                receivers: [users.buyer, users.seller, users.deployer],
                amounts: [
                  BN(constants.seller_deposit).div(2),
                  expectedSellerDeposit,
                  expectedEscrowAmountDeposit,
                ],
              },
              buyerDeposit: {
                receiver: users.buyer,
                amount: constants.buyer_deposit,
              },
            });
          }
        );

        await checkEscrowAmounts('after');
      });

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        await checkEscrowAmounts('before');

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

        await validateBalancesFromSameTokenContract({
          expectedBuyerPrice,
          expectedBuyerDeposit,
          expectedSellerPrice,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit,
        });

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              payment: {
                receiver: users.buyer,
                amount: constants.product_price,
              },
              sellerDeposit: {
                receivers: [users.seller, users.buyer],
                amounts: [
                  expectedSellerDeposit,
                  BN(constants.seller_deposit).div(BN(2)),
                ],
              },
              buyerDeposit: {
                receiver: users.buyer,
                amount: constants.buyer_deposit,
              },
            });
          }
        );

        await checkEscrowAmounts('after');
      });

      describe('Redeem', () => {
        beforeEach(async () => {
          await utils.redeem(voucherID, users.buyer.signer);
        });

        it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const expectedBuyerPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit); // 0.05

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    BN(constants.seller_deposit).div(BN(4)),
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    BN(constants.seller_deposit).div(BN(4)),
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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
          const expectedEscrowAmountDeposit = BN(0);

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    BN(constants.seller_deposit).div(BN(2)),
                    BN(constants.seller_deposit).div(BN(2)),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
      });

      describe('Refund', () => {
        beforeEach(async () => {
          await utils.refund(voucherID, users.buyer.signer);
        });

        it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    expectedSellerDeposit,
                    BN(constants.seller_deposit).div(2),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
      });

      describe('Expire', () => {
        beforeEach(async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await contractVoucherKernel.triggerExpiration(voucherID);
        });

        it('COMMIT->EXPIRE->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesFromSameTokenContract({
            expectedBuyerPrice,
            expectedBuyerDeposit,
            expectedSellerPrice,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    expectedSellerDeposit,
                    BN(constants.seller_deposit).div(2),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
      });
    });

    describe(`ETHTKN [WITH PERMIT]`, () => {
      let voucherID;

      async function validateBalancesDepositToken(expected) {
        expect(
          await utils.contractBSNTokenDeposit.balanceOf(users.buyer.address)
        ).to.equal(
          expected.expectedBuyerDeposit,
          'Buyer did not get expected tokens from DepositTokenContract'
        );

        expect(
          await utils.contractBSNTokenDeposit.balanceOf(users.seller.address)
        ).to.equal(
          expected.expectedSellerDeposit,
          'Seller did not get expected tokens from DepositTokenContract'
        );

        expect(
          await utils.contractBSNTokenDeposit.balanceOf(users.deployer.address)
        ).to.equal(
          expected.expectedEscrowAmountDeposit,
          'Escrow did not get expected tokens from DepositTokenContract'
        );

        expect(
          await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          )
        ).to.equal(
          BN(constants.seller_deposit).mul(BN(constants.QTY_15 - 1)),
          'Cashier Contract is not correct'
        );
      }

      async function checkEscrowAmounts(stage) {
        switch (stage) {
          case 'before':
            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.buyer.address
              )
            ).to.be.equal(
              constants.buyer_deposit,
              'Buyers escrow should be zero'
            );

            expect(
              await contractCashier.getEscrowAmount(users.buyer.address)
            ).to.be.equal(
              constants.product_price,
              'Buyers price escrow should be product price'
            );

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.seller.address
              )
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15)),
              'Seller escrow mismatch'
            );

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.be.equal(
              constants.ZERO,
              'Sellers price escrow should be zero'
            );
            break;
          case 'after':
            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.buyer.address
              )
            ).to.be.equal(constants.ZERO, 'Buyers escrow should be zero');

            expect(
              await contractCashier.getEscrowAmount(users.buyer.address)
            ).to.be.equal(constants.ZERO, 'Buyers escrow should be zero');

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.seller.address
              )
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15 - 1)),
              'Seller escrow mismatch'
            );

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.be.equal(constants.ZERO, 'Sellers escrow should be zero');
            break;
        }
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

        const supplyQty = constants.QTY_15;
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

        voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
      });

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        await checkEscrowAmounts('before');

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

        await validateBalancesDepositToken({
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit,
        });

        const txReceipt = await withdrawTx.wait();

        // Payment should have been returned to buyer
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(
              ev._caller,
              users.deployer.address,
              'Incorrect Caller'
            );
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));
          }
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              payment: {
                receiver: users.buyer,
                amount: constants.product_price,
              },
              sellerDeposit: {
                receivers: [users.buyer, users.seller, users.deployer],
                amounts: [
                  BN(constants.seller_deposit).div(2),
                  expectedSellerDeposit,
                  expectedEscrowAmountDeposit,
                ],
              },
              buyerDeposit: {
                receiver: users.buyer,
                amount: constants.buyer_deposit,
              },
            });
          }
        );

        await checkEscrowAmounts('after');
      });

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        await checkEscrowAmounts('before');

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

        await validateBalancesDepositToken({
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit,
        });

        // Payment should have been returned to buyer
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            assert.equal(
              ev._caller,
              users.deployer.address,
              'Incorrect Caller'
            );
            assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
            assert.isTrue(ev._payment.eq(expectedBuyerPrice));
          }
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              payment: {
                receiver: users.buyer,
                amount: constants.product_price,
              },
              sellerDeposit: {
                receivers: [users.seller, users.buyer],
                amounts: [
                  expectedSellerDeposit,
                  BN(constants.seller_deposit).div(BN(2)),
                ],
              },
              buyerDeposit: {
                receiver: users.buyer,
                amount: constants.buyer_deposit,
              },
            });
          }
        );

        await checkEscrowAmounts('after');
      });

      describe('Redeem', () => {
        beforeEach(async () => {
          await utils.redeem(voucherID, users.buyer.signer);
        });

        it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(0);

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been sent to seller
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit); // 0.05

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been sent to seller
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been sent to seller
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    BN(constants.seller_deposit).div(BN(4)),
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );
        });

        it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been sent to seller
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    BN(constants.seller_deposit).div(BN(4)),
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been sent to seller
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    BN(constants.seller_deposit).div(BN(2)),
                    BN(constants.seller_deposit).div(BN(2)),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );
          await checkEscrowAmounts('after');
        });
      });

      describe('Refund', () => {
        beforeEach(async () => {
          await utils.refund(voucherID, users.buyer.signer);
        });

        it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been returned to buyer
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been returned to buyer
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been returned to buyer
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been returned to buyer
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been returned to buyer
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    expectedSellerDeposit,
                    BN(constants.seller_deposit).div(2),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
      });

      describe('Expire', () => {
        beforeEach(async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await contractVoucherKernel.triggerExpiration(voucherID);
        });

        it('COMMIT->EXPIRE->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been returned to buyer
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been returned to buyer
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been returned to buyer
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been returned to buyer
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesDepositToken({
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit,
          });

          // Payment should have been returned to buyer
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(
                ev._caller,
                users.deployer.address,
                'Incorrect Caller'
              );
              assert.equal(ev._payee, users.buyer.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    expectedSellerDeposit,
                    BN(constants.seller_deposit).div(2),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
      });
    });

    describe(`TKNETH [WITH PERMIT]`, () => {
      let voucherID;

      async function validateBalancesPriceToken(expected) {
        expect(
          await utils.contractBSNTokenPrice.balanceOf(users.buyer.address)
        ).to.equal(
          expected.expectedBuyerPrice,
          'Buyer did not get expected tokens from PaymentTokenContract'
        );

        expect(
          await utils.contractBSNTokenPrice.balanceOf(users.seller.address)
        ).to.equal(
          expected.expectedSellerPrice,
          'Seller did not get expected tokens from PaymentTokenContract'
        );

        expect(
          await utils.contractBSNTokenPrice.balanceOf(users.deployer.address)
        ).to.equal(
          expected.expectedEscrowPrice,
          'Escrow did not get expected tokens from PaymentTokenContract'
        );

        expect(
          await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          )
        ).to.equal(BN(0), 'Cashier Contract is not empty');
      }

      async function checkEscrowAmounts(stage) {
        switch (stage) {
          case 'before':
            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenPrice.address,
                users.buyer.address
              )
            ).to.be.equal(
              constants.product_price,
              'Buyers token escrow should be product_price'
            );

            expect(
              await contractCashier.getEscrowAmount(users.buyer.address)
            ).to.be.equal(
              constants.buyer_deposit,
              'Buyers ETH escrow should be buyer_deposit'
            );

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenPrice.address,
                users.seller.address
              )
            ).to.be.equal(constants.ZERO, 'Seller tokens escrow should be');

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15)),
              'Sellers ETH escrow mismatch'
            );
            break;
          case 'after':
            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenPrice.address,
                users.buyer.address
              )
            ).to.be.equal(
              constants.ZERO,
              'Buyers tokens escrow should be zero'
            );

            expect(
              await contractCashier.getEscrowAmount(users.buyer.address)
            ).to.be.equal(constants.ZERO, 'Buyers ETH escrow should be zero');

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenPrice.address,
                users.seller.address
              )
            ).to.be.equal(constants.ZERO, 'Seller tokens escrow should be');

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15 - 1)),
              'Sellers ETH escrow mismatch'
            );
            break;
        }
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
          constants.QTY_15
        );

        voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );
      });

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
        await utils.cancel(voucherID, users.seller.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        await checkEscrowAmounts('before');

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

        await validateBalancesPriceToken({
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowPrice,
        });

        //Deposits in ETH
        const distributedAmounts = {...zeroDistributedAmounts};
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            validateEmittedLogWithdrawal(ev, {
              caller: users.deployer,
              payees: [users.deployer, users.seller, users.buyer],
              amounts: [
                [expectedEscrowAmountDeposit],
                [expectedSellerDeposit],
                [expectedBuyerDeposit],
              ],
            });

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

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              payment: {
                receiver: users.buyer,
                amount: constants.product_price,
              },
              sellerDeposit: {
                receivers: [users.buyer, users.seller, users.deployer],
                amounts: [
                  BN(constants.seller_deposit).div(2),
                  expectedSellerDeposit,
                  expectedEscrowAmountDeposit,
                ],
              },
              buyerDeposit: {
                receiver: users.buyer,
                amount: constants.buyer_deposit,
              },
            });
          }
        );

        await checkEscrowAmounts('after');
      });

      it('COMMIT->CANCEL->FINALIZE->WITHDRAW', async () => {
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        await checkEscrowAmounts('before');

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

        await validateBalancesPriceToken({
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowPrice,
        });

        //Deposits in ETH
        const distributedAmounts = {...zeroDistributedAmounts};
        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            validateEmittedLogWithdrawal(ev, {
              caller: users.deployer,
              payees: [users.buyer, users.seller],
              amounts: [[expectedBuyerDeposit], [expectedSellerDeposit]],
            });

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

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              payment: {
                receiver: users.buyer,
                amount: constants.product_price,
              },
              sellerDeposit: {
                receivers: [users.seller, users.buyer],
                amounts: [
                  expectedSellerDeposit,
                  BN(constants.seller_deposit).div(BN(2)),
                ],
              },
              buyerDeposit: {
                receiver: users.buyer,
                amount: constants.buyer_deposit,
              },
            });
          }
        );

        await checkEscrowAmounts('after');
      });

      describe('Redeem', () => {
        beforeEach(async () => {
          await utils.redeem(voucherID, users.buyer.signer);
        });

        it('COMMIT->REDEEM->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller],
                amounts: [[expectedBuyerDeposit], [expectedSellerDeposit]],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.deployer],
                amounts: [
                  [expectedBuyerDeposit],
                  [expectedEscrowAmountDeposit],
                ],
              });
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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller, users.deployer],
                amounts: [
                  [expectedBuyerDeposit],
                  [expectedSellerDeposit],
                  [expectedEscrowAmountDeposit],
                ],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    BN(constants.seller_deposit).div(BN(4)),
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller, users.deployer],
                amounts: [
                  [expectedBuyerDeposit],
                  [expectedSellerDeposit],
                  [expectedEscrowAmountDeposit],
                ],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    BN(constants.seller_deposit).div(BN(4)),
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller],
                amounts: [[expectedBuyerDeposit], [expectedSellerDeposit]],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.seller,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    BN(constants.seller_deposit).div(BN(2)),
                    BN(constants.seller_deposit).div(BN(2)),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
      });

      describe('Refund', () => {
        beforeEach(async () => {
          await utils.refund(voucherID, users.buyer.signer);
        });

        it('COMMIT->REFUND->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.seller, users.deployer],
                amounts: [
                  [expectedSellerDeposit],
                  [expectedEscrowAmountDeposit],
                ],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer],
                amounts: [[expectedEscrowAmountDeposit]],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer, users.seller, users.buyer],
                amounts: [
                  [expectedEscrowAmountDeposit],
                  [expectedSellerDeposit],
                  [expectedBuyerDeposit],
                ],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer, users.seller, users.buyer],
                amounts: [
                  [expectedEscrowAmountDeposit],
                  [expectedSellerDeposit],
                  [expectedBuyerDeposit],
                ],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller],
                amounts: [[expectedBuyerDeposit], [expectedSellerDeposit]],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    expectedSellerDeposit,
                    BN(constants.seller_deposit).div(2),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
      });

      describe('Expire', () => {
        beforeEach(async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await contractVoucherKernel.triggerExpiration(voucherID);
        });

        it('COMMIT->EXPIRE->FINALIZE->WITHDRAW', async () => {
          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.seller, users.deployer],
                amounts: [
                  [expectedSellerDeposit],
                  [expectedEscrowAmountDeposit],
                ],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer],
                amounts: [[expectedEscrowAmountDeposit]],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.deployer],
                  amounts: [constants.seller_deposit],
                },
                buyerDeposit: {
                  receiver: users.deployer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.complain(voucherID, users.buyer.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer, users.seller, users.buyer],
                amounts: [
                  [expectedEscrowAmountDeposit],
                  [expectedSellerDeposit],
                  [expectedBuyerDeposit],
                ],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);
          await utils.complain(voucherID, users.buyer.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.deployer, users.seller, users.buyer],
                amounts: [
                  [expectedEscrowAmountDeposit],
                  [expectedSellerDeposit],
                  [expectedBuyerDeposit],
                ],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.buyer, users.seller, users.deployer],
                  amounts: [
                    BN(constants.seller_deposit).div(2),
                    expectedSellerDeposit,
                    expectedEscrowAmountDeposit,
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });

        it('COMMIT->EXPIRE->CANCEL->FINALIZE->WITHDRAW', async () => {
          await utils.cancel(voucherID, users.seller.signer);

          await advanceTimeSeconds(60);

          await utils.finalize(voucherID, users.deployer.signer);

          await checkEscrowAmounts('before');

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

          await validateBalancesPriceToken({
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice,
          });

          //Deposits in ETH
          const distributedAmounts = {...zeroDistributedAmounts};
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                payees: [users.buyer, users.seller],
                amounts: [[expectedBuyerDeposit], [expectedSellerDeposit]],
              });

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

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              validateEmittedLogAmountDistribution(ev, {
                voucherID,
                payment: {
                  receiver: users.buyer,
                  amount: constants.product_price,
                },
                sellerDeposit: {
                  receivers: [users.seller, users.buyer],
                  amounts: [
                    expectedSellerDeposit,
                    BN(constants.seller_deposit).div(2),
                  ],
                },
                buyerDeposit: {
                  receiver: users.buyer,
                  amount: constants.buyer_deposit,
                },
              });
            }
          );

          await checkEscrowAmounts('after');
        });
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
      beforeEach(async () => {
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

      describe('setDisasterState', () => {
        it('[setDisasterState] Disaster state should be set when paused', async () => {
          await contractBosonRouter.pause();
          const expectedTriggerBy = users.deployer.address;

          const tx = await contractCashier.setDisasterState();
          const txReceipt = await tx.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_DISASTER_STATE_SET,
            (ev) => {
              assert.equal(ev._triggeredBy, expectedTriggerBy);
            }
          );

          assert.isTrue(await contractCashier.isDisasterStateSet());
        });

        it("[setDisasterState] BosonRouter's cashier address should be able to set the disaster state", async () => {
          const expectedCashierAddress = await contractBosonRouter.getCashierAddress();
          const cashier = await contractCashier.attach(expectedCashierAddress);
          await contractBosonRouter.pause();

          assert.equal(cashier.address, contractCashier.address);

          const tx = await cashier.setDisasterState();
          const txReceipt = await tx.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_DISASTER_STATE_SET,
            (ev) => {
              assert.isTrue(ev._triggeredBy == users.deployer.address);
              assert.isTrue(ev._disasterState);
            }
          );

          assert.isTrue(await cashier.isDisasterStateSet());
        });

        it('[NEGATIVE][setDisasterState] Disaster state should not be set when contract is not paused', async () => {
          await expect(contractCashier.setDisasterState()).to.be.revertedWith(
            revertReasons.NOT_PAUSED
          );
        });

        it('[NEGATIVE][setDisasterState] Disaster state should not be set from attacker', async () => {
          const attackerInstance = contractCashier.connect(
            users.attacker.signer
          );

          await contractBosonRouter.pause();

          await expect(attackerInstance.setDisasterState()).to.be.revertedWith(
            revertReasons.UNAUTHORIZED_OWNER
          );
        });
      });

      describe('isDisasterStateSet', () => {
        it('[isDisasterStateSet] Disaster State should be false initially', async () => {
          const disasterState = await contractCashier.isDisasterStateSet();

          assert.isFalse(disasterState);
        });

        it('[isDisasterStateSet] Disaster State should be true once it is set', async () => {
          await contractBosonRouter.pause();
          await contractCashier.setDisasterState();

          assert.isTrue(await contractCashier.isDisasterStateSet());
        });
      });

      describe('canUnpause', () => {
        it('[canUnpause] Should return true initially when contract is deployed', async () => {
          assert.isTrue(await contractCashier.canUnpause());
        });

        it('[canUnpause] Should return false once disasterState is set to true', async () => {
          await contractBosonRouter.pause();
          await contractCashier.setDisasterState();

          assert.isFalse(await contractCashier.canUnpause());
        });
      });
    });

    describe('Withdraw ETH', () => {
      beforeEach(async () => {
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

      it('[withdrawEthOnDisaster] Buyer should be able to withdraw all the funds locked in escrow', async () => {
        for (let i = 0; i < vouchersToBuy; i++) {
          await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
          );
        }

        const buyerInstance = contractCashier.connect(users.buyer.signer);
        await contractBosonRouter.pause();
        await contractCashier.setDisasterState();

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
              'ev._triggeredBy not as expected'
            );
          }
        );
      });

      it('[withdrawEthOnDisaster] Seller should be able to withdraw all the funds locked in escrow', async () => {
        const sellerInstance = contractCashier.connect(users.seller.signer);
        await contractBosonRouter.pause();
        await contractCashier.setDisasterState();
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
              "Seller withdrawn funds don't match"
            );
            assert.equal(
              users.seller.address,
              ev._triggeredBy,
              'ev._triggeredBy not as expected'
            );
          }
        );
      });

      it('[NEGATIVE] withdrawEthOnDisaster should not be executable before admin allows to', async () => {
        await contractBosonRouter.pause();
        const buyerInstance = contractCashier.connect(users.buyer.signer);

        await expect(buyerInstance.withdrawEthOnDisaster()).to.be.revertedWith(
          revertReasons.MANUAL_WITHDRAW_NOT_ALLOWED
        );
      });

      it('[NEGATIVE][withdrawEthOnDisaster] should revert if funds already withdrawn for an account', async () => {
        for (let i = 0; i < vouchersToBuy; i++) {
          await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.product_price,
            constants.buyer_deposit
          );
        }

        const buyerInstance = contractCashier.connect(users.buyer.signer);
        await contractBosonRouter.pause();
        await contractCashier.setDisasterState();
        await buyerInstance.withdrawEthOnDisaster();

        await expect(buyerInstance.withdrawEthOnDisaster()).to.be.revertedWith(
          revertReasons.ESCROW_EMPTY
        );
      });
    });

    describe('Withdraw TKN', () => {
      beforeEach(async () => {
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
      });

      it('[withdrawTokensOnDisaster] Buyer should be able to withdraw all the funds locked in escrow', async () => {
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
        await contractCashier.setDisasterState();
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
              'ev._triggeredBy not as expected'
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
              'ev._triggeredBy not as expected'
            );
          }
        );
      });

      it('[withdrawTokensOnDisaster] Seller should be able to withdraw all the funds locked in escrow', async () => {
        await contractBosonRouter.pause();
        await contractCashier.setDisasterState();
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
              "Seller withdrawn funds don't match"
            );
            assert.equal(
              users.seller.address,
              ev._triggeredBy,
              'ev._triggeredBy not as expected'
            );
          }
        );
      });

      it('[NEGATIVE][withdrawTokensOnDisaster] should not be executable before admin allows to', async () => {
        await contractBosonRouter.pause();
        const buyerInstance = contractCashier.connect(users.buyer.signer);

        await expect(
          buyerInstance.withdrawTokensOnDisaster(contractBSNTokenPrice.address)
        ).to.be.revertedWith(revertReasons.MANUAL_WITHDRAW_NOT_ALLOWED);
      });

      it('[NEGATIVE][withdrawTokensOnDisaster] Escrow amount should revert if funds already withdrawn for an account', async () => {
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
        await contractCashier.setDisasterState();
        const buyerInstance = contractCashier.connect(users.buyer.signer);
        await buyerInstance.withdrawTokensOnDisaster(
          contractBSNTokenPrice.address
        );

        await expect(
          buyerInstance.withdrawTokensOnDisaster(contractBSNTokenPrice.address)
        ).to.be.revertedWith(revertReasons.ESCROW_EMPTY);
      });

      it('[NEGATIVE][withdrawTokensOnDisaster] Withdraw using safe transfer should revert if token is paused', async () => {
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
        await contractCashier.setDisasterState();
        const buyerInstance = contractCashier.connect(users.buyer.signer);

        //pausing the token
        contractBSNTokenPrice.pause();

        //withdraw with token paused.
        await expect(
          buyerInstance.withdrawTokensOnDisaster(contractBSNTokenPrice.address)
        ).to.be.revertedWith(revertReasons.PAUSED);
      });

      it('[NEGATIVE][withdrawTokensOnDisaster] Withdraw should revert if token address is a zero address', async () => {
        await contractBosonRouter.pause();
        await contractCashier.setDisasterState();
        const buyerInstance = contractCashier.connect(users.buyer.signer);

        await expect(
          buyerInstance.withdrawTokensOnDisaster(constants.ZERO_ADDRESS)
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
      });
    });
  });
});
