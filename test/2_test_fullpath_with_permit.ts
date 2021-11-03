import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';
import {assert, expect} from 'chai';
import {ecsign} from 'ethereumjs-util';
import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
import constants from '../testHelpers/constants';
import {advanceTimeSeconds} from '../testHelpers/timemachine';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';
import {toWei, getApprovalDigest} from '../testHelpers/permitUtils';
import {
  BosonRouter,
  VoucherSets,
  Vouchers,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockBosonRouter,
  MockERC20Permit,
  MockERC721Receiver,
} from '../typechain';
const {keccak256, solidityPack} = ethers.utils;

let VoucherSets_Factory: ContractFactory;
let Vouchers_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockBosonRouter_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;
let MockERC721Receiver_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
const eventNames = eventUtils.eventNames;
import fnSignatures from '../testHelpers/functionSignatures';

const BN = ethers.BigNumber.from;

let utils: Utils;
let users;

describe('Cashier and VoucherKernel', () => {
  let promiseId: string, tokenSupplyKey: string;

  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    VoucherSets_Factory = await ethers.getContractFactory('VoucherSets');
    Vouchers_Factory = await ethers.getContractFactory('Vouchers');
    VoucherKernel_Factory = await ethers.getContractFactory('VoucherKernel');
    Cashier_Factory = await ethers.getContractFactory('Cashier');
    BosonRouter_Factory = await ethers.getContractFactory('BosonRouter');
    TokenRegistry_Factory = await ethers.getContractFactory('TokenRegistry');
    MockBosonRouter_Factory = await ethers.getContractFactory(
      'MockBosonRouter'
    );
    MockERC20Permit_Factory = await ethers.getContractFactory(
      'MockERC20Permit'
    );
    MockERC721Receiver_Factory = await ethers.getContractFactory(
      'MockERC721Receiver'
    );

    await setPeriods();
  });

  let contractVoucherSets: VoucherSets,
    contractVouchers: Vouchers,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractBSNTokenPrice: MockERC20Permit,
    contractBSNTokenDeposit: MockERC20Permit,
    contractTokenRegistry: TokenRegistry,
    contractMockERC721Receiver: MockERC721Receiver,
    contractMockBosonRouter: MockBosonRouter;

  const deadline = toWei(1);

  let timestamp;

  let distributedAmounts = {
    buyerAmount: BN(0),
    sellerAmount: BN(0),
    escrowAmount: BN(0),
  };

  async function setPeriods() {
    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;
  }

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

    contractMockERC721Receiver =
      (await MockERC721Receiver_Factory.deploy()) as Contract &
        MockERC721Receiver;

    await contractTokenRegistry.deployed();
    await contractVoucherSets.deployed();
    await contractVouchers.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();
    await contractMockERC721Receiver.deployed();
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

    // calculate expected tokenSupplyID for first voucher
    promiseId = keccak256(
      solidityPack(
        ['address', 'uint256', 'uint256', 'uint256', 'address'],
        [
          users.seller.address,
          constants.ZERO,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          contractVoucherKernel.address,
        ]
      )
    );

    // calculate expected tokenSupplyID for first voucher
    const tokenIndex = constants.ONE;
    const TYPE_NF_BIT = constants.ONE.shl(255);
    tokenSupplyKey = TYPE_NF_BIT.or(tokenIndex.shl(128)).toString();
  }

  describe('TOKEN SUPPLY CREATION (Voucher batch creation)', () => {
    const vouchersToBuy = 5;

    const paymentMethods = {
      ETHETH: 0,
      ETHTKN: 1,
      TKNETH: 2,
      TKNTKN: 3,
    };

    describe('ETHETH', () => {
      beforeEach(async () => {
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

      it('All expected events are emitted', async () => {
        expect(
          await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_10,
            true
          )
        )
          .to.emit(contractBosonRouter, eventNames.LOG_ORDER_CREATED)
          .withArgs(
            tokenSupplyKey,
            users.seller.address,
            constants.QTY_10,
            paymentMethods.ETHETH
          )
          .to.emit(contractVoucherKernel, eventNames.LOG_PROMISE_CREATED)
          .withArgs(
            promiseId,
            constants.ONE,
            users.seller.address,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.ZERO
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            constants.ZERO_ADDRESS,
            users.seller.address,
            tokenSupplyKey,
            constants.QTY_10
          );
      });

      describe('After creation', () => {
        beforeEach(async () => {
          await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_10
          );
        });

        describe('Voucher Kernel state', () => {
          it('Promise info is correct', async () => {
            const promiseData = await contractVoucherKernel.getPromiseData(
              promiseId
            );
            assert.equal(
              promiseData[constants.PROMISE_DATA_FIELDS.promiseId],
              promiseId,
              'Promise Id incorrect'
            );

            assert.equal(
              promiseData[constants.PROMISE_DATA_FIELDS.nonce].toString(),
              constants.ONE.toString(),
              'Promise data field -> nonce is incorrect'
            );
            assert.equal(
              promiseData[constants.PROMISE_DATA_FIELDS.validFrom].toString(),
              constants.PROMISE_VALID_FROM.toString(),
              'Promise data field -> validFrom is incorrect'
            );

            assert.equal(
              promiseData[constants.PROMISE_DATA_FIELDS.validTo].toString(),
              constants.PROMISE_VALID_TO.toString(),
              'Promise data field -> validTo is incorrect'
            );
            assert.equal(
              promiseData[constants.PROMISE_DATA_FIELDS.idx].toString(),
              constants.ZERO.toString(),
              'Promise data field -> idx is incorrect'
            );

            const promiseSeller = await contractVoucherKernel.getSupplyHolder(
              tokenSupplyKey
            );

            assert.strictEqual(
              promiseSeller,
              users.seller.address,
              'Seller incorrect'
            );

            const promiseOrderData = await contractVoucherKernel.getOrderCosts(
              tokenSupplyKey
            );
            assert.isTrue(
              promiseOrderData[constants.PROMISE_ORDER_FIELDS.price].eq(
                BN(constants.PROMISE_PRICE1)
              ),
              'Promise product price mismatch'
            );
            assert.isTrue(
              promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
                BN(constants.PROMISE_DEPOSITSE1)
              ),
              'Promise seller deposit mismatch'
            );
            assert.isTrue(
              promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
                BN(constants.PROMISE_DEPOSITBU1)
              ),
              'Promise buyer deposit mismatch'
            );

            const tokenNonce = await contractVoucherKernel.getTokenNonce(
              users.seller.address
            );

            assert.isTrue(
              tokenNonce.eq(constants.ONE.toString()),
              'Voucher kernel nonce mismatch'
            );

            assert.equal(
              promiseId,
              await contractVoucherKernel.getPromiseIdFromSupplyId(
                tokenSupplyKey
              ),
              'PromiseId mismatch'
            );
          });

          it('Should create payment method ETHETH', async () => {
            expect(
              await contractVoucherKernel.getVoucherPaymentMethod(
                tokenSupplyKey
              )
            ).to.equal(
              paymentMethods.ETHETH,
              'Payment Method ETHETH not set correctly'
            );
          });

          it('Deposit and Price address should be constants.ZERO', async () => {
            expect(
              await contractVoucherKernel.getVoucherPriceToken(tokenSupplyKey)
            ).to.equal(
              constants.ZERO_ADDRESS,
              'ETHETH Method Price Token Address mismatch'
            );

            expect(
              await contractVoucherKernel.getVoucherDepositToken(tokenSupplyKey)
            ).to.equal(
              constants.ZERO_ADDRESS,
              'ETHETH Method Deposit Token Address mismatch'
            );
          });
        });

        it('Voucher Sets token state is correct', async () => {
          const sellerVoucherSetTokenBalance = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.seller.address,
              tokenSupplyKey
            )
          )[0];

          assert.isTrue(
            sellerVoucherSetTokenBalance.eq(constants.QTY_10),
            'Voucher Set token seller balance mismatch'
          );
        });

        it('ESCROW has correct balance', async () => {
          const expectedBalance = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          expect(
            await ethers.provider.getBalance(contractCashier.address)
          ).to.equal(expectedBalance, 'Escrow balance is incorrect');
          expect(
            await contractCashier.getEscrowAmount(users.seller.address)
          ).to.equal(expectedBalance, 'Escrow stored amount is incorrect');
        });

        it('Get correct remaining qty for supply', async () => {
          expect(
            await contractVoucherKernel.getRemQtyForSupply(
              tokenSupplyKey,
              users.seller.address
            )
          ).to.equal(constants.QTY_10, 'Remaining qty is not correct');

          for (let i = 0; i < vouchersToBuy; i++) {
            await utils.commitToBuy(
              users.buyer,
              users.seller,
              tokenSupplyKey,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1
            );
            expect(
              await contractVoucherKernel.getRemQtyForSupply(
                tokenSupplyKey,
                users.seller.address
              )
            ).to.equal(
              constants.QTY_10 - i - 1,
              `Remaining qty is not correct [${i}]`
            );
          }
        });
      });

      it('It should be possible to create Order with 0 buyer deposit', async () => {
        await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.ZERO,
          constants.QTY_10,
          true
        );
        const promiseOrderData = await contractVoucherKernel.getOrderCosts(
          tokenSupplyKey
        );
        assert.isTrue(
          promiseOrderData[constants.PROMISE_ORDER_FIELDS.price].eq(
            BN(constants.PROMISE_PRICE1)
          ),
          'Promise product price mismatch'
        );

        assert.isTrue(
          promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
            BN(constants.PROMISE_DEPOSITSE1)
          ),
          'Promise seller deposit mismatch'
        );
        assert.isTrue(
          promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
            BN(constants.ZERO)
          ),
          'Promise buyer deposit mismatch'
        );
      });

      it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
        await expect(
          utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_FROM + constants.ONE_MINUTE,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_10
          )
        ).to.be.revertedWith(revertReasons.INVALID_VALIDITY_TO);
      });

      it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
        await expect(
          utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_FROM + constants.ONE_MINUTE,
            constants.ABOVE_ETH_LIMIT,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.ONE,
            true
          )
        ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
      });

      it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
        await expect(
          utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_FROM + constants.ONE_MINUTE,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.ABOVE_ETH_LIMIT,
            constants.ONE,
            true
          )
        ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
      });

      it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
        await expect(
          utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_FROM + constants.ONE_MINUTE,
            constants.PROMISE_PRICE1,
            constants.ABOVE_ETH_LIMIT,
            constants.PROMISE_DEPOSITBU1,
            constants.ONE,
            true
          )
        ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
      });

      it('[NEGATIVE] Should not create a supply if quantity is zero', async () => {
        await expect(
          utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.ZERO,
            true
          )
        ).to.be.revertedWith(revertReasons.INVALID_QUANTITY_LONG);
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', () => {
        beforeEach(async () => {
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

          const tokensToMint = BN(constants.seller_deposit).mul(
            BN(constants.QTY_20)
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

        it('All expected events are emitted', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
              true
            )
          )
            .to.emit(contractBosonRouter, eventNames.LOG_ORDER_CREATED)
            .withArgs(
              tokenSupplyKey,
              users.seller.address,
              constants.QTY_10,
              paymentMethods.ETHTKN
            )
            .to.emit(contractVoucherKernel, eventNames.LOG_PROMISE_CREATED)
            .withArgs(
              promiseId,
              constants.ONE,
              users.seller.address,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.ZERO
            )
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              constants.ZERO_ADDRESS,
              users.seller.address,
              tokenSupplyKey,
              constants.QTY_10
            );
        });

        describe('After creation', () => {
          beforeEach(async () => {
            await utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10
            );
          });

          describe('Voucher Kernel state', () => {
            it('Promise info is correct', async () => {
              const promiseData = await contractVoucherKernel.getPromiseData(
                promiseId
              );
              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.promiseId],
                promiseId,
                'Promise Id incorrect'
              );

              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.nonce].toString(),
                constants.ONE.toString(),
                'Promise data field -> nonce is incorrect'
              );
              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.validFrom].toString(),
                constants.PROMISE_VALID_FROM.toString(),
                'Promise data field -> validFrom is incorrect'
              );

              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.validTo].toString(),
                constants.PROMISE_VALID_TO.toString(),
                'Promise data field -> validTo is incorrect'
              );
              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.idx].toString(),
                constants.ZERO.toString(),
                'Promise data field -> idx is incorrect'
              );

              const promiseSeller = await contractVoucherKernel.getSupplyHolder(
                tokenSupplyKey
              );

              assert.strictEqual(
                promiseSeller,
                users.seller.address,
                'Seller incorrect'
              );

              const promiseOrderData =
                await contractVoucherKernel.getOrderCosts(tokenSupplyKey);
              assert.isTrue(
                promiseOrderData[constants.PROMISE_ORDER_FIELDS.price].eq(
                  BN(constants.PROMISE_PRICE1)
                ),
                'Promise product price mismatch'
              );
              assert.isTrue(
                promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
                  BN(constants.PROMISE_DEPOSITSE1)
                ),
                'Promise seller deposit mismatch'
              );
              assert.isTrue(
                promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
                  BN(constants.PROMISE_DEPOSITBU1)
                ),
                'Promise buyer deposit mismatch'
              );

              const tokenNonce = await contractVoucherKernel.getTokenNonce(
                users.seller.address
              );

              assert.isTrue(
                tokenNonce.eq(constants.ONE),
                'Voucher kernel nonce mismatch'
              );

              assert.equal(
                promiseId,
                await contractVoucherKernel.getPromiseIdFromSupplyId(
                  tokenSupplyKey
                ),
                'PromiseId mismatch'
              );
            });

            it('Should create payment method ETHTKN', async () => {
              expect(
                await contractVoucherKernel.getVoucherPaymentMethod(
                  tokenSupplyKey
                )
              ).to.equal(
                paymentMethods.ETHTKN,
                'Payment Method ETHTKN not set correctly'
              );
            });

            it('Deposit contract should be correct and Price address should be constants.ZERO', async () => {
              expect(
                await contractVoucherKernel.getVoucherPriceToken(tokenSupplyKey)
              ).to.equal(
                constants.ZERO_ADDRESS,
                'ETHTKN Method Price Token Address mismatch'
              );

              expect(
                await contractVoucherKernel.getVoucherDepositToken(
                  tokenSupplyKey
                )
              ).to.equal(
                contractBSNTokenDeposit.address,
                'ETHTKN Method Deposit Token Address mismatch'
              );
            });
          });

          it('Voucher Sets token state is correct', async () => {
            const sellerVoucherSetTokenBalance = (
              await contractVoucherSets.functions[fnSignatures.balanceOf1155](
                users.seller.address,
                tokenSupplyKey
              )
            )[0];

            assert.isTrue(
              sellerVoucherSetTokenBalance.eq(constants.QTY_10),
              'Voucher Set token seller balance mismatch'
            );
          });

          it('Cashier has correct balance in Deposit Contract', async () => {
            const expectedBalance = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(constants.QTY_10)
            );
            expect(
              await contractBSNTokenDeposit.balanceOf(contractCashier.address)
            ).to.equal(expectedBalance, 'Escrow amount is incorrect');
          });

          it('escrowTokens has correct balance', async () => {
            const expectedBalance = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(constants.QTY_10)
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
            expect(
              await contractVoucherKernel.getRemQtyForSupply(
                tokenSupplyKey,
                users.seller.address
              )
            ).to.equal(constants.QTY_10, 'Remaining qty is not correct');

            for (let i = 0; i < vouchersToBuy; i++) {
              await utils.commitToBuy(
                users.buyer,
                users.seller,
                tokenSupplyKey,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITBU1
              );
              expect(
                await contractVoucherKernel.getRemQtyForSupply(
                  tokenSupplyKey,
                  users.seller.address
                )
              ).to.equal(
                constants.QTY_10 - i - 1,
                `Remaining qty is not correct [${i}]`
              );
            }
          });
        });

        it('It should be possible to create Order with 0 buyer deposit', async () => {
          await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.ZERO,
            constants.QTY_10,
            true
          );
          const promiseOrderData = await contractVoucherKernel.getOrderCosts(
            tokenSupplyKey
          );
          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.price].eq(
              BN(constants.PROMISE_PRICE1)
            ),
            'Promise product price mismatch'
          );

          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
              BN(constants.PROMISE_DEPOSITSE1)
            ),
            'Promise seller deposit mismatch'
          );
          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
              BN(constants.ZERO)
            ),
            'Promise buyer deposit mismatch'
          );
        });

        it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_FROM + constants.ONE_MINUTE,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10
            )
          ).to.be.revertedWith(revertReasons.INVALID_VALIDITY_TO);
        });

        it('[NEGATIVE] Should revert if token deposit contract address is constants.ZERO address', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(constants.ONE));
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

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderETHTKNWithPermit(
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
              ]
            )
          ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
        });

        it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.ABOVE_ETH_LIMIT,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
              true
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.ABOVE_TOKEN_LIMIT,
              constants.QTY_10,
              true
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.ABOVE_TOKEN_LIMIT,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
              true
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if quantity is zero', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.ZERO,
              true
            )
          ).to.be.revertedWith(revertReasons.INVALID_QUANTITY_LONG);
        });

        it('[NEGATIVE] Should revert if wrong amount of tokens sent', async () => {
          const txValue = BN(constants.PROMISE_DEPOSITSE1)
            .mul(BN(constants.QTY_10))
            .div(2);
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

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );
          await expect(
            sellerInstance.requestCreateOrderETHTKNWithPermit(
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
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ]
            )
          ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
        });
      });

      describe('TKNETH', () => {
        beforeEach(async () => {
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
              contractBSNTokenDeposit
            );

          const tokensToMint = BN(constants.product_price).mul(
            BN(constants.QTY_10)
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMint
          );
        });

        it('All expected events are emitted', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
              true
            )
          )
            .to.emit(contractBosonRouter, eventNames.LOG_ORDER_CREATED)
            .withArgs(
              tokenSupplyKey,
              users.seller.address,
              constants.QTY_10,
              paymentMethods.TKNETH
            )
            .to.emit(contractVoucherKernel, eventNames.LOG_PROMISE_CREATED)
            .withArgs(
              promiseId,
              constants.ONE,
              users.seller.address,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.ZERO
            )
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              constants.ZERO_ADDRESS,
              users.seller.address,
              tokenSupplyKey,
              constants.QTY_10
            );
        });

        describe('After creation', () => {
          beforeEach(async () => {
            await utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10
            );
          });

          describe('Voucher Kernel state', () => {
            it('Promise info is correct', async () => {
              const promiseData = await contractVoucherKernel.getPromiseData(
                promiseId
              );
              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.promiseId],
                promiseId,
                'Promise Id incorrect'
              );

              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.nonce].toString(),
                constants.ONE.toString(),
                'Promise data field -> nonce is incorrect'
              );
              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.validFrom].toString(),
                constants.PROMISE_VALID_FROM.toString(),
                'Promise data field -> validFrom is incorrect'
              );

              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.validTo].toString(),
                constants.PROMISE_VALID_TO.toString(),
                'Promise data field -> validTo is incorrect'
              );
              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.idx].toString(),
                constants.ZERO.toString(),
                'Promise data field -> idx is incorrect'
              );

              const promiseSeller = await contractVoucherKernel.getSupplyHolder(
                tokenSupplyKey
              );

              assert.strictEqual(
                promiseSeller,
                users.seller.address,
                'Seller incorrect'
              );

              const promiseOrderData =
                await contractVoucherKernel.getOrderCosts(tokenSupplyKey);
              assert.isTrue(
                promiseOrderData[constants.PROMISE_ORDER_FIELDS.price].eq(
                  BN(constants.PROMISE_PRICE1)
                ),
                'Promise product price mismatch'
              );
              assert.isTrue(
                promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
                  BN(constants.PROMISE_DEPOSITSE1)
                ),
                'Promise seller deposit mismatch'
              );
              assert.isTrue(
                promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
                  BN(constants.PROMISE_DEPOSITBU1)
                ),
                'Promise buyer deposit mismatch'
              );

              const tokenNonce = await contractVoucherKernel.getTokenNonce(
                users.seller.address
              );

              assert.isTrue(
                tokenNonce.eq(constants.ONE.toString()),
                'Voucher kernel nonce mismatch'
              );

              assert.equal(
                promiseId,
                await contractVoucherKernel.getPromiseIdFromSupplyId(
                  tokenSupplyKey
                ),
                'PromiseId mismatch'
              );
            });

            it('Should create payment method TKNETH', async () => {
              expect(
                await contractVoucherKernel.getVoucherPaymentMethod(
                  tokenSupplyKey
                )
              ).to.equal(
                paymentMethods.TKNETH,
                'Payment Method TKNETH not set correctly'
              );
            });

            it('Price address should be correct and Deposit should be constants.ZERO', async () => {
              expect(
                await contractVoucherKernel.getVoucherPriceToken(tokenSupplyKey)
              ).to.equal(
                contractBSNTokenPrice.address,
                'TKNETH Method Price Token Address mismatch'
              );

              expect(
                await contractVoucherKernel.getVoucherDepositToken(
                  tokenSupplyKey
                )
              ).to.equal(
                constants.ZERO_ADDRESS,
                'TKNETH Method Deposit Token Address mismatch'
              );
            });
          });

          it('Voucher Sets token state is correct', async () => {
            const sellerVoucherSetTokenBalance = (
              await contractVoucherSets.functions[fnSignatures.balanceOf1155](
                users.seller.address,
                tokenSupplyKey
              )
            )[0];

            assert.isTrue(
              sellerVoucherSetTokenBalance.eq(constants.QTY_10),
              'Voucher Set token seller balance mismatch'
            );
          });

          it('ESCROW has correct balance', async () => {
            const expectedBalance = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(constants.QTY_10)
            );

            expect(
              await ethers.provider.getBalance(contractCashier.address)
            ).to.equal(expectedBalance, 'Escrow balance is incorrect');
            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.equal(expectedBalance, 'Escrow stored amount is incorrect');
          });

          it('Get correct remaining qty for supply', async () => {
            expect(
              await contractVoucherKernel.getRemQtyForSupply(
                tokenSupplyKey,
                users.seller.address
              )
            ).to.equal(constants.QTY_10, 'Remaining qty is not correct');

            for (let i = 0; i < vouchersToBuy; i++) {
              await utils.commitToBuy(
                users.buyer,
                users.seller,
                tokenSupplyKey,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITBU1
              );
              expect(
                await contractVoucherKernel.getRemQtyForSupply(
                  tokenSupplyKey,
                  users.seller.address
                )
              ).to.equal(
                constants.QTY_10 - i - 1,
                `Remaining qty is not correct [${i}]`
              );
            }
          });
        });

        it('It should be possible to create Order with 0 buyer deposit', async () => {
          await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.ZERO,
            constants.QTY_10,
            true
          );
          const promiseOrderData = await contractVoucherKernel.getOrderCosts(
            tokenSupplyKey
          );
          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.price].eq(
              BN(constants.PROMISE_PRICE1)
            ),
            'Promise product price mismatch'
          );

          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
              BN(constants.PROMISE_DEPOSITSE1)
            ),
            'Promise seller deposit mismatch'
          );
          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
              BN(constants.ZERO)
            ),
            'Promise buyer deposit mismatch'
          );
        });

        it('[NEGATIVE] Should fail if token price contract is constants.ZERO address', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNETH(constants.ZERO_ADDRESS, [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.seller_deposit,
              constants.PROMISE_DEPOSITBU1,
              constants.ORDER_QUANTITY1,
            ])
          ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
        });

        it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.ABOVE_TOKEN_LIMIT,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
              true
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.ABOVE_TOKEN_LIMIT,
              constants.QTY_10,
              true
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.ABOVE_ETH_LIMIT,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
              true
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if quantity is zero', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.ZERO,
              true
            )
          ).to.be.revertedWith(revertReasons.INVALID_QUANTITY_LONG);
        });
      });

      describe('TKNTKN', () => {
        beforeEach(async () => {
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

          const tokensToMint = BN(constants.product_price).mul(
            BN(constants.QTY_20)
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

        it('All expected events are emitted', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
              true
            )
          )
            .to.emit(contractBosonRouter, eventNames.LOG_ORDER_CREATED)
            .withArgs(
              tokenSupplyKey,
              users.seller.address,
              constants.QTY_10,
              paymentMethods.TKNTKN
            )
            .to.emit(contractVoucherKernel, eventNames.LOG_PROMISE_CREATED)
            .withArgs(
              promiseId,
              constants.ONE,
              users.seller.address,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.ZERO
            )
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              constants.ZERO_ADDRESS,
              users.seller.address,
              tokenSupplyKey,
              constants.QTY_10
            );
        });

        describe('After creation', () => {
          beforeEach(async () => {
            await utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10
            );
          });

          describe('Voucher Kernel state', () => {
            it('Promise info is correct', async () => {
              const promiseData = await contractVoucherKernel.getPromiseData(
                promiseId
              );
              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.promiseId],
                promiseId,
                'Promise Id incorrect'
              );

              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.nonce].toString(),
                constants.ONE.toString(),
                'Promise data field -> nonce is incorrect'
              );
              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.validFrom].toString(),
                constants.PROMISE_VALID_FROM.toString(),
                'Promise data field -> validFrom is incorrect'
              );

              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.validTo].toString(),
                constants.PROMISE_VALID_TO.toString(),
                'Promise data field -> validTo is incorrect'
              );
              assert.equal(
                promiseData[constants.PROMISE_DATA_FIELDS.idx].toString(),
                constants.ZERO.toString(),
                'Promise data field -> idx is incorrect'
              );

              const promiseSeller = await contractVoucherKernel.getSupplyHolder(
                tokenSupplyKey
              );

              assert.strictEqual(
                promiseSeller,
                users.seller.address,
                'Seller incorrect'
              );

              const promiseOrderData =
                await contractVoucherKernel.getOrderCosts(tokenSupplyKey);
              assert.isTrue(
                promiseOrderData[constants.PROMISE_ORDER_FIELDS.price].eq(
                  BN(constants.PROMISE_PRICE1)
                ),
                'Promise product price mismatch'
              );
              assert.isTrue(
                promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
                  BN(constants.PROMISE_DEPOSITSE1)
                ),
                'Promise seller deposit mismatch'
              );
              assert.isTrue(
                promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
                  BN(constants.PROMISE_DEPOSITBU1)
                ),
                'Promise buyer deposit mismatch'
              );

              const tokenNonce = await contractVoucherKernel.getTokenNonce(
                users.seller.address
              );

              assert.isTrue(
                tokenNonce.eq(constants.ONE.toString()),
                'Voucher kernel nonce mismatch'
              );

              assert.equal(
                promiseId,
                await contractVoucherKernel.getPromiseIdFromSupplyId(
                  tokenSupplyKey
                ),
                'PromiseId mismatch'
              );
            });

            it('Should create payment method ETHETH', async () => {
              expect(
                await contractVoucherKernel.getVoucherPaymentMethod(
                  tokenSupplyKey
                )
              ).to.equal(
                paymentMethods.TKNTKN,
                'Payment Method TKNTKN not set correctly'
              );
            });

            it('Deposit and Price address should be correctly set', async () => {
              expect(
                await contractVoucherKernel.getVoucherPriceToken(tokenSupplyKey)
              ).to.equal(
                contractBSNTokenPrice.address,
                'TKNTKN Method Price Token Address mismatch'
              );

              expect(
                await contractVoucherKernel.getVoucherDepositToken(
                  tokenSupplyKey
                )
              ).to.equal(
                contractBSNTokenDeposit.address,
                'TKNTKN Method Deposit Token Address mismatch'
              );
            });
          });

          it('Voucher Sets token state is correct', async () => {
            const sellerVoucherSetTokenBalance = (
              await contractVoucherSets.functions[fnSignatures.balanceOf1155](
                users.seller.address,
                tokenSupplyKey
              )
            )[0];

            assert.isTrue(
              sellerVoucherSetTokenBalance.eq(constants.QTY_10),
              'Voucher Set token seller balance mismatch'
            );
          });

          it('Cashier has correct balance in Deposit Contract', async () => {
            // REWRITE
            const expectedBalance = BN(constants.PROMISE_DEPOSITSE1).mul(
              constants.QTY_10
            );

            expect(
              await contractBSNTokenDeposit.balanceOf(contractCashier.address)
            ).to.equal(expectedBalance, 'Escrow amount is incorrect');
          });

          it('escrowTokens has correct balance', async () => {
            const expectedBalance = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(constants.QTY_10)
            );

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.seller.address
              )
            ).to.equal(expectedBalance, 'Escrow amount is incorrect');
          });

          it('Get correct remaining qty for supply', async () => {
            expect(
              await contractVoucherKernel.getRemQtyForSupply(
                tokenSupplyKey,
                users.seller.address
              )
            ).to.equal(constants.QTY_10, 'Remaining qty is not correct');

            for (let i = 0; i < vouchersToBuy; i++) {
              await utils.commitToBuy(
                users.buyer,
                users.seller,
                tokenSupplyKey,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITBU1
              );
              expect(
                await contractVoucherKernel.getRemQtyForSupply(
                  tokenSupplyKey,
                  users.seller.address
                )
              ).to.equal(
                constants.QTY_10 - i - 1,
                `Remaining qty is not correct [${i}]`
              );
            }
          });
        });

        it('It should be possible to create Order with 0 buyer deposit', async () => {
          await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.ZERO,
            constants.QTY_10,
            true
          );
          const promiseOrderData = await contractVoucherKernel.getOrderCosts(
            tokenSupplyKey
          );
          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.price].eq(
              BN(constants.PROMISE_PRICE1)
            ),
            'Promise product price mismatch'
          );

          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
              BN(constants.PROMISE_DEPOSITSE1)
            ),
            'Promise seller deposit mismatch'
          );
          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
              BN(constants.ZERO)
            ),
            'Promise buyer deposit mismatch'
          );
        });

        it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_FROM + constants.ONE_MINUTE,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10
            )
          ).to.be.revertedWith(revertReasons.INVALID_VALIDITY_TO);
        });

        it('[NEGATIVE] Should revert if token price contract address is constants.ZERO address', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(constants.ONE));
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

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNTKNWithPermit(
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
              ]
            )
          ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
        });

        it('[NEGATIVE] Should revert if token deposit contract address is constants.ZERO address', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(constants.ONE));
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

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNTKNWithPermit(
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
              ]
            )
          ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
        });

        it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.ABOVE_TOKEN_LIMIT,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
              true
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.ABOVE_TOKEN_LIMIT,
              constants.QTY_10,
              true
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.ABOVE_TOKEN_LIMIT,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
              true
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if quantity is zero', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.ZERO,
              true
            )
          ).to.be.revertedWith(revertReasons.INVALID_QUANTITY_LONG);
        });

        it('[NEGATIVE] Should revert if wrong amount of tokens sent', async () => {
          const txValue = BN(constants.PROMISE_DEPOSITSE1)
            .mul(BN(constants.QTY_10))
            .div(2);
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

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );
          await expect(
            sellerInstance.requestCreateOrderTKNTKNWithPermit(
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
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ]
            )
          ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
        });
      });
    });
  });

  describe('TOKEN SUPPLY CANCELLATION', () => {
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

      timestamp = await Utils.getCurrTimestamp();

      tokenSupplyKey = await utils.createOrder(
        users.seller,
        timestamp,
        timestamp + constants.SECONDS_IN_DAY,
        constants.PROMISE_PRICE1,
        constants.seller_deposit,
        constants.PROMISE_DEPOSITBU1,
        constants.QTY_10
      );
    });

    it('Should process supply/voucher set cancellation properly', async () => {
      const sellerBalanceBefore = await users.seller.signer.getBalance(
        'latest'
      );

      const quantityBefore = await contractVoucherKernel.getRemQtyForSupply(
        tokenSupplyKey,
        users.seller.address
      );

      assert.isTrue(quantityBefore.eq(constants.QTY_10));

      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      const tx = await sellerInstance.requestCancelOrFaultVoucherSet(
        tokenSupplyKey
      );
      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherSets_Factory,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev.operator == contractVoucherKernel.address);
          assert.isTrue(ev.from === users.seller.address);
          assert.isTrue(ev.to === constants.ZERO_ADDRESS);
          assert.isTrue(ev.id == tokenSupplyKey);
          assert.isTrue(ev.value == constants.QTY_10);
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_CANCEL_VOUCHER_SET,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.eq(tokenSupplyKey));
          assert.isTrue(ev._issuer === users.seller.address);
        }
      );

      const sellerDeposit = BN(constants.seller_deposit).mul(
        BN(constants.QTY_10)
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        Cashier_Factory,
        eventNames.LOG_WITHDRAWAL,
        (ev) => {
          assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
          assert.isTrue(ev._payment.eq(sellerDeposit), 'Payment incorrect');
        }
      );

      const txCost = tx.gasPrice.mul(txReceipt.gasUsed);
      const expectedSellerBalance = sellerBalanceBefore
        .add(sellerDeposit)
        .sub(txCost);
      const sellerBalanceAfter = await users.seller.signer.getBalance('latest');

      assert.isTrue(
        expectedSellerBalance.eq(sellerBalanceAfter),
        'Seller balance incorrect'
      );
    });
  });

  describe('VOUCHER CREATION (Commit to buy)', () => {
    const ORDER_QTY = 5;
    let TOKEN_SUPPLY_ID;

    // calculate expected tokenSupplyID for first voucher
    const tokenIndex = constants.ONE;
    const TYPE_NF_BIT = constants.ONE.shl(255);
    tokenSupplyKey = TYPE_NF_BIT.or(tokenIndex.shl(128)).toString();

    const voucherTokenId = BN(tokenSupplyKey).or(constants.ONE);

    describe('ETHETH', () => {
      beforeEach(async () => {
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

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        );
      });

      it('Should create order', async () => {
        await expect(
          utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1,
            true
          )
        )
          .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
          .withArgs(
            tokenSupplyKey,
            voucherTokenId,
            users.seller.address,
            users.buyer.address,
            promiseId
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            users.seller.address,
            constants.ZERO,
            tokenSupplyKey,
            constants.ONE
          )
          .to.emit(contractVouchers, eventNames.TRANSFER)
          .withArgs(constants.ZERO, users.buyer.address, voucherTokenId);
      });

      describe('After request', () => {
        beforeEach(async () => {
          await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );
        });

        it('Voucher Kernel state is correct', async () => {
          const voucherStatus = await contractVoucherKernel.getVoucherStatus(
            voucherTokenId
          );

          const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

          assert.equal(
            voucherStatus[0],
            expectedStatus.toNumber(),
            'Wrong status'
          );
          assert.isFalse(voucherStatus[1], 'Payment should not be released');
          assert.isFalse(voucherStatus[2], 'Deposit should not be released');
          assert.isTrue(
            voucherStatus[3].eq(constants.ZERO),
            'Complaint period should not started yet'
          );
          assert.isTrue(
            voucherStatus[4].eq(constants.ZERO),
            'COF period should not started yet'
          );
        });

        it('Voucher Sets and Vouchers token state is correct', async () => {
          const sellerVoucherSetTokenBalance = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.seller.address,
              TOKEN_SUPPLY_ID
            )
          )[0];

          assert.isTrue(
            sellerVoucherSetTokenBalance.eq(constants.QTY_10 - 1),
            'Voucher Set token seller balance mismatch'
          );

          const buyerERC721Balance = (
            await contractVouchers.functions[fnSignatures.balanceOf721](
              users.buyer.address
            )
          )[0];

          assert.isTrue(
            buyerERC721Balance.eq(constants.ONE),
            'Buyer 721 balance mismatch'
          );

          expect(await contractVouchers.ownerOf(voucherTokenId)).to.equal(
            users.buyer.address,
            'Owner address mismatch'
          );
        });

        it('Cashier Contract has correct amount of funds', async () => {
          const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );
          const buyerETHSent = BN(constants.PROMISE_PRICE1).add(
            BN(constants.PROMISE_DEPOSITBU1)
          );
          const expectedBalance = sellerDeposits.add(buyerETHSent);

          expect(
            await ethers.provider.getBalance(contractCashier.address)
          ).to.equal(expectedBalance, 'Escrow amount is incorrect');
        });

        it('Escrow should be updated', async () => {
          const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );
          const buyerETHSent = BN(constants.PROMISE_PRICE1).add(
            BN(constants.PROMISE_DEPOSITBU1)
          );

          expect(
            await contractCashier.getEscrowAmount(users.seller.address)
          ).to.equal(sellerDeposits, 'Seller escrow amount is incorrect');

          expect(
            await contractCashier.getEscrowAmount(users.buyer.address)
          ).to.equal(buyerETHSent, 'Buyer escrow amount is incorrect');
        });
      });

      it('It should be possible to request voucher with 0 buyer deposit', async () => {
        const TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.ZERO,
          ORDER_QTY
        );

        await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.ZERO
        );

        const voucherTokenId = BN(TOKEN_SUPPLY_ID).or(constants.ONE);

        const voucherStatus = await contractVoucherKernel.getVoucherStatus(
          voucherTokenId
        );

        const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

        assert.equal(
          voucherStatus[0],
          expectedStatus.toNumber(),
          'Wrong status'
        );
      });

      it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
        contractMockBosonRouter = (await MockBosonRouter_Factory.deploy(
          contractVoucherKernel.address,
          contractTokenRegistry.address,
          contractCashier.address
        )) as Contract & MockBosonRouter;

        await contractMockBosonRouter.deployed();

        //Set mock so that passing wrong payment type from requestCreateOrderETHETH to createPaymentMethod can be tested
        await contractBosonRouter.pause();
        await contractVoucherKernel.setBosonRouterAddress(
          contractMockBosonRouter.address
        );

        await contractCashier.setBosonRouterAddress(
          contractMockBosonRouter.address
        );

        // To unpause Cashier and VoucherKernel unpause must be called on the new router
        // To call unpause, router must be in paused state, so pause should be called first
        await contractMockBosonRouter.pause();
        await contractMockBosonRouter.unpause();

        const utilsTknEth = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNETH()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
            contractVoucherKernel,
            contractCashier,
            contractMockBosonRouter,
            contractBSNTokenPrice,
            contractBSNTokenDeposit
          );

        await expect(
          utilsTknEth.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          )
        ).to.be.revertedWith(revertReasons.RUNTIME_ERROR_INVALID_OPCODE);
      });

      it('[NEGATIVE] Should not create order with incorrect price', async () => {
        await expect(
          utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.incorrect_product_price,
            constants.PROMISE_DEPOSITBU1
          )
        ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
      });

      it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
        await expect(
          utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.PROMISE_PRICE1,
            constants.buyer_incorrect_deposit
          )
        ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', async () => {
        beforeEach(async () => {
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

          const tokensToMintSeller = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(ORDER_QTY)
          );
          const tokensToMintBuyer = BN(constants.PROMISE_DEPOSITBU1).mul(
            BN(ORDER_QTY)
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
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            ORDER_QTY
          );
        });

        it('Should create order', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1,
              true
            )
          )
            .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
            .withArgs(
              tokenSupplyKey,
              voucherTokenId,
              users.seller.address,
              users.buyer.address,
              promiseId
            )
            .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
            .withArgs(
              tokenSupplyKey,
              voucherTokenId,
              users.seller.address,
              users.buyer.address,
              promiseId
            )
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              users.seller.address,
              constants.ZERO,
              tokenSupplyKey,
              constants.ONE
            )
            .to.emit(contractVouchers, eventNames.TRANSFER)
            .withArgs(constants.ZERO, users.buyer.address, voucherTokenId)
            .to.emit(contractBSNTokenDeposit, eventNames.TRANSFER)
            .withArgs(
              users.buyer.address,
              contractCashier.address,
              constants.PROMISE_DEPOSITBU1
            );
        });

        describe('After request', () => {
          beforeEach(async () => {
            await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1
            );
          });

          it('Voucher Kernel state is correct', async () => {
            const voucherStatus = await contractVoucherKernel.getVoucherStatus(
              voucherTokenId
            );

            const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

            assert.equal(
              voucherStatus[0],
              expectedStatus.toNumber(),
              'Wrong status'
            );
            assert.isFalse(voucherStatus[1], 'Payment should not be released');
            assert.isFalse(voucherStatus[2], 'Deposit should not be released');
            assert.isTrue(
              voucherStatus[3].eq(constants.ZERO),
              'Complaint period should not started yet'
            );
            assert.isTrue(
              voucherStatus[4].eq(constants.ZERO),
              'COF period should not started yet'
            );
          });

          it('Voucher Sets and Vouchers token state are correct', async () => {
            const sellerVoucherSetTokenBalance = (
              await contractVoucherSets.functions[fnSignatures.balanceOf1155](
                users.seller.address,
                TOKEN_SUPPLY_ID
              )
            )[0];

            assert.isTrue(
              sellerVoucherSetTokenBalance.eq(ORDER_QTY - 1),
              'Voucher Set token seller balance mismatch'
            );

            const buyerERC721Balance = (
              await contractVouchers.functions[fnSignatures.balanceOf721](
                users.buyer.address
              )
            )[0];

            assert.isTrue(
              buyerERC721Balance.eq(constants.ONE),
              'Buyer 721 balance mismatch'
            );

            expect(await contractVouchers.ownerOf(voucherTokenId)).to.equal(
              users.buyer.address,
              'Owner address mismatch'
            );
          });

          it('Cashier Contract has correct amount of funds', async () => {
            const expectedETHBalance = BN(constants.PROMISE_PRICE1);
            const sellerTokenDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(ORDER_QTY)
            );
            const expectedTokenBalance = BN(constants.PROMISE_DEPOSITBU1).add(
              sellerTokenDeposits
            );

            expect(
              await ethers.provider.getBalance(contractCashier.address)
            ).to.equal(expectedETHBalance, 'Escrow amount is incorrect');

            expect(
              await contractBSNTokenDeposit.balanceOf(contractCashier.address)
            ).to.equal(expectedTokenBalance, 'Escrow amount is incorrect');
          });

          it('Escrows should be updated', async () => {
            const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(ORDER_QTY)
            );
            const buyerETHSent = BN(constants.PROMISE_PRICE1);
            const buyerTKNSent = BN(constants.PROMISE_DEPOSITBU1);

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.seller.address
              )
            ).to.equal(sellerDeposits, 'Escrow amount is incorrect');

            expect(
              await contractCashier.getEscrowAmount(users.buyer.address)
            ).to.equal(buyerETHSent, 'Escrow amount is incorrect');

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.buyer.address
              )
            ).to.equal(buyerTKNSent, 'Escrow amount is incorrect');
          });
        });

        it('It should be possible to request voucher with 0 buyer deposit', async () => {
          const tokensToMintSeller = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(ORDER_QTY)
          );
          await contractBSNTokenDeposit.mint(
            users.seller.address,
            tokensToMintSeller
          );

          const TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.ZERO,
            ORDER_QTY
          );

          await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.PROMISE_PRICE1,
            constants.ZERO
          );

          const voucherTokenId = BN(TOKEN_SUPPLY_ID).or(constants.ONE);

          const voucherStatus = await contractVoucherKernel.getVoucherStatus(
            voucherTokenId
          );

          const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

          assert.equal(
            voucherStatus[0],
            expectedStatus.toNumber(),
            'Wrong status'
          );
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          const utilsEthEth = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHETH()
            .buildAsync(
              contractVoucherSets,
              contractVouchers,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await expect(
            utilsEthEth.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_PAYMENT_METHOD);
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.incorrect_product_price,
              constants.PROMISE_DEPOSITBU1
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_PRICE);
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.buyer_incorrect_deposit
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_DEPOSIT);
        });
      });

      describe('TKNTKN', () => {
        beforeEach(async () => {
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

          const tokensToMintSeller = BN(constants.seller_deposit).mul(
            BN(ORDER_QTY)
          );
          const tokensToMintBuyer = BN(constants.product_price).mul(
            BN(ORDER_QTY)
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
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            ORDER_QTY
          );
        });

        it('Should create order', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1,
              true
            )
          )
            .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
            .withArgs(
              tokenSupplyKey,
              voucherTokenId,
              users.seller.address,
              users.buyer.address,
              promiseId
            )
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              users.seller.address,
              constants.ZERO,
              tokenSupplyKey,
              constants.ONE
            )
            .to.emit(contractVouchers, eventNames.TRANSFER)
            .withArgs(constants.ZERO, users.buyer.address, voucherTokenId)
            .to.emit(contractBSNTokenDeposit, eventNames.TRANSFER)
            .withArgs(
              users.buyer.address,
              contractCashier.address,
              constants.PROMISE_DEPOSITBU1
            )
            .to.emit(contractBSNTokenPrice, eventNames.TRANSFER)
            .withArgs(
              users.buyer.address,
              contractCashier.address,
              constants.PROMISE_PRICE1
            );
        });

        describe('After request', () => {
          beforeEach(async () => {
            await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1
            );
          });

          it('Voucher Kernel state is correct', async () => {
            const voucherStatus = await contractVoucherKernel.getVoucherStatus(
              voucherTokenId
            );

            const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

            assert.equal(
              voucherStatus[0],
              expectedStatus.toNumber(),
              'Wrong status'
            );
            assert.isFalse(voucherStatus[1], 'Payment should not be released');
            assert.isFalse(voucherStatus[2], 'Deposit should not be released');
            assert.isTrue(
              voucherStatus[3].eq(constants.ZERO),
              'Complaint period should not started yet'
            );
            assert.isTrue(
              voucherStatus[4].eq(constants.ZERO),
              'COF period should not started yet'
            );
          });

          it('Voucher Sets and Vouchers token state are correct', async () => {
            const sellerVoucherSetTokenBalance = (
              await contractVoucherSets.functions[fnSignatures.balanceOf1155](
                users.seller.address,
                TOKEN_SUPPLY_ID
              )
            )[0];

            assert.isTrue(
              sellerVoucherSetTokenBalance.eq(ORDER_QTY - 1),
              'Voucher Set token seller balance mismatch'
            );

            const buyerERC721Balance = (
              await contractVouchers.functions[fnSignatures.balanceOf721](
                users.buyer.address
              )
            )[0];

            assert.isTrue(
              buyerERC721Balance.eq(constants.ONE),
              'Buyer 721 balance mismatch'
            );

            expect(await contractVouchers.ownerOf(voucherTokenId)).to.equal(
              users.buyer.address,
              'Owner address mismatch'
            );
          });

          it('Cashier Contract has correct amount of funds', async () => {
            const sellerDeposit = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(ORDER_QTY)
            );
            const expectedDepositBalance = BN(constants.PROMISE_DEPOSITBU1).add(
              sellerDeposit
            );

            expect(
              await contractBSNTokenPrice.balanceOf(contractCashier.address)
            ).to.be.equal(
              constants.PROMISE_PRICE1,
              'Escrow amount is incorrect'
            );

            expect(
              await contractBSNTokenDeposit.balanceOf(contractCashier.address)
            ).to.be.equal(expectedDepositBalance, 'Escrow amount is incorrect');
          });

          it('Escrows should be updated', async () => {
            const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(ORDER_QTY)
            );
            const buyerTknPriceSent = BN(constants.PROMISE_PRICE1);
            const buyerTknDepositSent = BN(constants.PROMISE_DEPOSITBU1);

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.seller.address
              )
            ).to.be.equal(sellerDeposits, 'Escrow amount is incorrect');

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenPrice.address,
                users.buyer.address
              )
            ).to.be.equal(buyerTknPriceSent, 'Escrow amount is incorrect');

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenDeposit.address,
                users.buyer.address
              )
            ).to.be.equal(buyerTknDepositSent, 'Escrow amount is incorrect');
          });
        });

        it('It should be possible to request voucher with 0 buyer deposit', async () => {
          const TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.ZERO,
            ORDER_QTY
          );

          await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.PROMISE_PRICE1,
            constants.ZERO
          );

          const voucherTokenId = BN(TOKEN_SUPPLY_ID).or(constants.ONE);

          const voucherStatus = await contractVoucherKernel.getVoucherStatus(
            voucherTokenId
          );

          const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

          assert.equal(
            voucherStatus[0],
            expectedStatus.toNumber(),
            'Wrong status'
          );
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          const utilsEthTkn = await UtilsBuilder.create()
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

          await expect(
            utilsEthTkn.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_PAYMENT_METHOD);
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.incorrect_product_price,
              constants.PROMISE_DEPOSITBU1
            )
          ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.buyer_incorrect_deposit
            )
          ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
        });
      });

      describe('TKNTKN Same', () => {
        const tokensToMintSeller = BN(constants.seller_deposit).mul(
          BN(ORDER_QTY)
        );
        const tokensToMintBuyer = BN(constants.product_price).mul(
          BN(ORDER_QTY)
        );

        beforeEach(async () => {
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
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            ORDER_QTY
          );
        });

        it('Should create voucher', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1,
              true
            )
          )
            .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
            .withArgs(
              tokenSupplyKey,
              voucherTokenId,
              users.seller.address,
              users.buyer.address,
              promiseId
            )
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              users.seller.address,
              constants.ZERO,
              tokenSupplyKey,
              constants.ONE
            )
            .to.emit(contractVouchers, eventNames.TRANSFER)
            .withArgs(constants.ZERO, users.buyer.address, voucherTokenId)
            .to.emit(contractBSNTokenPrice, eventNames.TRANSFER)
            .withArgs(
              users.buyer.address,
              contractCashier.address,
              BN(constants.PROMISE_PRICE1).add(constants.PROMISE_DEPOSITBU1)
            );
        });

        describe('After request', () => {
          beforeEach(async () => {
            await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1
            );
          });

          it('Voucher Kernel state is correct', async () => {
            const voucherStatus = await contractVoucherKernel.getVoucherStatus(
              voucherTokenId
            );

            const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

            assert.equal(
              voucherStatus[0],
              expectedStatus.toNumber(),
              'Wrong status'
            );
            assert.isFalse(voucherStatus[1], 'Payment should not be released');
            assert.isFalse(voucherStatus[2], 'Deposit should not be released');
            assert.isTrue(
              voucherStatus[3].eq(constants.ZERO),
              'Complaint period should not started yet'
            );
            assert.isTrue(
              voucherStatus[4].eq(constants.ZERO),
              'COF period should not started yet'
            );
          });

          it('Voucher Sets and Vouchers token state are correct', async () => {
            const sellerVoucherSetTokenBalance = (
              await contractVoucherSets.functions[fnSignatures.balanceOf1155](
                users.seller.address,
                TOKEN_SUPPLY_ID
              )
            )[0];

            assert.isTrue(
              sellerVoucherSetTokenBalance.eq(ORDER_QTY - 1),
              'Voucher Set token seller balance mismatch'
            );

            const buyerERC721Balance = (
              await contractVouchers.functions[fnSignatures.balanceOf721](
                users.buyer.address
              )
            )[0];

            assert.isTrue(
              buyerERC721Balance.eq(constants.ONE),
              'Buyer 721 balance mismatch'
            );

            expect(await contractVouchers.ownerOf(voucherTokenId)).to.equal(
              users.buyer.address,
              'Owner address mismatch'
            );
          });

          it('Cashier Contract has correct amount of funds', async () => {
            const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(ORDER_QTY)
            );
            const buyerTokensSent = BN(constants.PROMISE_PRICE1).add(
              BN(constants.PROMISE_DEPOSITBU1)
            );
            const expectedDepositBalance = buyerTokensSent.add(sellerDeposits);

            expect(
              await utils.contractBSNTokenSame.balanceOf(
                contractCashier.address
              )
            ).to.equal(expectedDepositBalance, 'Cashier amount is incorrect');
          });

          it('Escrows should be updated', async () => {
            const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(ORDER_QTY)
            );
            const buyerTknSent = BN(constants.PROMISE_PRICE1).add(
              BN(constants.PROMISE_DEPOSITBU1)
            );

            expect(
              await contractCashier.getEscrowTokensAmount(
                utils.contractBSNTokenSame.address,
                users.seller.address
              )
            ).to.equal(sellerDeposits, 'Escrow amount is incorrect');

            expect(
              await contractCashier.getEscrowTokensAmount(
                utils.contractBSNTokenSame.address,
                users.buyer.address
              )
            ).to.equal(buyerTknSent, 'Escrow amount is incorrect');
          });
        });

        it('It should be possible to request voucher with 0 buyer deposit', async () => {
          const TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.ZERO,
            ORDER_QTY
          );

          await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.PROMISE_PRICE1,
            constants.ZERO
          );

          const voucherTokenId = BN(TOKEN_SUPPLY_ID).or(constants.ONE);

          const voucherStatus = await contractVoucherKernel.getVoucherStatus(
            voucherTokenId
          );

          const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

          assert.equal(
            voucherStatus[0],
            expectedStatus.toNumber(),
            'Wrong status'
          );
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          const utilsEthEth = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHETH()
            .buildAsync(
              contractVoucherSets,
              contractVouchers,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await expect(
            utilsEthEth.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_PAYMENT_METHOD);
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.incorrect_product_price,
              constants.PROMISE_DEPOSITBU1
            )
          ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,

              constants.PROMISE_PRICE1,
              constants.buyer_incorrect_deposit
            )
          ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
        });

        it('[NEGATIVE] Should revert if Price Token and Deposit Token are diff contracts', async () => {
          //get instance with different Price token and Deposit Token addresses
          const utilsTKNTKN = await UtilsBuilder.create()
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
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            ORDER_QTY,
            false
          );

          const nonce = await utils.contractBSNTokenSame.nonces(
            users.buyer.address
          );
          const tokensToSend = BN(constants.PROMISE_PRICE1).add(
            BN(constants.PROMISE_DEPOSITBU1)
          );

          const digestTokens = await getApprovalDigest(
            utils.contractBSNTokenSame,
            users.buyer.address,
            contractBosonRouter.address,
            tokensToSend,
            nonce,
            deadline
          );

          const VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const v = VRS_TOKENS.v;
          const r = VRS_TOKENS.r;
          const s = VRS_TOKENS.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherTKNTKNSameWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              tokensToSend,
              deadline,
              v,
              r,
              s
            )
          ).to.be.revertedWith(revertReasons.TOKENS_ARE_NOT_THE_SAME);
        });
      });

      describe('TKNETH', () => {
        beforeEach(async () => {
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
              contractBSNTokenDeposit
            );

          const tokensToMintBuyer = BN(constants.PROMISE_PRICE1).mul(
            BN(ORDER_QTY)
          );

          await contractBSNTokenPrice.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            ORDER_QTY
          );
        });

        it('Should create order', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1,
              true
            )
          )
            .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
            .withArgs(
              tokenSupplyKey,
              voucherTokenId,
              users.seller.address,
              users.buyer.address,
              promiseId
            )
            .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
            .withArgs(
              contractVoucherKernel.address,
              users.seller.address,
              constants.ZERO,
              tokenSupplyKey,
              constants.ONE
            )
            .to.emit(contractVouchers, eventNames.TRANSFER)
            .withArgs(constants.ZERO, users.buyer.address, voucherTokenId)
            .to.emit(contractBSNTokenPrice, eventNames.TRANSFER)
            .withArgs(
              users.buyer.address,
              contractCashier.address,
              constants.PROMISE_PRICE1
            );
        });

        describe('After request', () => {
          beforeEach(async () => {
            await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1
            );
          });

          it('Voucher Kernel state is correct', async () => {
            const voucherStatus = await contractVoucherKernel.getVoucherStatus(
              voucherTokenId
            );

            const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

            assert.equal(
              voucherStatus[0],
              expectedStatus.toNumber(),
              'Wrong status'
            );
            assert.isFalse(voucherStatus[1], 'Payment should not be released');
            assert.isFalse(voucherStatus[2], 'Deposit should not be released');
            assert.isTrue(
              voucherStatus[3].eq(constants.ZERO),
              'Complaint period should not started yet'
            );
            assert.isTrue(
              voucherStatus[4].eq(constants.ZERO),
              'COF period should not started yet'
            );
          });

          it('Voucher Sets and Vouchers token state are correct', async () => {
            const sellerVoucherSetTokenBalance = (
              await contractVoucherSets.functions[fnSignatures.balanceOf1155](
                users.seller.address,
                TOKEN_SUPPLY_ID
              )
            )[0];

            assert.isTrue(
              sellerVoucherSetTokenBalance.eq(ORDER_QTY - 1),
              'Voucher Set token seller balance mismatch'
            );

            const buyerERC721Balance = (
              await contractVouchers.functions[fnSignatures.balanceOf721](
                users.buyer.address
              )
            )[0];

            assert.isTrue(
              buyerERC721Balance.eq(constants.ONE),
              'Buyer 721 balance mismatch'
            );

            expect(await contractVouchers.ownerOf(voucherTokenId)).to.equal(
              users.buyer.address,
              'Owner address mismatch'
            );
          });

          it('Cashier Contract has correct amount of funds', async () => {
            const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(ORDER_QTY)
            );
            const expectedDepositBalance = BN(constants.PROMISE_DEPOSITBU1).add(
              sellerDeposits
            );

            expect(
              await ethers.provider.getBalance(contractCashier.address)
            ).to.equal(expectedDepositBalance, 'Cashier amount is incorrect');

            expect(
              await contractBSNTokenPrice.balanceOf(contractCashier.address)
            ).to.equal(constants.PROMISE_PRICE1, 'Cashier amount is incorrect');
          });

          it('Escrow should be updated', async () => {
            const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
              BN(ORDER_QTY)
            );

            expect(
              await contractCashier.getEscrowAmount(users.seller.address)
            ).to.equal(sellerDeposits, 'Escrow amount is incorrect');

            expect(
              await contractCashier.getEscrowTokensAmount(
                contractBSNTokenPrice.address,
                users.buyer.address
              )
            ).to.equal(constants.PROMISE_PRICE1, 'Escrow amount is incorrect');
          });
        });

        it('It should be possible to request voucher with 0 buyer deposit', async () => {
          const TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.ZERO,
            ORDER_QTY
          );

          await utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.PROMISE_PRICE1,
            constants.ZERO
          );

          const voucherTokenId = BN(TOKEN_SUPPLY_ID).or(constants.ONE);

          const voucherStatus = await contractVoucherKernel.getVoucherStatus(
            voucherTokenId
          );

          const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

          assert.equal(
            voucherStatus[0],
            expectedStatus.toNumber(),
            'Wrong status'
          );
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          const utilsEthEth = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHETH()
            .buildAsync(
              contractVoucherSets,
              contractVouchers,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await expect(
            utilsEthEth.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITBU1
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_PAYMENT_METHOD);
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.incorrect_product_price,
              constants.PROMISE_DEPOSITBU1
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_PRICE);
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          await expect(
            utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID,
              constants.PROMISE_PRICE1,
              constants.buyer_incorrect_deposit
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_DEPOSIT);
        });
      });
    });

    describe('Common voucher interactions after expiry', () => {
      const TEN_MINUTES = 10 * constants.ONE_MINUTE;
      const cancelPeriod = constants.ONE_MINUTE;
      const complainPeriod = constants.ONE_MINUTE;

      beforeEach(async () => {
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

        constants.PROMISE_VALID_FROM = timestamp;
        constants.PROMISE_VALID_TO = timestamp + TEN_MINUTES;

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.seller_deposit,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        );
      });

      it('[!COMMIT] Buyer should not be able to commit after expiry date has passed', async () => {
        await advanceTimeSeconds(
          TEN_MINUTES + constants.ONE_MINUTE // block.timestamp > tpromise.validTo
        );

        await expect(
          utils.commitToBuy(
            users.buyer,
            users.seller,
            TOKEN_SUPPLY_ID,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          )
        ).to.be.revertedWith(revertReasons.OFFER_EXPIRED);
      });

      it('[COMMIT->!CANCEL] Seller should not be able to cancel after complain and expiry periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );
        await advanceTimeSeconds(
          TEN_MINUTES + cancelPeriod + complainPeriod + constants.ONE_MINUTE // block.timestamp > tpromise.validTo + complainPeriod + cancelFaultPeriod
        );

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->CANCEL->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(complainPeriod + constants.ONE_MINUTE); // block.timestamp > complainPeriodStart + complainPeriod

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->!REFUND] Buyer should not be able to refund after expiry date has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await advanceTimeSeconds(
          TEN_MINUTES + constants.ONE_MINUTE // block.timestamp > tpromise.validTo
        );

        await expect(
          utils.refund(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.VALIDITY_PERIOD_PASSED);
      });

      it('[COMMIT->!REDEEM] Buyer should not be able to redeem after expiry date has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await advanceTimeSeconds(
          TEN_MINUTES + constants.ONE_MINUTE // block.timestamp > tpromise.validTo
        );

        await expect(
          utils.redeem(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.VALIDITY_PERIOD_PASSED);
      });

      it('[COMMIT->REDEEM->!COMPLAIN] Buyer should not be able to complain after complain and cancel periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );
        await utils.redeem(voucherID, users.buyer.signer);

        await advanceTimeSeconds(
          complainPeriod + constants.ONE_MINUTE // block.timestamp > complainPeriodStart + complainPeriod
        );

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->REDEEM->!CANCEL] Seller should not be able to cancel after complain and cancel periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );
        await utils.redeem(voucherID, users.buyer.signer);

        await advanceTimeSeconds(
          cancelPeriod + constants.ONE_MINUTE // block.timestamp > cancelFaultPeriodStart + cancelPeriod
        );

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->REDEEM->CANCEL->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await advanceTimeSeconds(complainPeriod + constants.ONE_MINUTE); // block.timestamp > complainPeriodStart + complainPeriod

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->REDEEM->COMPLAIN->!CANCEL] Seller should not be able to cancel after cancel period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);
        await advanceTimeSeconds(cancelPeriod + constants.ONE_MINUTE); // block.timestamp > cancelFaultPeriodStart + cancelPeriod

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->REFUND->!CANCEL] Seller should not be able to cancel after cancel & complain periods expire', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.refund(voucherID, users.buyer.signer);

        await advanceTimeSeconds(
          cancelPeriod + constants.ONE_MINUTE // block.timestamp > cancelFaultPeriodStart + cancelPeriod
        );

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->REFUND->!COMPLAIN] Buyer should not be able to complain after complain and expiry periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.refund(voucherID, users.buyer.signer);

        await advanceTimeSeconds(
          complainPeriod + constants.ONE_MINUTE // block.timestamp > complainPeriodStart + complainPeriod
        );

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->REFUND->COMPLAIN->!CANCEL] Seller should not be able to cancel after cancel period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(cancelPeriod + constants.ONE_MINUTE); // block.timestamp > cancelFaultPeriodStart + cancelPeriod

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->REFUND->CANCEL->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(complainPeriod + constants.ONE_MINUTE); // block.timestamp > complainPeriodStart + complainPeriod

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->EXPIRY TRIGGERED->CANCEL] Seller should be able to cancel within the cancel period after expiry triggered', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await advanceTimeSeconds(TEN_MINUTES + constants.ONE_MINUTE); // block.timestamp > tpromise.validTo

        const expiryTx = await contractVoucherKernel.triggerExpiration(
          voucherID
        );
        let txReceipt = await expiryTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_EXPIRATION_TRIGGERED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );

        await advanceTimeSeconds(ONE_WEEK + ONE_WEEK - TEN_MINUTES); // block.timestamp < tpromise.validTo + cancelPeriod + complainPeriod

        const cancelTx = await utils.cancel(voucherID, users.seller.signer);
        txReceipt = await cancelTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_FAULT_CANCEL,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );
      });

      it('[COMMIT->EXPIRY TRIGGERED->!CANCEL] Seller should not be able to cancel after cancel period has passed', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await advanceTimeSeconds(TEN_MINUTES + constants.ONE_MINUTE); // block.timestamp > tpromise.validTo

        await contractVoucherKernel.triggerExpiration(voucherID);

        await advanceTimeSeconds(ONE_WEEK + ONE_WEEK + constants.ONE_MINUTE); // block.timestamp > tpromise.validTo + cancelPeriod + complainPeriod

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->EXPIRY TRIGGERED->COMPLAIN] Buyer should be able to complain within the complain period after expiry triggered', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await advanceTimeSeconds(TEN_MINUTES + constants.ONE_MINUTE); // block.timestamp > tpromise.validTo

        const expiryTx = await contractVoucherKernel.triggerExpiration(
          voucherID
        );
        let txReceipt = await expiryTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_EXPIRATION_TRIGGERED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );

        await advanceTimeSeconds(ONE_WEEK + ONE_WEEK - TEN_MINUTES); // block.timestamp < tpromise.validTo + cancelPeriod + complainPeriod

        const complainTx = await utils.complain(voucherID, users.buyer.signer);
        txReceipt = await complainTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_COMPLAIN,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );
      });

      it('[COMMIT->EXPIRY TRIGGERED->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );
        await advanceTimeSeconds(TEN_MINUTES + constants.ONE_MINUTE); // block.timestamp > tpromise.validTo
        await contractVoucherKernel.triggerExpiration(voucherID);
        await advanceTimeSeconds(ONE_WEEK + ONE_WEEK + constants.ONE_MINUTE); // block.timestamp > tpromise.validTo + cancelPeriod + complainPeriod
        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->EXPIRY TRIGGERED->CANCEL->COMPLAIN] Buyer should be able to complain within the complain period after expiry triggered and seller cancels', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await advanceTimeSeconds(TEN_MINUTES + constants.ONE_MINUTE); // block.timestamp > tpromise.validTo

        const expiryTx = await contractVoucherKernel.triggerExpiration(
          voucherID
        );
        let txReceipt = await expiryTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_EXPIRATION_TRIGGERED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );

        const cancelTx = await utils.cancel(voucherID, users.seller.signer);
        txReceipt = await cancelTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_FAULT_CANCEL,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );

        await advanceTimeSeconds(ONE_WEEK - TEN_MINUTES); // block.timestamp < complainPeriodStart + complainPeriod
        const complainTx = await utils.complain(voucherID, users.buyer.signer);
        txReceipt = await complainTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_COMPLAIN,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );
      });

      it('[COMMIT->EXPIRY TRIGGERED->CANCEL->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await advanceTimeSeconds(TEN_MINUTES + constants.ONE_MINUTE); // block.timestamp > tpromise.validTo

        await contractVoucherKernel.triggerExpiration(voucherID);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(ONE_WEEK + constants.ONE_MINUTE); // block.timestamp > complainPeriodStart + complainPeriod

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->EXPIRY TRIGGERED->COMPLAIN->CANCEL] Seller should be able to cancel within the cancel period after expiry triggered and buyer complains', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await advanceTimeSeconds(TEN_MINUTES + constants.ONE_MINUTE); // block.timestamp > tpromise.validTo

        const expiryTx = await contractVoucherKernel.triggerExpiration(
          voucherID
        );
        let txReceipt = await expiryTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_EXPIRATION_TRIGGERED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );

        const complainTx = await utils.complain(voucherID, users.buyer.signer);
        txReceipt = await complainTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_COMPLAIN,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );

        await advanceTimeSeconds(ONE_WEEK - TEN_MINUTES); // block.timestamp < cancelPeriodStart + cancelPeriod
        const cancelTx = await utils.cancel(voucherID, users.seller.signer);
        txReceipt = await cancelTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_FAULT_CANCEL,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );
      });

      it('[COMMIT->EXPIRY TRIGGERED->COMPLAIN->!CANCEL] Seller should not be able to cancel after cancel period has passed', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await advanceTimeSeconds(TEN_MINUTES + constants.ONE_MINUTE); // block.timestamp > tpromise.validTo

        await contractVoucherKernel.triggerExpiration(voucherID);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(ONE_WEEK + constants.ONE_MINUTE); // block.timestamp > cancelPeriodStart + cancelPeriod

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->!COMPLAIN] Buyer should not be able to complain directly after commit', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );
        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
      });

      it('[!CANCEL] It should not be possible to cancel voucher that is not mapped to any supply', async () => {
        // spoof boson router address.
        await contractBosonRouter.pause();
        await contractVoucherKernel.setBosonRouterAddress(
          users.deployer.address
        );
        await contractVoucherKernel.unpause();

        await expect(
          contractVoucherKernel.cancelOrFault(
            constants.ONE,
            constants.ZERO_ADDRESS
          )
        ).to.be.revertedWith(revertReasons.INEXISTENT_SUPPLY);
      });

      it('[!CANCEL] It should not be possible to cancel voucher that does not exist yet', async () => {
        // spoof boson router address
        await contractBosonRouter.pause();
        await contractVoucherKernel.setBosonRouterAddress(
          users.deployer.address
        );
        await contractVoucherKernel.unpause();

        await expect(
          contractVoucherKernel.cancelOrFault(
            BN(TOKEN_SUPPLY_ID).or(1),
            users.seller.address
          )
        ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
      });
    });

    describe('Action at wrong step', () => {
      let tokenVoucherId;
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

        const tokenSupplyKey = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        );

        tokenVoucherId = await utils.commitToBuy(
          users.buyer,
          users.seller,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );
      });

      describe('REFUND', () => {
        it('[NEGATIVE] REDEEM->!REFUND', async () => {
          await utils.redeem(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.refund(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
        });

        it('[NEGATIVE] CANCEL->!REFUND', async () => {
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.refund(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
        });

        it('[NEGATIVE] EXPIRE->!REFUND', async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await utils.expire(tokenVoucherId, users.seller.signer);

          await expect(
            utils.refund(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
        });
      });

      describe('DOUBLE COMPLAIN', () => {
        it('[NEGATIVE] CANCEL->COMPLAIN->!COMPLAIN', async () => {
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_COMPLAINED);
        });

        it('[NEGATIVE] REDEEM->COMPLAIN->!COMPLAIN', async () => {
          await utils.redeem(tokenVoucherId, users.buyer.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_COMPLAINED);
        });

        it('[NEGATIVE] REDEEM->COMPLAIN->CANCEL->!COMPLAIN', async () => {
          await utils.redeem(tokenVoucherId, users.buyer.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_COMPLAINED);
        });

        it('[NEGATIVE] REDEEM->CANCEL->COMPLAIN->!COMPLAIN', async () => {
          await utils.redeem(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_COMPLAINED);
        });

        it('[NEGATIVE] REFUND->COMPLAIN->!COMPLAIN', async () => {
          await utils.refund(tokenVoucherId, users.buyer.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_COMPLAINED);
        });

        it('[NEGATIVE] REFUND->COMPLAIN->CANCEL->!COMPLAIN', async () => {
          await utils.refund(tokenVoucherId, users.buyer.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_COMPLAINED);
        });

        it('[NEGATIVE] REFUND->CANCEL->COMPLAIN->!COMPLAIN', async () => {
          await utils.refund(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_COMPLAINED);
        });

        it('[NEGATIVE] EXPIRE->COMPLAIN->!COMPLAIN', async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await utils.expire(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_COMPLAINED);
        });

        it('[NEGATIVE] EXPIRE->COMPLAIN->CANCEL->!COMPLAIN', async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await utils.expire(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_COMPLAINED);
        });

        it('[NEGATIVE] EXPIRE->CANCEL->COMPLAIN->!COMPLAIN', async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await utils.expire(tokenVoucherId, users.seller.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_COMPLAINED);
        });
      });

      describe('DOUBLE COF', () => {
        it('[NEGATIVE] COMMIT->CANCEL->COMPLAIN->!CANCEL', async () => {
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });

        it('[NEGATIVE] COMMIT->CANCEL->!CANCEL', async () => {
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });

        it('[NEGATIVE] COMMIT->REDEEM->COMPLAIN->CANCEL->!CANCEL', async () => {
          await utils.redeem(tokenVoucherId, users.buyer.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });

        it('[NEGATIVE] COMMIT->REDEEM->CANCEL->COMPLAIN->!CANCEL', async () => {
          await utils.redeem(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });

        it('[NEGATIVE] COMMIT->REDEEM->CANCEL->!CANCEL', async () => {
          await utils.redeem(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });

        it('[NEGATIVE] COMMIT->REFUND->COMPLAIN->CANCEL->!CANCEL', async () => {
          await utils.refund(tokenVoucherId, users.buyer.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });

        it('[NEGATIVE] COMMIT->REFUND->CANCEL->COMPLAIN->!CANCEL', async () => {
          await utils.refund(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });

        it('[NEGATIVE] COMMIT->REFUND->CANCEL->!CANCEL', async () => {
          await utils.refund(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });

        it('[NEGATIVE] COMMIT->EXPIRE->COMPLAIN->CANCEL->!CANCEL-', async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await utils.expire(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });

        it('[NEGATIVE] COMMIT->EXPIRE->CANCEL->COMPLAIN->!CANCEL', async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await utils.expire(tokenVoucherId, users.seller.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });

        it('[NEGATIVE] COMMIT->EXPIRE->CANCEL->!CANCEL', async () => {
          await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await utils.expire(tokenVoucherId, users.seller.signer);
          await utils.cancel(tokenVoucherId, users.seller.signer);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_CANCELFAULT);
        });
      });

      describe('COMPLAIN/COF/FINALIZE after finalize', () => {
        it('[NEGATIVE] COMMIT->CANCEL->COMPLAIN->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await utils.complain(tokenVoucherId, users.buyer.signer);
          // await advanceTimeSeconds(60);
          await utils.finalize(tokenVoucherId, users.deployer.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

          await expect(
            utils.finalize(tokenVoucherId, users.deployer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
        });

        it('[NEGATIVE] COMMIT->CANCEL->FINALIZE->!COMPLAIN/!COF/!FINALIZEV', async () => {
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await advanceTimeSeconds(60);
          await utils.finalize(tokenVoucherId, users.deployer.signer);

          await expect(
            utils.complain(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

          await expect(
            utils.cancel(tokenVoucherId, users.seller.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

          await expect(
            utils.finalize(tokenVoucherId, users.deployer.signer)
          ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
        });

        describe('REDEEM', () => {
          beforeEach(async () => {
            await utils.redeem(tokenVoucherId, users.buyer.signer);
          });

          it('[NEGATIVE] COMMIT->REDEEM->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->REDEEM->COMPLAIN->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->REDEEM->CANCEL->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });
        });

        describe('REFUND', () => {
          beforeEach(async () => {
            await utils.refund(tokenVoucherId, users.buyer.signer);
          });

          it('[NEGATIVE] COMMIT->REFUND->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->REFUND->COMPLAIN->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->REFUND->CANCEL->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });
        });

        describe('EXPIRE', () => {
          beforeEach(async () => {
            await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
            await utils.expire(tokenVoucherId, users.deployer.signer);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->COMPLAIN->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->CANCEL->FINALIZE->!COMPLAIN/!COF/!FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);

            await expect(
              utils.complain(tokenVoucherId, users.buyer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.cancel(tokenVoucherId, users.seller.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);

            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.ALREADY_FINALIZED);
          });
        });
      });

      describe('EXPIRY after some other action', () => {
        async function testTriggerExpiraton(advanceTime = true) {
          // to try expiration we should go to the future, but then other methods might fail as well.
          // therefore we revert to the state before advancing in the future
          const snapshot = await ethers.provider.send('evm_snapshot', []);
          if (advanceTime)
            await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
          await expect(
            utils.expire(tokenVoucherId, users.deployer.signer)
          ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);

          // revert to state before we advanced time
          await ethers.provider.send('evm_revert', [snapshot]);
        }

        it('[NEGATIVE] EXPIRY before expiration time should be reverted', async () => {
          await expect(
            utils.expire(tokenVoucherId, users.deployer.signer)
          ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
        });

        it('[NEGATIVE] COMMIT->CANCEL->COMPLAIN->FINALIZE', async () => {
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await testTriggerExpiraton();
          await utils.complain(tokenVoucherId, users.buyer.signer);
          await testTriggerExpiraton();
          await utils.finalize(tokenVoucherId, users.deployer.signer);
          await testTriggerExpiraton();
        });

        it('[NEGATIVE] COMMIT->CANCEL->FINALIZE', async () => {
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await advanceTimeSeconds(60);
          await utils.finalize(tokenVoucherId, users.deployer.signer);
          await testTriggerExpiraton();
        });

        describe('REDEEM', () => {
          beforeEach(async () => {
            await utils.redeem(tokenVoucherId, users.buyer.signer);
          });

          it('[NEGATIVE] COMMIT->REDEEM->FINALIZE', async () => {
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton();
          });

          it('[NEGATIVE] COMMIT->REDEEM->COMPLAIN->FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await testTriggerExpiraton();
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton();
          });

          it('[NEGATIVE] COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await testTriggerExpiraton();
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton();
          });

          it('[NEGATIVE] COMMIT->REDEEM->CANCEL->COMPLAIN->FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await testTriggerExpiraton();
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton();
          });

          it('[NEGATIVE] COMMIT->REDEEM->CANCEL->FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await testTriggerExpiraton();
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton();
          });
        });

        describe('REFUND', () => {
          beforeEach(async () => {
            await utils.refund(tokenVoucherId, users.buyer.signer);
          });

          it('[NEGATIVE] COMMIT->REFUND->FINALIZE', async () => {
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton();
          });

          it('[NEGATIVE] COMMIT->REFUND->COMPLAIN->FINALIZEF', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await testTriggerExpiraton();
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton();
          });

          it('[NEGATIVE] COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await testTriggerExpiraton();
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton();
          });

          it('[NEGATIVE] COMMIT->REFUND->CANCEL->COMPLAIN->FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await testTriggerExpiraton();
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton();
          });

          it('[NEGATIVE] COMMIT->REFUND->CANCEL->FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await testTriggerExpiraton();
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton();
          });
        });

        describe('EXPIRE', () => {
          beforeEach(async () => {
            await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
            await utils.expire(tokenVoucherId, users.deployer.signer);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->FINALIZE', async () => {
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton(false);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->COMPLAIN->FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await testTriggerExpiraton(false);
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton(false);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->COMPLAIN->CANCEL->FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await testTriggerExpiraton(false);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton(false);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->CANCEL->COMPLAIN->FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await testTriggerExpiraton(false);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton(false);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->CANCEL->FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await testTriggerExpiraton(false);
            await advanceTimeSeconds(60);
            await utils.finalize(tokenVoucherId, users.deployer.signer);
            await testTriggerExpiraton(false);
          });
        });
      });

      describe('PREMATURE FINALIZE', () => {
        it('[NEGATIVE] Finalize before complain period end should have no effect', async () => {
          await expect(
            utils.finalize(tokenVoucherId, users.deployer.signer)
          ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
        });

        it('[NEGATIVE] COMMIT->CANCEL->!FINALIZE', async () => {
          await utils.cancel(tokenVoucherId, users.seller.signer);
          await expect(
            utils.finalize(tokenVoucherId, users.deployer.signer)
          ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
        });

        describe('REDEEM', () => {
          beforeEach(async () => {
            await utils.redeem(tokenVoucherId, users.buyer.signer);
          });

          it('[NEGATIVE] COMMIT->REDEEM->FINALIZE', async () => {
            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
          });

          it('[NEGATIVE] COMMIT->REDEEM->COMPLAIN->FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
          });

          it('[NEGATIVE] COMMIT->REDEEM->CANCEL->FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
          });
        });

        describe('REFUND', () => {
          beforeEach(async () => {
            await utils.refund(tokenVoucherId, users.buyer.signer);
          });

          it('[NEGATIVE] COMMIT->REFUND->FINALIZE', async () => {
            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
          });

          it('[NEGATIVE] COMMIT->REFUND->COMPLAIN->FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
          });

          it('[NEGATIVE] COMMIT->REFUND->CANCEL->FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
          });
        });

        describe('EXPIRE', () => {
          beforeEach(async () => {
            await advanceTimeSeconds(2 * constants.SECONDS_IN_DAY + 1);
            await utils.expire(tokenVoucherId, users.deployer.signer);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->FINALIZE', async () => {
            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->COMPLAIN->FINALIZE', async () => {
            await utils.complain(tokenVoucherId, users.buyer.signer);
            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
          });

          it('[NEGATIVE] COMMIT->EXPIRE->CANCEL->FINALIZE', async () => {
            await utils.cancel(tokenVoucherId, users.seller.signer);
            await expect(
              utils.finalize(tokenVoucherId, users.deployer.signer)
            ).to.be.revertedWith(revertReasons.INAPPLICABLE_STATUS);
          });
        });
      });

      describe('BEFORE VALIDITY PERIOD', () => {
        let tokenVoucherId;

        beforeEach(async () => {
          const timestamp = await Utils.getCurrTimestamp();

          constants.PROMISE_VALID_FROM =
            timestamp + 10 * constants.SECONDS_IN_DAY;
          constants.PROMISE_VALID_TO =
            constants.PROMISE_VALID_FROM + 2 * constants.SECONDS_IN_DAY;

          utils = await UtilsBuilder.create()
            .ETHETH()
            .buildAsync(
              contractVoucherSets,
              contractVouchers,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter
            );

          const tokenSupplyId = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_10
          );

          tokenVoucherId = await utils.commitToBuy(
            users.buyer,
            users.seller,
            tokenSupplyId,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );
        });

        it('[NEGATIVE] Should not be possible to redeem before promise valid', async () => {
          await expect(
            utils.redeem(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.INVALID_VALIDITY_FROM);
        });

        it('[NEGATIVE] Should not be possible to refund before promise valid', async () => {
          await expect(
            utils.refund(tokenVoucherId, users.buyer.signer)
          ).to.be.revertedWith(revertReasons.INVALID_VALIDITY_FROM);
        });
      });
    });
  });

  describe('TOKEN SUPPLY TRANSFER', () => {
    const paymentType = {
      PAYMENT: 0,
      DEPOSIT_SELLER: 1,
      DEPOSIT_BUYER: 2,
    };

    beforeEach(() => {
      distributedAmounts = {
        buyerAmount: BN(0),
        sellerAmount: BN(0),
        escrowAmount: BN(0),
      };
    });

    describe('Common transfer', () => {
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

        tokenSupplyKey = await utils.createOrder(
          users.other1,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        );
      });

      it('Should transfer voucher supply', async () => {
        // Check supply holder before
        expect(
          await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
        ).to.equal(users.other1.address, 'Supply 1 before - holder mismatch');

        const expectedBalanceInEscrow = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );

        let actualOldOwnerBalanceFromEscrow =
          await contractCashier.getEscrowAmount(users.other1.address);
        let actualNewOwnerBalanceFromEscrow =
          await contractCashier.getEscrowAmount(users.other2.address);

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(constants.ZERO),
          'New owner balance from escrow does not match'
        );

        // balances before
        const user1BalanceBeforeTransfer = (
          await contractVoucherSets.functions[fnSignatures.balanceOf1155](
            users.other1.address,
            tokenSupplyKey
          )
        )[0];

        const user2BalanceBeforeTransfer = (
          await contractVoucherSets.functions[fnSignatures.balanceOf1155](
            users.other2.address,
            tokenSupplyKey
          )
        )[0];

        assert.equal(
          user1BalanceBeforeTransfer,
          constants.QTY_10,
          'User1 before balance mismatch'
        );
        assert.equal(
          user2BalanceBeforeTransfer,
          0,
          'User2 before balance mismatch'
        );

        const transferTx = await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_10,
          users.other1.signer
        );

        const txReceipt = await transferTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.isTrue(ev.operator === users.other1.address);
            assert.isTrue(ev.from === users.other1.address);
            assert.isTrue(ev.to === users.other2.address);
            assert.isTrue(ev.id.eq(tokenSupplyKey));
            assert.isTrue(ev.value.eq(constants.QTY_10));
          }
        );

        // balances after
        const user1BalanceAfterTransfer = (
          await contractVoucherSets.functions[fnSignatures.balanceOf1155](
            users.other1.address,
            tokenSupplyKey
          )
        )[0];

        const user2BalanceAfterTransfer = (
          await contractVoucherSets.functions[fnSignatures.balanceOf1155](
            users.other2.address,
            tokenSupplyKey
          )
        )[0];

        assert.equal(
          user1BalanceAfterTransfer,
          0,
          'User1 after balance mismatch'
        );
        assert.equal(
          user2BalanceAfterTransfer,
          constants.QTY_10,
          'User2 after balance mismatch'
        );

        actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other1.address
        );
        actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(constants.ZERO),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'New owner balance from escrow does not match'
        );

        // Check supply holder after
        expect(
          await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
        ).to.equal(users.other2.address, 'Supply 1 after - holder mismatch');
      });

      it('Should transfer voucher supply to self and balance should be the same', async () => {
        // Check supply holder before
        expect(
          await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
        ).to.equal(users.other1.address, 'Supply 1 before - holder mismatch');

        const expectedBalanceInEscrow = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );

        let actualOldOwnerBalanceFromEscrow =
          await contractCashier.getEscrowAmount(users.other1.address);

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );

        const balanceBeforeTransfer = (
          await contractVoucherSets.functions[fnSignatures.balanceOf1155](
            users.other1.address,
            tokenSupplyKey
          )
        )[0];

        const transferTx = await utils.safeTransfer1155(
          users.other1.address,
          users.other1.address,
          tokenSupplyKey,
          constants.QTY_10,
          users.other1.signer
        );

        const balanceAfterTransfer = (
          await contractVoucherSets.functions[fnSignatures.balanceOf1155](
            users.other1.address,
            tokenSupplyKey
          )
        )[0];

        assert.equal(
          balanceBeforeTransfer.toString(),
          balanceAfterTransfer.toString(),
          'Balance mismatch!'
        );

        const txReceipt = await transferTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.equal(ev.from, users.other1.address);
            assert.equal(ev.to, users.other1.address);
            assert.equal(ev.id.toString(), tokenSupplyKey);
            assert.equal(ev.value.toString(), constants.QTY_10);
          }
        );

        actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other1.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );

        // Check supply holder after
        expect(
          await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
        ).to.equal(users.other1.address, 'Supply 1 after - holder mismatch');
      });

      it('[NEGATIVE] Should revert if owner tries to transfer voucher supply partially', async () => {
        await expect(
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          )
        ).to.be.revertedWith(revertReasons.INVALID_QUANTITY);
      });

      it('[NEGATIVE] Should revert if Attacker tries to transfer voucher supply', async () => {
        await expect(
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_10,
            users.attacker.signer
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_1155);
      });

      describe('Batch transfers', () => {
        let tokenSupplyKey2;
        let tokenSupplyBatch;
        const batchQuantities = [BN(constants.QTY_10), BN(constants.QTY_20)];

        beforeEach(async () => {
          tokenSupplyKey2 = await utils.createOrder(
            users.other1,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE2,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_20
          );

          tokenSupplyBatch = [BN(tokenSupplyKey), BN(tokenSupplyKey2)];
        });

        it('Should transfer batch voucher supply', async () => {
          // Check supply holder before
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
          ).to.equal(users.other1.address, 'Supply 1 before - holder mismatch');
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey2)
          ).to.equal(users.other1.address, 'Supply 2 before - holder mismatch');

          // balances before
          let actualOldOwnerBalanceFromEscrow =
            await contractCashier.getEscrowAmount(users.other1.address);
          let actualNewOwnerBalanceFromEscrow =
            await contractCashier.getEscrowAmount(users.other2.address);

          const expectedBalanceInEscrow = BN(constants.PROMISE_DEPOSITSE1)
            .mul(BN(constants.QTY_10))
            .add(BN(constants.PROMISE_DEPOSITSE2).mul(BN(constants.QTY_20)));

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(constants.ZERO),
            'New owner balance from escrow does not match'
          );

          const user1BalanceBeforeTransfer =
            await contractVoucherSets.balanceOfBatch(
              [users.other1.address, users.other1.address],
              tokenSupplyBatch
            );

          const user2BalanceBeforeTransfer =
            await contractVoucherSets.balanceOfBatch(
              [users.other2.address, users.other2.address],
              tokenSupplyBatch
            );

          assert.equal(
            JSON.stringify(user1BalanceBeforeTransfer),
            JSON.stringify(batchQuantities),
            'User1 before balance mismatch'
          );
          assert.equal(
            JSON.stringify(user2BalanceBeforeTransfer),
            JSON.stringify([constants.ZERO, constants.ZERO]),
            'User2 before balance mismatch'
          );

          const transferTx = await utils.safeBatchTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyBatch,
            batchQuantities.map((q) => q.toString()),
            users.other1.signer
          );

          const txReceipt = await transferTx.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherSets_Factory,
            eventNames.TRANSFER_BATCH,
            (ev) => {
              assert.equal(ev.from, users.other1.address);
              assert.equal(ev.to, users.other2.address);
              assert.equal(
                JSON.stringify(ev.ids),
                JSON.stringify(tokenSupplyBatch)
              );
              assert.equal(
                JSON.stringify(ev[ev.length - 1]), //for some reason, "values" is not available in the event objec by that name
                JSON.stringify(batchQuantities)
              );
            }
          );

          // balances after
          const user1BalanceAfterTransfer =
            await contractVoucherSets.balanceOfBatch(
              [users.other1.address, users.other1.address],
              tokenSupplyBatch
            );

          const user2BalanceAfterTransfer =
            await contractVoucherSets.balanceOfBatch(
              [users.other2.address, users.other2.address],
              tokenSupplyBatch
            );

          assert.equal(
            JSON.stringify(user1BalanceAfterTransfer),
            JSON.stringify([constants.ZERO, constants.ZERO]),
            'User1 after balance mismatch'
          );
          assert.equal(
            JSON.stringify(user2BalanceAfterTransfer),
            JSON.stringify(batchQuantities),
            'User2 after balance mismatch'
          );

          actualOldOwnerBalanceFromEscrow =
            await contractCashier.getEscrowAmount(users.other1.address);
          actualNewOwnerBalanceFromEscrow =
            await contractCashier.getEscrowAmount(users.other2.address);

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(constants.ZERO),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'New owner balance from escrow does not match'
          );

          // Check supply holder after
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
          ).to.equal(users.other2.address, 'Supply 1 after - holder mismatch');
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey2)
          ).to.equal(users.other2.address, 'Supply 2 after - holder mismatch');
        });

        it('Should transfer batch voucher supply to self and balance should be the same', async () => {
          // Check supply holder before
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
          ).to.equal(users.other1.address, 'Supply 1 before - holder mismatch');
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey2)
          ).to.equal(users.other1.address, 'Supply 2 before - holder mismatch');

          // balances before
          let actualOldOwnerBalanceFromEscrow =
            await contractCashier.getEscrowAmount(users.other1.address);

          const expectedBalanceInEscrow = BN(constants.PROMISE_DEPOSITSE1)
            .mul(BN(constants.QTY_10))
            .add(BN(constants.PROMISE_DEPOSITSE2).mul(BN(constants.QTY_20)));

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );

          const balanceBeforeTransfer =
            await contractVoucherSets.balanceOfBatch(
              [users.other1.address, users.other1.address],
              tokenSupplyBatch
            );

          const transferTx = await utils.safeBatchTransfer1155(
            users.other1.address,
            users.other1.address,
            tokenSupplyBatch,
            batchQuantities.map((q) => q.toString()),
            users.other1.signer
          );

          const balanceAfterTransfer = await contractVoucherSets.balanceOfBatch(
            [users.other1.address, users.other1.address],
            tokenSupplyBatch
          );

          assert.equal(
            JSON.stringify(balanceBeforeTransfer),
            JSON.stringify(balanceAfterTransfer),
            'Balance mismatch!'
          );

          const txReceipt = await transferTx.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherSets_Factory,
            eventNames.TRANSFER_BATCH,
            (ev) => {
              assert.equal(ev.from, users.other1.address);
              assert.equal(ev.to, users.other1.address);
              assert.equal(
                JSON.stringify(ev.ids),
                JSON.stringify(tokenSupplyBatch)
              );
              assert.equal(
                JSON.stringify(ev[ev.length - 1]), //for some reason, "values" is not available in the event objec by that name
                JSON.stringify(batchQuantities)
              );
            }
          );

          actualOldOwnerBalanceFromEscrow =
            await contractCashier.getEscrowAmount(users.other1.address);

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );

          // Check supply holder after
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
          ).to.equal(users.other1.address, 'Supply 1 after - holder mismatch');
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey2)
          ).to.equal(users.other1.address, 'Supply 2 after - holder mismatch');
        });

        it('[NEGATIVE] Should revert if owner tries to transfer voucher supply batch partially', async () => {
          await expect(
            utils.safeBatchTransfer1155(
              users.other1.address,
              users.other2.address,
              tokenSupplyBatch,
              [constants.QTY_10, constants.QTY_10],
              users.other1.signer
            )
          ).to.be.revertedWith(revertReasons.INVALID_QUANTITY);
        });

        it('[NEGATIVE] Should revert if Attacker tries to transfer batch voucher supply', async () => {
          await expect(
            utils.safeBatchTransfer1155(
              users.other1.address,
              users.other2.address,
              tokenSupplyBatch,
              batchQuantities.map((q) => q.toString()),
              users.attacker.signer
            )
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_BATCH_1155);
        });
      });
    });

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

        tokenSupplyKey = await utils.createOrder(
          users.other1,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_1
        );
      });

      it('Should update escrow amounts after transfer', async () => {
        // Check supply holder before
        expect(
          await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
        ).to.equal(users.other1.address, 'Supply 1 before - holder mismatch');

        const expectedBalanceInEscrow = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_1)
        );

        let actualOldOwnerBalanceFromEscrow =
          await contractCashier.getEscrowAmount(users.other1.address);
        let actualNewOwnerBalanceFromEscrow =
          await contractCashier.getEscrowAmount(users.other2.address);

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(constants.ZERO),
          'New owner balance from escrow does not match'
        );

        await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          users.other1.signer
        );

        actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other1.address
        );
        actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(constants.ZERO),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'New owner balance from escrow does not match'
        );

        // Check supply holder after
        expect(
          await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
        ).to.equal(users.other2.address, 'Supply 1 after - holder mismatch');
      });

      it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
        // Check supply holder before
        let supplyHolder = await contractVoucherKernel.getSupplyHolder(
          tokenSupplyKey
        );

        assert.equal(
          supplyHolder,
          users.other1.address,
          'Supply holder mismatch'
        );

        const expectedBuyerAmount = BN(constants.PROMISE_DEPOSITBU1);
        const expectedSellerAmount = BN(constants.PROMISE_DEPOSITSE1).add(
          BN(constants.PROMISE_PRICE1)
        );
        const expectedEscrowAmount = BN(0);

        await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          users.other1.signer
        );

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.other2,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
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
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            expect(ev._payee).to.be.oneOf(
              [users.other2.address, users.buyer.address],
              'Incorrect Payee'
            );
            switch (ev._payee) {
              case users.other2.address:
                expect(ev._payment.toNumber()).to.be.oneOf([
                  constants.PROMISE_PRICE1,
                  constants.PROMISE_DEPOSITSE1,
                ]);
                break;
              case users.buyer.address:
                assert.equal(ev._payment, constants.PROMISE_DEPOSITBU1);
                break;
            }
          }
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            expect(ev._type).to.be.oneOf(Object.values(paymentType));
            switch (ev._type) {
              case paymentType.PAYMENT:
                assert.equal(
                  ev._tokenIdVoucher.toString(),
                  voucherID.toString(),
                  'Wrong token id voucher'
                );
                assert.equal(
                  ev._to,
                  users.other2.address,
                  'Wrong payment recipient'
                );
                assert.equal(
                  ev._payment,
                  constants.PROMISE_PRICE1,
                  'Wrong payment amount'
                );
                break;
              case paymentType.DEPOSIT_SELLER:
                assert.equal(
                  ev._tokenIdVoucher.toString(),
                  voucherID.toString(),
                  'Wrong token id voucher'
                );
                assert.equal(
                  ev._to,
                  users.other2.address,
                  'Wrong seller deposit recipient'
                );
                assert.equal(
                  ev._payment,
                  constants.PROMISE_DEPOSITSE1,
                  'Wrong seller deposit amount'
                );
                break;
              case paymentType.DEPOSIT_BUYER:
                assert.equal(
                  ev._tokenIdVoucher.toString(),
                  voucherID.toString(),
                  'Wrong token id voucher'
                );
                assert.equal(
                  ev._to,
                  users.buyer.address,
                  'Wrong buyer deposit recipient'
                );
                assert.equal(
                  ev._payment,
                  constants.PROMISE_DEPOSITBU1,
                  'Wrong buyer deposit amount'
                );
                break;
            }

            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.other2.address
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

        supplyHolder = await contractVoucherKernel.getSupplyHolder(
          tokenSupplyKey
        );

        assert.equal(
          supplyHolder,
          users.other2.address,
          'Supply holder mismatch'
        );
      });

      it('New owner should be able to COF', async () => {
        await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          users.other1.signer
        );

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.other2,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.redeem(voucherID, users.buyer.signer);

        expect(await utils.cancel(voucherID, users.other2.signer))
          .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_FAULT_CANCEL)
          .withArgs(voucherID);
      });

      it('[NEGATIVE] Old owner should not be able to COF', async () => {
        await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          users.other1.signer
        );

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.other2,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.redeem(voucherID, users.buyer.signer);

        await expect(
          utils.cancel(voucherID, users.other1.signer)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
      });
    });

    describe('[WITH PERMIT]', () => {
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

          const tokensToMint = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_1)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            constants.PROMISE_DEPOSITBU1.toString()
          );

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_1
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          // Check supply holder before
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
          ).to.equal(users.other1.address, 'Supply 1 before - holder mismatch');

          // balances before
          const expectedBalanceInEscrow = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_1)
          );

          let actualOldOwnerBalanceFromEscrow =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            );
          let actualNewOwnerBalanceFromEscrow =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other2.address
            );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(constants.ZERO),
            'New owner balance from escrow does not match'
          );

          const user1BalanceBeforeTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other1.address,
              tokenSupplyKey
            )
          )[0];

          const user2BalanceBeforeTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other2.address,
              tokenSupplyKey
            )
          )[0];

          assert.equal(
            user1BalanceBeforeTransfer,
            constants.QTY_1,
            'User1 before balance mismatch'
          );
          assert.equal(
            user2BalanceBeforeTransfer,
            0,
            'User2 before balance mismatch'
          );

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          // balances after
          actualOldOwnerBalanceFromEscrow =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            );
          actualNewOwnerBalanceFromEscrow =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other2.address
            );

          const user1BalanceAfterTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other1.address,
              tokenSupplyKey
            )
          )[0];

          const user2BalanceAfterTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other2.address,
              tokenSupplyKey
            )
          )[0];

          assert.equal(
            user1BalanceAfterTransfer,
            0,
            'User1 after balance mismatch'
          );
          assert.equal(
            user2BalanceAfterTransfer,
            constants.QTY_1,
            'User2 after balance mismatch'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(constants.ZERO),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'New owner balance from escrow does not match'
          );

          // Check supply holder after
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
          ).to.equal(users.other2.address, 'Supply 1 after - holder mismatch');
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerDeposit = BN(constants.PROMISE_DEPOSITBU1);
          const expectedSellerPrice = BN(constants.PROMISE_PRICE1);
          const expectedSellerDeposit = BN(constants.PROMISE_DEPOSITSE1);
          const expectedEscrowAmountDeposit = BN(0);

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
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
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(ev._payee, users.other2.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerPrice));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              expect(ev._type).to.be.oneOf(Object.values(paymentType));
              switch (ev._type) {
                case paymentType.PAYMENT:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong payment recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_PRICE1,
                    'Wrong payment amount'
                  );
                  break;
                case paymentType.DEPOSIT_SELLER:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong seller deposit recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_DEPOSITSE1,
                    'Wrong seller deposit amount'
                  );
                  break;
                case paymentType.DEPOSIT_BUYER:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.buyer.address,
                    'Wrong buyer deposit recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_DEPOSITBU1,
                    'Wrong buyer deposit amount'
                  );
                  break;
              }

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.other2.address
              );
            }
          );

          const balanceBuyerFromDeposits =
            await utils.contractBSNTokenDeposit.balanceOf(users.buyer.address);
          const balanceSellerFromDeposits =
            await utils.contractBSNTokenDeposit.balanceOf(users.other2.address);
          const escrowBalanceFromDeposits =
            await utils.contractBSNTokenDeposit.balanceOf(
              users.deployer.address
            );
          const cashierDepositLeft =
            await utils.contractBSNTokenDeposit.balanceOf(
              utils.contractCashier.address
            );
          const cashierPaymentLeft =
            await utils.contractBSNTokenPrice.balanceOf(
              utils.contractCashier.address
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
        });

        it('New owner should be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.redeem(voucherID, users.buyer.signer);

          expect(await utils.cancel(voucherID, users.other2.signer))
            .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_FAULT_CANCEL)
            .withArgs(voucherID);
        });

        it('[NEGATIVE] Old owner should not be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.redeem(voucherID, users.buyer.signer);

          await expect(
            utils.cancel(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
        });
      });

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

          const supplyQty = 1;
          const tokensToMint = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(supplyQty)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            BN(constants.PROMISE_PRICE1)
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            BN(constants.PROMISE_DEPOSITBU1)
          );

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            supplyQty
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          // Check supply holder before
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
          ).to.equal(users.other1.address, 'Supply 1 before - holder mismatch');

          // balances before transfer
          const expectedBalanceInEscrow = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_1)
          );

          let actualOldOwnerBalanceFromEscrow =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            );
          let actualNewOwnerBalanceFromEscrow =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other2.address
            );

          const user1BalanceBeforeTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other1.address,
              tokenSupplyKey
            )
          )[0];

          const user2BalanceBeforeTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other2.address,
              tokenSupplyKey
            )
          )[0];

          assert.equal(
            user1BalanceBeforeTransfer,
            constants.QTY_1,
            'User1 before balance mismatch'
          );
          assert.equal(
            user2BalanceBeforeTransfer,
            0,
            'User2 before balance mismatch'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(constants.ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          // balances after
          actualOldOwnerBalanceFromEscrow =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            );
          actualNewOwnerBalanceFromEscrow =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other2.address
            );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(constants.ZERO),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'New owner balance from escrow does not match'
          );

          const user1BalanceAfterTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other1.address,
              tokenSupplyKey
            )
          )[0];

          const user2BalanceAfterTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other2.address,
              tokenSupplyKey
            )
          )[0];

          assert.equal(
            user1BalanceAfterTransfer,
            0,
            'User1 after balance mismatch'
          );
          assert.equal(
            user2BalanceAfterTransfer,
            constants.QTY_1,
            'User2 after balance mismatch'
          );

          // Check supply holder after
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
          ).to.equal(users.other2.address, 'Supply 1 after - holder mismatch');
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.PROMISE_DEPOSITBU1);
          const expectedSellerPrice = BN(constants.PROMISE_PRICE1);
          const expectedSellerDeposit = BN(constants.PROMISE_DEPOSITSE1);
          const expectedEscrowAmountDeposit = BN(0);
          const expectedEscrowAmountPrice = BN(0);

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
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
              expect(ev._type).to.be.oneOf(Object.values(paymentType));
              switch (ev._type) {
                case paymentType.PAYMENT:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong payment recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_PRICE1,
                    'Wrong payment amount'
                  );
                  break;
                case paymentType.DEPOSIT_SELLER:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong seller deposit recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_DEPOSITSE1,
                    'Wrong seller deposit amount'
                  );
                  break;
                case paymentType.DEPOSIT_BUYER:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.buyer.address,
                    'Wrong buyer deposit recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_DEPOSITBU1,
                    'Wrong buyer deposit amount'
                  );
                  break;
              }

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.other2.address
              );
            }
          );

          //Payments
          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.buyer.address)
          ).to.equal(
            expectedBuyerPrice,
            'Buyer did not get expected tokens from PriceTokenContract'
          );

          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.other2.address)
          ).to.equal(
            expectedSellerPrice,
            'Seller did not get expected tokens from PriceTokenContract'
          );

          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.deployer.address)
          ).to.equal(
            expectedEscrowAmountPrice,
            'Escrow did not get expected tokens from PriceTokenContract'
          );

          // //Deposits
          expect(
            await utils.contractBSNTokenDeposit.balanceOf(users.buyer.address)
          ).to.equal(
            expectedBuyerDeposit,
            'Buyer did not get expected tokens from DepositTokenContract'
          );

          expect(
            await utils.contractBSNTokenDeposit.balanceOf(users.other2.address)
          ).to.equal(
            expectedSellerDeposit,
            'Seller did not get expected tokens from DepositTokenContract'
          );

          expect(
            await utils.contractBSNTokenDeposit.balanceOf(
              users.deployer.address
            )
          ).to.equal(
            expectedEscrowAmountDeposit,
            'Escrow did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          expect(
            await utils.contractBSNTokenPrice.balanceOf(
              utils.contractCashier.address
            )
          ).to.equal(constants.ZERO, 'Cashier Contract is not empty');

          expect(
            await utils.contractBSNTokenDeposit.balanceOf(
              utils.contractCashier.address
            )
          ).to.equal(constants.ZERO, 'Cashier Contract is not empty');
        });

        it('New owner should be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.redeem(voucherID, users.buyer.signer);

          expect(await utils.cancel(voucherID, users.other2.signer))
            .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_FAULT_CANCEL)
            .withArgs(voucherID);
        });

        it('[NEGATIVE] Old owner should not be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.redeem(voucherID, users.buyer.signer);

          await expect(
            utils.cancel(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
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
              contractBSNTokenDeposit
            );

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            BN(constants.PROMISE_PRICE1)
          );

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_1
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          // Check supply holder before
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
          ).to.equal(users.other1.address, 'Supply 1 before - holder mismatch');

          // balances before
          const expectedBalanceInEscrow = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_1)
          );

          let actualOldOwnerBalanceFromEscrow =
            await contractCashier.getEscrowAmount(users.other1.address);
          let actualNewOwnerBalanceFromEscrow =
            await contractCashier.getEscrowAmount(users.other2.address);

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(constants.ZERO),
            'New owner balance from escrow does not match'
          );

          const user1BalanceBeforeTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other1.address,
              tokenSupplyKey
            )
          )[0];

          const user2BalanceBeforeTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other2.address,
              tokenSupplyKey
            )
          )[0];

          assert.equal(
            user1BalanceBeforeTransfer,
            constants.QTY_1,
            'User1 before balance mismatch'
          );
          assert.equal(
            user2BalanceBeforeTransfer,
            0,
            'User2 before balance mismatch'
          );

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          // balances after
          actualOldOwnerBalanceFromEscrow =
            await contractCashier.getEscrowAmount(users.other1.address);
          actualNewOwnerBalanceFromEscrow =
            await contractCashier.getEscrowAmount(users.other2.address);

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(constants.ZERO),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'New owner balance from escrow does not match'
          );

          const user1BalanceAfterTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other1.address,
              tokenSupplyKey
            )
          )[0];

          const user2BalanceAfterTransfer = (
            await contractVoucherSets.functions[fnSignatures.balanceOf1155](
              users.other2.address,
              tokenSupplyKey
            )
          )[0];

          assert.equal(
            user1BalanceAfterTransfer,
            0,
            'User1 after balance mismatch'
          );
          assert.equal(
            user2BalanceAfterTransfer,
            constants.QTY_1,
            'User2 after balance mismatch'
          );

          // Check supply holder after
          expect(
            await contractVoucherKernel.getSupplyHolder(tokenSupplyKey)
          ).to.equal(users.other2.address, 'Supply 1 after - holder mismatch');
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedSellerPrice = BN(constants.PROMISE_PRICE1);
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.PROMISE_DEPOSITBU1);
          const expectedSellerDeposit = BN(constants.PROMISE_DEPOSITSE1);
          const expectedEscrowAmountDeposit = BN(0);

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );
          await utils.redeem(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          // Payments in TKN
          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.buyer.address)
          ).to.equal(
            expectedBuyerPrice,
            'Buyer did not get expected tokens from PaymentTokenContract'
          );

          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.other2.address)
          ).to.equal(
            expectedSellerPrice,
            'Seller did not get expected tokens from PaymentTokenContract'
          );

          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.deployer.address)
          ).to.equal(
            expectedEscrowPrice,
            'Escrow did not get expected tokens from PaymentTokenContract'
          );

          const txReceipt = await withdrawTx.wait();

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
                users.other2.address
              );
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              expect(ev._type).to.be.oneOf(Object.values(paymentType));
              switch (ev._type) {
                case paymentType.PAYMENT:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong payment recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_PRICE1,
                    'Wrong payment amount'
                  );
                  break;
                case paymentType.DEPOSIT_SELLER:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong seller deposit recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_DEPOSITSE1,
                    'Wrong seller deposit amount'
                  );
                  break;
                case paymentType.DEPOSIT_BUYER:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.buyer.address,
                    'Wrong buyer deposit recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_DEPOSITBU1,
                    'Wrong buyer deposit amount'
                  );
                  break;
              }
            }
          );

          //Deposits in ETH
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
          expect(
            await utils.contractBSNTokenPrice.balanceOf(
              utils.contractCashier.address
            )
          ).to.equal(constants.ZERO, 'Cashier Contract is not empty');

          expect(
            await utils.contractBSNTokenDeposit.balanceOf(
              utils.contractCashier.address
            )
          ).to.equal(constants.ZERO, 'Cashier Contract is not empty');
        });

        it('New owner should be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.redeem(voucherID, users.buyer.signer);

          expect(await utils.cancel(voucherID, users.other2.signer))
            .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_FAULT_CANCEL)
            .withArgs(voucherID);
        });

        it('[NEGATIVE] Old owner should not be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.redeem(voucherID, users.buyer.signer);

          await expect(
            utils.cancel(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
        });
      });
    });
  });

  describe('VOUCHER TRANSFER', () => {
    const paymentType = {
      PAYMENT: 0,
      DEPOSIT_SELLER: 1,
      DEPOSIT_BUYER: 2,
    };

    beforeEach(() => {
      distributedAmounts = {
        buyerAmount: BN(0),
        sellerAmount: BN(0),
        escrowAmount: BN(0),
      };
    });

    describe('Common transfer', () => {
      let voucherID;
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

        tokenSupplyKey = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        );

        voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );
      });

      it('Should transfer a voucher', async () => {
        // balances before
        const expectedBalanceInEscrow = BN(constants.PROMISE_DEPOSITBU1).add(
          constants.PROMISE_PRICE1
        );

        let actualOldOwnerBalanceFromEscrow =
          await contractCashier.getEscrowAmount(users.other1.address);
        let actualNewOwnerBalanceFromEscrow =
          await contractCashier.getEscrowAmount(users.other2.address);

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(constants.ZERO),
          'New owner balance from escrow does not match'
        );

        expect(
          (
            await contractVouchers.functions[fnSignatures.balanceOf721](
              users.other1.address
            )
          )[0]
        ).to.equal(1, 'User1 before balance mismatch');

        expect(
          (
            await contractVouchers.functions[fnSignatures.balanceOf721](
              users.other2.address
            )
          )[0]
        ).to.equal(0, 'User2 before balance mismatch');

        expect(
          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          )
        )
          .to.emit(contractVouchers, eventNames.TRANSFER)
          .withArgs(users.other1.address, users.other2.address, voucherID);

        // balances after
        actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other1.address
        );
        actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(constants.ZERO),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'New owner balance from escrow does not match'
        );

        expect(await contractVouchers.balanceOf(users.other1.address)).to.equal(
          0,
          'User1 after balance mismatch'
        );

        expect(await contractVouchers.balanceOf(users.other2.address)).to.equal(
          1,
          'User2 after balance mismatch'
        );
      });

      it('Should transfer voucher to self and balance should be the same', async () => {
        // balances before
        const expectedBalanceInEscrow = BN(constants.PROMISE_DEPOSITBU1).add(
          constants.PROMISE_PRICE1
        );

        let actualOldOwnerBalanceFromEscrow =
          await contractCashier.getEscrowAmount(users.other1.address);

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );

        const balanceOf = contractVouchers.functions[fnSignatures.balanceOf721];

        const balanceBeforeTransfer = (
          await balanceOf(users.other1.address)
        )[0];

        expect(
          await utils.safeTransfer721(
            users.other1.address,
            users.other1.address,
            voucherID,
            users.other1.signer
          )
        )
          .to.emit(contractVouchers, eventNames.TRANSFER)
          .withArgs(users.other1.address, users.other1.address, voucherID);

        // balances after
        actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other1.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );

        const balanceAfterTransfer = (await balanceOf(users.other1.address))[0];

        assert.isTrue(
          balanceBeforeTransfer.eq(balanceAfterTransfer),
          'Balance mismatch!'
        );
      });
    });

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

        tokenSupplyKey = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        );
      });

      it('Should update escrow amounts after transfer', async () => {
        const expectedBalanceInEscrow = BN(constants.PROMISE_PRICE1).add(
          BN(constants.PROMISE_DEPOSITBU1)
        );

        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        let actualOldOwnerBalanceFromEscrowEth =
          await contractCashier.getEscrowAmount(users.other1.address);
        let actualNewOwnerBalanceFromEscrowEth =
          await contractCashier.getEscrowAmount(users.other2.address);

        assert.isTrue(
          actualOldOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrowEth.eq(constants.ZERO),
          'New owner balance from escrow does not match'
        );

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          users.other1.signer
        );

        actualOldOwnerBalanceFromEscrowEth =
          await contractCashier.getEscrowAmount(users.other1.address);
        actualNewOwnerBalanceFromEscrowEth =
          await contractCashier.getEscrowAmount(users.other2.address);

        assert.isTrue(
          actualOldOwnerBalanceFromEscrowEth.eq(constants.ZERO),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrow),
          'New owner balance from escrow does not match'
        );
      });

      it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
        const expectedBuyerAmount = BN(constants.PROMISE_DEPOSITBU1)
          .add(BN(constants.PROMISE_PRICE1))
          .add(BN(constants.PROMISE_DEPOSITSE1).div(BN(2)));
        const expectedSellerAmount = BN(constants.PROMISE_DEPOSITSE1).div(
          BN(4)
        );
        const expectedEscrowAmount = BN(constants.PROMISE_DEPOSITSE1).div(
          BN(4)
        );

        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          users.other1.signer
        );

        await utils.refund(voucherID, users.other2.signer);
        await utils.complain(voucherID, users.other2.signer);
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
          eventNames.LOG_WITHDRAWAL,
          (ev) => {
            expect(ev._payee).to.be.oneOf(
              [
                users.other2.address,
                users.seller.address,
                users.deployer.address,
              ],
              'Incorrect Payee'
            );
            switch (ev._payee) {
              case users.other2.address:
                expect(ev._payment.toNumber()).to.be.oneOf([
                  expectedBuyerAmount.sub(constants.PROMISE_PRICE1).toNumber(),
                  constants.PROMISE_PRICE1,
                ]);
                break;
              case users.seller.address:
                expect(ev._payment.toNumber()).to.be.oneOf([
                  BN(constants.PROMISE_DEPOSITSE1).div(4).toNumber(),
                  constants.PROMISE_DEPOSITBU1,
                ]);
                break;
              case users.deployer.address:
                assert.equal(
                  ev._payment,
                  BN(constants.PROMISE_DEPOSITSE1).div(4).toNumber()
                );
                break;
            }
          }
        );

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            expect(ev._type).to.be.oneOf(
              Object.values(paymentType),
              'Wrong payment type'
            );
            switch (ev._type) {
              case paymentType.PAYMENT:
                assert.equal(
                  ev._tokenIdVoucher.toString(),
                  voucherID.toString(),
                  'Wrong token id voucher'
                );
                assert.equal(
                  ev._to,
                  users.other2.address,
                  'Wrong payment recipient'
                );
                assert.equal(
                  ev._payment,
                  constants.PROMISE_PRICE1,
                  'Wrong payment amount'
                );
                break;
              case paymentType.DEPOSIT_SELLER:
                expect(ev._to).to.be.oneOf(
                  [
                    users.seller.address,
                    users.deployer.address,
                    users.other2.address,
                  ],
                  'Unexpected recipient'
                );

                switch (ev._to) {
                  case users.other2.address:
                    assert.equal(
                      ev._tokenIdVoucher.toString(),
                      voucherID.toString(),
                      'Wrong token id voucher'
                    );
                    assert.equal(
                      ev._payment,
                      BN(constants.PROMISE_DEPOSITSE1).div(2).toString(),
                      'Wrong payment amount'
                    );
                    break;
                  case users.seller.address:
                    assert.equal(
                      ev._tokenIdVoucher.toString(),
                      voucherID.toString(),
                      'Wrong token id voucher'
                    );
                    assert.equal(
                      ev._payment,
                      BN(constants.PROMISE_DEPOSITSE1).div(4).toString(),
                      'Wrong payment amount'
                    );
                    break;
                  case users.deployer.address:
                    assert.equal(
                      ev._tokenIdVoucher.toString(),
                      voucherID.toString(),
                      'Wrong token id voucher'
                    );
                    assert.equal(
                      ev._payment,
                      BN(constants.PROMISE_DEPOSITSE1).div(4).toString(),
                      'Wrong payment amount'
                    );
                    break;
                }
                break;
              case paymentType.DEPOSIT_BUYER:
                assert.equal(
                  ev._tokenIdVoucher.toString(),
                  voucherID.toString(),
                  'Wrong token id voucher'
                );
                assert.equal(
                  ev._to,
                  users.other2.address,
                  'Wrong buyer deposit recipient'
                );
                assert.equal(
                  ev._payment,
                  constants.PROMISE_DEPOSITBU1,
                  'Wrong buyer deposit amount'
                );
                break;
            }

            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.other2.address,
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

      it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.refund(voucherID, users.other1.signer);
        await utils.complain(voucherID, users.other1.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        await utils.withdraw(voucherID, users.deployer.signer);

        await expect(
          utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          )
        ).to.be.revertedWith(revertReasons.FUNDS_RELEASED);
      });

      it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          users.other1.signer
        );

        await expect(
          utils.redeem(voucherID, users.other1.signer)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);

        await expect(
          utils.refund(voucherID, users.other1.signer)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
      });

      it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        await expect(
          utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.attacker.signer
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_721);
      });
    });

    describe('[WITH PERMIT]', () => {
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

          const supplyQty = 1;
          const tokensToMint = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(supplyQty)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            BN(constants.PROMISE_DEPOSITBU1)
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            supplyQty
          );
        });

        beforeEach(async () => {
          distributedAmounts = {
            buyerAmount: BN(0),
            sellerAmount: BN(0),
            escrowAmount: BN(0),
          };
        });

        it('Should update escrow amounts after transfer', async () => {
          const expectedBalanceInEscrowEth = BN(constants.PROMISE_PRICE1);
          const expectedBalanceInEscrowTkn = BN(constants.PROMISE_DEPOSITBU1);

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          let actualOldOwnerBalanceFromEscrowEth =
            await contractCashier.getEscrowAmount(users.other1.address);

          let actualOldOwnerBalanceFromEscrowTkn =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            );

          let actualNewOwnerBalanceFromEscrowEth =
            await contractCashier.getEscrowAmount(users.other2.address);

          let actualNewOwnerBalanceFromEscrowTkn =
            await contractCashier.getEscrowTokensAmount(
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
            actualNewOwnerBalanceFromEscrowEth.eq(constants.ZERO),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTkn.eq(constants.ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          actualOldOwnerBalanceFromEscrowEth =
            await contractCashier.getEscrowAmount(users.other1.address);

          actualOldOwnerBalanceFromEscrowTkn =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            );

          actualNewOwnerBalanceFromEscrowEth =
            await contractCashier.getEscrowAmount(users.other2.address);

          actualNewOwnerBalanceFromEscrowTkn =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other2.address
            );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowEth.eq(constants.ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTkn.eq(constants.ZERO),
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
          const expectedBuyerPrice = BN(constants.PROMISE_PRICE1);
          const expectedBuyerDeposit = BN(constants.PROMISE_DEPOSITBU1).add(
            BN(constants.PROMISE_DEPOSITSE1).div(BN(2))
          );
          const expectedSellerDeposit = BN(constants.PROMISE_DEPOSITSE1).div(
            BN(4)
          );
          const expectedEscrowAmountDeposit = BN(
            constants.PROMISE_DEPOSITSE1
          ).div(BN(4));

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          await utils.refund(voucherID, users.other2.signer);
          await utils.complain(voucherID, users.other2.signer);
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
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              expect(ev._payee).to.be.oneOf(
                [
                  users.other2.address,
                  users.seller.address,
                  users.deployer.address,
                ],
                'Incorrect Payee'
              );
              switch (ev._payee) {
                case users.other2.address:
                  expect(ev._payment.toNumber()).to.be.oneOf([
                    constants.PROMISE_PRICE1,
                  ]);
                  break;
                case users.seller.address:
                  expect(ev._payment.toNumber()).to.be.oneOf([
                    BN(constants.PROMISE_DEPOSITSE1).div(4).toNumber(),
                    constants.PROMISE_DEPOSITBU1,
                  ]);
                  break;
                case users.deployer.address:
                  assert.equal(
                    ev._payment,
                    BN(constants.PROMISE_DEPOSITSE1).div(4).toNumber()
                  );
                  break;
              }
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,

            (ev) => {
              expect(ev._type).to.be.oneOf(
                Object.values(paymentType),
                'Wrong payment type'
              );
              switch (ev._type) {
                case paymentType.PAYMENT:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong payment recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_PRICE1,
                    'Wrong payment amount'
                  );
                  break;
                case paymentType.DEPOSIT_SELLER:
                  expect(ev._to).to.be.oneOf(
                    [
                      users.seller.address,
                      users.deployer.address,
                      users.other2.address,
                    ],
                    'Unexpected recipient'
                  );

                  switch (ev._to) {
                    case users.other2.address:
                      assert.equal(
                        ev._tokenIdVoucher.toString(),
                        voucherID.toString(),
                        'Wrong token id voucher'
                      );
                      assert.equal(
                        ev._payment,
                        BN(constants.PROMISE_DEPOSITSE1).div(2).toString(),
                        'Wrong payment amount'
                      );
                      break;
                    case users.seller.address:
                      assert.equal(
                        ev._tokenIdVoucher.toString(),
                        voucherID.toString(),
                        'Wrong token id voucher'
                      );
                      assert.equal(
                        ev._payment,
                        BN(constants.PROMISE_DEPOSITSE1).div(4).toString(),
                        'Wrong payment amount'
                      );
                      break;
                    case users.deployer.address:
                      assert.equal(
                        ev._tokenIdVoucher.toString(),
                        voucherID.toString(),
                        'Wrong token id voucher'
                      );
                      assert.equal(
                        ev._payment,
                        BN(constants.PROMISE_DEPOSITSE1).div(4).toString(),
                        'Wrong payment amount'
                      );
                      break;
                  }
                  break;
                case paymentType.DEPOSIT_BUYER:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong buyer deposit recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_DEPOSITBU1,
                    'Wrong buyer deposit amount'
                  );
                  break;
              }

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.other2.address
              );
            }
          );

          // Payment should have been returned to buyer
          // const txReceipt = await withdrawTx.wait();
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(ev._payee, users.other2.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          //Deposits
          expect(
            await utils.contractBSNTokenDeposit.balanceOf(users.other2.address)
          ).to.equal(
            expectedBuyerDeposit,
            'NewVoucherOwner did not get expected tokens from DepositTokenContract'
          );
          expect(
            await utils.contractBSNTokenDeposit.balanceOf(users.seller.address)
          ).to.equal(
            expectedSellerDeposit,
            'Seller did not get expected tokens from DepositTokenContract'
          );
          expect(
            await utils.contractBSNTokenDeposit.balanceOf(
              users.deployer.address
            )
          ).to.equal(
            expectedEscrowAmountDeposit,
            'Escrow did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          expect(
            await utils.contractBSNTokenPrice.balanceOf(
              utils.contractCashier.address
            )
          ).to.equal(constants.ZERO, 'Cashier Contract is not empty');

          expect(
            await utils.contractBSNTokenDeposit.balanceOf(
              utils.contractCashier.address
            )
          ).to.equal(constants.ZERO, 'Cashier Contract is not empty');
        });

        it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.refund(voucherID, users.other1.signer);
          await utils.complain(voucherID, users.other1.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await utils.withdraw(voucherID, users.deployer.signer);

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.other1.signer
            )
          ).to.be.revertedWith(revertReasons.FUNDS_RELEASED);
        });

        it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          await expect(
            utils.redeem(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);

          await expect(
            utils.refund(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
        });

        it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.attacker.signer
            )
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_721);
        });
      });

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

          const supplyQty = 1;
          const tokensToMint = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(supplyQty)
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
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            supplyQty
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          const expectedBalanceInEscrowTknPrice = BN(constants.PROMISE_PRICE1);
          const expectedBalanceInEscrowTknDeposit = BN(
            constants.PROMISE_DEPOSITBU1
          );
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          let actualOldOwnerBalanceFromEscrowTknPrice =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.other1.address
            );

          let actualOldOwnerBalanceFromEscrowTknDeposit =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            );

          let actualNewOwnerBalanceFromEscrowTknPrice =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.other2.address
            );

          let actualNewOwnerBalanceFromEscrowTknDeposit =
            await contractCashier.getEscrowTokensAmount(
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
            actualNewOwnerBalanceFromEscrowTknPrice.eq(constants.ZERO),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTknDeposit.eq(constants.ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          actualOldOwnerBalanceFromEscrowTknPrice =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.other1.address
            );

          actualOldOwnerBalanceFromEscrowTknDeposit =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            );

          actualNewOwnerBalanceFromEscrowTknPrice =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.other2.address
            );

          actualNewOwnerBalanceFromEscrowTknDeposit =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other2.address
            );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTknPrice.eq(constants.ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTknDeposit.eq(constants.ZERO),
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
          const expectedBuyerPrice = BN(constants.PROMISE_PRICE1);
          const expectedBuyerDeposit = BN(constants.PROMISE_DEPOSITBU1).add(
            BN(constants.PROMISE_DEPOSITSE1).div(BN(2))
          );
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(constants.PROMISE_DEPOSITSE1).div(
            BN(4)
          );
          const expectedEscrowAmountDeposit = BN(
            constants.PROMISE_DEPOSITSE1
          ).div(BN(4));
          const expectedEscrowAmountPrice = BN(0);

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          await utils.refund(voucherID, users.other2.signer);
          await utils.complain(voucherID, users.other2.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          // await utils.withdraw(voucherID, users.deployer.signer);
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
              expect(ev._type).to.be.oneOf(
                Object.values(paymentType),
                'Wrong payment type'
              );
              switch (ev._type) {
                case paymentType.PAYMENT:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong payment recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_PRICE1,
                    'Wrong payment amount'
                  );
                  break;
                case paymentType.DEPOSIT_SELLER:
                  expect(ev._to).to.be.oneOf(
                    [
                      users.seller.address,
                      users.deployer.address,
                      users.other2.address,
                    ],
                    'Unexpected recipient'
                  );

                  switch (ev._to) {
                    case users.other2.address:
                      assert.equal(
                        ev._tokenIdVoucher.toString(),
                        voucherID.toString(),
                        'Wrong token id voucher'
                      );
                      assert.equal(
                        ev._payment,
                        BN(constants.PROMISE_DEPOSITSE1).div(2).toString(),
                        'Wrong payment amount'
                      );
                      break;
                    case users.seller.address:
                      assert.equal(
                        ev._tokenIdVoucher.toString(),
                        voucherID.toString(),
                        'Wrong token id voucher'
                      );
                      assert.equal(
                        ev._payment,
                        BN(constants.PROMISE_DEPOSITSE1).div(4).toString(),
                        'Wrong payment amount'
                      );
                      break;
                    case users.deployer:
                      assert.equal(
                        ev._tokenIdVoucher.toString(),
                        voucherID.toString(),
                        'Wrong token id voucher'
                      );
                      assert.equal(
                        ev._payment,
                        BN(constants.PROMISE_DEPOSITSE1).div(4).toString(),
                        'Wrong payment amount'
                      );
                      break;
                  }
                  break;
                case paymentType.DEPOSIT_BUYER:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong buyer deposit recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_DEPOSITBU1,
                    'Wrong buyer deposit amount'
                  );
                  break;
              }

              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.other2.address
              );
            }
          );

          //Payments
          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.other2.address)
          ).to.equal(
            expectedBuyerPrice,
            'Buyer did not get expected tokens from PriceTokenContract'
          );

          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.seller.address)
          ).to.equal(
            expectedSellerPrice,
            'Seller did not get expected tokens from PriceTokenContract'
          );

          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.deployer.address)
          ).to.equal(
            expectedEscrowAmountPrice,
            'Escrow did not get expected tokens from PriceTokenContract'
          );

          //Deposits
          expect(
            await utils.contractBSNTokenDeposit.balanceOf(users.other2.address)
          ).to.equal(
            expectedBuyerDeposit,
            'Buyer did not get expected tokens from DepositTokenContract'
          );

          expect(
            await utils.contractBSNTokenDeposit.balanceOf(users.seller.address)
          ).to.equal(
            expectedSellerDeposit,
            'Seller did not get expected tokens from DepositTokenContract'
          );

          expect(
            await utils.contractBSNTokenDeposit.balanceOf(
              users.deployer.address
            )
          ).to.equal(
            expectedEscrowAmountDeposit,
            'Buyer did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          expect(
            await utils.contractBSNTokenPrice.balanceOf(
              utils.contractCashier.address
            )
          ).to.equal(constants.ZERO, 'Cashier Contract is not empty');

          expect(
            await utils.contractBSNTokenDeposit.balanceOf(
              utils.contractCashier.address
            )
          ).to.equal(constants.ZERO, 'Cashier Contract is not empty');
        });

        it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.refund(voucherID, users.other1.signer);
          await utils.complain(voucherID, users.other1.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await utils.withdraw(voucherID, users.deployer.signer);

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.other1.signer
            )
          ).to.be.revertedWith(revertReasons.FUNDS_RELEASED);
        });

        it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          await expect(
            utils.redeem(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);

          await expect(
            utils.refund(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
        });

        it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.attacker.signer
            )
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_721);
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
              contractBSNTokenDeposit
            );

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.other1.address,
            BN(constants.PROMISE_PRICE1)
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_1
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          const expectedBalanceInEscrowEth = BN(constants.PROMISE_DEPOSITBU1);
          const expectedBalanceInEscrowTkn = BN(constants.PROMISE_PRICE1);
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          let actualOldOwnerBalanceFromEscrowEth =
            await contractCashier.getEscrowAmount(users.other1.address);

          let actualOldOwnerBalanceFromEscrowTkn =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.other1.address
            );

          let actualNewOwnerBalanceFromEscrowEth =
            await contractCashier.getEscrowAmount(users.other2.address);

          let actualNewOwnerBalanceFromEscrowTkn =
            await contractCashier.getEscrowTokensAmount(
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
            actualNewOwnerBalanceFromEscrowEth.eq(constants.ZERO),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTkn.eq(constants.ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          actualOldOwnerBalanceFromEscrowEth =
            await contractCashier.getEscrowAmount(users.other1.address);

          actualOldOwnerBalanceFromEscrowTkn =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.other1.address
            );

          actualNewOwnerBalanceFromEscrowEth =
            await contractCashier.getEscrowAmount(users.other2.address);

          actualNewOwnerBalanceFromEscrowTkn =
            await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.other2.address
            );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowEth.eq(constants.ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTkn.eq(constants.ZERO),
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
          const expectedBuyerPrice = BN(constants.PROMISE_PRICE1);
          const expectedSellerPrice = BN(0);
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.PROMISE_DEPOSITBU1).add(
            BN(constants.PROMISE_DEPOSITSE1).div(BN(2))
          );
          const expectedSellerDeposit = BN(constants.PROMISE_DEPOSITSE1).div(
            BN(4)
          );
          const expectedEscrowAmountDeposit = BN(
            constants.PROMISE_DEPOSITSE1
          ).div(BN(4));

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );
          await utils.refund(voucherID, users.other2.signer);
          await utils.complain(voucherID, users.other2.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          const txReceipt = await withdrawTx.wait();

          // Payments in TKN
          // Payment should have been returned to buyer
          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.other2.address)
          ).to.equal(
            expectedBuyerPrice,
            'Buyer did not get expected tokens from PaymentTokenContract'
          );
          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.seller.address)
          ).to.equal(
            expectedSellerPrice,
            'Seller did not get expected tokens from PaymentTokenContract'
          );
          expect(
            await utils.contractBSNTokenPrice.balanceOf(users.deployer.address)
          ).to.equal(
            expectedEscrowPrice,
            'Escrow did not get expected tokens from PaymentTokenContract'
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              expect(ev._payee).to.be.oneOf(
                [
                  users.other2.address,
                  users.seller.address,
                  users.deployer.address,
                ],
                'Incorrect Payee'
              );
              switch (ev._payee) {
                case users.other2.address:
                  assert.equal(
                    ev._payment.toString(),
                    expectedBuyerDeposit.toString(),
                    'Wrong payment amount'
                  );
                  break;
                case users.seller.address:
                  assert.equal(
                    ev._payment.toString(),
                    BN(constants.PROMISE_DEPOSITSE1).div(4).toString(),
                    'Wrong payment amount'
                  );
                  break;
                case users.deployer.address:
                  assert.equal(
                    ev._payment,
                    BN(constants.PROMISE_DEPOSITSE1).div(4).toString(),
                    'Wrong payment amount'
                  );
                  break;
              }
            }
          );

          // //Deposits in ETH
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_AMOUNT_DISTRIBUTION,
            (ev) => {
              expect(ev._type).to.be.oneOf(
                Object.values(paymentType),
                'Wrong payment type'
              );
              switch (ev._type) {
                case paymentType.PAYMENT:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong payment recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_PRICE1,
                    'Wrong payment amount'
                  );
                  break;
                case paymentType.DEPOSIT_SELLER:
                  expect(ev._to).to.be.oneOf(
                    [
                      users.seller.address,
                      users.deployer.address,
                      users.other2.address,
                    ],
                    'Unexpected recipient'
                  );

                  switch (ev._to) {
                    case users.seller.address:
                      assert.equal(
                        ev._tokenIdVoucher.toString(),
                        voucherID.toString(),
                        'Wrong token id voucher'
                      );
                      assert.equal(
                        ev._payment,
                        BN(constants.PROMISE_DEPOSITSE1).div(4).toString(),
                        'Wrong payment amount'
                      );
                      break;
                    case users.deployer.address:
                      assert.equal(
                        ev._tokenIdVoucher.toString(),
                        voucherID.toString(),
                        'Wrong token id voucher'
                      );
                      assert.equal(
                        ev._payment,
                        BN(constants.PROMISE_DEPOSITSE1).div(4).toString(),
                        'Wrong payment amount'
                      );
                      break;
                    case users.other2.address:
                      assert.equal(
                        ev._tokenIdVoucher.toString(),
                        voucherID.toString(),
                        'Wrong token id voucher'
                      );
                      assert.equal(
                        ev._payment,
                        BN(constants.PROMISE_DEPOSITSE1).div(2).toString(),
                        'Wrong payment amount'
                      );
                      break;
                  }
                  break;
                case paymentType.DEPOSIT_BUYER:
                  assert.equal(
                    ev._tokenIdVoucher.toString(),
                    voucherID.toString(),
                    'Wrong token id voucher'
                  );
                  assert.equal(
                    ev._to,
                    users.other2.address,
                    'Wrong buyer deposit recipient'
                  );
                  assert.equal(
                    ev._payment,
                    constants.PROMISE_DEPOSITBU1,
                    'Wrong buyer deposit amount'
                  );
                  break;
              }
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_payee',
                users.other2.address,
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
          expect(
            await utils.contractBSNTokenPrice.balanceOf(
              utils.contractCashier.address
            )
          ).to.equal(constants.ZERO, 'Cashier Contract is not empty');

          expect(
            await utils.contractBSNTokenDeposit.balanceOf(
              utils.contractCashier.address
            )
          ).to.equal(constants.ZERO, 'Cashier Contract is not empty');
        });

        it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.refund(voucherID, users.other1.signer);
          await utils.complain(voucherID, users.other1.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await utils.withdraw(voucherID, users.deployer.signer);

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.other1.signer
            )
          ).to.be.revertedWith(revertReasons.FUNDS_RELEASED);
        });

        it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          await expect(
            utils.redeem(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);

          await expect(
            utils.refund(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
        });

        it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          );

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.attacker.signer
            )
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_721);
        });
      });
    });
  });
});
