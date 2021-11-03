import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

import {waffle} from 'hardhat';
import IVK from '../artifacts/contracts/interfaces/IVoucherKernel.sol/IVoucherKernel.json';

import {assert, expect} from 'chai';

import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
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

const BN = ethers.BigNumber.from;

let utils: Utils;

let TOKEN_SUPPLY_ID;

let users;

describe('Cashier withdrawals ', () => {
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

  const zeroDistributedAmounts = {
    buyerAmount: BN(0),
    sellerAmount: BN(0),
    escrowAmount: BN(0),
  };

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
      contractVoucherKernel.address,
      true
    );
    await contractVouchers.setApprovalForAll(
      contractVoucherKernel.address,
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

    async function allPaths(
      voucherID,
      methods,
      paymentAmountDistribution,
      depositAmountDistribution,
      paymentWithdrawal,
      depositWithdrawal,
      expectedAmounts,
      checkEscrowAmounts,
      checkTokenBalances = null,
      ethTransfers = true
    ) {
      // allPaths takes in all methods called in certain scenario
      // methods is array of {m,c} where m is method and c is caller
      // after each method, withdraw can or cannot be called
      // allPaths goes over all possible paths and calcuate total distributed amounts
      // it compares it to expected values {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount}

      // directly after commitToBuy withdraw should not emit any event or do any state change
      // paymentAmountDistribution is withdraw after some action after commitToBuy (cancel, redeem, refund, expire) but before finalize. It releases payments.
      // depositAmountDistribution is withdraw after finalize. It releases deposits.
      // paymentWithdrawal is the amount of eth transfered in scenarios that include ETH after some action after commitToBuy (cancel, redeem, refund, expire) but before finalize. It releases payments.
      // depositWithdrawal is the amount of eth transfered in scenarios that include ETH after finalize. It releases deposits.
      // any withdrawal after paymentAmountDistribution but before finalize should not emit any event or do any state change
      // if there is no withdrawal prior to finalize, paymentAmountDistribution and depositAmountDistribution are joined together

      // checkEscrowAmounts is function that checks escrowAmount based on payment type
      // checkTokenBalances (optional) validates that token balances are correct
      const len = methods.length;
      const numberOfPaths = Math.pow(2, len); // you either withdraw or not after each action -> 2^(#actions) paths

      let snapshot = await ethers.provider.send('evm_snapshot', []);

      // withdraw before first action should not do anything
      expect(await utils.withdraw(voucherID, users.deployer.signer))
        .to.not.emit(contractCashier, eventNames.LOG_WITHDRAWAL)
        .to.not.emit(contractCashier, eventNames.LOG_AMOUNT_DISTRIBUTION);

      await checkEscrowAmounts('beforePaymentRelease');
      if (checkTokenBalances)
        await checkTokenBalances(expectedAmounts.beforePaymentRelease);

      for (let i = 0; i < numberOfPaths; i++) {
        const distributedAmounts = {...zeroDistributedAmounts};
        const execTable = i
          .toString(2)
          .padStart(len, '0')
          .split('')
          .map((d) => d == '1'); //withdraw execution table -> for each path it tells wether to call withdraw after certain action or not
        let paymentWithdrawn = false; // tells if withdraw was called already

        for (let j = 0; j < len; j++) {
          await utils[methods[j].m](voucherID, methods[j].c.signer); // call methods tested in scenario {m:method, c:caller}
          if (execTable[j]) {
            // call withdraw only if execution table says it should be done in thi subscenario
            if (!paymentWithdrawn) {
              // if withdraw is called first time in the subscernario, it should emit event, and change state
              // withdraw should release payments
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
                  validateEmittedLogAmountDistribution(ev, {
                    voucherID,
                    ...paymentAmountDistribution,
                  });
                }
              );

              if (ethTransfers && paymentWithdrawal) {
                // only eth transfers emit LOG_WITHDRAWAL. If price was in TKN, paymentWithdrawal == null and no adjustment is needed
                eventUtils.assertEventEmitted(
                  txReceipt,
                  Cashier_Factory,
                  eventNames.LOG_WITHDRAWAL,
                  (ev) => {
                    validateEmittedLogWithdrawal(ev, {
                      caller: users.deployer,
                      ...paymentWithdrawal,
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
              }
              paymentWithdrawn = true;
            } else {
              await expect(
                utils.withdraw(voucherID, users.deployer.signer)
              ).to.be.revertedWith(revertReasons.NOTHING_TO_WITHDRAW);
            }

            await checkEscrowAmounts('betweenPaymentAndDepositRelease');
            if (checkTokenBalances)
              await checkTokenBalances(
                expectedAmounts.betweenPaymentAndDepositRelease
              );
          }
        }

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
            let addPaymentAmountDistribution = {};
            if (i == 0)
              addPaymentAmountDistribution = paymentAmountDistribution; // if payment were not withdrawn before, they should be together with deposit
            validateEmittedLogAmountDistribution(ev, {
              voucherID,
              ...addPaymentAmountDistribution,
              ...depositAmountDistribution,
            });
          }
        );

        if (ethTransfers && (depositWithdrawal || !paymentWithdrawn)) {
          // only eth transfers emit LOG_WITHDRAWAL
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              let expectedWithdrawal = {...depositWithdrawal};
              if (depositWithdrawal == null) {
                // if deposits are in
                expectedWithdrawal = {...paymentWithdrawal};
              } else if (!paymentWithdrawn && paymentWithdrawal) {
                // if price was in TKN, paymentWithdrawal == null and no adjustment is needed
                // if payment were not withdrawn before, they should be together with deposit
                const find = expectedWithdrawal.payees
                  .map((a) => a.address)
                  .indexOf(paymentWithdrawal.payees[0].address);
                if (find < 0) {
                  expectedWithdrawal.payees.push(paymentWithdrawal.payees[0]);
                  expectedWithdrawal.amounts.push(paymentWithdrawal.amounts[0]);
                } else {
                  expectedWithdrawal.amounts[find].push(
                    paymentWithdrawal.amounts[0]
                  );
                }
              }

              validateEmittedLogWithdrawal(ev, {
                caller: users.deployer,
                ...expectedWithdrawal,
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
        }
        await checkEscrowAmounts('afterDepositRelease');
        if (checkTokenBalances)
          await checkTokenBalances(expectedAmounts.afterDepositRelease);

        if (ethTransfers) {
          // make sure that total distributed ammount in path is correct
          const withdrawsAfter = methods
            .map((m, ind) => (execTable[ind] ? m.m : ''))
            .filter((a) => a != '');
          withdrawsAfter.push('finalize');
          assert.isTrue(
            distributedAmounts.buyerAmount.eq(
              expectedAmounts.expectedBuyerAmount
            ),
            `Buyer Amount is not as expected. Withdraws after "${withdrawsAfter}"`
          );
          assert.isTrue(
            distributedAmounts.sellerAmount.eq(
              expectedAmounts.expectedSellerAmount
            ),
            `Seller Amount is not as expected. Withdraws after "${withdrawsAfter}"`
          );
          assert.isTrue(
            distributedAmounts.escrowAmount.eq(
              expectedAmounts.expectedEscrowAmount
            ),
            `Escrow Amount is not as expected. Withdraws after "${withdrawsAfter}"`
          );
        }

        // revert to state before path was executed
        await ethers.provider.send('evm_revert', [snapshot]);
        snapshot = await ethers.provider.send('evm_snapshot', []);
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
          case 'beforePaymentRelease':
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
              'Seller escrow mismatch - should be full'
            );
            break;
          case 'betweenPaymentAndDepositRelease':
            expect(
              await contractCashier.getEscrowAmount(users.buyer.address)
            ).to.be.equal(
              BN(constants.buyer_deposit),
              'Buyers escrow should have only deposit'
            );

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15)),
              'Seller escrow mismatch - should be full'
            );
            break;
          case 'afterDepositRelease':
            expect(
              await contractCashier.getEscrowAmount(users.buyer.address)
            ).to.be.equal(constants.ZERO, 'Buyers escrow should be zero');

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15 - 1)),
              'Seller escrow mismatch - should be reduced'
            );
            break;
        }
      }

      beforeEach(async () => {
        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit)
          .add(BN(constants.product_price))
          .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

        // expected content of LOG_AMOUNT_DISTRIBUTION
        const paymentAmountDistribution = {
          payment: {
            receiver: users.buyer,
            amount: constants.product_price,
          },
        };

        const depositAmountDistribution = {
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
        };

        // expected contents of LOG_WITHDRAWAL
        const paymentWithdrawal = {
          payees: [users.buyer],
          amounts: [[constants.product_price]],
        };
        const depositWithdrawal = {
          payees: [users.deployer, users.seller, users.buyer],
          amounts: [
            [expectedEscrowAmount],
            [expectedSellerAmount],
            [expectedBuyerAmount.sub(BN(constants.product_price))],
          ],
        };

        await allPaths(
          voucherID,
          [
            {m: 'cancel', c: users.seller},
            {m: 'complain', c: users.buyer},
          ],
          paymentAmountDistribution,
          depositAmountDistribution,
          paymentWithdrawal,
          depositWithdrawal,
          {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
          checkEscrowAmounts
        );
      });

      it('COMMIT->CANCEL->FINALIZE', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit)
          .add(BN(constants.product_price))
          .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmount = BN(0); // 0

        // expected content of LOG_AMOUNT_DISTRIBUTION
        const paymentAmountDistribution = {
          payment: {
            receiver: users.buyer,
            amount: constants.product_price,
          },
        };

        const depositAmountDistribution = {
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
        };

        // expected contents of LOG_WITHDRAWAL
        const paymentWithdrawal = {
          payees: [users.buyer],
          amounts: [[constants.product_price]],
        };
        const depositWithdrawal = {
          payees: [users.buyer, users.seller],
          amounts: [
            [expectedBuyerAmount.sub(constants.product_price)],
            [expectedSellerAmount],
          ],
        };

        await allPaths(
          voucherID,
          [{m: 'cancel', c: users.seller}],
          paymentAmountDistribution,
          depositAmountDistribution,
          paymentWithdrawal,
          depositWithdrawal,
          {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
          checkEscrowAmounts
        );
      });

      describe('Redeem', () => {
        it('COMMIT->REDEEM->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit); // 0.04
          const expectedSellerAmount = BN(constants.seller_deposit).add(
            BN(constants.product_price)
          ); // 0.35
          const expectedEscrowAmount = BN(0); // 0

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.buyer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.seller],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.buyer, users.seller],
            amounts: [
              [expectedBuyerAmount],
              [expectedSellerAmount.sub(constants.product_price)],
            ],
          };

          await allPaths(
            voucherID,
            [{m: 'redeem', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->REDEEM->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit); // 0.04
          const expectedSellerAmount = BN(constants.product_price); // 0.3
          const expectedEscrowAmount = BN(constants.seller_deposit); // 0.05

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.buyer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.seller],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.buyer, users.deployer],
            amounts: [[expectedBuyerAmount], [expectedEscrowAmount]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerAmount = BN(constants.product_price).add(
            BN(constants.seller_deposit).div(BN(4))
          ); // 0.3125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.seller],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.buyer, users.seller, users.deployer],
            amounts: [
              [expectedBuyerAmount],
              [expectedSellerAmount.sub(constants.product_price)],
              [expectedEscrowAmount],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerAmount = BN(constants.product_price).add(
            BN(constants.seller_deposit).div(BN(4))
          ); // 0.3125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.seller],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.buyer, users.seller, users.deployer],
            amounts: [
              [expectedBuyerAmount],
              [expectedSellerAmount.sub(constants.product_price)],
              [expectedEscrowAmount],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->REDEEM->CANCEL->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerAmount = BN(constants.product_price).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.325
          const expectedEscrowAmount = BN(0); // 0

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.seller],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.buyer, users.seller],
            amounts: [
              [expectedBuyerAmount],
              [expectedSellerAmount.sub(constants.product_price)],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });
      });

      describe('Refund', () => {
        it('COMMIT->REFUND->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.product_price); // 0.3
          const expectedSellerAmount = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmount = BN(constants.buyer_deposit); // 0.04

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.seller, users.deployer],
            amounts: [[expectedSellerAmount], [expectedEscrowAmount]],
          };

          await allPaths(
            voucherID,
            [{m: 'refund', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->REFUND->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.product_price); // 0.3
          const expectedSellerAmount = BN(0); // 0
          const expectedEscrowAmount = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.deployer],
            amounts: [[expectedEscrowAmount]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.deployer, users.seller, users.buyer],
            amounts: [
              [expectedEscrowAmount],
              [expectedSellerAmount],
              [expectedBuyerAmount.sub(BN(constants.product_price))],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.deployer, users.seller, users.buyer],
            amounts: [
              [expectedEscrowAmount],
              [expectedSellerAmount],
              [expectedBuyerAmount.sub(BN(constants.product_price))],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->REFUND->CANCEL->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmount = BN(0); //0

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.buyer, users.seller],
            amounts: [
              [expectedBuyerAmount.sub(constants.product_price)],
              [expectedSellerAmount],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });
      });

      describe('Expire', () => {
        beforeEach(async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
        });

        it('COMMIT->EXPIRE->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.product_price); // 0.3
          const expectedSellerAmount = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmount = BN(constants.buyer_deposit); // 0.04

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.seller, users.deployer],
            amounts: [[expectedSellerAmount], [expectedEscrowAmount]],
          };

          await allPaths(
            voucherID,
            [{m: 'expire', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->EXPIRE->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.product_price); // 0.3
          const expectedSellerAmount = BN(0); // 0
          const expectedEscrowAmount = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.deployer],
            amounts: [[expectedEscrowAmount]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.deployer, users.seller, users.buyer],
            amounts: [
              [expectedEscrowAmount],
              [expectedSellerAmount],
              [expectedBuyerAmount.sub(BN(constants.product_price))],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.deployer, users.seller, users.buyer],
            amounts: [
              [expectedEscrowAmount],
              [expectedSellerAmount],
              [expectedBuyerAmount.sub(BN(constants.product_price))],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
        });

        it('COMMIT->EXPIRE->CANCEL->FINALIZE', async () => {
          const expectedBuyerAmount = BN(constants.buyer_deposit)
            .add(BN(constants.product_price))
            .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
          const expectedSellerAmount = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmount = BN(0); //0

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[constants.product_price]],
          };
          const depositWithdrawal = {
            payees: [users.buyer, users.seller],
            amounts: [
              [expectedBuyerAmount.sub(constants.product_price)],
              [expectedSellerAmount],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal,
            depositWithdrawal,
            {expectedBuyerAmount, expectedSellerAmount, expectedEscrowAmount},
            checkEscrowAmounts
          );
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

        expect(
          await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          )
        ).to.equal(
          expected.expectedCashierAmountPrice,
          'Cashier Contract is not empty'
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

        expect(
          await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          )
        ).to.equal(
          expected.expectedCashierAmountDeposit,
          'Cashier Contract has wrong balance'
        );
      }

      async function checkEscrowAmounts(stage) {
        switch (stage) {
          case 'beforePaymentRelease':
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
          case 'betweenPaymentAndDepositRelease':
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
            ).to.be.equal(constants.ZERO, 'Buyers price escrow should be zero');

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
          case 'afterDepositRelease':
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

      function getExpectedTokenBalancesInStages(
        expectedBuyerPrice,
        expectedSellerPrice,
        expectedEscrowAmountPrice,
        expectedBuyerDeposit,
        expectedSellerDeposit,
        expectedEscrowAmountDeposit
      ) {
        // expected token balances in stages
        const beforePaymentRelease = {
          expectedBuyerPrice: constants.ZERO,
          expectedSellerPrice: constants.ZERO,
          expectedEscrowAmountPrice: constants.ZERO,
          expectedBuyerDeposit: constants.ZERO,
          expectedSellerDeposit: constants.ZERO,
          expectedEscrowAmountDeposit: constants.ZERO,
          expectedCashierAmountPrice: constants.product_price,
          expectedCashierAmountDeposit: BN(constants.seller_deposit)
            .mul(constants.QTY_15)
            .add(constants.buyer_deposit),
        };

        const betweenPaymentAndDepositRelease = {
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowAmountPrice,
          expectedBuyerDeposit: constants.ZERO,
          expectedSellerDeposit: constants.ZERO,
          expectedEscrowAmountDeposit: constants.ZERO,
          expectedCashierAmountPrice: constants.ZERO,
          expectedCashierAmountDeposit: BN(constants.seller_deposit)
            .mul(constants.QTY_15)
            .add(constants.buyer_deposit),
        };

        const afterDepositRelease = {
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowAmountPrice,
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit,
          expectedCashierAmountPrice: constants.ZERO,
          expectedCashierAmountDeposit: BN(constants.seller_deposit).mul(
            constants.QTY_15 - 1
          ),
        };

        return {
          beforePaymentRelease,
          betweenPaymentAndDepositRelease,
          afterDepositRelease,
        };
      }

      beforeEach(async () => {
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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE', async () => {
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

        const expectedTokenBalances = getExpectedTokenBalancesInStages(
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowAmountPrice,
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit
        );

        // expected content of LOG_AMOUNT_DISTRIBUTION
        const paymentAmountDistribution = {
          payment: {
            receiver: users.buyer,
            amount: constants.product_price,
          },
        };

        const depositAmountDistribution = {
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
        };

        await allPaths(
          voucherID,
          [
            {m: 'cancel', c: users.seller},
            {m: 'complain', c: users.buyer},
          ],
          paymentAmountDistribution,
          depositAmountDistribution,
          {}, // no LOG_WITHDRAWAL expected
          {}, // no LOG_WITHDRAWAL expected
          expectedTokenBalances,
          checkEscrowAmounts,
          validateBalancesFromPriceTokenAndDepositToken,
          false
        );
      });

      it('COMMIT->CANCEL->FINALIZE', async () => {
        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(0);

        const expectedTokenBalances = getExpectedTokenBalancesInStages(
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowAmountPrice,
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit
        );

        // expected content of LOG_AMOUNT_DISTRIBUTION
        const paymentAmountDistribution = {
          payment: {
            receiver: users.buyer,
            amount: constants.product_price,
          },
        };

        const depositAmountDistribution = {
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
        };

        await allPaths(
          voucherID,
          [{m: 'cancel', c: users.seller}],
          paymentAmountDistribution,
          depositAmountDistribution,
          {}, // no LOG_WITHDRAWAL expected
          {}, // no LOG_WITHDRAWAL expected
          expectedTokenBalances,
          checkEscrowAmounts,
          validateBalancesFromPriceTokenAndDepositToken,
          false
        );
      });

      describe('Redeem', () => {
        it('COMMIT->REDEEM->FINALIZE', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); //// 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(0);
          const expectedEscrowAmountPrice = BN(0);

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.buyer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [{m: 'redeem', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->REDEEM->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountPrice = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit); // 0.05

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.buyer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->REDEEM->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountPrice = BN(0);
          const expectedEscrowAmountDeposit = BN(0);

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });
      });

      describe('Refund', () => {
        it('COMMIT->REFUND->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedEscrowAmountPrice = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [{m: 'refund', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->REFUND->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09
          const expectedEscrowAmountPrice = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->REFUND->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountDeposit = BN(0);
          const expectedEscrowAmountPrice = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });
      });

      describe('Expire', () => {
        beforeEach(async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
        });

        it('COMMIT->EXPIRE->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedEscrowAmountPrice = BN(0);

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [{m: 'expire', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->EXPIRE->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09
          const expectedEscrowAmountPrice = BN(0);

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE', async () => {
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

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE', async () => {
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

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
        });

        it('COMMIT->EXPIRE->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountDeposit = BN(0);
          const expectedEscrowAmountPrice = BN(0);

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromPriceTokenAndDepositToken,
            false
          );
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
          expected.expectedEscrowAmountPrice.add(
            expected.expectedEscrowAmountDeposit
          ),
          'Escrow did not get expected tokens from SameTokenContract'
        );

        expect(
          await utils.contractBSNTokenSame.balanceOf(
            utils.contractCashier.address
          )
        ).to.equal(
          expected.expectedCashierAmountPrice.add(
            expected.expectedCashierAmountDeposit
          )
        );
      }

      async function checkEscrowAmounts(stage) {
        switch (stage) {
          case 'beforePaymentRelease':
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
          case 'betweenPaymentAndDepositRelease':
            expect(
              await contractCashier.getEscrowTokensAmount(
                utils.contractBSNTokenSame.address,
                users.buyer.address
              )
            ).to.be.equal(
              BN(constants.buyer_deposit),
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
          case 'afterDepositRelease':
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

      function getExpectedTokenBalancesInStages(
        expectedBuyerPrice,
        expectedSellerPrice,
        expectedEscrowAmountPrice,
        expectedBuyerDeposit,
        expectedSellerDeposit,
        expectedEscrowAmountDeposit
      ) {
        // expected token balances in stages
        const beforePaymentRelease = {
          expectedBuyerPrice: constants.ZERO,
          expectedSellerPrice: constants.ZERO,
          expectedEscrowAmountPrice: constants.ZERO,
          expectedBuyerDeposit: constants.ZERO,
          expectedSellerDeposit: constants.ZERO,
          expectedEscrowAmountDeposit: constants.ZERO,
          expectedCashierAmountPrice: BN(constants.product_price),
          expectedCashierAmountDeposit: BN(constants.seller_deposit)
            .mul(constants.QTY_15)
            .add(constants.buyer_deposit),
        };

        const betweenPaymentAndDepositRelease = {
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowAmountPrice,
          expectedBuyerDeposit: constants.ZERO,
          expectedSellerDeposit: constants.ZERO,
          expectedEscrowAmountDeposit: constants.ZERO,
          expectedCashierAmountPrice: constants.ZERO,
          expectedCashierAmountDeposit: BN(constants.seller_deposit)
            .mul(constants.QTY_15)
            .add(constants.buyer_deposit),
        };

        const afterDepositRelease = {
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowAmountPrice,
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit,
          expectedCashierAmountPrice: constants.ZERO,
          expectedCashierAmountDeposit: BN(constants.seller_deposit).mul(
            constants.QTY_15 - 1
          ),
        };

        return {
          beforePaymentRelease,
          betweenPaymentAndDepositRelease,
          afterDepositRelease,
        };
      }

      beforeEach(async () => {
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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE', async () => {
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

        const expectedTokenBalances = getExpectedTokenBalancesInStages(
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowAmountPrice,
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit
        );

        // expected content of LOG_AMOUNT_DISTRIBUTION
        const paymentAmountDistribution = {
          payment: {
            receiver: users.buyer,
            amount: constants.product_price,
          },
        };

        const depositAmountDistribution = {
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
        };

        await allPaths(
          voucherID,
          [
            {m: 'cancel', c: users.seller},
            {m: 'complain', c: users.buyer},
          ],
          paymentAmountDistribution,
          depositAmountDistribution,
          {}, // no LOG_WITHDRAWAL expected
          {}, // no LOG_WITHDRAWAL expected
          expectedTokenBalances,
          checkEscrowAmounts,
          validateBalancesFromSameTokenContract,
          false
        );
      });

      it('COMMIT->CANCEL->FINALIZE', async () => {
        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerPrice = BN(0);
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountPrice = BN(0);
        const expectedEscrowAmountDeposit = BN(0);

        const expectedTokenBalances = getExpectedTokenBalancesInStages(
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowAmountPrice,
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit
        );

        // expected content of LOG_AMOUNT_DISTRIBUTION
        const paymentAmountDistribution = {
          payment: {
            receiver: users.buyer,
            amount: constants.product_price,
          },
        };

        const depositAmountDistribution = {
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
        };

        await allPaths(
          voucherID,
          [{m: 'cancel', c: users.seller}],
          paymentAmountDistribution,
          depositAmountDistribution,
          {}, // no LOG_WITHDRAWAL expected
          {}, // no LOG_WITHDRAWAL expected
          expectedTokenBalances,
          checkEscrowAmounts,
          validateBalancesFromSameTokenContract,
          false
        );
      });

      describe('Redeem', () => {
        it('COMMIT->REDEEM->FINALIZE', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); //// 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(0);
          const expectedEscrowAmountPrice = BN(0);

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.buyer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [{m: 'redeem', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->REDEEM->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountPrice = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit); // 0.05

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.buyer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->REDEEM->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountPrice = BN(0);
          const expectedEscrowAmountDeposit = BN(0);

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });
      });

      describe('Refund', () => {
        it('COMMIT->REFUND->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedEscrowAmountPrice = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [{m: 'refund', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->REFUND->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09
          const expectedEscrowAmountPrice = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->REFUND->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountDeposit = BN(0);
          const expectedEscrowAmountPrice = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            expectedTokenBalances,
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });
      });

      describe('Expire', () => {
        beforeEach(async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
        });

        it('COMMIT->EXPIRE->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedEscrowAmountPrice = BN(0);

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [{m: 'expire', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->EXPIRE->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09
          const expectedEscrowAmountPrice = BN(0);

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE', async () => {
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

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE', async () => {
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

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
        });

        it('COMMIT->EXPIRE->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountDeposit = BN(0);
          const expectedEscrowAmountPrice = BN(0);

          const expectedBuyerAmount =
            expectedBuyerPrice.add(expectedBuyerDeposit);
          const expectedSellerAmount = expectedSellerPrice.add(
            expectedSellerDeposit
          );
          const expectedEscrowAmount = expectedEscrowAmountDeposit.add(
            expectedEscrowAmountPrice
          );

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowAmountPrice,
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            {}, // no LOG_WITHDRAWAL expected
            {}, // no LOG_WITHDRAWAL expected
            {
              ...expectedTokenBalances,
              expectedBuyerAmount,
              expectedSellerAmount,
              expectedEscrowAmount,
            },
            checkEscrowAmounts,
            validateBalancesFromSameTokenContract,
            false
          );
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
          expected.expectedCashierAmountDeposit,
          'Cashier Contract is not correct'
        );
      }

      async function checkEscrowAmounts(stage) {
        switch (stage) {
          case 'beforePaymentRelease':
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
          case 'betweenPaymentAndDepositRelease':
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
            ).to.be.equal(constants.ZERO, 'Buyers price escrow should be zero');

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
          case 'afterDepositRelease':
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

      function getExpectedTokenBalancesInStages(
        expectedBuyerDeposit,
        expectedSellerDeposit,
        expectedEscrowAmountDeposit
      ) {
        // expected token balances in stages
        const beforePaymentRelease = {
          expectedBuyerDeposit: constants.ZERO,
          expectedSellerDeposit: constants.ZERO,
          expectedEscrowAmountDeposit: constants.ZERO,
          expectedCashierAmountDeposit: BN(constants.seller_deposit)
            .mul(constants.QTY_15)
            .add(constants.buyer_deposit),
        };

        const betweenPaymentAndDepositRelease = {
          expectedBuyerDeposit: constants.ZERO,
          expectedSellerDeposit: constants.ZERO,
          expectedEscrowAmountDeposit: constants.ZERO,
          expectedCashierAmountDeposit: BN(constants.seller_deposit)
            .mul(constants.QTY_15)
            .add(constants.buyer_deposit),
        };

        const afterDepositRelease = {
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit,
          expectedCashierAmountDeposit: BN(constants.seller_deposit).mul(
            constants.QTY_15 - 1
          ),
        };

        return {
          beforePaymentRelease,
          betweenPaymentAndDepositRelease,
          afterDepositRelease,
        };
      }

      beforeEach(async () => {
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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE', async () => {
        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
          BN(4)
        ); // 0.0125

        const expectedTokenBalances = getExpectedTokenBalancesInStages(
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit
        );

        // expected content of LOG_AMOUNT_DISTRIBUTION
        const paymentAmountDistribution = {
          payment: {
            receiver: users.buyer,
            amount: constants.product_price,
          },
        };

        const depositAmountDistribution = {
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
        };

        // expected contents of LOG_WITHDRAWAL
        const paymentWithdrawal = {
          payees: [users.buyer],
          amounts: [[expectedBuyerPrice]],
        };

        await allPaths(
          voucherID,
          [
            {m: 'cancel', c: users.seller},
            {m: 'complain', c: users.buyer},
          ],
          paymentAmountDistribution,
          depositAmountDistribution,
          paymentWithdrawal, // no LOG_WITHDRAWAL
          null, // no LOG_WITHDRAWAL expected for deposits
          {
            expectedBuyerAmount: expectedBuyerPrice,
            expectedSellerAmount: constants.ZERO,
            expectedEscrowAmount: constants.ZERO,
            ...expectedTokenBalances,
          },
          checkEscrowAmounts,
          validateBalancesDepositToken
        );
      });

      it('COMMIT->CANCEL->FINALIZE', async () => {
        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountDeposit = BN(0);

        const expectedTokenBalances = getExpectedTokenBalancesInStages(
          expectedBuyerDeposit,
          expectedSellerDeposit,
          expectedEscrowAmountDeposit
        );

        // expected content of LOG_AMOUNT_DISTRIBUTION
        const paymentAmountDistribution = {
          payment: {
            receiver: users.buyer,
            amount: constants.product_price,
          },
        };

        const depositAmountDistribution = {
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
        };

        // expected contents of LOG_WITHDRAWAL
        const paymentWithdrawal = {
          payees: [users.buyer],
          amounts: [[expectedBuyerPrice]],
        };

        await allPaths(
          voucherID,
          [{m: 'cancel', c: users.seller}],
          paymentAmountDistribution,
          depositAmountDistribution,
          paymentWithdrawal, // no LOG_WITHDRAWAL
          null, // no LOG_WITHDRAWAL expected for deposits
          {
            expectedBuyerAmount: expectedBuyerPrice,
            expectedSellerAmount: constants.ZERO,
            expectedEscrowAmount: constants.ZERO,
            ...expectedTokenBalances,
          },
          checkEscrowAmounts,
          validateBalancesDepositToken
        );
      });

      describe('Redeem', () => {
        it('COMMIT->REDEEM->FINALIZE', async () => {
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.buyer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.seller],
            amounts: [[expectedSellerPrice]],
          };

          await allPaths(
            voucherID,
            [{m: 'redeem', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: constants.ZERO,
              expectedSellerAmount: expectedSellerPrice,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->REDEEM->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit); // 0.05

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.buyer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.seller],
            amounts: [[expectedSellerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: constants.ZERO,
              expectedSellerAmount: expectedSellerPrice,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE', async () => {
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.seller],
            amounts: [[expectedSellerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: constants.ZERO,
              expectedSellerAmount: expectedSellerPrice,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.seller],
            amounts: [[expectedSellerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: constants.ZERO,
              expectedSellerAmount: expectedSellerPrice,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->REDEEM->CANCEL->FINALIZE', async () => {
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountDeposit = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.seller],
            amounts: [[expectedSellerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: constants.ZERO,
              expectedSellerAmount: expectedSellerPrice,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });
      });

      describe('Refund', () => {
        it('COMMIT->REFUND->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[expectedBuyerPrice]],
          };

          await allPaths(
            voucherID,
            [{m: 'refund', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: expectedBuyerPrice,
              expectedSellerAmount: constants.ZERO,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->REFUND->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[expectedBuyerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: expectedBuyerPrice,
              expectedSellerAmount: constants.ZERO,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[expectedBuyerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: expectedBuyerPrice,
              expectedSellerAmount: constants.ZERO,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[expectedBuyerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: expectedBuyerPrice,
              expectedSellerAmount: constants.ZERO,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->REFUND->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountDeposit = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[expectedBuyerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: expectedBuyerPrice,
              expectedSellerAmount: constants.ZERO,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });
      });

      describe('Expire', () => {
        beforeEach(async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
        });

        it('COMMIT->EXPIRE->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[expectedBuyerPrice]],
          };

          await allPaths(
            voucherID,
            [{m: 'expire', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: expectedBuyerPrice,
              expectedSellerAmount: constants.ZERO,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->EXPIRE->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(0);
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[expectedBuyerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: expectedBuyerPrice,
              expectedSellerAmount: constants.ZERO,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[expectedBuyerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: expectedBuyerPrice,
              expectedSellerAmount: constants.ZERO,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[expectedBuyerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: expectedBuyerPrice,
              expectedSellerAmount: constants.ZERO,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
        });

        it('COMMIT->EXPIRE->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountDeposit = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerDeposit,
            expectedSellerDeposit,
            expectedEscrowAmountDeposit
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const paymentWithdrawal = {
            payees: [users.buyer],
            amounts: [[expectedBuyerPrice]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            paymentWithdrawal, // no LOG_WITHDRAWAL
            null, // no LOG_WITHDRAWAL expected for deposits
            {
              expectedBuyerAmount: expectedBuyerPrice,
              expectedSellerAmount: constants.ZERO,
              expectedEscrowAmount: constants.ZERO,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesDepositToken
          );
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
        ).to.equal(
          expected.expectedCashierAmountPrice,
          'Cashier Contract amount mismatch'
        );
      }

      async function checkEscrowAmounts(stage) {
        switch (stage) {
          case 'beforePaymentRelease':
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
          case 'betweenPaymentAndDepositRelease':
            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenPrice.address,
                users.buyer.address
              )
            ).to.be.equal(constants.ZERO, 'Buyers token escrow should be zero');

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
            ).to.be.equal(
              constants.ZERO,
              'Seller tokens escrow should be zero'
            );

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15)),
              'Sellers ETH escrow mismatch'
            );
            break;
          case 'afterDepositRelease':
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
            ).to.be.equal(
              constants.ZERO,
              'Seller tokens escrow should be zero'
            );

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.be.equal(
              BN(constants.seller_deposit).mul(BN(constants.QTY_15 - 1)),
              'Sellers ETH escrow mismatch'
            );
            break;
        }
      }

      function getExpectedTokenBalancesInStages(
        expectedBuyerPrice,
        expectedSellerPrice,
        expectedEscrowPrice
      ) {
        // expected token balances in stages
        const beforePaymentRelease = {
          expectedBuyerPrice: constants.ZERO,
          expectedSellerPrice: constants.ZERO,
          expectedEscrowPrice: constants.ZERO,
          expectedCashierAmountPrice: constants.product_price,
        };

        const betweenPaymentAndDepositRelease = {
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowPrice,
          expectedCashierAmountPrice: constants.ZERO,
        };

        const afterDepositRelease = {
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowPrice,
          expectedCashierAmountPrice: constants.ZERO,
        };

        return {
          beforePaymentRelease,
          betweenPaymentAndDepositRelease,
          afterDepositRelease,
        };
      }

      beforeEach(async () => {
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

      it('COMMIT->CANCEL->COMPLAIN->FINALIZE', async () => {
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

        const expectedTokenBalances = getExpectedTokenBalancesInStages(
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowPrice
        );

        // expected content of LOG_AMOUNT_DISTRIBUTION
        const paymentAmountDistribution = {
          payment: {
            receiver: users.buyer,
            amount: constants.product_price,
          },
        };

        const depositAmountDistribution = {
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
        };

        // expected contents of LOG_WITHDRAWAL
        const depositWithdrawal = {
          payees: [users.deployer, users.seller, users.buyer],
          amounts: [
            [expectedEscrowAmountDeposit],
            [expectedSellerDeposit],
            [expectedBuyerDeposit],
          ],
        };

        await allPaths(
          voucherID,
          [
            {m: 'cancel', c: users.seller},
            {m: 'complain', c: users.buyer},
          ],
          paymentAmountDistribution,
          depositAmountDistribution,
          null, // no LOG_WITHDRAWAL expected for payment
          depositWithdrawal, // no LOG_WITHDRAWAL expected
          {
            expectedBuyerAmount: expectedBuyerDeposit,
            expectedSellerAmount: expectedSellerDeposit,
            expectedEscrowAmount: expectedEscrowAmountDeposit,
            ...expectedTokenBalances,
          },
          checkEscrowAmounts,
          validateBalancesPriceToken
        );
      });

      it('COMMIT->CANCEL->FINALIZE', async () => {
        const expectedBuyerPrice = BN(constants.product_price); // 0.3
        const expectedSellerPrice = BN(0);
        const expectedEscrowPrice = BN(0);
        const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
          BN(constants.seller_deposit).div(BN(2))
        ); // 0.065
        const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
        const expectedEscrowAmountDeposit = BN(0);

        const expectedTokenBalances = getExpectedTokenBalancesInStages(
          expectedBuyerPrice,
          expectedSellerPrice,
          expectedEscrowPrice
        );

        // expected content of LOG_AMOUNT_DISTRIBUTION
        const paymentAmountDistribution = {
          payment: {
            receiver: users.buyer,
            amount: constants.product_price,
          },
        };

        const depositAmountDistribution = {
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
        };

        // expected contents of LOG_WITHDRAWAL
        const depositWithdrawal = {
          payees: [users.buyer, users.seller],
          amounts: [[expectedBuyerDeposit], [expectedSellerDeposit]],
        };

        await allPaths(
          voucherID,
          [{m: 'cancel', c: users.seller}],
          paymentAmountDistribution,
          depositAmountDistribution,
          null, // no LOG_WITHDRAWAL expected for payment
          depositWithdrawal, // no LOG_WITHDRAWAL expected
          {
            expectedBuyerAmount: expectedBuyerDeposit,
            expectedSellerAmount: expectedSellerDeposit,
            expectedEscrowAmount: expectedEscrowAmountDeposit,
            ...expectedTokenBalances,
          },
          checkEscrowAmounts,
          validateBalancesPriceToken
        );
      });

      describe('Redeem', () => {
        it('COMMIT->REDEEM->FINALIZE', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.buyer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.buyer, users.seller],
            amounts: [[expectedBuyerDeposit], [expectedSellerDeposit]],
          };

          await allPaths(
            voucherID,
            [{m: 'redeem', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->REDEEM->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit); // 0.05

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.buyer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.buyer, users.deployer],
            amounts: [[expectedBuyerDeposit], [expectedEscrowAmountDeposit]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.buyer, users.seller, users.deployer],
            amounts: [
              [expectedBuyerDeposit],
              [expectedSellerDeposit],
              [expectedEscrowAmountDeposit],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.buyer, users.seller, users.deployer],
            amounts: [
              [expectedBuyerDeposit],
              [expectedSellerDeposit],
              [expectedEscrowAmountDeposit],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->REDEEM->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountDeposit = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.seller,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.buyer, users.seller],
            amounts: [[expectedBuyerDeposit], [expectedSellerDeposit]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'redeem', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });
      });

      describe('Refund', () => {
        it('COMMIT->REFUND->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedSellerPrice = BN(0);
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.seller, users.deployer],
            amounts: [[expectedSellerDeposit], [expectedEscrowAmountDeposit]],
          };

          await allPaths(
            voucherID,
            [{m: 'refund', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->REFUND->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedSellerPrice = BN(0);
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(0);
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.deployer],
            amounts: [[expectedEscrowAmountDeposit]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.deployer, users.seller, users.buyer],
            amounts: [
              [expectedEscrowAmountDeposit],
              [expectedSellerDeposit],
              [expectedBuyerDeposit],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.deployer, users.seller, users.buyer],
            amounts: [
              [expectedEscrowAmountDeposit],
              [expectedSellerDeposit],
              [expectedBuyerDeposit],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->REFUND->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedSellerPrice = BN(0);
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountDeposit = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.buyer, users.seller],
            amounts: [[expectedBuyerDeposit], [expectedSellerDeposit]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'refund', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });
      });

      describe('Expire', () => {
        beforeEach(async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
        });
        it('COMMIT->EXPIRE->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedSellerPrice = BN(0);
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(constants.buyer_deposit); // 0.04

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.seller],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.seller, users.deployer],
            amounts: [[expectedSellerDeposit], [expectedEscrowAmountDeposit]],
          };

          await allPaths(
            voucherID,
            [{m: 'expire', c: users.buyer}],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->EXPIRE->COMPLAIN->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedSellerPrice = BN(0);
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(0);
          const expectedSellerDeposit = BN(0);
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).add(
            BN(constants.buyer_deposit)
          ); // 0.09

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
            sellerDeposit: {
              receivers: [users.deployer],
              amounts: [constants.seller_deposit],
            },
            buyerDeposit: {
              receiver: users.deployer,
              amount: constants.buyer_deposit,
            },
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.deployer],
            amounts: [[expectedEscrowAmountDeposit]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.deployer, users.seller, users.buyer],
            amounts: [
              [expectedEscrowAmountDeposit],
              [expectedSellerDeposit],
              [expectedBuyerDeposit],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'complain', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE', async () => {
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

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.deployer, users.seller, users.buyer],
            amounts: [
              [expectedEscrowAmountDeposit],
              [expectedSellerDeposit],
              [expectedBuyerDeposit],
            ],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'cancel', c: users.seller},
              {m: 'complain', c: users.buyer},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });

        it('COMMIT->EXPIRE->CANCEL->FINALIZE', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedSellerPrice = BN(0);
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(2)); // 0.025
          const expectedEscrowAmountDeposit = BN(0);

          const expectedTokenBalances = getExpectedTokenBalancesInStages(
            expectedBuyerPrice,
            expectedSellerPrice,
            expectedEscrowPrice
          );

          // expected content of LOG_AMOUNT_DISTRIBUTION
          const paymentAmountDistribution = {
            payment: {
              receiver: users.buyer,
              amount: constants.product_price,
            },
          };

          const depositAmountDistribution = {
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
          };

          // expected contents of LOG_WITHDRAWAL
          const depositWithdrawal = {
            payees: [users.buyer, users.seller],
            amounts: [[expectedBuyerDeposit], [expectedSellerDeposit]],
          };

          await allPaths(
            voucherID,
            [
              {m: 'expire', c: users.buyer},
              {m: 'cancel', c: users.seller},
            ],
            paymentAmountDistribution,
            depositAmountDistribution,
            null, // no LOG_WITHDRAWAL expected for payment
            depositWithdrawal, // no LOG_WITHDRAWAL expected
            {
              expectedBuyerAmount: expectedBuyerDeposit,
              expectedSellerAmount: expectedSellerDeposit,
              expectedEscrowAmount: expectedEscrowAmountDeposit,
              ...expectedTokenBalances,
            },
            checkEscrowAmounts,
            validateBalancesPriceToken
          );
        });
      });
    });
  });

  describe('Seller cancels uncommitted voucher set', () => {
    const remQty = 5;
    const voucherToBuyBeforeBurn = 5;
    let tokensToMintSeller, tokensToMintBuyer;

    describe('ETHETH', () => {
      beforeEach(async () => {
        await deployContracts();
        await setPeriods();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
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
        }
      });

      it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
        const sellerInstance = contractBosonRouter.connect(users.seller.signer);
        const expectedSellerDeposit = BN(constants.seller_deposit).mul(
          BN(remQty)
        );

        expect(
          await sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
        )
          .to.emit(contractCashier, eventNames.LOG_WITHDRAWAL)
          .withArgs(
            contractBosonRouter.address,
            users.seller.address,
            expectedSellerDeposit
          )
          .to.emit(contractVoucherKernel, eventNames.LOG_CANCEL_VOUCHER_SET)
          .withArgs(TOKEN_SUPPLY_ID, users.seller.address)
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            users.seller.address,
            constants.ZERO_ADDRESS,
            TOKEN_SUPPLY_ID,
            remQty
          );
      });

      describe('State after COF', () => {
        beforeEach(async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );
          await sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID);
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
          const remainingQtyInContract =
            await contractVoucherKernel.getRemQtyForSupply(
              TOKEN_SUPPLY_ID,
              users.seller.address
            );

          assert.isTrue(
            remainingQtyInContract.eq(BN(0)),
            'Escrow amount is incorrect'
          );
        });

        it('VoucherSets balance should be correct', async () => {
          const balance = await contractVoucherSets[
            'balanceOf(address,uint256)'
          ](users.seller.address, TOKEN_SUPPLY_ID);

          assert.equal(
            balance.toString(),
            constants.ZERO.toString(),
            'VoucherSets amount is incorrect'
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
      });

      it('[NEGATIVE] should revert if not called from the seller', async () => {
        const attackerInstance = contractBosonRouter.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
      });

      it('[NEGATIVE] Should revert if called when contract is paused', async () => {
        const sellerInstance = contractBosonRouter.connect(users.seller.signer);
        await contractBosonRouter.pause();

        await expect(
          sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
        ).to.be.revertedWith(revertReasons.PAUSED);
      });

      it('[NEGATIVE] should revert if router supplies wrong _messageSender', async () => {
        // spoof boson router
        await contractBosonRouter.pause();
        await contractCashier.setBosonRouterAddress(users.deployer.address);
        await contractCashier.unpause();

        await expect(
          contractCashier.withdrawDepositsSe(
            TOKEN_SUPPLY_ID,
            remQty,
            users.attacker.address
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
      });

      it('[NEGATIVE] should revert if router supplies burn quantity as zero', async () => {
        // spoof boson router
        await contractBosonRouter.pause();
        await contractCashier.setBosonRouterAddress(users.deployer.address);
        await contractCashier.unpause();

        await expect(
          contractCashier.withdrawDepositsSe(
            TOKEN_SUPPLY_ID,
            0,
            users.seller.address
          )
        ).to.be.revertedWith(revertReasons.NO_FUNDS_TO_WITHDRAW);
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('TKNTKN', () => {
        beforeEach(async () => {
          await deployContracts();
          await setPeriods();
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
          }
        });

        it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          const expectedSellerDeposit = BN(constants.seller_deposit).mul(
            BN(remQty)
          );

          expect(
            await sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          )
            .to.emit(contractBSNTokenDeposit, eventNames.TRANSFER)
            .withArgs(
              contractCashier.address,
              users.seller.address,
              expectedSellerDeposit
            )
            .to.emit(contractVoucherKernel, eventNames.LOG_CANCEL_VOUCHER_SET)
            .withArgs(TOKEN_SUPPLY_ID, users.seller.address)
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              users.seller.address,
              constants.ZERO_ADDRESS,
              TOKEN_SUPPLY_ID,
              remQty
            );
        });

        describe('State after COF', () => {
          beforeEach(async () => {
            const sellerInstance = contractBosonRouter.connect(
              users.seller.signer
            );
            await sellerInstance.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID
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
            const remainingQtyInContract =
              await contractVoucherKernel.getRemQtyForSupply(
                TOKEN_SUPPLY_ID,
                users.seller.address
              );

            assert.isTrue(
              remainingQtyInContract.eq(BN(0)),
              'Remaining supply is incorrect'
            );
          });

          it('VoucherSets balance should be correct', async () => {
            const balance = await contractVoucherSets[
              'balanceOf(address,uint256)'
            ](users.seller.address, TOKEN_SUPPLY_ID);

            assert.equal(
              balance.toString(),
              constants.ZERO.toString(),
              'VoucherSets amount is incorrect'
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
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          const attackerInstance = contractBosonRouter.connect(
            users.attacker.signer
          );

          await expect(
            attackerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
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

        it('[NEGATIVE] should revert if router supplies wrong _messageSender', async () => {
          // spoof boson router
          await contractBosonRouter.pause();
          await contractCashier.setBosonRouterAddress(users.deployer.address);
          await contractCashier.unpause();

          await expect(
            contractCashier.withdrawDepositsSe(
              TOKEN_SUPPLY_ID,
              remQty,
              users.attacker.address
            )
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
        });

        it('[NEGATIVE] should revert if router supplies burn quantity as zero', async () => {
          // spoof boson router
          await contractBosonRouter.pause();
          await contractCashier.setBosonRouterAddress(users.deployer.address);
          await contractCashier.unpause();

          await expect(
            contractCashier.withdrawDepositsSe(
              TOKEN_SUPPLY_ID,
              0,
              users.seller.address
            )
          ).to.be.revertedWith(revertReasons.NO_FUNDS_TO_WITHDRAW);
        });
      });

      describe('TKNTKN Same', () => {
        beforeEach(async () => {
          await deployContracts();
          await setPeriods();
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

          tokensToMintSeller = BN(constants.seller_deposit).mul(
            BN(constants.QTY_10)
          );
          tokensToMintBuyer = BN(constants.product_price).mul(
            BN(constants.QTY_10)
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
          }
        });

        it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          const expectedSellerDeposit = BN(constants.seller_deposit).mul(
            BN(remQty)
          );

          expect(
            await sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          )
            .to.emit(utils.contractBSNTokenSame, eventNames.TRANSFER)
            .withArgs(
              contractCashier.address,
              users.seller.address,
              expectedSellerDeposit
            )
            .to.emit(contractVoucherKernel, eventNames.LOG_CANCEL_VOUCHER_SET)
            .withArgs(TOKEN_SUPPLY_ID, users.seller.address)
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              users.seller.address,
              constants.ZERO_ADDRESS,
              TOKEN_SUPPLY_ID,
              remQty
            );
        });

        describe('State after COF', () => {
          beforeEach(async () => {
            const sellerInstance = contractBosonRouter.connect(
              users.seller.signer
            );
            await sellerInstance.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID
            );
          });

          it('Tokens should be returned to seller after burning the rest of the supply', async () => {
            const expectedBalance = BN(constants.seller_deposit).mul(
              BN(voucherToBuyBeforeBurn)
            );
            const escrowAmount = await utils.contractBSNTokenSame.balanceOf(
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
              utils.contractBSNTokenSame.address,
              users.seller.address
            );

            assert.isTrue(
              escrowAmount.eq(expectedBalance),
              'Escrow amount is incorrect'
            );
          });

          it('Remaining QTY for Token Supply should be ZERO', async () => {
            const remainingQtyInContract =
              await contractVoucherKernel.getRemQtyForSupply(
                TOKEN_SUPPLY_ID,
                users.seller.address
              );

            assert.isTrue(
              remainingQtyInContract.eq(BN(0)),
              'Remaining supply is incorrect'
            );
          });

          it('VoucherSets balance should be correct', async () => {
            const balance = await contractVoucherSets[
              'balanceOf(address,uint256)'
            ](users.seller.address, TOKEN_SUPPLY_ID);

            assert.equal(
              balance.toString(),
              constants.ZERO.toString(),
              'VoucherSets amount is incorrect'
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
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          const attackerInstance = contractBosonRouter.connect(
            users.attacker.signer
          );

          await expect(
            attackerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
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

        it('[NEGATIVE] should revert if router supplies wrong _messageSender', async () => {
          // spoof boson router
          await contractBosonRouter.pause();
          await contractCashier.setBosonRouterAddress(users.deployer.address);
          await contractCashier.unpause();

          await expect(
            contractCashier.withdrawDepositsSe(
              TOKEN_SUPPLY_ID,
              remQty,
              users.attacker.address
            )
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
        });

        it('[NEGATIVE] should revert if router supplies burn quantity as zero', async () => {
          // spoof boson router
          await contractBosonRouter.pause();
          await contractCashier.setBosonRouterAddress(users.deployer.address);
          await contractCashier.unpause();

          await expect(
            contractCashier.withdrawDepositsSe(
              TOKEN_SUPPLY_ID,
              0,
              users.seller.address
            )
          ).to.be.revertedWith(revertReasons.NO_FUNDS_TO_WITHDRAW);
        });
      });

      describe('ETHTKN', () => {
        beforeEach(async () => {
          await deployContracts();
          await setPeriods();

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
          }
        });

        it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          const expectedSellerDeposit = BN(constants.seller_deposit).mul(
            BN(remQty)
          );

          expect(
            await sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          )
            .to.emit(contractBSNTokenDeposit, eventNames.TRANSFER)
            .withArgs(
              contractCashier.address,
              users.seller.address,
              expectedSellerDeposit
            )
            .to.emit(contractVoucherKernel, eventNames.LOG_CANCEL_VOUCHER_SET)
            .withArgs(TOKEN_SUPPLY_ID, users.seller.address)
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              users.seller.address,
              constants.ZERO_ADDRESS,
              TOKEN_SUPPLY_ID,
              remQty
            );
        });

        describe('State after COF', () => {
          beforeEach(async () => {
            const sellerInstance = contractBosonRouter.connect(
              users.seller.signer
            );
            await sellerInstance.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID
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
            const remainingQtyInContract =
              await contractVoucherKernel.getRemQtyForSupply(
                TOKEN_SUPPLY_ID,
                users.seller.address
              );

            assert.isTrue(
              remainingQtyInContract.eq(BN(0)),
              'Remaining quantity is incorrect'
            );
          });

          it('VoucherSets balance should be correct', async () => {
            const balance = await contractVoucherSets[
              'balanceOf(address,uint256)'
            ](users.seller.address, TOKEN_SUPPLY_ID);

            assert.equal(
              balance.toString(),
              constants.ZERO.toString(),
              'VoucherSets amount is incorrect'
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
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          const attackerInstance = contractBosonRouter.connect(
            users.attacker.signer
          );

          await expect(
            attackerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
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

        it('[NEGATIVE] should revert if router supplies wrong _messageSender', async () => {
          // spoof boson router
          await contractBosonRouter.pause();
          await contractCashier.setBosonRouterAddress(users.deployer.address);
          await contractCashier.unpause();

          await expect(
            contractCashier.withdrawDepositsSe(
              TOKEN_SUPPLY_ID,
              remQty,
              users.attacker.address
            )
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
        });

        it('[NEGATIVE] should revert if router supplies burn quantity as zero', async () => {
          // spoof boson router
          await contractBosonRouter.pause();
          await contractCashier.setBosonRouterAddress(users.deployer.address);
          await contractCashier.unpause();

          await expect(
            contractCashier.withdrawDepositsSe(
              TOKEN_SUPPLY_ID,
              0,
              users.seller.address
            )
          ).to.be.revertedWith(revertReasons.NO_FUNDS_TO_WITHDRAW);
        });
      });

      describe('TKNETH', () => {
        beforeEach(async () => {
          await deployContracts();
          await setPeriods();

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
          }
        });

        it('Seller should be able to withdraw deposits for the remaining QTY in Token Supply', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          const expectedSellerDeposit = BN(constants.seller_deposit).mul(
            BN(remQty)
          );

          expect(
            await sellerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          )
            .to.emit(contractCashier, eventNames.LOG_WITHDRAWAL)
            .withArgs(
              contractBosonRouter.address,
              users.seller.address,
              expectedSellerDeposit
            )
            .to.emit(contractVoucherKernel, eventNames.LOG_CANCEL_VOUCHER_SET)
            .withArgs(TOKEN_SUPPLY_ID, users.seller.address)
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              users.seller.address,
              constants.ZERO_ADDRESS,
              TOKEN_SUPPLY_ID,
              remQty
            );
        });

        describe('State after COF', () => {
          beforeEach(async () => {
            const sellerInstance = contractBosonRouter.connect(
              users.seller.signer
            );
            await sellerInstance.requestCancelOrFaultVoucherSet(
              TOKEN_SUPPLY_ID
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
            const remainingQtyInContract =
              await contractVoucherKernel.getRemQtyForSupply(
                TOKEN_SUPPLY_ID,
                users.seller.address
              );

            assert.isTrue(
              remainingQtyInContract.eq(BN(0)),
              'Escrow amount is incorrect'
            );
          });

          it('VoucherSets balance should be correct', async () => {
            const balance = await contractVoucherSets[
              'balanceOf(address,uint256)'
            ](users.seller.address, TOKEN_SUPPLY_ID);

            assert.equal(
              balance.toString(),
              constants.ZERO.toString(),
              'VoucherSets amount is incorrect'
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
        });

        it('[NEGATIVE] should revert if not called from the seller', async () => {
          const attackerInstance = contractBosonRouter.connect(
            users.attacker.signer
          );

          await expect(
            attackerInstance.requestCancelOrFaultVoucherSet(TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
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

        it('[NEGATIVE] should revert if router supplies wrong _messageSender', async () => {
          // spoof boson router
          await contractBosonRouter.pause();
          await contractCashier.setBosonRouterAddress(users.deployer.address);
          await contractCashier.unpause();

          await expect(
            contractCashier.withdrawDepositsSe(
              TOKEN_SUPPLY_ID,
              remQty,
              users.attacker.address
            )
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
        });

        it('[NEGATIVE] should revert if router supplies burn quantity as zero', async () => {
          // spoof boson router
          await contractBosonRouter.pause();
          await contractCashier.setBosonRouterAddress(users.deployer.address);
          await contractCashier.unpause();

          await expect(
            contractCashier.withdrawDepositsSe(
              TOKEN_SUPPLY_ID,
              0,
              users.seller.address
            )
          ).to.be.revertedWith(revertReasons.NO_FUNDS_TO_WITHDRAW);
        });
      });
    });

    it('[NEGATIVE] should revert if not called via boson router', async () => {
      await deployContracts();

      const sellerInstance = contractVoucherKernel.connect(users.seller.signer);

      const attackerInstance = contractVoucherKernel.connect(
        users.attacker.signer
      );

      await expect(
        sellerInstance.cancelOrFaultVoucherSet(
          constants.ONE,
          users.seller.address
        )
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);

      await expect(
        attackerInstance.cancelOrFaultVoucherSet(
          constants.ONE,
          users.attacker.address
        )
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
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
            contractVoucherSets,
            contractVouchers,
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
        it('[setDisasterState] Disaster state can be set when paused', async () => {
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
              assert.isTrue(ev._disasterState);
            }
          );

          assert.isTrue(await contractCashier.isDisasterStateSet());
        });

        it('[setDisasterState] Cannot unpause if setDisasterState is called already', async () => {
          await contractBosonRouter.pause();

          await contractCashier.setDisasterState();
          assert.isTrue(await contractCashier.isDisasterStateSet());

          await expect(contractBosonRouter.unpause()).to.be.revertedWith(
            revertReasons.UNPAUSED_FORBIDDEN
          );
        });

        it('[NEGATIVE][setDisasterState] Disaster state cannot be set again when it is already set', async () => {
          await contractBosonRouter.pause();

          await contractCashier.setDisasterState();
          await expect(contractCashier.setDisasterState()).to.be.revertedWith(
            revertReasons.DISASTER_STATE_ALREADY_SET
          );
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
            contractVoucherSets,
            contractVouchers,
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

        // check escrow - before
        expect(
          await contractCashier.getEscrowAmount(users.buyer.address)
        ).to.be.equal(expectedBuyerBalance, 'Buyer escrow not as expected');

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

        // check escrow - after
        expect(
          await contractCashier.getEscrowAmount(users.buyer.address)
        ).to.be.equal(constants.ZERO, 'Buyers escrow should be zero');
      });

      it('[withdrawEthOnDisaster] Seller should be able to withdraw all the funds locked in escrow', async () => {
        const sellerInstance = contractCashier.connect(users.seller.signer);
        await contractBosonRouter.pause();
        await contractCashier.setDisasterState();
        const expectedSellerBalance = BN(constants.seller_deposit).mul(
          BN(constants.QTY_10)
        );

        // check escrow - before
        expect(
          await contractCashier.getEscrowAmount(users.seller.address)
        ).to.be.equal(expectedSellerBalance, 'Seller escrow not as expected');

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

        // check escrow - after
        expect(
          await contractCashier.getEscrowAmount(users.seller.address)
        ).to.be.equal(constants.ZERO, 'Seller escrow should be zero');
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
            contractVoucherSets,
            contractVouchers,
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

      async function validateBalancesFromDepositToken(expected) {
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
      }

      describe('[withdrawTokensOnDisaster] Buyer should be able to withdraw all the funds locked in escrow', () => {
        it('contractBSNTokenPrice', async () => {
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

          const buyerInstance = contractCashier.connect(users.buyer.signer);

          // check escrow - before
          expect(
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.buyer.address
            )
          ).to.be.equal(expectedTknPrice, 'Buyer escrow not as expected');

          const txTknPrice = await buyerInstance.withdrawTokensOnDisaster(
            contractBSNTokenPrice.address
          );

          const receiptTknPrice = await txTknPrice.wait();

          //validate balances from price token
          const expectedBuyerPrice = BN(constants.product_price).mul(
            BN(constants.QTY_10)
          ); // 0.3

          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.buyer.address)
          ).to.equal(
            expectedBuyerPrice,
            'Buyer did not get expected tokens from PriceTokenContract'
          );

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

          // check escrow - after
          expect(
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.buyer.address
            )
          ).to.be.equal(BN(constants.ZERO), 'Buyer escrow should be zero');
        });

        it('contractBSNTokenDeposit', async () => {
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
          const expectedTknDeposit = BN(constants.buyer_deposit).mul(
            BN(vouchersToBuy)
          );

          const buyerInstance = contractCashier.connect(users.buyer.signer);

          // check escrow - before
          expect(
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.buyer.address
            )
          ).to.be.equal(expectedTknDeposit, 'Buyer escrow not as expected');

          const txTknDeposit = await buyerInstance.withdrawTokensOnDisaster(
            contractBSNTokenDeposit.address
          );

          const receiptTknDeposit = await txTknDeposit.wait();

          //validate balances from deposit token
          const expectedBuyerDeposit = BN(constants.product_price).mul(
            BN(constants.QTY_10)
          ); // 0.3
          expect(
            await utils.contractBSNTokenDeposit.balanceOf(users.buyer.address)
          ).to.equal(
            expectedBuyerDeposit,
            'Buyer did not get expected tokens from DepositTokenContract'
          );

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

          // check escrow - after
          expect(
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.buyer.address
            )
          ).to.be.equal(BN(constants.ZERO), 'Buyer escrow should be zero');
        });
      });

      it('[withdrawTokensOnDisaster] Seller should be able to withdraw all the funds locked in escrow', async () => {
        await contractBosonRouter.pause();
        await contractCashier.setDisasterState();
        const sellerInstance = contractCashier.connect(users.seller.signer);
        const expectedSellerBalance = BN(constants.seller_deposit).mul(
          BN(constants.QTY_10)
        );

        // check escrow - before
        expect(
          await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          )
        ).to.be.equal(expectedSellerBalance, 'Seller escrow not as expected');

        const tx = await sellerInstance.withdrawTokensOnDisaster(
          contractBSNTokenDeposit.address
        );

        const txReceipt = await tx.wait();

        //validate balances from deposit token
        const expectedBuyerDeposit = BN(constants.product_price).mul(
          BN(constants.QTY_10)
        ); // 0.3
        const expectedSellerDeposit = BN(constants.seller_deposit).mul(
          BN(constants.QTY_10)
        ); // 0.05

        await validateBalancesFromDepositToken({
          expectedBuyerDeposit,
          expectedSellerDeposit,
        });

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

        //check escrow - After
        expect(
          await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          )
        ).to.be.equal(BN(constants.ZERO), 'Seller escrow should be zero');
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

  describe('General failing flows', () => {
    before(async () => {
      await deployContracts();
      await setPeriods();
    });

    it('[NEGATIVE] should revert if specified voucher ID equals 0', async () => {
      await expect(contractCashier.withdraw(constants.ZERO)).to.be.revertedWith(
        revertReasons.UNSPECIFIED_ID
      );
    });

    it('[NEGATIVE] should revert if withdrawDepositsSe is called with zero address message sender', async () => {
      // spoof boson router address
      await contractBosonRouter.pause();
      await contractCashier.setBosonRouterAddress(users.deployer.address);
      await contractCashier.unpause();

      await expect(
        contractCashier.withdrawDepositsSe(
          constants.ONE,
          1,
          constants.ZERO_ADDRESS
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[NEGATIVE] should revert if voucherId does not map to any supply', async () => {
      await expect(contractCashier.withdraw(constants.ONE)).to.be.revertedWith(
        revertReasons.INEXISTENT_SUPPLY
      );
    });

    it('[NEGATIVE] should revert if voucher kernel returns payment method greater than 5', async () => {
      const tokenVoucherId = constants.ONE;
      const tokenSupplyId = constants.TWO;

      const {deployMockContract} = waffle;

      const mockVoucherKernel = await deployMockContract(
        users.deployer.signer,
        IVK.abi
      ); //deploys mock

      contractCashier = (await Cashier_Factory.deploy(
        users.deployer.address, // spoof boson router address
        mockVoucherKernel.address,
        contractVoucherSets.address,
        contractVouchers.address
      )) as Contract & Cashier;

      await contractCashier.deployed();

      await mockVoucherKernel.mock.getIdSupplyFromVoucher
        .withArgs(constants.ONE)
        .returns(constants.TWO);
      await mockVoucherKernel.mock.getVoucherPaymentMethod
        .withArgs(tokenSupplyId)
        .returns('5');

      await expect(contractCashier.withdraw(tokenVoucherId)).to.be.revertedWith(
        revertReasons.RUNTIME_ERROR_INVALID_OPCODE
      );

      await mockVoucherKernel.mock.getSupplyHolder
        .withArgs(tokenSupplyId)
        .returns(users.seller.address);
      await mockVoucherKernel.mock.getSellerDeposit
        .withArgs(tokenSupplyId)
        .returns(constants.seller_deposit);

      await expect(
        contractCashier.withdrawDepositsSe(
          tokenSupplyId,
          1,
          users.seller.address
        )
      ).to.be.revertedWith(revertReasons.RUNTIME_ERROR_INVALID_OPCODE);
    });
  });
});
