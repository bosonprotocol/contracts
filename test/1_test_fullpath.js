const ethers = require('hardhat').ethers;

// later consider using
// https://github.com/OpenZeppelin/openzeppelin-test-helpers

const constants = require('../testHelpers/constants');
const timemachine = require('../testHelpers/timemachine');
const Utils = require('../testHelpers/utils');
const Users = require('../testHelpers/users');

const chai = require('chai');
const {assert, expect} = chai;
const revertReasons = require('../testHelpers/revertReasons');

const eventUtils = require('../testHelpers/events');
const {eventNames} = require('../testHelpers/events');
const fnSignatures = require('../testHelpers/functionSignatures');

let ERC1155ERC721;
let VoucherKernel;
let Cashier;
let BosonRouter;
let FundLimitsOracle;

const BN = ethers.BigNumber.from;

let users;

describe.only('Voucher tests', () => {
  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractFundLimitsOracle;
  let tokenSupplyKey1,
    tokenSupplyKey2,
    tokenVoucherKey1,
    tokenVoucherKey2,
    promiseId1,
    promiseId2;

  before(async () => {
    const signers = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel = await ethers.getContractFactory('VoucherKernel');
    Cashier = await ethers.getContractFactory('Cashier');
    BosonRouter = await ethers.getContractFactory('BosonRouter');
    ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
    FundLimitsOracle = await ethers.getContractFactory('FundLimitsOracle');
  });

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

    await contractFundLimitsOracle.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();

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
  }

  beforeEach('execute prerequisite steps', async () => {
    const timestamp = await Utils.getCurrTimestamp();
    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    await deployContracts();
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

      let txReceipt = await txOrder.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
          assert.isTrue(ev._seller === users.seller.address);
          assert.isTrue(ev._quantity.eq(constants.ONE));
          assert.isTrue(BN(ev._paymentType).eq(constants.ONE));
          assert.isTrue(ev._correlationId.eq(constants.ZERO));

          tokenSupplyKey1 = BN(ev._tokenIdSupply);
        }
      );

      let promiseId1;

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel,
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
        ERC1155ERC721,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev._operator === contractVoucherKernel.address);
          assert.isTrue(ev._from === constants.ZERO_ADDRESS);
          assert.isTrue(ev._to === users.seller.address);
          assert.isTrue(ev._id.eq(tokenSupplyKey1));
          assert.isTrue(ev._value.eq(constants.ORDER_QUANTITY1));
        }
      );

      //Check BosonRouter state
      assert.isTrue(
        (await contractBosonRouter.correlationIds(users.seller.address)).eq(
          constants.ONE
        )
      );

      //Check VocherKernel State
      const promise = await contractVoucherKernel.promises(promiseId1);
      assert.equal(promise.promiseId, promiseId1);
      assert.isTrue(promise.nonce.eq(constants.ONE));

      assert.strictEqual(
        promise.seller,
        users.seller.address,
        'Seller incorrect'
      );

      assert.isTrue(promise.validFrom.eq(constants.PROMISE_VALID_FROM));
      assert.isTrue(promise.validTo.eq(constants.PROMISE_VALID_TO));
      assert.isTrue(promise.price.eq(constants.PROMISE_PRICE1));
      assert.isTrue(promise.depositSe.eq(constants.PROMISE_DEPOSITSE1));
      assert.isTrue(promise.depositBu.eq(constants.PROMISE_DEPOSITBU1));
      assert.isTrue(promise.idx.eq(constants.ZERO));

      const orderPromiseId = await contractVoucherKernel.ordersPromise(
        tokenSupplyKey1
      );

      assert.strictEqual(
        orderPromiseId,
        promiseId1,
        'Order Promise Id incorrect'
      );

      const tokenNonce = await contractVoucherKernel.tokenNonces(
        users.seller.address
      );
      assert.isTrue(tokenNonce.eq(constants.ONE));

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

      let txReceipt = await txOrder.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
          assert.isTrue(ev._seller === users.seller.address);
          assert.isTrue(ev._quantity.eq(constants.ORDER_QUANTITY1));
          assert.isTrue(BN(ev._paymentType).eq(constants.ONE));
          assert.isTrue(ev._correlationId.eq(constants.ZERO));
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

      let txReceipt2 = await txOrder2.wait();

      eventUtils.assertEventEmitted(
        txReceipt2,
        BosonRouter,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
          assert.isTrue(ev._seller === users.seller.address);
          assert.isTrue(ev._quantity.eq(constants.ORDER_QUANTITY2));
          assert.isTrue(BN(ev._paymentType).eq(constants.ONE));
          assert.isTrue(ev._correlationId.eq(constants.ONE));
          tokenSupplyKey2 = ev._tokenIdSupply;
        }
      );

      let promiseId2;
      eventUtils.assertEventEmitted(
        txReceipt2,
        VoucherKernel,
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
        ERC1155ERC721,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev._operator === contractVoucherKernel.address);
          assert.isTrue(ev._from === constants.ZERO_ADDRESS);
          assert.isTrue(ev._to === users.seller.address);
          assert.isTrue(ev._id.eq(tokenSupplyKey2));
          assert.isTrue(ev._value.eq(constants.ORDER_QUANTITY2));
        }
      );

      //Check BosonRouter state
      assert.isTrue(
        (await contractBosonRouter.correlationIds(users.seller.address)).eq(
          constants.TWO
        ),
        'Correlation Id incorrect'
      );

      //Check VocherKernel State
      const promise = await contractVoucherKernel.promises(promiseId2);
      assert.strictEqual(promise.promiseId, promiseId2, 'Promise Id incorrect');
      assert.isTrue(promise.nonce.eq(constants.TWO));
      assert.strictEqual(
        promise.seller,
        users.seller.address,
        'Seller incorrect'
      );
      assert.isTrue(promise.validFrom.eq(constants.PROMISE_VALID_FROM));
      assert.isTrue(promise.validTo.eq(constants.PROMISE_VALID_TO));
      assert.isTrue(promise.price.eq(constants.PROMISE_PRICE2));
      assert.isTrue(promise.depositSe.eq(constants.PROMISE_DEPOSITSE2));
      assert.isTrue(promise.depositBu.eq(constants.PROMISE_DEPOSITBU2));
      assert.isTrue(promise.idx.eq(constants.ONE));

      const orderPromiseId = await contractVoucherKernel.ordersPromise(
        tokenSupplyKey2
      );
      assert.strictEqual(
        orderPromiseId,
        promiseId2,
        'Order Promise Id incorrect'
      );

      const tokenNonce = await contractVoucherKernel.tokenNonces(
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

      let txReceipt = await txOrder.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
          tokenSupplyKey1 = ev._tokenIdSupply;
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel,
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
        BosonRouter,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
          tokenSupplyKey2 = ev._tokenIdSupply;
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt2,
        VoucherKernel,
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
        VoucherKernel,
        eventNames.LOG_VOUCHER_DELIVERED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.eq(tokenSupplyKey1));
          assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
          assert.isTrue(ev._issuer === users.seller.address);
          assert.isTrue(ev._holder === users.buyer.address);
          assert.isTrue(ev._promiseId === promiseId1);
          assert.isTrue(ev._correlationId.eq(constants.ZERO));

          tokenVoucherKey = ev._tokenIdVoucher;
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        contractERC1155ERC721,
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
        contractERC1155ERC721,
        eventNames.TRANSFER,
        (ev) => {
          assert.isTrue(ev._from === constants.ZERO_ADDRESS);
          assert.isTrue(ev._to === users.buyer.address);
          assert.isTrue(ev._tokenId.eq(tokenVoucherKey));
        }
      );

      //Check BosonRouter state
      assert.equal(
        await contractBosonRouter.correlationIds(users.buyer.address),
        1,
        'Correlation Id incorrect'
      );

      //Check Voucher Kernel state
      const voucherStatus = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey
      );

      assert.isTrue(voucherStatus.status === 128); //128 = COMMITTED
      assert.isFalse(
        voucherStatus.isPaymentReleased,
        'Payment released not false'
      );
      assert.isFalse(
        voucherStatus.isDepositsReleased,
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
        VoucherKernel,
        eventNames.LOG_VOUCHER_DELIVERED,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.eq(tokenSupplyKey2));
          assert.isTrue(ev._tokenIdVoucher.gt(constants.ZERO));
          assert.isTrue(ev._issuer === users.seller.address);
          assert.isTrue(ev._holder === users.buyer.address);
          assert.isTrue(ev._promiseId === promiseId2);
          assert.isTrue(ev._correlationId.eq(constants.ZERO));

          tokenVoucherKey = ev._tokenIdVoucher;
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        contractERC1155ERC721,
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
        contractERC1155ERC721,
        eventNames.TRANSFER,
        (ev) => {
          assert.isTrue(ev._from === constants.ZERO_ADDRESS);
          assert.isTrue(ev._to === users.buyer.address);
          assert.isTrue(ev._tokenId.eq(tokenVoucherKey));
        }
      );

      //Check BosonRouter state
      assert.equal(
        await contractBosonRouter.correlationIds(users.buyer.address),
        1,
        'Correlation Id incorrect'
      );

      //Check Voucher Kernel state
      const voucherStatus = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey
      );
      assert.isTrue(voucherStatus.status === 128); //128 = COMMITTED
      assert.isFalse(
        voucherStatus.isPaymentReleased,
        'Payment released not false'
      );
      assert.isFalse(
        voucherStatus.isDepositsReleased,
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
  });

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
        BosonRouter,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          tokenSupplyKey1 = ev._tokenIdSupply;
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel,
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
        VoucherKernel,
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
        BosonRouter,
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
        VoucherKernel,
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
        VoucherKernel,
        eventNames.LOG_VOUCHER_REDEEMED,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(tokenVoucherKey1));
          assert.isTrue(ev._holder === users.buyer.address);
          assert.isTrue(ev._promiseId == promiseId1);
        }
      );

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );
      assert.isTrue(voucherStatus.status === 192); //Redeemed

      const transactionBlock = await ethers.provider.getBlock(
        txRedeem.blockNumber
      );
      assert.isTrue(
        voucherStatus.complainPeriodStart.eq(new BN(transactionBlock.timestamp))
      );
    });

    it('mark non-redeemed voucher as expired', async () => {
      const statusBefore = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey2
      );

      // [1000.0000] = hex"80" = 128 = COMMITTED
      assert.equal(
        ethers.utils.hexlify(statusBefore.status),
        ethers.utils.hexlify(128),
        'initial voucher status not as expected (COMMITTED)'
      );

      // fast-forward for a year
      await timemachine.advanceTimeSeconds(constants.SECONDS_IN_DAY * 365);
      const expTx = await contractVoucherKernel.triggerExpiration(
        tokenVoucherKey2
      );

      const txReceipt = await expTx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel,
        eventNames.LOG_EXPIRATION_TRIGGERED,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(tokenVoucherKey2));
          assert.equal(ev._triggeredBy, users.deployer.address);
        }
      );

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey2
      );

      //[1001.0000] = hex"90" = 144 = EXPIRED
      assert.equal(
        ethers.utils.hexlify(voucherStatus.status),
        ethers.utils.hexlify(144),
        'end voucher status not as expected (EXPIRED)'
      );
    });

    it('mark voucher as finalized', async () => {
      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

      await buyerInstance.redeem(tokenVoucherKey1);

      //fast forward 8 days (complain period is 7)
      await timemachine.advanceTimeSeconds(constants.SECONDS_IN_DAY * 8);

      const txFinalize = await contractVoucherKernel.triggerFinalizeVoucher(
        tokenVoucherKey1
      );
      const txReceipt = await txFinalize.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel,
        eventNames.LOG_FINALIZED_VOUCHER,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(tokenVoucherKey1));
        }
      );

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );
      assert.equal(
        ethers.utils.hexlify(voucherStatus.status),
        ethers.utils.hexlify(194),
        'voucher status not as expected (FINALIZED)'
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
        BosonRouter,
        eventNames.LOG_ORDER_CREATED,
        (ev) => {
          tokenSupplyKey1 = ev._tokenIdSupply;
          assert.isTrue(ev._tokenIdSupply.gt(constants.ZERO));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel,
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
        VoucherKernel,
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
        Cashier,
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
        Cashier,
        eventNames.LOG_WITHDRAWAL,
        (ev) => {
          assert.isTrue(ev._caller === users.deployer.address);
          assert.isTrue(ev._payee === users.seller.address);
          assert.isTrue(ev._payment.eq(BN(constants.PROMISE_PRICE1)));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel,
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
      const voucherStatus = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );
      assert.isTrue(voucherStatus.isPaymentReleased, 'Payment not released');

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

describe.only('Voucher tests - UNHAPPY PATH', () => {
  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractFundLimitsOracle;
  let tokenSupplyKey1, tokenVoucherKey1;

  before(async () => {
    const signers = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel = await ethers.getContractFactory('VoucherKernel');
    Cashier = await ethers.getContractFactory('Cashier');
    BosonRouter = await ethers.getContractFactory('BosonRouter');
    ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
    FundLimitsOracle = await ethers.getContractFactory('FundLimitsOracle');
  });

  async function deployContracts() {
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

    await contractFundLimitsOracle.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();

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
      BosonRouter,
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
      VoucherKernel,
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
        VoucherKernel,
        eventNames.LOG_COMPLAIN_PERIOD_CHANGED,
        (ev) => {
          assert.isTrue(ev._newComplainPeriod.eq(BN(complainPeriodSeconds)));
          assert.equal(ev._triggeredBy, users.deployer.address);
        }
      );

      //Check VoucherKernel state
      const newComplainPeriod = await contractVoucherKernel.complainPeriod();
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
        VoucherKernel,
        eventNames.LOG_CANCEL_FAULT_PERIOD_CHANGED,
        (ev) => {
          assert.isTrue(
            ev._newCancelFaultPeriod.eq(BN(cancelFaultPeriodSeconds))
          );
          assert.equal(ev._triggeredBy, users.deployer.address);
        }
      );

      //Check VoucherKernel state
      const newCancelOrFaultPeriod = await contractVoucherKernel.cancelFaultPeriod();
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
        VoucherKernel,
        eventNames.LOG_VOUCHER_REFUNDED,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(new BN(tokenVoucherKey1)));
        }
      );

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );
      const transactionBlock = await ethers.provider.getBlock(
        txRefund.blockNumber
      );
      assert.isTrue(
        voucherStatus.complainPeriodStart.eq(new BN(transactionBlock.timestamp))
      );

      // [1010.0000] = hex"A0" = 160 = REFUND
      assert.equal(
        ethers.utils.hexlify(voucherStatus.status),
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
        VoucherKernel,
        eventNames.LOG_VOUCHER_COMPLAIN,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(new BN(tokenVoucherKey1)));
        }
      );

      //Check VoucherKernel state
      const voucherStatus = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );
      const transactionBlock = await ethers.provider.getBlock(
        complainTx.blockNumber
      );
      assert.isTrue(
        voucherStatus.cancelFaultPeriodStart.eq(
          new BN(transactionBlock.timestamp)
        )
      );

      // [1010.1000] = hex"A8" = 168 = REFUND_COMPLAIN
      assert.equal(
        ethers.utils.hexlify(voucherStatus.status),
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
      const voucherStatusBefore = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );
      const transactionBlock = await ethers.provider.getBlock(
        complainTx.blockNumber
      );
      assert.isTrue(
        voucherStatusBefore.cancelFaultPeriodStart.eq(
          new BN(transactionBlock.timestamp)
        )
      );

      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      const cancelTx = await sellerInstance.cancelOrFault(tokenVoucherKey1);

      const txReceipt = await cancelTx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel,
        eventNames.LOG_VOUCHER_FAULT_CANCEL,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(new BN(tokenVoucherKey1)));
        }
      );

      //Check VoucherKernel state
      const voucherStatusAfter = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );

      //Check it didn't go into a code branch that changes the complainPeriodStart
      assert.isTrue(
        voucherStatusAfter.complainPeriodStart.eq(
          voucherStatusBefore.complainPeriodStart
        )
      );

      // [1010.1100] = hex"AC" = 172 = REFUND_COMPLAIN_COF
      assert.equal(
        ethers.utils.hexlify(voucherStatusAfter.status),
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

      const voucherStatus = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );

      // [1000.0100] = hex"84" = 132 = CANCELORFAULT
      assert.equal(
        ethers.utils.hexlify(voucherStatus.status),
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
      await timemachine.advanceTimeSeconds(secondsInThreeDays);

      await contractVoucherKernel.triggerExpiration(tokenVoucherKey1);

      let statusAfter = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );

      // [1001.0000] = hex"90" = 144 = EXPIRED
      assert.equal(
        ethers.utils.hexlify(statusAfter.status),
        ethers.utils.hexlify(144),
        'end voucher status not as expected (EXPIRED)'
      );

      const buyerInstance = contractBosonRouter.connect(users.buyer.signer);
      const complainTx = await buyerInstance.complain(tokenVoucherKey1);

      let txReceipt = await complainTx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel,
        eventNames.LOG_VOUCHER_COMPLAIN,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(new BN(tokenVoucherKey1)));
        }
      );

      statusAfter = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );

      // [1001.1000] = hex"98" = 152 = EXPIRED_COMPLAIN
      assert.equal(
        ethers.utils.hexlify(statusAfter[0]),
        ethers.utils.hexlify(152),
        'end voucher status not as expected (EXPIRED_COMPLAINED)'
      );

      // in the same test, because the EVM time machine is funky ...
      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      const cancelTx = await sellerInstance.cancelOrFault(tokenVoucherKey1);

      txReceipt = await cancelTx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel,
        eventNames.LOG_VOUCHER_FAULT_CANCEL,
        (ev) => {
          assert.isTrue(ev._tokenIdVoucher.eq(new BN(tokenVoucherKey1)));
        }
      );

      statusAfter = await contractVoucherKernel.vouchersStatus(
        tokenVoucherKey1
      );

      // [1001.1000] = hex"9C" = 156 = EXPIRED_COMPLAINED_CANCELORFAULT
      assert.equal(
        ethers.utils.hexlify(statusAfter[0]),
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
