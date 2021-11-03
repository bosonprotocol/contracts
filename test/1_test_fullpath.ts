import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract, ContractReceipt} from 'ethers';

// later consider using
// https://github.com/OpenZeppelin/openzeppelin-test-helpers

import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
import constants from '../testHelpers/constants';
import {advanceTimeSeconds} from '../testHelpers/timemachine';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';

import {assert, expect} from 'chai';

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
const eventNames = eventUtils.eventNames;
const {keccak256, solidityPack} = ethers.utils;

import {waffle} from 'hardhat';
const {deployMockContract} = waffle;
import IERC20 from '../artifacts/contracts/interfaces/IERC20WithPermit.sol/IERC20WithPermit.json';
import IERC20Old from '../artifacts/contracts/mocks/IERC20old.sol/IERC20Old.json';

import {
  BosonRouter,
  VoucherSets,
  Vouchers,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockBosonRouter,
  MockERC20Permit,
} from '../typechain';

let VoucherSets_Factory: ContractFactory;
let Vouchers_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockBosonRouter_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;

const BN = ethers.BigNumber.from;

let users;

describe('Voucher tests', () => {
  let contractVoucherSets: VoucherSets,
    contractVouchers: Vouchers,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractTokenRegistry: TokenRegistry,
    contractMockBosonRouter: MockBosonRouter,
    contractBSNTokenPrice: MockERC20Permit;

  let contractVoucherSets_2: VoucherSets,
    contractVouchers_2: Vouchers,
    contractVoucherKernel_2: VoucherKernel,
    contractCashier_2: Cashier,
    contractBosonRouter_2: BosonRouter,
    contractTokenRegistry_2: TokenRegistry;

  let tokenSupplyKey1,
    tokenSupplyKey2,
    tokenVoucherKey1,
    tokenVoucherKey2,
    promiseId1,
    promiseId2;

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
  });

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

    await contractTokenRegistry.deployed();
    await contractVoucherSets.deployed();
    await contractVouchers.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();

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
  }

  async function deployContracts2() {
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

    contractTokenRegistry_2 =
      (await TokenRegistry_Factory.deploy()) as Contract & TokenRegistry;
    contractVoucherSets_2 = (await VoucherSets_Factory.deploy(
      'https://token-cdn-domain/{id}.json',
      contractAddresses.Cashier,
      contractAddresses.VoucherKernel
    )) as Contract & VoucherSets;
    contractVouchers_2 = (await Vouchers_Factory.deploy(
      'https://token-cdn-domain/orders/metadata/',
      'Boson Smart Voucher',
      'BSV',
      contractAddresses.Cashier,
      contractAddresses.VoucherKernel
    )) as Contract & Vouchers;
    contractVoucherKernel_2 = (await VoucherKernel_Factory.deploy(
      contractAddresses.BosonRouter,
      contractAddresses.Cashier,
      contractAddresses.VoucherSets,
      contractAddresses.Vouchers
    )) as Contract & VoucherKernel;
    contractCashier_2 = (await Cashier_Factory.deploy(
      contractAddresses.BosonRouter,
      contractAddresses.VoucherKernel,
      contractAddresses.VoucherSets,
      contractAddresses.Vouchers
    )) as Contract & Cashier;
    contractBosonRouter_2 = (await BosonRouter_Factory.deploy(
      contractAddresses.VoucherKernel,
      contractAddresses.TokenRegistry,
      contractAddresses.Cashier
    )) as Contract & BosonRouter;

    await contractTokenRegistry_2.deployed();
    await contractVoucherSets_2.deployed();
    await contractVouchers_2.deployed();
    await contractVoucherKernel_2.deployed();
    await contractCashier_2.deployed();
    await contractBosonRouter_2.deployed();

    await contractVoucherSets_2.setApprovalForAll(
      contractVoucherKernel_2.address,
      true
    );
    await contractVouchers_2.setApprovalForAll(
      contractVoucherKernel_2.address,
      true
    );

    await contractVoucherKernel_2.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel_2.setCancelFaultPeriod(sixtySeconds);
  }

  beforeEach('execute prerequisite steps', async () => {
    const timestamp = await Utils.getCurrTimestamp();
    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    await deployContracts();
  });

  describe('Contract Addresses Getters', function () {
    it('Should have set contract addresses properly for Boson Router', async () => {
      const registry = await contractBosonRouter.getTokenRegistryAddress();
      const cashier = await contractBosonRouter.getCashierAddress();
      const voucherKernel = await contractBosonRouter.getVoucherKernelAddress();

      assert.equal(registry, contractTokenRegistry.address);
      assert.equal(cashier, contractCashier.address);
      assert.equal(voucherKernel, contractVoucherKernel.address);
    });

    it('Should have set contract addresses properly for VoucherSets', async () => {
      const voucherKernel = await contractVoucherSets.getVoucherKernelAddress();
      const cashier = await contractVoucherSets.getCashierAddress();

      assert.equal(voucherKernel, contractVoucherKernel.address);
      assert.equal(cashier, contractCashier.address);
    });

    it('Should have set contract addresses properly for Vouchers', async () => {
      const voucherKernel = await contractVouchers.getVoucherKernelAddress();
      const cashier = await contractVouchers.getCashierAddress();

      assert.equal(voucherKernel, contractVoucherKernel.address);
      assert.equal(cashier, contractCashier.address);
    });

    it('Should have set contract addresses properly for VoucherKernel', async () => {
      const voucherSetTokenContract =
        await contractVoucherKernel.getVoucherSetTokenAddress();
      assert.equal(voucherSetTokenContract, contractVoucherSets.address);

      const voucherTokenContract =
        await contractVoucherKernel.getVoucherTokenAddress();
      assert.equal(voucherTokenContract, contractVouchers.address);
    });

    it('Should have set contract addresses properly for Cashier', async () => {
      const voucherKernel = await contractCashier.getVoucherKernelAddress();
      const bosonRouter = await contractCashier.getBosonRouterAddress();
      const voucherSetTokenContract =
        await contractCashier.getVoucherSetTokenAddress();
      const voucherTokenContract =
        await contractCashier.getVoucherTokenAddress();

      assert.equal(voucherKernel, contractVoucherKernel.address);
      assert.equal(bosonRouter, contractBosonRouter.address);
      assert.equal(voucherSetTokenContract, contractVoucherSets.address);
      assert.equal(voucherTokenContract, contractVouchers.address);
    });
  });

  describe('Direct minting', function () {
    it('must fail: unauthorized minting ERC-1155', async () => {
      await expect(
        contractVoucherSets.mint(users.attacker.address, 666, 1, [])
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VK);
    });

    it('must fail: unauthorized minting ERC-721', async () => {
      await expect(
        contractVouchers.mint(users.attacker.address, 666)
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
          assert.isTrue(BN(ev._paymentType).eq(constants.ZERO));
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
        VoucherSets_Factory,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev.operator === contractVoucherKernel.address);
          assert.isTrue(ev.from === constants.ZERO_ADDRESS);
          assert.isTrue(ev.to === users.seller.address);
          assert.isTrue(ev.id.eq(tokenSupplyKey1));
          assert.isTrue(ev.value.eq(constants.ORDER_QUANTITY1));
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

      //Check Voucher Sets token state
      const sellerVoucherSetTokenBalance = await contractVoucherSets.balanceOf(
        users.seller.address,
        tokenSupplyKey1
      );

      assert.isTrue(sellerVoucherSetTokenBalance.eq(constants.ONE));
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
          assert.isTrue(BN(ev._paymentType).eq(constants.ZERO));
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
          assert.isTrue(BN(ev._paymentType).eq(constants.ZERO));
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
        VoucherSets_Factory,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev.operator === contractVoucherKernel.address);
          assert.isTrue(ev.from === constants.ZERO_ADDRESS);
          assert.isTrue(ev.to === users.seller.address);
          assert.isTrue(ev.id.eq(tokenSupplyKey2));
          assert.isTrue(ev.value.eq(constants.ORDER_QUANTITY2));
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

      //Check Voucher Sets token state
      const sellerERC1155ERC721BalanceVoucherSet1 =
        await contractVoucherSets.balanceOf(
          users.seller.address,
          tokenSupplyKey1
        );

      assert.isTrue(sellerERC1155ERC721BalanceVoucherSet1.eq(constants.ONE));

      const sellerERC1155ERC721BalanceVoucherSet2 =
        await contractVoucherSets.balanceOf(
          users.seller.address,
          tokenSupplyKey2
        );

      assert.isTrue(sellerERC1155ERC721BalanceVoucherSet2.eq(constants.TWO));
    });

    it('must fail: adding new order with incorrect payment method', async () => {
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
      ).to.be.revertedWith(revertReasons.RUNTIME_ERROR_INVALID_OPCODE);
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
        VoucherSets_Factory,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev.operator === contractVoucherKernel.address);
          assert.isTrue(ev.from === users.seller.address);
          assert.isTrue(ev.to === constants.ZERO_ADDRESS);
          assert.isTrue(ev.id.eq(tokenSupplyKey1));
          assert.isTrue(ev.value.eq(constants.ONE));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        Vouchers_Factory,
        eventNames.TRANSFER,
        (ev) => {
          assert.isTrue(ev.from === constants.ZERO_ADDRESS);
          assert.isTrue(ev.to === users.buyer.address);
          assert.isTrue(ev.tokenId.eq(tokenVoucherKey));
        }
      );

      //Check Voucher Kernel state
      const voucherStatus = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey
      );

      assert.isTrue(
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] == 64
      ); //64 = COMMITTED

      assert.isFalse(
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.isPaymentReleased],
        'Payment released not false'
      );
      assert.isFalse(
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.isDepositsReleased],
        'Deposit released not false'
      );

      //Check Voucher Sets token state
      const sellerVoucherSetTokenBalance = await contractVoucherSets.balanceOf(
        users.seller.address,
        tokenSupplyKey1
      );

      assert.isTrue(sellerVoucherSetTokenBalance.eq(constants.ZERO));

      const buyerERC721Balance = await contractVouchers.balanceOf(
        users.buyer.address
      );

      const erc721TokenOwner = await contractVouchers.ownerOf(tokenVoucherKey);
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
        VoucherSets_Factory,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev.operator === contractVoucherKernel.address);
          assert.isTrue(ev.from === users.seller.address);
          assert.isTrue(ev.to === constants.ZERO_ADDRESS);
          assert.isTrue(ev.id.eq(tokenSupplyKey2));
          assert.isTrue(ev.value.eq(constants.ONE));
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        Vouchers_Factory,
        eventNames.TRANSFER,
        (ev) => {
          assert.isTrue(ev.from === constants.ZERO_ADDRESS);
          assert.isTrue(ev.to === users.buyer.address);
          assert.isTrue(ev.tokenId.eq(tokenVoucherKey));
        }
      );

      //Check Voucher Kernel state
      const voucherStatus = await contractVoucherKernel.getVoucherStatus(
        tokenVoucherKey
      );

      assert.isTrue(
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] == 64
      ); //64 = COMMITTED
      assert.isFalse(
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.isPaymentReleased],
        'Payment released not false'
      );
      assert.isFalse(
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.isDepositsReleased],
        'Deposit released not false'
      );

      //Check Voucher Sets token state
      const sellerVoucherSetTokenBalance = await contractVoucherSets.balanceOf(
        users.seller.address,
        tokenSupplyKey2
      );

      assert.isTrue(sellerVoucherSetTokenBalance.eq(constants.ONE));

      const buyerERC721Balance = await contractVouchers.balanceOf(
        users.buyer.address
      );

      const erc721TokenOwner = await contractVouchers.ownerOf(tokenVoucherKey);

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
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] == 64 + 32
      ); // COMMITED(64) + REDEEMED(32)

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

      // [0100.0000] = 64 = COMMITTED
      assert.equal(
        ethers.utils.hexlify(
          statusBefore[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(64),
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

      //[0100.1000] = 72 = EXPIRED
      assert.equal(
        ethers.utils.hexlify(
          voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(72),
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
        voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] == 97
      ); // COMMITED(64) + REDEEMED(32) + FINALIZED(1)
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

  describe('TransferFrom: It is safe to interact with older ERC20 tokens', function () {
    let sellerInstance;
    beforeEach('set mock as boson router', async () => {
      contractMockBosonRouter = (await MockBosonRouter_Factory.deploy(
        contractVoucherKernel.address,
        contractTokenRegistry.address,
        contractCashier.address
      )) as Contract & MockBosonRouter;

      await contractMockBosonRouter.deployed();

      //Set mock so that failed transferFrom of tokens with no return value can be tested in transferFromAndAddEscrow
      await contractBosonRouter.pause();

      await contractCashier.setBosonRouterAddress(
        contractMockBosonRouter.address
      );

      await contractVoucherKernel.setBosonRouterAddress(
        contractMockBosonRouter.address
      );

      // To unpause Cashier and VoucherKernel unpause must be called on the new router
      // To call unpause, router must be in paused state, so pause should be called first
      await contractMockBosonRouter.pause();
      await contractMockBosonRouter.unpause();

      sellerInstance = contractMockBosonRouter.connect(users.seller.signer);
    });

    it('[Negative] safeTransferFrom will revert the transaction if it fails', async () => {
      await contractBSNTokenPrice.pause();
      await expect(
        sellerInstance.transferFromAndAddEscrowTest(
          contractBSNTokenPrice.address,
          BN(0)
        )
      ).to.be.revertedWith(revertReasons.PAUSED);
    });

    it('safeTransferFrom will NOT revert the transaction if it succeeds', async () => {
      await expect(
        sellerInstance.transferFromAndAddEscrowTest(
          contractBSNTokenPrice.address,
          BN(0)
        )
      ).to.not.be.reverted;
    });

    it('safeTransferFrom will NOT revert if token contract does not return anything', async () => {
      const MockERC20Permit = await deployMockContract(
        users.deployer.signer,
        IERC20Old.abi
      ); //deploys mock

      await MockERC20Permit.mock.transferFrom
        .withArgs(users.seller.address, contractCashier.address, 0)
        .returns();

      await expect(
        sellerInstance.transferFromAndAddEscrowTest(
          MockERC20Permit.address,
          BN(0)
        )
      ).to.not.be.reverted;
    });

    it('[NEGATIVE] safeTransferFrom will revert if token contract returns false', async () => {
      const MockERC20Permit = await deployMockContract(
        users.deployer.signer,
        IERC20.abi
      ); //deploys mock

      await MockERC20Permit.mock.transferFrom
        .withArgs(users.seller.address, contractCashier.address, 0)
        .returns(false);

      await expect(
        sellerInstance.transferFromAndAddEscrowTest(
          MockERC20Permit.address,
          BN(0)
        )
      ).to.be.revertedWith(revertReasons.SAFE_ERC20_FAIL);
    });

    it('[NEGATIVE] safeTransferFrom will revert if contract does not support transfer from', async () => {
      await expect(
        sellerInstance.transferFromAndAddEscrowTest(
          contractCashier.address,
          BN(0)
        )
      ).to.be.revertedWith(revertReasons.SAFE_ERC20_LOW_LEVEL_FAIL);
    });
  });

  describe('Creates unique Promise keys for every VoucherKernal instance', async () => {
    beforeEach(
      'Deploy and create another instance of the contracts',
      async () => {
        await deployContracts2();
      }
    );

    async function promiseKeyForVoucherKernel(voucherKernel: VoucherKernel) {
      return keccak256(
        solidityPack(
          ['address', 'uint256', 'uint256', 'uint256', 'address'],
          [
            users.seller.address,
            constants.ZERO,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            voucherKernel.address,
          ]
        )
      );
    }

    it('Promise key is DIFFERENT for different instances of VoucherKernal contract', async () => {
      const promisekey1 = await promiseKeyForVoucherKernel(
        contractVoucherKernel
      );
      const promisekey2 = await promiseKeyForVoucherKernel(
        contractVoucherKernel_2
      );

      const sellerInstance = contractBosonRouter.connect(users.seller.signer);

      const txOrder1 = await sellerInstance.requestCreateOrderETHETH(
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

      const txReceipt: ContractReceipt = await txOrder1.wait();

      const sellerInstance2 = contractBosonRouter_2.connect(
        users.seller.signer
      );

      const txOrder2 = await sellerInstance2.requestCreateOrderETHETH(
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

      const txReceipt2: ContractReceipt = await txOrder2.wait();

      let promiseIdFromBosonRouter1: string;

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_PROMISE_CREATED,
        (ev) => {
          promiseIdFromBosonRouter1 = ev._promiseId;
          assert.isTrue(ev._promiseId == promisekey1);
          assert.isTrue(ev._promiseId != promisekey2);
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt2,
        VoucherKernel_Factory,
        eventNames.LOG_PROMISE_CREATED,
        (ev) => {
          assert.isTrue(ev._promiseId == promisekey2);
          assert.isTrue(ev._promiseId != promiseIdFromBosonRouter1);
          assert.isTrue(ev._promiseId != promisekey1);
        }
      );

      const promiseKeyFromContract1 = await contractVoucherKernel.getPromiseKey(
        0
      );
      assert.equal(promiseKeyFromContract1, promisekey1, 'Wrong promise key 1');

      const promiseKeyFromContract2 =
        await contractVoucherKernel_2.getPromiseKey(0);
      assert.equal(promiseKeyFromContract2, promisekey2, 'Wrong promise key 2');
    });
  });
}); //end of contract

describe('Voucher tests - UNHAPPY PATH', () => {
  let contractVoucherSets: VoucherSets,
    contractVouchers: Vouchers,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractTokenRegistry: TokenRegistry;
  let tokenSupplyKey1, tokenVoucherKey1;

  before(async () => {
    const signers = await ethers.getSigners();
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
  });

  async function deployContracts() {
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

    await contractTokenRegistry.deployed();
    await contractVoucherSets.deployed();
    await contractVouchers.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();

    await contractVoucherSets.setApprovalForAll(
      contractVoucherKernel.address,
      true
    );
    await contractVouchers.setApprovalForAll(
      contractVoucherKernel.address,
      true
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
      const newCancelOrFaultPeriod =
        await contractVoucherKernel.getCancelFaultPeriod();
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

      // [0101.0000] = 80 = REFUND
      assert.equal(
        ethers.utils.hexlify(
          voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(80),
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

      // [0101.0100] = 84 = REFUND_COMPLAIN
      assert.equal(
        ethers.utils.hexlify(
          voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(84),
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

      // [0101.0110] = hex"AC" = 86 = REFUND_COMPLAIN_COF
      assert.equal(
        ethers.utils.hexlify(
          voucherStatusAfter[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(86),
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

      // [0100.0010] = 66 = CANCELORFAULT
      assert.equal(
        ethers.utils.hexlify(
          voucherStatus[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(66),
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

    it('[NEGATIVE][cancelOrFault] should revert if not called via boson router', async () => {
      const sellerInstance = contractVoucherKernel.connect(users.seller.signer);

      const attackerInstance = contractVoucherKernel.connect(
        users.attacker.signer
      );

      await expect(
        sellerInstance.cancelOrFault(constants.ONE, users.seller.address)
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);

      await expect(
        attackerInstance.cancelOrFault(constants.ONE, users.attacker.address)
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
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

      // [0100.1000] = 72 = EXPIRED
      assert.equal(
        ethers.utils.hexlify(
          statusAfter[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(72),
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

      // [0100.1100] = 76 = EXPIRED_COMPLAIN
      assert.equal(
        ethers.utils.hexlify(
          statusAfter[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(76),
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

      // [0100.1100] = 78 = EXPIRED_COMPLAINED_CANCELORFAULT
      assert.equal(
        ethers.utils.hexlify(
          statusAfter[constants.VOUCHER_STATUS_FIELDS.status] as number
        ),
        ethers.utils.hexlify(78),
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
