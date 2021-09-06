import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

// later consider using
// https://github.com/OpenZeppelin/openzeppelin-test-helpers

import constants from '../testHelpers/constants';
import {advanceTimeSeconds} from '../testHelpers/timemachine';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';

import {assert, expect} from 'chai';

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
const eventNames = eventUtils.eventNames;
import fnSignatures from '../testHelpers/functionSignatures';

import {
  BosonRouter,
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  FundLimitsOracle,
  MockBosonRouter,
} from '../typechain';

let ERC1155ERC721_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let FundLimitsOracle_Factory: ContractFactory;
let MockBosonRouter_Factory: ContractFactory;

const BN = ethers.BigNumber.from;

let users;

describe('Voucher tests', () => {
  let contractERC1155ERC721: ERC1155ERC721,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractFundLimitsOracle: FundLimitsOracle,
    contractMockBosonRouter: MockBosonRouter;

  let tokenSupplyKey1,
    tokenSupplyKey2,
    tokenVoucherKey1,
    tokenVoucherKey2,
    promiseId1,
    promiseId2;

  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721_Factory = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel_Factory = await ethers.getContractFactory('VoucherKernel');
    Cashier_Factory = await ethers.getContractFactory('Cashier');
    BosonRouter_Factory = await ethers.getContractFactory('BosonRouter');
    FundLimitsOracle_Factory = await ethers.getContractFactory(
      'FundLimitsOracle'
    );
    MockBosonRouter_Factory = await ethers.getContractFactory(
      'MockBosonRouter'
    );
  });

  async function deployContracts() {
    const sixtySeconds = 60;

    contractFundLimitsOracle = (await FundLimitsOracle_Factory.deploy()) as Contract &
      FundLimitsOracle;
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
      contractFundLimitsOracle.address,
      contractCashier.address
    )) as Contract & BosonRouter;

    contractMockBosonRouter = (await MockBosonRouter_Factory.deploy(
      contractVoucherKernel.address,
      contractFundLimitsOracle.address,
      contractCashier.address
    )) as Contract & MockBosonRouter;

    await contractFundLimitsOracle.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractMockBosonRouter.deployed();

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
  }

  beforeEach('execute prerequisite steps', async () => {
    const timestamp = await Utils.getCurrTimestamp();
    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    await deployContracts();
  });

  describe('Contract Addresses Getters', function () {
    it('Should have set contract addresses properly for Boson Router', async () => {
      const flo = await contractBosonRouter.getFundLimitOracleAddress();
      const cashier = await contractBosonRouter.getCashierAddress();
      const voucherKernel = await contractBosonRouter.getVoucherKernelAddress();

      assert.equal(flo, contractFundLimitsOracle.address);
      assert.equal(cashier, contractCashier.address);
      assert.equal(voucherKernel, contractVoucherKernel.address);
    });

    it('Should have set contract addresses properly for ERC1155ERC721', async () => {
      const voucherKernel = await contractERC1155ERC721.getVoucherKernelAddress();
      const cashier = await contractERC1155ERC721.getCashierAddress();

      assert.equal(voucherKernel, contractVoucherKernel.address);
      assert.equal(cashier, contractCashier.address);
    });

    it('Should have set contract addresses properly for VoucherKernel', async () => {
      const tokensContract = await contractVoucherKernel.getTokensContractAddress();

      assert.equal(tokensContract, contractERC1155ERC721.address);
    });

    it('Should have set contract addresses properly for Cashier', async () => {
      const voucherKernel = await contractCashier.getVoucherKernelAddress();
      const bosonRouter = await contractCashier.getBosonRouterAddress();
      const tokensContract = await contractCashier.getTokensContractAddress();

      assert.equal(voucherKernel, contractVoucherKernel.address);
      assert.equal(bosonRouter, contractBosonRouter.address);
      assert.equal(tokensContract, contractERC1155ERC721.address);
    });
  });

  describe('Direct minting', function () {
    it('must fail: unauthorized minting ERC-1155', async () => {
      await expect(
        contractERC1155ERC721.functions[fnSignatures.mint1155](
          users.attacker.address,
          666,
          1,
          []
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VK);
    });

    it('must fail: unauthorized minting ERC-721', async () => {
      await expect(
        contractERC1155ERC721.functions[fnSignatures.mint721](
          users.attacker.address,
          666
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VK);
    });
  });

  describe('Create Voucher Sets (ERC1155)', () => {
    it('adding one new order / promise', async () => {
      const sellerInstance = contractBosonRouter.connect(users.seller.signer);

      const txOrder = await sellerInstance.requestCreateOrderETHETH(
        [
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.ORDER_QUANTITY1,
        ],
        {
          value: constants.PROMISE_DEPOSITSE1,
        }
      );

      let tokenSupplyKey1;

      const txReceipt = await txOrder.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter_Factory,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
          assert.isTrue(ev._seller === users.seller.address);
          assert.isTrue(ev._quantity.eq(constants.ONE));
          assert.isTrue(BN(ev._paymentType).eq(constants.ONE));
          tokenSupplyKey1 = BN(ev._tokenIdSupply);
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
          assert.isTrue(ev._id.eq(tokenSupplyKey1));
          assert.isTrue(ev._value.eq(constants.ORDER_QUANTITY1));
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
        tokenSupplyKey1
      );

      assert.strictEqual(
        promiseSeller,
        users.seller.address,
        'Seller incorrect'
      );

      const promiseOrderData = await contractVoucherKernel.getOrderCosts(
        tokenSupplyKey1
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
        await contractVoucherKernel.getPromiseIdFromSupplyId(tokenSupplyKey1)
      );

      //Check ERC1155ERC721 state
      const sellerERC1155ERC721Balance = (
        await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
          users.seller.address,
          tokenSupplyKey1
        )
      )[0];

      assert.isTrue(sellerERC1155ERC721Balance.eq(constants.ONE));
    });

    it('adding two new orders / promises', async () => {
      const sellerInstance = contractBosonRouter.connect(users.seller.signer);

      //Create 1st order
      const txOrder = await sellerInstance.requestCreateOrderETHETH(
        [
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.ORDER_QUANTITY1,
        ],
        {
          value: constants.PROMISE_DEPOSITSE1,
        }
      );

      const txReceipt = await txOrder.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter_Factory,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
          assert.isTrue(ev._seller === users.seller.address);
          assert.isTrue(ev._quantity.eq(constants.ORDER_QUANTITY1));
          assert.isTrue(BN(ev._paymentType).eq(constants.ONE));
          tokenSupplyKey1 = ev._tokenIdSupply;
        }
      );

      //Create 2nd order
      const txOrder2 = await sellerInstance.requestCreateOrderETHETH(
        [
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE2,
          constants.PROMISE_DEPOSITSE2,
          constants.PROMISE_DEPOSITBU2,
          constants.ORDER_QUANTITY2,
        ],
        {
          value: constants.PROMISE_DEPOSITSE2 * constants.ORDER_QUANTITY2,
        }
      );

      const txReceipt2 = await txOrder2.wait();

      eventUtils.assertEventEmitted(
        txReceipt2,
        BosonRouter_Factory,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
          assert.isTrue(ev._seller === users.seller.address);
          assert.isTrue(ev._quantity.eq(constants.ORDER_QUANTITY2));
          assert.isTrue(BN(ev._paymentType).eq(constants.ONE));
          tokenSupplyKey2 = ev._tokenIdSupply;
        }
      );

      let promiseId2;
      eventUtils.assertEventEmitted(
        txReceipt2,
        VoucherKernel_Factory,
        eventNames.LOG_PROMISE_CREATED,
        (ev) => {
          assert.isTrue(ev._promiseId > constants.ZERO_BYTES);
          assert.isTrue(ev._nonce.eq(constants.TWO));
          assert.isTrue(ev._seller === users.seller.address);
          assert.isTrue(ev._validFrom.eq(constants.PROMISE_VALID_FROM));
          assert.isTrue(ev._validTo.eq(constants.PROMISE_VALID_TO));
          assert.isTrue(ev._idx.eq(constants.ONE));

          promiseId2 = ev._promiseId;
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt2,
        ERC1155ERC721_Factory,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev._operator === contractVoucherKernel.address);
          assert.isTrue(ev._from === constants.ZERO_ADDRESS);
          assert.isTrue(ev._to === users.seller.address);
          assert.isTrue(ev._id.eq(tokenSupplyKey2));
          assert.isTrue(ev._value.eq(constants.ORDER_QUANTITY2));
        }
      );

      //Check VocherKernel State
      const promiseData = await contractVoucherKernel.getPromiseData(
        promiseId2
      );

      assert.equal(
        promiseData[constants.PROMISE_DATA_FIELDS.promiseId],
        promiseId2,
        'Promise Id incorrect'
      );
      assert.equal(
        promiseData[constants.PROMISE_DATA_FIELDS.nonce].toString(),
        constants.TWO.toString(),
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
        constants.ONE.toString()
      );

      const promiseSeller = await contractVoucherKernel.getSupplyHolder(
        tokenSupplyKey1
      );

      assert.strictEqual(
        promiseSeller,
        users.seller.address,
        'Seller incorrect'
      );

      const promiseOrderData = await contractVoucherKernel.getOrderCosts(
        tokenSupplyKey1
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
      assert.isTrue(tokenNonce.eq(constants.TWO));

      //Check ERC1155ERC721 state
      const sellerERC1155ERC721BalanceVoucherSet1 = (
        await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
          users.seller.address,
          tokenSupplyKey1
        )
      )[0];
      assert.isTrue(sellerERC1155ERC721BalanceVoucherSet1.eq(constants.ONE));

      const sellerERC1155ERC721BalanceVoucherSet2 = (
        await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
          users.seller.address,
          tokenSupplyKey2
        )
      )[0];
      assert.isTrue(sellerERC1155ERC721BalanceVoucherSet2.eq(constants.TWO));
    });
  });

  describe('Commit to buy a voucher (ERC1155)', () => {
    beforeEach('execute prerequisite steps', async () => {
      //Create first voucher set
      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      const txOrder = await sellerInstance.requestCreateOrderETHETH(
        [
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.ORDER_QUANTITY1,
        ],
        {
          value: constants.PROMISE_DEPOSITSE1,
        }
      );

      const txReceipt = await txOrder.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter_Factory,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
          tokenSupplyKey1 = ev._tokenIdSupply;
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_PROMISE_CREATED,
        (ev) => {
          assert.isTrue(ev._promiseId > 0);
          promiseId1 = ev._promiseId;
        }
      );

      //Create 2nd voucher set
      const txOrder2 = await sellerInstance.requestCreateOrderETHETH(
        [
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE2,
          constants.PROMISE_DEPOSITSE2,
          constants.PROMISE_DEPOSITBU2,
          constants.ORDER_QUANTITY2,
        ],
        {
          value: constants.PROMISE_DEPOSITSE2 * constants.ORDER_QUANTITY2,
        }
      );

      const txReceipt2 = await txOrder2.wait();

      eventUtils.assertEventEmitted(
        txReceipt2,
        BosonRouter_Factory,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
          tokenSupplyKey2 = ev._tokenIdSupply;
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt2,
        VoucherKernel_Factory,
        eventNames.LOG_PROMISE_CREATED,
        (ev) => {
          assert.isTrue(ev._promiseId > 0);
          promiseId2 = ev._promiseId;
        }
      );
    });

    it('fill one order (aka commit to buy a voucher)', async () => {
      //Buyer commits
      const routerFromBuyer = contractBosonRouter.connect(users.buyer.signer);

      const txFillOrder = await routerFromBuyer.requestVoucherETHETH(
        tokenSupplyKey1,
        users.seller.address,
        {
          value: constants.PROMISE_PRICE1 + constants.PROMISE_DEPOSITBU1,
        }
      );

      const txReceipt = await txFillOrder.wait();

      let tokenVoucherKey;

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_DELIVERED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.eq(tokenSupplyKey1));
          assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
          assert.isTrue(ev._issuer === users.seller.address);
          assert.isTrue(ev._holder === users.buyer.address);
          assert.isTrue(ev._promiseId === promiseId1);
          tokenVoucherKey = ev._tokenIdVoucher;
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        ERC1155ERC721_Factory,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev._operator === contractVoucherKernel.address);
          assert.isTrue(ev._from === users.seller.address);
          assert.isTrue(ev._to === constants.ZERO_ADDRESS);
          assert.isTrue(ev._id.eq(tokenSupplyKey1));
          assert.isTrue(ev._value.eq(constants.ONE));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        ERC1155ERC721_Factory,
        eventNames.TRANSFER,
        (ev) => {
          assert.isTrue(ev._from === constants.ZERO_ADDRESS);
          assert.isTrue(ev._to === users.buyer.address);
          assert.isTrue(ev._tokenId.eq(tokenVoucherKey));
        }
      );

      //Check BosonRouter state
      assert.equal(
        (
          await contractBosonRouter.getCorrelationId(users.buyer.address)
        ).toString(),
        '1',
        'Correlation Id incorrect'
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
          tokenSupplyKey1
        )
      )[0];

      assert.isTrue(sellerERC1155ERC721Balance.eq(constants.ZERO));

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

    it('fill second order (aka commit to buy a voucher)', async () => {
      const routerFromBuyer = contractBosonRouter.connect(users.buyer.signer);

      const txFillOrder = await routerFromBuyer.requestVoucherETHETH(
        tokenSupplyKey2,
        users.seller.address,
        {
          value: constants.PROMISE_PRICE2 + constants.PROMISE_DEPOSITBU2,
        }
      );
      const txReceipt = await txFillOrder.wait();
      let tokenVoucherKey;

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_DELIVERED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.eq(tokenSupplyKey2));
          assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
          assert.isTrue(ev._issuer === users.seller.address);
          assert.isTrue(ev._holder === users.buyer.address);
          assert.isTrue(ev._promiseId === promiseId2);
          tokenVoucherKey = ev._tokenIdVoucher;
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        ERC1155ERC721_Factory,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev._operator === contractVoucherKernel.address);
          assert.isTrue(ev._from === users.seller.address);
          assert.isTrue(ev._to === constants.ZERO_ADDRESS);
          assert.isTrue(ev._id.eq(tokenSupplyKey2));
          assert.isTrue(ev._value.eq(constants.ONE));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        ERC1155ERC721_Factory,
        eventNames.TRANSFER,
        (ev) => {
          assert.isTrue(ev._from === constants.ZERO_ADDRESS);
          assert.isTrue(ev._to === users.buyer.address);
          assert.isTrue(ev._tokenId.eq(tokenVoucherKey));
        }
      );

      //Check BosonRouter state
      assert.equal(
        (
          await contractBosonRouter.getCorrelationId(users.buyer.address)
        ).toString(),
        '1',
        'Correlation Id incorrect'
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
          tokenSupplyKey2
        )
      )[0];

      assert.isTrue(sellerERC1155ERC721Balance.eq(constants.ONE));

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

    it('must fail: adding new order with incorrect value sent', async () => {
      const sellerInstance = contractBosonRouter.connect(users.seller.signer);

      await expect(
        sellerInstance.requestCreateOrderETHETH(
          [
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.ORDER_QUANTITY1,
          ],
          {
            value: 0,
          }
        )
      ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
    });

    it('must fail: fill an order with incorrect value', async () => {
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

      await expect(
        buyerInstance.requestVoucherETHETH(
          tokenSupplyKey1,
          users.seller.address,
          {
            value: 0,
          }
        )
      ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
    });

    it('must fail: adding new order with incorrect payment method', async () => {
      //Set mock so that passing wrong payment type can be tested
      await contractVoucherKernel.setBosonRouterAddress(
        contractMockBosonRouter.address
      );

      const sellerInstance = contractMockBosonRouter.connect(
        users.seller.signer
      );

      await expect(
        sellerInstance.requestCreateOrderETHETH(
          [
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.ORDER_QUANTITY1,
          ],
          {
            value: constants.PROMISE_DEPOSITSE1,
          }
        )
      ).to.be.revertedWith(revertReasons.INVALID_PAYMENT_METHOD);
    });
  }); //end describe

  describe('Vouchers (ERC721)', function () {
    beforeEach('execute prerequisite steps', async () => {
      //Create first voucher set
      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      const txOrder = await sellerInstance.requestCreateOrderETHETH(
        [
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.ORDER_QUANTITY1,
        ],
        {
          value: constants.PROMISE_DEPOSITSE1,
        }
      );

      let txReceipt = await txOrder.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter_Factory,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          tokenSupplyKey1 = ev._tokenIdSupply;
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_PROMISE_CREATED,
        (ev) => {
          promiseId1 = ev._promiseId;
          assert.isTrue(ev._promiseId > 0);
        }
      );

      //Buyer commits - voucher set 1
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);
      const txFillOrder = await buyerInstance.requestVoucherETHETH(
        tokenSupplyKey1,
        users.seller.address,
        {
          value: constants.PROMISE_PRICE1 + constants.PROMISE_DEPOSITBU1,
        }
      );

      txReceipt = await txFillOrder.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_DELIVERED,
        (ev) => {
          tokenVoucherKey1 = ev._tokenIdVoucher;
          assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
        }
      );

      //Create 2nd voucher set
      const txOrder2 = await sellerInstance.requestCreateOrderETHETH(
        [
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE2,
          constants.PROMISE_DEPOSITSE2,
          constants.PROMISE_DEPOSITBU2,
          constants.ORDER_QUANTITY2,
        ],
        {
          value: constants.PROMISE_DEPOSITSE2 * constants.ORDER_QUANTITY2,
        }
      );

      txReceipt = await txOrder2.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter_Factory,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          tokenSupplyKey2 = ev._tokenIdSupply;
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
        }
      );

      //Buyer commits - Voucher Set 2
      const txFillOrder2 = await buyerInstance.requestVoucherETHETH(
        tokenSupplyKey2,
        users.seller.address,
        {
          value: constants.PROMISE_PRICE2 + constants.PROMISE_DEPOSITBU2,
        }
      );

      txReceipt = await txFillOrder2.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_DELIVERED,
        (ev) => {
          tokenVoucherKey2 = ev._tokenIdVoucher;
          assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
        }
      );
    });

    it('redeeming one voucher', async () => {
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);
      const txRedeem = await buyerInstance.redeem(tokenVoucherKey1, {
        from: users.buyer.address,
      });

      const txReceipt = await txRedeem.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_REDEEMED,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(tokenVoucherKey1));
          assert.isTrue(ev._holder === users.buyer.address);
          assert.isTrue(ev._promiseId == promiseId1);
        }
      );

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );
      assert.isTrue(
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] == 192
      );

      const transactionBlock = await ethers.provider.getBlock(
        txRedeem.blockNumber
      );
      assert.equal(
        voucherStatus[
          constants.VOUCHER_STATUS_FIELDS.complainPeriodStart
        ].toString(),
        transactionBlock.timestamp.toString()
      );
    });

    it('mark non-redeemed voucher as expired', async () => {
      const statusBefore = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey2
      );

      // [1000.0000] = hex"80" = 128 = COMMITTED
      assert.equal(
        ethers.utils.hexlify(
          statusBefore[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(128),
        'initial voucher status not as expected (COMMITTED)'
      );

      // fast-forward for a year
      await advanceTimeSeconds(constants.SECONDS_IN_DAY * 365);
      const expTx = await contractVoucherKernel.triggerExpiration(
        tokenVoucherKey2
      );

      const txReceipt = await expTx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_EXPIRATION_TRIGGERED,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(tokenVoucherKey2));
          assert.equal(ev._triggeredBy, users.deployer.address);
        }
      );

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey2
      );

      //[1001.0000] = hex"90" = 144 = EXPIRED
      assert.equal(
        ethers.utils.hexlify(
          voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(144),
        'end voucher status not as expected (EXPIRED)'
      );
    });

    it('mark voucher as finalized', async () => {
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

      await buyerInstance.redeem(tokenVoucherKey1);

      //fast forward 8 days (complain period is 7)
      await advanceTimeSeconds(constants.SECONDS_IN_DAY * 8);

      const txFinalize = await contractVoucherKernel.triggerFinalizeVoucher(
        tokenVoucherKey1
      );
      const txReceipt = await txFinalize.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_FINALIZED_VOUCHER,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(tokenVoucherKey1));
        }
      );

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );
      assert.isTrue(
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] == 194
      );
    });

    it('must fail: unauthorized redemption', async () => {
      const attackerInstance = contractBosonRouter.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.redeem(tokenVoucherKey1, {
          from: users.attacker.address,
        })
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
    });
  });

  //HS:  All other withdraw functions are tested in 3_withdrawals.js. Do we want to move this one?. Withdrawal of deposit not included here
  describe('Withdrawals', function () {
    beforeEach('execute prerequisite steps', async () => {
      //Create first voucher set
      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      const txOrder = await sellerInstance.requestCreateOrderETHETH(
        [
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.ORDER_QUANTITY1,
        ],
        {
          value: constants.PROMISE_DEPOSITSE1,
        }
      );

      let txReceipt = await txOrder.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter_Factory,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          tokenSupplyKey1 = ev._tokenIdSupply;
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_PROMISE_CREATED,
        (ev) => {
          promiseId1 = ev._promiseId;
          assert.isTrue(ev._promiseId > 0);
        }
      );

      //Buyer commits - voucher set 1
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);
      const txFillOrder = await buyerInstance.requestVoucherETHETH(
        tokenSupplyKey1,
        users.seller.address,
        {
          value: constants.PROMISE_PRICE1 + constants.PROMISE_DEPOSITBU1,
        }
      );

      txReceipt = await txFillOrder.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_DELIVERED,
        (ev) => {
          tokenVoucherKey1 = ev._tokenIdVoucher;
          assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
        }
      );

      //Buyer redeems voucher
      await buyerInstance.redeem(tokenVoucherKey1, {
        from: users.buyer.address,
      });
    });

    it('withdraw the escrowed payment from one redeemed voucher', async () => {
      const buyerEscrowedBefore = await contractCashier.getEscrowAmount(
        users.buyer.address
      );

      const sellerBalanceBefore = await ethers.provider.getBalance(
        users.seller.address
      );

      const cashierDeployer = contractCashier.connect(users.deployer.signer);
      const txWithdraw = await cashierDeployer.withdraw(tokenVoucherKey1, {
        from: users.deployer.address,
      });

      const txReceipt = await txWithdraw.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        Cashier_Factory,
        eventNames.LOG_AMOUNT_DISTRIBUTION,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(tokenVoucherKey1));
          assert.isTrue(ev._to === users.seller.address);
          assert.isTrue(ev._payment.eq(BN(constants.PROMISE_PRICE1)));
          assert.isTrue(BN(ev._type).eq(constants.ZERO));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        Cashier_Factory,
        eventNames.LOG_WITHDRAWAL,
        (ev) => {
          assert.isTrue(ev._caller === users.deployer.address);
          assert.isTrue(ev._payee === users.seller.address);
          assert.isTrue(ev._payment.eq(BN(constants.PROMISE_PRICE1)));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_FUNDS_RELEASED,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(tokenVoucherKey1));
          assert.isTrue(BN(ev._type).eq(constants.ZERO));
        }
      );

      //Check Cashier state
      const buyerEscrowedAfter = await contractCashier.getEscrowAmount(
        users.buyer.address
      );

      buyerEscrowedAfter.gt(buyerEscrowedBefore);

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );
      assert.isTrue(
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.isPaymentReleased],
        'Payment not released'
      );

      //Check seller account balance
      const sellerBalanceAfter = await ethers.provider.getBalance(
        users.seller.address
      );
      const expectedSellerBalance = sellerBalanceBefore.add(
        BN(constants.PROMISE_PRICE1)
      );
      assert.isTrue(sellerBalanceAfter.eq(expectedSellerBalance));
    });
  });
}); //end of contract

describe('Voucher tests - UNHAPPY PATH', () => {
  let contractERC1155ERC721: ERC1155ERC721,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractFundLimitsOracle: FundLimitsOracle;
  let tokenSupplyKey1, tokenVoucherKey1;

  before(async () => {
    const signers = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721_Factory = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel_Factory = await ethers.getContractFactory('VoucherKernel');
    Cashier_Factory = await ethers.getContractFactory('Cashier');
    BosonRouter_Factory = await ethers.getContractFactory('BosonRouter');
    ERC1155ERC721_Factory = await ethers.getContractFactory('ERC1155ERC721');
    FundLimitsOracle_Factory = await ethers.getContractFactory(
      'FundLimitsOracle'
    );
    MockBosonRouter_Factory = await ethers.getContractFactory(
      'MockBosonRouter'
    );
  });

  async function deployContracts() {
    contractFundLimitsOracle = (await FundLimitsOracle_Factory.deploy()) as Contract &
      FundLimitsOracle;
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
      contractFundLimitsOracle.address,
      contractCashier.address
    )) as Contract & BosonRouter;

    await contractFundLimitsOracle.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();

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
  }

  beforeEach('setup promise dates based on the block timestamp', async () => {
    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    await deployContracts();
  });

  beforeEach('execute prerequisite steps', async () => {
    const sellerInstance = contractBosonRouter.connect(users.seller.signer);
    const txOrder = await sellerInstance.requestCreateOrderETHETH(
      [
        constants.PROMISE_VALID_FROM,
        constants.PROMISE_VALID_TO,
        constants.PROMISE_PRICE1,
        constants.PROMISE_DEPOSITSE1,
        constants.PROMISE_DEPOSITBU1,
        constants.ORDER_QUANTITY1,
      ],
      {
        value: constants.PROMISE_DEPOSITSE1,
      }
    );

    let txReceipt = await txOrder.wait();
    eventUtils.assertEventEmitted(
      txReceipt,
      BosonRouter_Factory,
      eventNames.LOG_ORDER_CREATED,
      (ev) => {
        assert.equal(ev._seller, users.seller.address);
        tokenSupplyKey1 = ev._tokenIdSupply;
      }
    );

    const buyerInstance = contractBosonRouter.connect(users.buyer.signer);
    const txFillOrder = await buyerInstance.requestVoucherETHETH(
      tokenSupplyKey1,
      users.seller.address,
      {
        value: constants.PROMISE_PRICE1 + constants.PROMISE_DEPOSITBU1,
      }
    );

    txReceipt = await txFillOrder.wait();
    eventUtils.assertEventEmitted(
      txReceipt,
      VoucherKernel_Factory,
      eventNames.LOG_VOUCHER_DELIVERED,
      (ev) => {
        tokenVoucherKey1 = ev._tokenIdVoucher;
        assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
      }
    );
  });

  describe('Wait periods', () => {
    it('change complain period', async () => {
      const complainPeriodSeconds =
        constants.PROMISE_CHALLENGE_PERIOD * constants.SECONDS_IN_DAY;

      const txChangePeriod = await contractVoucherKernel.setComplainPeriod(
        complainPeriodSeconds
      );

      const txReceipt = await txChangePeriod.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_COMPLAIN_PERIOD_CHANGED,
        (ev) => {
          assert.isTrue(ev._newComplainPeriod.eq(BN(complainPeriodSeconds)));
          assert.equal(ev._triggeredBy, users.deployer.address);
        }
      );

      //Check VoucherKernel state
      const newComplainPeriod = await contractVoucherKernel.getComplainPeriod();
      assert.isTrue(newComplainPeriod.eq(BN(complainPeriodSeconds)));
    });

    it('must fail: unauthorized change of complain period', async () => {
      const attackerInstance = contractVoucherKernel.connect(
        users.attacker.signer
      );
      const complainPeriodSeconds =
        constants.PROMISE_CHALLENGE_PERIOD * constants.SECONDS_IN_DAY;

      await expect(
        attackerInstance.setComplainPeriod(complainPeriodSeconds)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('change cancelOrFault period', async () => {
      const cancelFaultPeriodSeconds =
        constants.PROMISE_CANCELORFAULT_PERIOD * constants.SECONDS_IN_DAY;
      const txChangePeriod = await contractVoucherKernel.setCancelFaultPeriod(
        cancelFaultPeriodSeconds
      );

      const txReceipt = await txChangePeriod.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_CANCEL_FAULT_PERIOD_CHANGED,
        (ev) => {
          assert.isTrue(
            ev._newCancelFaultPeriod.eq(BN(cancelFaultPeriodSeconds))
          );
          assert.equal(ev._triggeredBy, users.deployer.address);
        }
      );

      //Check VoucherKernel state
      const newCancelOrFaultPeriod = await contractVoucherKernel.getCancelFaultPeriod();
      assert.isTrue(newCancelOrFaultPeriod.eq(BN(cancelFaultPeriodSeconds)));
    });

    it('must fail: unauthorized change of cancelOrFault period', async () => {
      const attackerInstance = contractVoucherKernel.connect(
        users.attacker.signer
      );
      const cancelFaultPeriodSeconds =
        constants.PROMISE_CANCELORFAULT_PERIOD * constants.SECONDS_IN_DAY;

      await expect(
        attackerInstance.setCancelFaultPeriod(cancelFaultPeriodSeconds)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });
  });

  describe('Refunds ...', function () {
    it('refunding one voucher', async () => {
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);
      const txRefund = await buyerInstance.refund(tokenVoucherKey1);

      const txReceipt = await txRefund.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_REFUNDED,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(BN(tokenVoucherKey1)));
        }
      );

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );
      const transactionBlock = await ethers.provider.getBlock(
        txRefund.blockNumber
      );
      assert.equal(
        voucherStatus[
          constants.VOUCHER_STATUS_FIELDS.complainPeriodStart
        ].toString(),
        transactionBlock.timestamp.toString()
      );

      // [1010.0000] = hex"A0" = 160 = REFUND
      assert.equal(
        ethers.utils.hexlify(
          voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(160),
        'end voucher status not as expected (REFUNDED)'
      );
    });

    it('refunding one voucher, then complain', async () => {
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

      await buyerInstance.refund(tokenVoucherKey1);
      const complainTx = await buyerInstance.complain(tokenVoucherKey1);

      const txReceipt = await complainTx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_COMPLAIN,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(BN(tokenVoucherKey1)));
        }
      );

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );
      const transactionBlock = await ethers.provider.getBlock(
        complainTx.blockNumber
      );
      assert.equal(
        voucherStatus[
          constants.VOUCHER_STATUS_FIELDS.cancelFaultPeriodStart
        ].toString(),
        transactionBlock.timestamp.toString()
      );

      // [1010.1000] = hex"A8" = 168 = REFUND_COMPLAIN
      assert.equal(
        ethers.utils.hexlify(
          voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(168),
        'end voucher status not as expected (REFUNDED_COMPLAINED)'
      );
    });

    it('refunding one voucher, then complain, then cancel/fault', async () => {
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

      await buyerInstance.refund(tokenVoucherKey1, {
        from: users.buyer.address,
      });
      const complainTx = await buyerInstance.complain(tokenVoucherKey1, {
        from: users.buyer.address,
      });

      //Check VoucherKernel state
      const voucherStatusBefore = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );
      const transactionBlock = await ethers.provider.getBlock(
        complainTx.blockNumber
      );
      assert.equal(
        voucherStatusBefore[
          constants.VOUCHER_STATUS_FIELDS.cancelFaultPeriodStart
        ].toString(),
        transactionBlock.timestamp.toString()
      );

      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      const cancelTx = await sellerInstance.cancelOrFault(tokenVoucherKey1);

      const txReceipt = await cancelTx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_FAULT_CANCEL,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(BN(tokenVoucherKey1)));
        }
      );

      //Check VoucherKernel state
      const voucherStatusAfter = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );

      //Check it didn't go into a code branch that changes the complainPeriodStart
      assert.equal(
        voucherStatusAfter[
          constants.VOUCHER_STATUS_FIELDS.complainPeriodStart
        ].toString(),
        voucherStatusBefore[
          constants.VOUCHER_STATUS_FIELDS.complainPeriodStart
        ].toString()
      );

      // [1010.1100] = hex"AC" = 172 = REFUND_COMPLAIN_COF
      assert.equal(
        ethers.utils.hexlify(
          voucherStatusAfter[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(172),
        'end voucher status not as expected ' +
          '(REFUNDED_COMPLAINED_CANCELORFAULT)'
      );
    });

    it('must fail: refund then try to redeem', async () => {
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);
      await buyerInstance.refund(tokenVoucherKey1);

      await expect(buyerInstance.redeem(tokenVoucherKey1)).to.be.revertedWith(
        revertReasons.ALREADY_PROCESSED
      );
    });
  });

  describe('Cancel/Fault by the seller ...', () => {
    it('canceling one voucher', async () => {
      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      await sellerInstance.cancelOrFault(tokenVoucherKey1);

      const voucherStatus = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );

      // [1000.0100] = hex"84" = 132 = CANCELORFAULT
      assert.equal(
        ethers.utils.hexlify(
          voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(132),
        'end voucher status not as expected (CANCELORFAULT)'
      );
    });

    it('must fail: cancel/fault then try to redeem', async () => {
      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

      await sellerInstance.cancelOrFault(tokenVoucherKey1);
      await expect(buyerInstance.redeem(tokenVoucherKey1)).to.be.revertedWith(
        revertReasons.ALREADY_PROCESSED
      );
    });
  });

  describe('Expirations (one universal test) ...', () => {
    it('Expired, then complain, then Cancel/Fault, then try to redeem', async () => {
      // fast-forward for three days
      const secondsInThreeDays = constants.SECONDS_IN_DAY * 3;
      await advanceTimeSeconds(secondsInThreeDays);

      await contractVoucherKernel.triggerExpiration(tokenVoucherKey1);

      let statusAfter = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );

      // [1001.0000] = hex"90" = 144 = EXPIRED
      assert.equal(
        ethers.utils.hexlify(
          statusAfter[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(144),
        'end voucher status not as expected (EXPIRED)'
      );

      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);
      const complainTx = await buyerInstance.complain(tokenVoucherKey1);

      let txReceipt = await complainTx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_COMPLAIN,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(BN(tokenVoucherKey1)));
        }
      );

      statusAfter = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );

      // [1001.1000] = hex"98" = 152 = EXPIRED_COMPLAIN
      assert.equal(
        ethers.utils.hexlify(
          statusAfter[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(152),
        'end voucher status not as expected (EXPIRED_COMPLAINED)'
      );

      // in the same test, because the EVM time machine is funky ...
      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      const cancelTx = await sellerInstance.cancelOrFault(tokenVoucherKey1);

      txReceipt = await cancelTx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_FAULT_CANCEL,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(BN(tokenVoucherKey1)));
        }
      );

      statusAfter = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey1
      );

      // [1001.1000] = hex"9C" = 156 = EXPIRED_COMPLAINED_CANCELORFAULT
      assert.equal(
        ethers.utils.hexlify(
          statusAfter[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(156),
        'end voucher status not as expected ' +
          '(EXPIRED_COMPLAINED_CANCELORFAULT)'
      );

      // in the same test, because the EVM time machine is funky ...
      await expect(buyerInstance.redeem(tokenVoucherKey1)).to.be.revertedWith(
        revertReasons.ALREADY_PROCESSED
      );
    });
  });
});
