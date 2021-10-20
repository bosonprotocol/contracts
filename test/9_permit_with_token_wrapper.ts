import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract, Wallet} from 'ethers';
import {waffle} from 'hardhat';
import {assert, expect} from 'chai';
import {ecsign} from 'ethereumjs-util';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import {toWei, getApprovalDigest} from '../testHelpers/permitUtils';
import {getApprovalDigestDAI} from '../testHelpers/permitUtilsDAI';
import {advanceTimeSeconds} from '../testHelpers/timemachine';
import {
  BosonRouter,
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
  DAITokenWrapper,
} from '../typechain';
import IDAI from '../artifacts/contracts/interfaces/IDAI.sol/IDAI.json';
import IERC20WithPermit from '../artifacts/contracts/interfaces/IERC20WithPermit.sol/IERC20WithPermit.json';
import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
import fnSignatures from '../testHelpers/functionSignatures';

const provider = waffle.provider;
const {deployMockContract} = waffle;
const BN = ethers.BigNumber.from;

let ERC1155ERC721_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;
let DAITokenWrapper_Factory: ContractFactory;

const eventNames = eventUtils.eventNames;
let users;
let mockDAI: Contract;
let mockUnsupportedToken: Contract;
let daiOwner, unsupportedTokenOwner: Wallet;

describe('Create Voucher sets and commit to vouchers with token wrapper', () => {
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
    DAITokenWrapper_Factory = await ethers.getContractFactory(
      'DAITokenWrapper'
    );
  });

  let contractERC1155ERC721: ERC1155ERC721,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractBSNTokenPrice: MockERC20Permit,
    contractBSNTokenDeposit: MockERC20Permit,
    contractTokenRegistry: TokenRegistry,
    contractDAITokenWrapper: DAITokenWrapper;

  let tokenSupplyKey, tokenVoucherKey;

  const deadline = toWei(1);
  let timestamp;
  let txReceipt;

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

    [daiOwner, unsupportedTokenOwner] = provider.getWallets();
    mockDAI = await deployMockContract(daiOwner, IDAI.abi); //deploys mock
    mockUnsupportedToken = await deployMockContract(
      unsupportedTokenOwner,
      IERC20WithPermit.abi
    ); //deploys mock unsupported token.

    contractDAITokenWrapper = (await DAITokenWrapper_Factory.deploy(
      mockDAI.address
    )) as Contract & DAITokenWrapper;

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
    await contractTokenRegistry.setTokenLimit(
      mockDAI.address,
      constants.TOKEN_LIMIT
    );
    await contractTokenRegistry.setTokenLimit(
      mockUnsupportedToken.address,
      constants.TOKEN_LIMIT
    );
    await contractTokenRegistry.setETHLimit(constants.ETHER_LIMIT);
    await contractTokenRegistry.setTokenWrapperAddress(
      mockDAI.address,
      contractDAITokenWrapper.address
    );

    //Map $BOSON token to itself so that the token address can be called by casting to the wrapper interface in the Boson Router
    await contractTokenRegistry.setTokenWrapperAddress(
      contractBSNTokenPrice.address,
      contractBSNTokenPrice.address
    );

    await contractDAITokenWrapper.setTokenAddress(mockDAI.address);
  }

  describe('TOKEN SUPPLY CREATION WITH TOKEN WRAPPER (Create Voucher Set)', () => {
    const paymentMethods = {
      ETHETH: 1,
      ETHTKN: 2,
      TKNETH: 3,
      TKNTKN: 4,
    };

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', () => {
        beforeEach(async () => {
          await deployContracts();

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          await mockDAI.mock.nonces.withArgs(users.seller.address).returns(0);
          await mockDAI.mock.permit.returns();
          await mockDAI.mock.name.returns('MockDAI');
          await mockDAI.mock.transferFrom
            .withArgs(users.seller.address, contractCashier.address, txValue)
            .returns(true);

          const digest = await getApprovalDigestDAI(
            mockDAI,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            0,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          ) as BosonRouter;

          const txOrder = await sellerInstance.requestCreateOrderETHTKNWithPermit(
            mockDAI.address,
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
            ],
            {
              from: users.seller.address,
            }
          );

          txReceipt = await txOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            BosonRouter_Factory,
            eventNames.LOG_ORDER_CREATED,
            (ev) => {
              tokenSupplyKey = BN(ev._tokenIdSupply);
            }
          );
        });

        it('Should emit the correct events and set correct state', async () => {
          eventUtils.assertEventEmitted(
            txReceipt,
            BosonRouter_Factory,
            eventNames.LOG_ORDER_CREATED,
            (ev) => {
              assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
              assert.isTrue(ev._seller === users.seller.address);
              assert.isTrue(ev._quantity.eq(constants.QTY_10));
              assert.isTrue(BN(ev._paymentType).eq(paymentMethods.ETHTKN));
              tokenSupplyKey = BN(ev._tokenIdSupply);
            }
          );

          let promiseId1;

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_PROMISE_CREATED,
            (ev) => {
              assert.isTrue(ev._promiseId > constants.ZERO_BYTES);
              assert.isTrue(ev._nonce.eq(constants.ONE));
              assert.isTrue(ev._seller === users.seller.address);
              assert.isTrue(ev._validFrom.eq(constants.PROMISE_VALID_FROM));
              assert.isTrue(ev._validTo.eq(constants.PROMISE_VALID_TO));
              assert.isTrue(ev._idx.eq(constants.ZERO));

              promiseId1 = ev._promiseId;
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            ERC1155ERC721_Factory,
            eventNames.TRANSFER_SINGLE,
            (ev) => {
              assert.isTrue(ev._operator === contractVoucherKernel.address);
              assert.isTrue(ev._from === constants.ZERO_ADDRESS);
              assert.isTrue(ev._to === users.seller.address);
              assert.isTrue(ev._id.eq(tokenSupplyKey));
              assert.isTrue(ev._value.eq(constants.QTY_10));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            DAITokenWrapper_Factory,
            eventNames.LOG_PERMIT_CALLED_ON_TOKEN,
            (ev) => {
              assert.isTrue(ev._tokenAddress === mockDAI.address);
              assert.isTrue(ev._owner === users.seller.address);
              assert.isTrue(ev._spender === contractBosonRouter.address);
              assert.isTrue(ev._value == 0);
            }
          );

          //Check VocherKernel State
          const promiseData = await contractVoucherKernel.getPromiseData(
            promiseId1
          );
          assert.equal(
            promiseData[constants.PROMISE_DATA_FIELDS.promiseId],
            promiseId1,
            'Promise Id incorrect'
          );

          assert.equal(
            promiseData[constants.PROMISE_DATA_FIELDS.nonce].toString(),
            constants.ONE.toString(),
            'Nonce is incorrect'
          );
          assert.equal(
            promiseData[constants.PROMISE_DATA_FIELDS.validFrom].toString(),
            constants.PROMISE_VALID_FROM.toString()
          );

          assert.equal(
            promiseData[constants.PROMISE_DATA_FIELDS.validTo].toString(),
            constants.PROMISE_VALID_TO.toString()
          );
          assert.equal(
            promiseData[constants.PROMISE_DATA_FIELDS.idx].toString(),
            constants.ZERO.toString()
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
            )
          );
          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
              BN(constants.PROMISE_DEPOSITSE1)
            )
          );
          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
              BN(constants.PROMISE_DEPOSITBU1)
            )
          );

          const tokenNonce = await contractVoucherKernel.getTokenNonce(
            users.seller.address
          );
          assert.isTrue(tokenNonce.eq(constants.ONE));

          assert.equal(
            promiseId1,
            await contractVoucherKernel.getPromiseIdFromSupplyId(tokenSupplyKey)
          );

          //Check ERC1155ERC721 state
          const sellerERC1155ERC721Balance = (
            await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
              users.seller.address,
              tokenSupplyKey
            )
          )[0];

          assert.isTrue(sellerERC1155ERC721Balance.eq(constants.QTY_10));
        });

        it('Should update escrow correctly', async () => {
          const expectedTokenBalance = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          const escrowTokens = await contractCashier.getEscrowTokensAmount(
            mockDAI.address,
            users.seller.address
          );

          assert.isTrue(
            escrowTokens.eq(expectedTokenBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Should create payment method ETHTKN', async () => {
          const paymentMethod = await contractVoucherKernel.getVoucherPaymentMethod(
            tokenSupplyKey
          );

          const addressTokenPrice = await contractVoucherKernel.getVoucherPriceToken(
            tokenSupplyKey
          );

          const addressTokenDeposits = await contractVoucherKernel.getVoucherDepositToken(
            tokenSupplyKey
          );

          assert.equal(
            paymentMethod.toString(),
            paymentMethods.ETHTKN.toString(),
            'Payment Method ETHTKN not set correctly'
          );
          assert.equal(
            addressTokenPrice.toString(),
            constants.ZERO_ADDRESS,
            'ETHTKN Method Price Token Address mismatch'
          );
          assert.equal(
            addressTokenDeposits.toString(),
            mockDAI.address,
            'ETHTKN Method Deposit Token Address mismatch'
          );
        });

        it('[NEGATIVE] Should revert if token doesn not have a registered token wrapper', async () => {
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          await mockUnsupportedToken.mock.nonces
            .withArgs(users.seller.address)
            .returns(0);
          await mockUnsupportedToken.mock.permit.returns();
          await mockUnsupportedToken.mock.name.returns(
            'Mock Unsupported Token'
          );

          const digest = await getApprovalDigest(
            mockUnsupportedToken,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            0,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          ) as BosonRouter;

          await expect(
            sellerInstance.requestCreateOrderETHTKNWithPermit(
              mockUnsupportedToken.address,
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
              ],
              {
                from: users.seller.address,
              }
            )
          ).to.be.revertedWith(revertReasons.UNSUPPORTED_TOKEN);
        });

        it('[NEGATIVE] Should revert if token wrapper reverts because of invalid deadline', async () => {
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          await mockDAI.mock.nonces.withArgs(users.seller.address).returns(0);
          await mockDAI.mock.permit.revertsWithReason(
            revertReasons.DAI_PERMIT_EXPIRED
          );
          await mockDAI.mock.name.returns('MockDAI');

          const digest = await getApprovalDigestDAI(
            mockDAI,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            0,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          ) as BosonRouter;

          timestamp = await Utils.getCurrTimestamp();
          const newDeadline: number = timestamp + 2 * constants.ONE_MINUTE;

          await advanceTimeSeconds(newDeadline * 2);

          await expect(
            sellerInstance.requestCreateOrderETHTKNWithPermit(
              mockDAI.address,
              txValue,
              newDeadline,
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
              ],
              {
                from: users.seller.address,
              }
            )
          ).to.be.revertedWith(revertReasons.DAI_PERMIT_EXPIRED);
        });

        it('[NEGATIVE] Should revert if token wrapper reverts because of invalid signature', async () => {
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          await mockDAI.mock.nonces.withArgs(users.seller.address).returns(0);
          await mockDAI.mock.permit.returns();
          await mockDAI.mock.name.returns('MockDAI');

          const digest = await getApprovalDigestDAI(
            mockDAI,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            0,
            deadline
          );

          const {v, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          ) as BosonRouter;

          await expect(
            sellerInstance.requestCreateOrderETHTKNWithPermit(
              mockDAI.address,
              txValue,
              deadline,
              v,
              ethers.constants.HashZero,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              {
                from: users.seller.address,
              }
            )
          ).to.be.revertedWith(revertReasons.INVALID_SIGNATURE_COMPONENTS);
        });
      });

      describe('TKNTKN', () => {
        beforeEach(async () => {
          await deployContracts();

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          await mockDAI.mock.nonces.withArgs(users.seller.address).returns(0);
          await mockDAI.mock.permit.returns();
          await mockDAI.mock.name.returns('MockDAI');
          await mockDAI.mock.transferFrom
            .withArgs(users.seller.address, contractCashier.address, txValue)
            .returns(true);

          const digest = await getApprovalDigestDAI(
            mockDAI,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            0,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          ) as BosonRouter;

          const txOrder = await sellerInstance.requestCreateOrderTKNTKNWithPermit(
            mockDAI.address,
            mockDAI.address,
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
            ],
            {
              from: users.seller.address,
            }
          );

          txReceipt = await txOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            BosonRouter_Factory,
            eventNames.LOG_ORDER_CREATED,
            (ev) => {
              tokenSupplyKey = BN(ev._tokenIdSupply);
            }
          );
        });

        it('Should emit the correct events and set correct state', async () => {
          eventUtils.assertEventEmitted(
            txReceipt,
            BosonRouter_Factory,
            eventNames.LOG_ORDER_CREATED,
            (ev) => {
              assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
              assert.isTrue(ev._seller === users.seller.address);
              assert.isTrue(ev._quantity.eq(constants.QTY_10));
              assert.isTrue(BN(ev._paymentType).eq(paymentMethods.TKNTKN));
              tokenSupplyKey = BN(ev._tokenIdSupply);
            }
          );

          let promiseId1;

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_PROMISE_CREATED,
            (ev) => {
              assert.isTrue(ev._promiseId > constants.ZERO_BYTES);
              assert.isTrue(ev._nonce.eq(constants.ONE));
              assert.isTrue(ev._seller === users.seller.address);
              assert.isTrue(ev._validFrom.eq(constants.PROMISE_VALID_FROM));
              assert.isTrue(ev._validTo.eq(constants.PROMISE_VALID_TO));
              assert.isTrue(ev._idx.eq(constants.ZERO));

              promiseId1 = ev._promiseId;
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            ERC1155ERC721_Factory,
            eventNames.TRANSFER_SINGLE,
            (ev) => {
              assert.isTrue(ev._operator === contractVoucherKernel.address);
              assert.isTrue(ev._from === constants.ZERO_ADDRESS);
              assert.isTrue(ev._to === users.seller.address);
              assert.isTrue(ev._id.eq(tokenSupplyKey));
              assert.isTrue(ev._value.eq(constants.QTY_10));
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            DAITokenWrapper_Factory,
            eventNames.LOG_PERMIT_CALLED_ON_TOKEN,
            (ev) => {
              assert.isTrue(ev._tokenAddress === mockDAI.address);
              assert.isTrue(ev._owner === users.seller.address);
              assert.isTrue(ev._spender === contractBosonRouter.address);
              assert.isTrue(ev._value == 0);
            }
          );

          //Check VocherKernel State
          const promiseData = await contractVoucherKernel.getPromiseData(
            promiseId1
          );
          assert.equal(
            promiseData[constants.PROMISE_DATA_FIELDS.promiseId],
            promiseId1,
            'Promise Id incorrect'
          );

          assert.equal(
            promiseData[constants.PROMISE_DATA_FIELDS.nonce].toString(),
            constants.ONE.toString(),
            'Nonce is incorrect'
          );
          assert.equal(
            promiseData[constants.PROMISE_DATA_FIELDS.validFrom].toString(),
            constants.PROMISE_VALID_FROM.toString()
          );

          assert.equal(
            promiseData[constants.PROMISE_DATA_FIELDS.validTo].toString(),
            constants.PROMISE_VALID_TO.toString()
          );
          assert.equal(
            promiseData[constants.PROMISE_DATA_FIELDS.idx].toString(),
            constants.ZERO.toString()
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
            )
          );
          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
              BN(constants.PROMISE_DEPOSITSE1)
            )
          );
          assert.isTrue(
            promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
              BN(constants.PROMISE_DEPOSITBU1)
            )
          );

          const tokenNonce = await contractVoucherKernel.getTokenNonce(
            users.seller.address
          );
          assert.isTrue(tokenNonce.eq(constants.ONE));

          assert.equal(
            promiseId1,
            await contractVoucherKernel.getPromiseIdFromSupplyId(tokenSupplyKey)
          );

          //Check ERC1155ERC721 state
          const sellerERC1155ERC721Balance = (
            await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
              users.seller.address,
              tokenSupplyKey
            )
          )[0];

          assert.isTrue(sellerERC1155ERC721Balance.eq(constants.QTY_10));
        });

        it('Should update escrow correctly', async () => {
          const expectedBalance = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          const escrowTokens = await contractCashier.getEscrowTokensAmount(
            mockDAI.address,
            users.seller.address
          );

          assert.isTrue(
            escrowTokens.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Should create payment method TKNTKN', async () => {
          const paymentMethod = await contractVoucherKernel.getVoucherPaymentMethod(
            tokenSupplyKey
          );

          const addressTokenPrice = await contractVoucherKernel.getVoucherPriceToken(
            tokenSupplyKey
          );

          const addressTokenDeposits = await contractVoucherKernel.getVoucherDepositToken(
            tokenSupplyKey
          );

          assert.equal(
            paymentMethod.toString(),
            paymentMethods.TKNTKN.toString(),
            'Payment Method TKNTKN not set correctly'
          );
          assert.equal(
            addressTokenPrice.toString(),
            mockDAI.address,
            'TKNTKN Method Price Token Address mismatch'
          );
          assert.equal(
            addressTokenDeposits.toString(),
            mockDAI.address,
            'TKNTKN Method Deposit Token Address mismatch'
          );
        });
      });
    });
  });

  describe('VOUCHER CREATION (Commit to buy)', () => {
    const ORDER_QTY = 5;
    let tokenSupplyKey;
    let promiseId1;
    let txReceiptFillOrder;

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', async () => {
        beforeEach(async () => {
          await deployContracts();

          //Create Voucher Set
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          await mockDAI.mock.nonces.withArgs(users.seller.address).returns(0);
          await mockDAI.mock.permit.returns();
          await mockDAI.mock.name.returns('MockDAI');
          await mockDAI.mock.transferFrom
            .withArgs(users.seller.address, contractCashier.address, txValue)
            .returns(true);

          const digest = await getApprovalDigestDAI(
            mockDAI,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            0,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          ) as BosonRouter;

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          const txOrder = await sellerInstance.requestCreateOrderETHTKNWithPermit(
            mockDAI.address,
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
            ],
            {
              from: users.seller.address,
            }
          );

          txReceipt = await txOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            BosonRouter_Factory,
            eventNames.LOG_ORDER_CREATED,
            (ev) => {
              tokenSupplyKey = BN(ev._tokenIdSupply);
            }
          );

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_PROMISE_CREATED,
            (ev) => {
              promiseId1 = ev._promiseId;
            }
          );

          //Commit to voucher
          await mockDAI.mock.nonces.withArgs(users.buyer.address).returns(1);
          await mockDAI.mock.transferFrom
            .withArgs(
              users.buyer.address,
              contractCashier.address,
              constants.PROMISE_DEPOSITBU1
            )
            .returns(true);

          const digestDeposit = await getApprovalDigestDAI(
            mockDAI,
            users.buyer.address,
            contractBosonRouter.address,
            constants.PROMISE_DEPOSITBU1,
            1,
            deadline
          );

          const VRS_DEPOSIT = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vDeposit = VRS_DEPOSIT.v;
          const rDeposit = VRS_DEPOSIT.r;
          const sDeposit = VRS_DEPOSIT.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          const txFillOrder = await buyerInstance.requestVoucherETHTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            constants.PROMISE_DEPOSITBU1,
            deadline,
            vDeposit,
            rDeposit,
            sDeposit,
            {value: constants.PROMISE_PRICE1}
          );

          txReceiptFillOrder = await txFillOrder.wait();

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              tokenVoucherKey = ev._tokenIdVoucher;
            }
          );
        });

        it('Should emit the correct events and set correct state', async () => {
          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              assert.isTrue(ev._tokenIdSupply.eq(tokenSupplyKey));
              assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
              assert.isTrue(ev._issuer === users.seller.address);
              assert.isTrue(ev._holder === users.buyer.address);
              assert.isTrue(ev._promiseId === promiseId1);
              tokenVoucherKey = ev._tokenIdVoucher;
            }
          );

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            ERC1155ERC721_Factory,
            eventNames.TRANSFER_SINGLE,
            (ev) => {
              assert.isTrue(ev._operator === contractVoucherKernel.address);
              assert.isTrue(ev._from === users.seller.address);
              assert.isTrue(ev._to === constants.ZERO_ADDRESS);
              assert.isTrue(ev._id.eq(tokenSupplyKey));
              assert.isTrue(ev._value.eq(constants.ONE));
            }
          );

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            ERC1155ERC721_Factory,
            eventNames.TRANSFER,
            (ev) => {
              assert.isTrue(ev._from === constants.ZERO_ADDRESS);
              assert.isTrue(ev._to === users.buyer.address);
              assert.isTrue(ev._tokenId.eq(tokenVoucherKey));
            }
          );

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            DAITokenWrapper_Factory,
            eventNames.LOG_PERMIT_CALLED_ON_TOKEN,
            (ev) => {
              assert.isTrue(ev._tokenAddress === mockDAI.address);
              assert.isTrue(ev._owner === users.buyer.address);
              assert.isTrue(ev._spender === contractBosonRouter.address);
              assert.isTrue(ev._value == 0);
            }
          );

          //Check Voucher Kernel state
          const voucherStatus = await contractVoucherKernel.getVoucherStatus(
            tokenVoucherKey
          );

          assert.isTrue(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] == 128
          ); //128 = COMMITTED

          assert.isFalse(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.isPaymentReleased],
            'Payment released not false'
          );
          assert.isFalse(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.isDepositsReleased],
            'Deposit released not false'
          );

          //Check ERC1155ERC721 state
          const sellerERC1155ERC721Balance = (
            await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
              users.seller.address,
              tokenSupplyKey
            )
          )[0];

          assert.isTrue(sellerERC1155ERC721Balance.eq(constants.NINE));

          const buyerERC721Balance = (
            await contractERC1155ERC721.functions[fnSignatures.balanceOf721](
              users.buyer.address
            )
          )[0];
          const erc721TokenOwner = await contractERC1155ERC721.ownerOf(
            tokenVoucherKey
          );
          assert.isTrue(buyerERC721Balance.eq(constants.ONE));
          assert.strictEqual(users.buyer.address, erc721TokenOwner);
        });

        it('Should update escrow correctly', async () => {
          const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );
          const buyerETHSent = BN(constants.PROMISE_PRICE1);
          const buyerTKNSent = BN(constants.PROMISE_DEPOSITBU1);

          const escrowSellerTkn = await contractCashier.getEscrowTokensAmount(
            mockDAI.address,
            users.seller.address
          );
          const escrowBuyerEth = await contractCashier.getEscrowAmount(
            users.buyer.address
          );
          const escrowBuyerTkn = await contractCashier.getEscrowTokensAmount(
            mockDAI.address,
            users.buyer.address
          );

          assert.isTrue(
            BN(sellerDeposits).eq(escrowSellerTkn),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerETHSent).eq(escrowBuyerEth),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerTKNSent).eq(escrowBuyerTkn),
            'Escrow amount is incorrect'
          );
        });
      }); //end ETHTKN

      describe('TKNTKN', () => {
        beforeEach(async () => {
          await deployContracts();

          //create voucher set
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          await mockDAI.mock.nonces.withArgs(users.seller.address).returns(0);
          await mockDAI.mock.permit.returns();
          await mockDAI.mock.name.returns('MockDAI');
          await mockDAI.mock.transferFrom
            .withArgs(users.seller.address, contractCashier.address, txValue)
            .returns(true);

          const digest = await getApprovalDigestDAI(
            mockDAI,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            0,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          ) as BosonRouter;

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          const tokensToMintBuyer = BN(constants.PROMISE_PRICE1).mul(
            BN(ORDER_QTY)
          );

          await contractBSNTokenPrice.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          const txOrder = await sellerInstance.requestCreateOrderTKNTKNWithPermit(
            contractBSNTokenPrice.address,
            mockDAI.address,
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
            ],
            {
              from: users.seller.address,
            }
          );

          txReceipt = await txOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            BosonRouter_Factory,
            eventNames.LOG_ORDER_CREATED,
            (ev) => {
              tokenSupplyKey = BN(ev._tokenIdSupply);
            }
          );

          promiseId1;

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_PROMISE_CREATED,
            (ev) => {
              promiseId1 = ev._promiseId;
            }
          );

          //commit to buy
          await mockDAI.mock.nonces.withArgs(users.buyer.address).returns(0);
          await mockDAI.mock.transferFrom
            .withArgs(
              users.buyer.address,
              contractCashier.address,
              constants.PROMISE_DEPOSITBU1
            )
            .returns(true);

          const nonce1 = await contractBSNTokenPrice.nonces(
            users.buyer.address
          );
          const tokensToSend = BN(constants.PROMISE_PRICE1).add(
            BN(constants.PROMISE_DEPOSITBU1)
          );

          const digestPrice = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractBosonRouter.address,
            constants.PROMISE_PRICE1,
            nonce1,
            deadline
          );

          const VRS_PRICE = ecsign(
            Buffer.from(digestPrice.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vPrice = VRS_PRICE.v;
          const rPrice = VRS_PRICE.r;
          const sPrice = VRS_PRICE.s;

          const digestDeposit = await getApprovalDigestDAI(
            mockDAI,
            users.buyer.address,
            contractBosonRouter.address,
            constants.PROMISE_DEPOSITBU1,
            ethers.constants.Zero, //mockDAI nonce has to be hardcoded
            deadline
          );

          const VRS_DEPOSIT = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vDeposit = VRS_DEPOSIT.v;
          const rDeposit = VRS_DEPOSIT.r;
          const sDeposit = VRS_DEPOSIT.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          const txFillOrder = await buyerInstance.requestVoucherTKNTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            tokensToSend,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          );

          txReceiptFillOrder = await txFillOrder.wait();

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              tokenVoucherKey = ev._tokenIdVoucher;
            }
          );
        });

        it('Should emit the correct events and set correct state', async () => {
          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              assert.isTrue(ev._tokenIdSupply.eq(tokenSupplyKey));
              assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
              assert.isTrue(ev._issuer === users.seller.address);
              assert.isTrue(ev._holder === users.buyer.address);
              assert.isTrue(ev._promiseId === promiseId1);
              tokenVoucherKey = ev._tokenIdVoucher;
            }
          );

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            ERC1155ERC721_Factory,
            eventNames.TRANSFER_SINGLE,
            (ev) => {
              assert.isTrue(ev._operator === contractVoucherKernel.address);
              assert.isTrue(ev._from === users.seller.address);
              assert.isTrue(ev._to === constants.ZERO_ADDRESS);
              assert.isTrue(ev._id.eq(tokenSupplyKey));
              assert.isTrue(ev._value.eq(constants.ONE));
            }
          );

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            DAITokenWrapper_Factory,
            eventNames.LOG_PERMIT_CALLED_ON_TOKEN,
            (ev) => {
              assert.isTrue(ev._tokenAddress === mockDAI.address);
              assert.isTrue(ev._owner === users.buyer.address);
              assert.isTrue(ev._spender === contractBosonRouter.address);
              assert.isTrue(ev._value == 0);
            }
          );

          //Throws data out-of-bounds error. Doesn't seem to be able to filter events properly if two events with the same signature are emitted
          /*
          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            ERC1155ERC721_Factory,
            eventNames.TRANSFER,
            (ev) => {
              assert.isTrue(ev._from === constants.ZERO_ADDRESS);
              assert.isTrue(ev._to === users.buyer.address);
              assert.isTrue(ev._tokenId.eq(tokenVoucherKey));
            }
          );

    
          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            MockERC20Permit_Factory,
            eventNames.TRANSFER,
            (ev) => {
              assert.isTrue(ev._from === users.buyer.address);
              assert.isTrue(ev._to === contractCashier.address);
              assert.isTrue(ev._value.eq(constants.PROMISE_PRICE1));
            }
          );
    
*/
          //Check Voucher Kernel state
          const voucherStatus = await contractVoucherKernel.getVoucherStatus(
            tokenVoucherKey
          );

          assert.isTrue(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] == 128
          ); //128 = COMMITTED

          assert.isFalse(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.isPaymentReleased],
            'Payment released not false'
          );
          assert.isFalse(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.isDepositsReleased],
            'Deposit released not false'
          );

          //Check ERC1155ERC721 state
          const sellerERC1155ERC721Balance = (
            await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
              users.seller.address,
              tokenSupplyKey
            )
          )[0];

          assert.isTrue(sellerERC1155ERC721Balance.eq(constants.NINE));

          const buyerERC721Balance = (
            await contractERC1155ERC721.functions[fnSignatures.balanceOf721](
              users.buyer.address
            )
          )[0];
          const erc721TokenOwner = await contractERC1155ERC721.ownerOf(
            tokenVoucherKey
          );
          assert.isTrue(buyerERC721Balance.eq(constants.ONE));
          assert.strictEqual(users.buyer.address, erc721TokenOwner);
        });

        it("Should update Cashier contract's token balance correctly", async () => {
          //Can't check MockDAI
          const cashierPriceTokenBalance = await contractBSNTokenPrice.balanceOf(
            contractCashier.address
          );

          //Boson Token was only used as the price token
          const expectedDepositBalance = BN(constants.PROMISE_PRICE1);

          assert.isTrue(
            BN(cashierPriceTokenBalance).eq(BN(expectedDepositBalance)),
            'Escrow amount is incorrect'
          );
        });

        it('Should update escrow correctly', async () => {
          //Can't check MockDAI
          const buyerTknPriceSent = BN(constants.PROMISE_PRICE1);

          const escrowBuyerTknPrice = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.buyer.address
          );

          assert.isTrue(
            BN(buyerTknPriceSent).eq(escrowBuyerTknPrice),
            'Escrow amount is incorrect'
          );
        });
      }); // end TKNTKN

      describe('TKNTKN Same', () => {
        beforeEach(async () => {
          await deployContracts();

          //create Voucher Set
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          await mockDAI.mock.nonces.withArgs(users.seller.address).returns(0);
          await mockDAI.mock.permit.returns();
          await mockDAI.mock.name.returns('MockDAI');
          await mockDAI.mock.transferFrom
            .withArgs(users.seller.address, contractCashier.address, txValue)
            .returns(true);

          const digest = await getApprovalDigestDAI(
            mockDAI,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            0,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          ) as BosonRouter;

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          const txOrder = await sellerInstance.requestCreateOrderTKNTKNWithPermit(
            mockDAI.address,
            mockDAI.address,
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
            ],
            {
              from: users.seller.address,
            }
          );

          txReceipt = await txOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            BosonRouter_Factory,
            eventNames.LOG_ORDER_CREATED,
            (ev) => {
              tokenSupplyKey = BN(ev._tokenIdSupply);
            }
          );

          promiseId1;

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_PROMISE_CREATED,
            (ev) => {
              promiseId1 = ev._promiseId;
            }
          );

          //commit to buy voucher
          await mockDAI.mock.nonces.withArgs(users.buyer.address).returns(1);
          await mockDAI.mock.permit.returns();
          await mockDAI.mock.name.returns('MockDAI');

          const tokensToSend = BN(constants.PROMISE_PRICE1).add(
            BN(constants.PROMISE_DEPOSITBU1)
          );

          await mockDAI.mock.transferFrom
            .withArgs(
              users.buyer.address,
              contractCashier.address,
              tokensToSend
            )
            .returns(true);

          const digestTokens = await getApprovalDigestDAI(
            mockDAI,
            users.buyer.address,
            contractBosonRouter.address,
            tokensToSend,
            ethers.constants.One, //mockDAI nonce has to be hardcoded,
            deadline
          );

          const VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vPrice = VRS_TOKENS.v;
          const rPrice = VRS_TOKENS.r;
          const sPrice = VRS_TOKENS.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          const txFillOrder = await buyerInstance.requestVoucherTKNTKNSameWithPermit(
            tokenSupplyKey,
            users.seller.address,
            tokensToSend,
            deadline,
            vPrice,
            rPrice,
            sPrice
          );

          txReceiptFillOrder = await txFillOrder.wait();

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              tokenVoucherKey = ev._tokenIdVoucher;
            }
          );
        });

        it('Should emit the correct events and set correct state', async () => {
          assert.isDefined(tokenVoucherKey.toString());

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              assert.isTrue(ev._tokenIdSupply.eq(tokenSupplyKey));
              assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
              assert.isTrue(ev._issuer === users.seller.address);
              assert.isTrue(ev._holder === users.buyer.address);
              assert.isTrue(ev._promiseId === promiseId1);
            }
          );

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            ERC1155ERC721_Factory,
            eventNames.TRANSFER_SINGLE,
            (ev) => {
              assert.isTrue(ev._operator === contractVoucherKernel.address);
              assert.isTrue(ev._from === users.seller.address);
              assert.isTrue(ev._to === constants.ZERO_ADDRESS);
              assert.isTrue(ev._id.eq(tokenSupplyKey));
              assert.isTrue(ev._value.eq(constants.ONE));
            }
          );

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            DAITokenWrapper_Factory,
            eventNames.LOG_PERMIT_CALLED_ON_TOKEN,
            (ev) => {
              assert.isTrue(ev._tokenAddress === mockDAI.address);
              assert.isTrue(ev._owner === users.buyer.address);
              assert.isTrue(ev._spender === contractBosonRouter.address);
              assert.isTrue(ev._value == 0);
            }
          );

          //Throws data out-of-bounds error. Doesn't seem to be able to filter events properly if two events with the same signature are emitted
          /*  
          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            ERC1155ERC721_Factory,
            eventNames.TRANSFER,
            (ev) => {
              assert.isTrue(ev._from === constants.ZERO_ADDRESS);
              assert.isTrue(ev._to === users.buyer.address);
              assert.isTrue(ev._tokenId.eq(tokenVoucherKey));
            }
          );

  
          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            MockERC20Permit_Factory,
            eventNames.TRANSFER,
            (ev) => {
              assert.isTrue(ev._from === users.buyer.address);
              assert.isTrue(ev._to === contractCashier.address);
              assert.isTrue(ev._value.eq(constants.PROMISE_PRICE1));
            }
          );
    
*/
          //Check Voucher Kernel state
          const voucherStatus = await contractVoucherKernel.getVoucherStatus(
            tokenVoucherKey
          );

          assert.isTrue(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] == 128
          ); //128 = COMMITTED

          assert.isFalse(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.isPaymentReleased],
            'Payment released not false'
          );
          assert.isFalse(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.isDepositsReleased],
            'Deposit released not false'
          );

          //Check ERC1155ERC721 state
          const sellerERC1155ERC721Balance = (
            await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
              users.seller.address,
              tokenSupplyKey
            )
          )[0];

          assert.isTrue(sellerERC1155ERC721Balance.eq(constants.NINE));

          const buyerERC721Balance = (
            await contractERC1155ERC721.functions[fnSignatures.balanceOf721](
              users.buyer.address
            )
          )[0];
          const erc721TokenOwner = await contractERC1155ERC721.ownerOf(
            tokenVoucherKey
          );
          assert.isTrue(buyerERC721Balance.eq(constants.ONE));
          assert.strictEqual(users.buyer.address, erc721TokenOwner);
        });

        it('Should update escrow correctly', async () => {
          const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );
          const buyerTknSent = BN(constants.PROMISE_PRICE1).add(
            BN(constants.PROMISE_DEPOSITBU1)
          );

          const escrowSellerTknDeposit = await contractCashier.getEscrowTokensAmount(
            mockDAI.address,
            users.seller.address
          );
          const escrowBuyerTkn = await contractCashier.getEscrowTokensAmount(
            mockDAI.address,
            users.buyer.address
          );

          assert.isTrue(
            BN(sellerDeposits).eq(escrowSellerTknDeposit),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerTknSent).eq(escrowBuyerTkn),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Should revert if Price Token and Deposit Token are diff contracts', async () => {
          //get instance with different Price token and Deposit Token addresses
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          await mockDAI.mock.nonces.withArgs(users.seller.address).returns(0);
          await mockDAI.mock.permit.returns();
          await mockDAI.mock.name.returns('MockDAI');
          await mockDAI.mock.transferFrom
            .withArgs(users.seller.address, contractCashier.address, txValue)
            .returns(true);

          const digest = await getApprovalDigestDAI(
            mockDAI,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            0,
            deadline
          );

          const VRS_TOKENS_CREATE = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const vPriceCreate = VRS_TOKENS_CREATE.v;
          const rPriceCreate = VRS_TOKENS_CREATE.r;
          const sPriceCreate = VRS_TOKENS_CREATE.s;

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          ) as BosonRouter;

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          const txOrder = await sellerInstance.requestCreateOrderTKNTKNWithPermit(
            contractBSNTokenPrice.address,
            mockDAI.address,
            txValue,
            deadline,
            vPriceCreate,
            rPriceCreate,
            sPriceCreate,
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            {
              from: users.seller.address,
            }
          );

          txReceipt = await txOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            BosonRouter_Factory,
            eventNames.LOG_ORDER_CREATED,
            (ev) => {
              tokenSupplyKey = BN(ev._tokenIdSupply);
            }
          );

          //commit to buy
          const tokensToMintBuyer = BN(constants.PROMISE_PRICE1).mul(
            BN(constants.QTY_10)
          );

          await contractBSNTokenPrice.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          const nonce = await contractBSNTokenPrice.nonces(users.buyer.address);
          const tokensToSend = BN(constants.PROMISE_PRICE1).add(
            BN(constants.PROMISE_DEPOSITBU1)
          );

          const digestTokens = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractBosonRouter.address,
            tokensToSend,
            nonce,
            deadline
          );

          const VRS_TOKENS_REQUEST_VOUCHER = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vPriceRequestVoucher = VRS_TOKENS_REQUEST_VOUCHER.v;
          const rPriceRequestVoucher = VRS_TOKENS_REQUEST_VOUCHER.r;
          const sPriceRequestVoucher = VRS_TOKENS_REQUEST_VOUCHER.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherTKNTKNSameWithPermit(
              tokenSupplyKey,
              users.seller.address,
              tokensToSend,
              deadline,
              vPriceRequestVoucher,
              rPriceRequestVoucher,
              sPriceRequestVoucher
            )
          ).to.be.revertedWith(revertReasons.INVALID_CALLER);
        });
      }); //TKNTKN Same

      describe('TKNETH', () => {
        beforeEach(async () => {
          await deployContracts();

          //create voucher set
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          ) as BosonRouter;

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          const txOrder = await sellerInstance.requestCreateOrderTKNETH(
            mockDAI.address,
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            {
              value: txValue,
            }
          );

          txReceipt = await txOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            BosonRouter_Factory,
            eventNames.LOG_ORDER_CREATED,
            (ev) => {
              tokenSupplyKey = BN(ev._tokenIdSupply);
            }
          );

          promiseId1;

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_PROMISE_CREATED,
            (ev) => {
              promiseId1 = ev._promiseId;
            }
          );

          //commit to buy
          await mockDAI.mock.nonces.withArgs(users.buyer.address).returns(1);
          await mockDAI.mock.permit.returns();
          await mockDAI.mock.name.returns('MockDAI');

          const txValueCommit = constants.PROMISE_DEPOSITBU1;
          await mockDAI.mock.transferFrom
            .withArgs(
              users.buyer.address,
              contractCashier.address,
              constants.PROMISE_PRICE1
            )
            .returns(true);

          const digestDeposit = await getApprovalDigestDAI(
            mockDAI,
            users.buyer.address,
            contractBosonRouter.address,
            constants.PROMISE_PRICE1,
            1,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          const txFillOrder = await buyerInstance.requestVoucherTKNETHWithPermit(
            tokenSupplyKey,
            users.seller.address,
            constants.PROMISE_PRICE1,
            deadline,
            v,
            r,
            s,
            {value: txValueCommit}
          );

          txReceiptFillOrder = await txFillOrder.wait();

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              tokenVoucherKey = ev._tokenIdVoucher;
            }
          );
        });

        it('Should emit the correct events and set correct state', async () => {
          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              assert.isTrue(ev._tokenIdSupply.eq(tokenSupplyKey));
              assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
              assert.isTrue(ev._issuer === users.seller.address);
              assert.isTrue(ev._holder === users.buyer.address);
              assert.isTrue(ev._promiseId === promiseId1);
            }
          );

          assert.isDefined(tokenVoucherKey.toString());

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            ERC1155ERC721_Factory,
            eventNames.TRANSFER_SINGLE,
            (ev) => {
              assert.isTrue(ev._operator === contractVoucherKernel.address);
              assert.isTrue(ev._from === users.seller.address);
              assert.isTrue(ev._to === constants.ZERO_ADDRESS);
              assert.isTrue(ev._id.eq(tokenSupplyKey));
              assert.isTrue(ev._value.eq(constants.ONE));
            }
          );

          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            DAITokenWrapper_Factory,
            eventNames.LOG_PERMIT_CALLED_ON_TOKEN,
            (ev) => {
              assert.isTrue(ev._tokenAddress === mockDAI.address);
              assert.isTrue(ev._owner === users.buyer.address);
              assert.isTrue(ev._spender === contractBosonRouter.address);
              assert.isTrue(ev._value == 0);
            }
          );

          //Throws data out-of-bounds error. Doesn't seem to be able to filter events properly if two events with the same signature are emitted
          /*  
          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            ERC1155ERC721_Factory,
            eventNames.TRANSFER,
            (ev) => {
              assert.isTrue(ev._from === constants.ZERO_ADDRESS);
              assert.isTrue(ev._to === users.buyer.address);
              assert.isTrue(ev._tokenId.eq(tokenVoucherKey));
            }
          );

  
          eventUtils.assertEventEmitted(
            txReceiptFillOrder,
            MockERC20Permit_Factory,
            eventNames.TRANSFER,
            (ev) => {
              assert.isTrue(ev._from === users.buyer.address);
              assert.isTrue(ev._to === contractCashier.address);
              assert.isTrue(ev._value.eq(constants.PROMISE_PRICE1));
            }
          );
    
*/
          //Check Voucher Kernel state
          const voucherStatus = await contractVoucherKernel.getVoucherStatus(
            tokenVoucherKey
          );

          assert.isTrue(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] == 128
          ); //128 = COMMITTED

          assert.isFalse(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.isPaymentReleased],
            'Payment released not false'
          );
          assert.isFalse(
            voucherStatus[constants.VOUCHER_STATUS_FIELDS.isDepositsReleased],
            'Deposit released not false'
          );

          //Check ERC1155ERC721 state
          const sellerERC1155ERC721Balance = (
            await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
              users.seller.address,
              tokenSupplyKey
            )
          )[0];

          assert.isTrue(sellerERC1155ERC721Balance.eq(constants.NINE));

          const buyerERC721Balance = (
            await contractERC1155ERC721.functions[fnSignatures.balanceOf721](
              users.buyer.address
            )
          )[0];
          const erc721TokenOwner = await contractERC1155ERC721.ownerOf(
            tokenVoucherKey
          );
          assert.isTrue(buyerERC721Balance.eq(constants.ONE));
          assert.strictEqual(users.buyer.address, erc721TokenOwner);
        });

        it('Should update escrow correctly', async () => {
          //can't check mockDAI
          const sellerDeposits = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );

          const buyerTknSent = BN(constants.PROMISE_PRICE1);
          const buyerEthSent = BN(constants.PROMISE_DEPOSITBU1);

          const escrowSeller = await contractCashier.getEscrowAmount(
            users.seller.address
          );
          const escrowBuyerEth = await contractCashier.getEscrowAmount(
            users.buyer.address
          );
          const escrowBuyerTkn = await contractCashier.getEscrowTokensAmount(
            mockDAI.address,
            users.buyer.address
          );

          assert.isTrue(
            BN(sellerDeposits).eq(escrowSeller),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerEthSent).eq(escrowBuyerEth),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerTknSent).eq(escrowBuyerTkn),
            'Escrow amount is incorrect'
          );
        });
      }); //TKNETH
    });
  });
});
