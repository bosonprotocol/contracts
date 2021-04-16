const truffleAssert = require('truffle-assertions');
// later consider using
// https://github.com/OpenZeppelin/openzeppelin-test-helpers

const constants = require('../testHelpers/constants');
const timemachine = require('../testHelpers/timemachine');
const Utils = require('../testHelpers/utils');
const Users = require('../testHelpers/users');
const { assert } = require('chai');

const ERC1155ERC721 = artifacts.require('ERC1155ERC721');
const VoucherKernel = artifacts.require('VoucherKernel');
const Cashier = artifacts.require('Cashier');
const BosonRouter = artifacts.require('BosonRouter');
const FundLimitsOracle = artifacts.require('FundLimitsOracle');
const BN = web3.utils.BN;

let snapshot;

contract('Voucher tests', async (addresses) => {
  const users = new Users(addresses);

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractFundLimitsOracle;
  let tokenSupplyKey1, tokenSupplyKey2, tokenVoucherKey1, tokenVoucherKey2, promiseId1, promiseId2;

  before('setup contracts for tests', async () => {
    const sixtySeconds = 60;

    snapshot = await timemachine.takeSnapshot();

    const timestamp = await Utils.getCurrTimestamp();
    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    contractFundLimitsOracle = await FundLimitsOracle.new();
    contractERC1155ERC721 = await ERC1155ERC721.new();
    contractVoucherKernel = await VoucherKernel.new(
      contractERC1155ERC721.address
    );
    contractCashier = await Cashier.new(contractVoucherKernel.address);
    contractBosonRouter = await BosonRouter.new(
      contractVoucherKernel.address,
      contractERC1155ERC721.address,
      contractFundLimitsOracle.address,
      contractCashier.address
    );

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address,
      'true'
    );
    await contractERC1155ERC721.setVoucherKernelAddress(
      contractVoucherKernel.address
    );
    await contractERC1155ERC721.setBosonRouterAddress(
      contractBosonRouter.address
    );

    await contractVoucherKernel.setBosonRouterAddress(
      contractBosonRouter.address
    );
    await contractVoucherKernel.setCashierAddress(contractCashier.address);

    await contractCashier.setBosonRouterAddress(contractBosonRouter.address);

    await contractVoucherKernel.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds);

    console.log('Seller:   ' + users.seller.address);
    console.log('Buyer:    ' + users.buyer.address);
    console.log('Attacker: ' + users.attacker.address);
    console.log();
  });

  describe('Direct minting', function () {
    it('must fail: unauthorized minting ERC-1155', async () => {
      await truffleAssert.reverts(
        contractERC1155ERC721.mint(users.attacker.address, 666, 1, []),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('must fail: unauthorized minting ERC-721', async () => {
      await truffleAssert.reverts(
        contractERC1155ERC721.mint(users.attacker.address, 666),
        truffleAssert.ErrorType.REVERT
      );
    });
  });

  describe('Voucher Sets (ERC1155)', () => {
    it('adding one new order / promise', async () => {
      const txOrder = await contractBosonRouter.requestCreateOrderETHETH(
        [
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.ORDER_QUANTITY1,
        ],
        {
          from: users.seller.address,
          to: contractCashier.address,
          value: constants.PROMISE_DEPOSITSE1,
        }
      );

      truffleAssert.eventEmitted(
        txOrder,
        'LogOrderCreated',
        (ev) => {
          tokenSupplyKey1 = ev._tokenIdSupply;
          return ev._seller === users.seller.address 
                 && ev._quantity.eq(new BN(constants.ORDER_QUANTITY1)) 
                 && ev._paymentType.eq(new BN(1))
                 && ev._correlationId.eq(new BN(0));  
        },
        'order1 event incorrect'
      );

      const internalVoucherKernelTx = await truffleAssert.createTransactionResult(
        contractVoucherKernel,
        txOrder.tx
      );


      truffleAssert.eventEmitted(
        internalVoucherKernelTx,
        'LogPromiseCreated',
        (ev) => {
          promiseId1 = ev._promiseId;
          return ev._promiseId > 0 
                 && ev._nonce.eq(new BN(1)) 
                 && ev._seller === users.seller.address 
                 && ev._validFrom.eq( new BN(constants.PROMISE_VALID_FROM)) 
                 && ev._validTo.eq(new BN(constants.PROMISE_VALID_TO)) 
                 && ev._idx.eq(new BN(0));
        },
        'promise event incorrect'
      );

      const internalTokenTx = await truffleAssert.createTransactionResult(
        contractERC1155ERC721,
        txOrder.tx
      );

      truffleAssert.eventEmitted(
        internalTokenTx,
        'TransferSingle',
        (ev) => {
          return ev._operator === contractVoucherKernel.address 
                 && ev._from === constants.ZERO_ADDRESS
                 && ev._to == users.seller.address 
                 && ev._id.eq(tokenSupplyKey1) 
                 && ev._value.eq(new BN(constants.ORDER_QUANTITY1));
        },
        'transfer event incorrect'
      );

      //Check BosonRouter state
      assert.equal(await contractBosonRouter.correlationIds(users.seller.address), 1, "Correlation Id incorrect");

      //Check VocherKernel State
      const promise = await contractVoucherKernel.promises(promiseId1);
      assert.equal(promise.promiseId, promiseId1, "Promise Id incorrect");
      promise.nonce.eq(new BN(1));
      assert.strictEqual(promise.seller, users.seller.address, "Seller incorrect");
      promise.validFrom.eq(new BN(constants.PROMISE_VALID_FROM));
      promise.validTo.eq(new BN(constants.PROMISE_VALID_TO));
      promise.price.eq(new BN(constants.PROMISE_PRICE1));
      promise.depositSe.eq(new BN(constants.PROMISE_DEPOSITSE1));
      promise.depositBu.eq(new BN(constants.PROMISE_DEPOSITBU1));
      promise.idx.eq(new BN(1));

      const orderPromiseId = await contractVoucherKernel.ordersPromise(tokenSupplyKey1);
      assert.strictEqual(orderPromiseId, promiseId1, "Order Promise Id incorrect");

      const tokenNonce = await contractVoucherKernel.tokenNonces(users.seller.address);
      tokenNonce.eq(new BN(1));

      //Check ERC1155ERC721 state
      const sellerERC1155ERC721Balance = await contractERC1155ERC721.balanceOf(users.seller.address, tokenSupplyKey1);
      sellerERC1155ERC721Balance.eq(new BN(1));
 
    });

    it('adding second order', async () => {
      const txOrder = await contractBosonRouter.requestCreateOrderETHETH(
        [
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE2,
          constants.PROMISE_DEPOSITSE2,
          constants.PROMISE_DEPOSITBU2,
          constants.ORDER_QUANTITY2,
        ],
        {
          from: users.seller.address,
          to: contractCashier.address,
          value: constants.PROMISE_DEPOSITSE2,
        }
      );

      truffleAssert.eventEmitted(
        txOrder,
        'LogOrderCreated',
        (ev) => {
          tokenSupplyKey2 = ev._tokenIdSupply;
          return ev._seller === users.seller.address 
                 && ev._quantity.eq(new BN(constants.ORDER_QUANTITY2)) 
                 && ev._paymentType.eq(new BN(1))
                 && ev._correlationId.eq(new BN(1)); 
        },
        'order1 event incorrect'
      );

      const internalVoucherKernelTx = await truffleAssert.createTransactionResult(
        contractVoucherKernel,
        txOrder.tx
      );


      truffleAssert.eventEmitted(
        internalVoucherKernelTx,
        'LogPromiseCreated',
        (ev) => {
          promiseId2 = ev._promiseId;
          return ev._promiseId > 0 
                 && ev._nonce.eq(new BN(2)) 
                 && ev._seller === users.seller.address 
                 && ev._validFrom.eq(new BN(constants.PROMISE_VALID_FROM)) 
                 && ev._validTo.eq(new BN(constants.PROMISE_VALID_TO))
                 && ev._idx.eq(new BN(1)); 
        },
        'promise event incorrect'
      );

      const internalTokenTx = await truffleAssert.createTransactionResult(
        contractERC1155ERC721,
        txOrder.tx
      );

      truffleAssert.eventEmitted(
        internalTokenTx,
        'TransferSingle',
        (ev) => {
          return ev._operator === contractVoucherKernel.address 
                 && ev._from === constants.ZERO_ADDRESS
                 && ev._to == users.seller.address 
                 && ev._id.eq(tokenSupplyKey2) 
                 && ev._value.eq(new BN(constants.ORDER_QUANTITY2));
        },
        'transfer event incorrect'
      );

      //Check BosonRouter state
      assert.equal(await contractBosonRouter.correlationIds(users.seller.address), 2, "Correlation Id incorrect");

      //Check VocherKernel State
      const promise = await contractVoucherKernel.promises(promiseId2);
      assert.strictEqual(promise.promiseId, promiseId2, "Promise Id incorrect");
      promise.nonce.eq(new BN(2));
      assert.strictEqual(promise.seller, users.seller.address, "Seller incorrect");
      promise.validFrom.eq(new BN(constants.PROMISE_VALID_FROM));
      promise.validTo.eq(new BN(constants.PROMISE_VALID_TO));
      promise.price.eq(new BN(constants.PROMISE_PRICE2));
      promise.depositSe.eq(new BN(constants.PROMISE_DEPOSITSE2));
      promise.depositBu.eq(new BN(constants.PROMISE_DEPOSITBU2));
      promise.idx.eq(new BN(2));

      const orderPromiseId = await contractVoucherKernel.ordersPromise(tokenSupplyKey2);
      assert.strictEqual(orderPromiseId, promiseId2, "Order Promise Id incorrect");

      const tokenNonce = await contractVoucherKernel.tokenNonces(users.seller.address);
      tokenNonce.eq(new BN(2));

      //Check ERC1155ERC721 state
      const sellerERC1155ERC721Balance = await contractERC1155ERC721.balanceOf(users.seller.address, tokenSupplyKey2);
      sellerERC1155ERC721Balance.eq(new BN(2));
 
    });

    it('fill one order (aka commit to buy a voucher)', async () => {
      const txFillOrder = await contractBosonRouter.requestVoucherETHETH(
        tokenSupplyKey1,
        users.seller.address,
        {
          from: users.buyer.address,
          to: contractBosonRouter.address,
          value: constants.PROMISE_PRICE1 + constants.PROMISE_DEPOSITBU1,
        }
      );
      const internalTx = await truffleAssert.createTransactionResult(
        contractVoucherKernel,
        txFillOrder.tx
      );


      truffleAssert.eventEmitted(
        internalTx,
        'LogVoucherDelivered',
        (ev) => {
          tokenVoucherKey1 = ev._tokenIdVoucher;
          return ev._tokenIdSupply.eq(tokenSupplyKey1) 
                 && ev._tokenIdVoucher.gt(new BN(0)) 
                 && ev._issuer === users.seller.address
                 && ev._holder === users.buyer.address 
                 && ev._promiseId === promiseId1 
                 && ev._correlationId.eq(new BN(0)); 
        },
        'order1 not created successfully'
      );

      const internalTokenTx = await truffleAssert.createTransactionResult(
        contractERC1155ERC721,
        txFillOrder.tx
      );

      truffleAssert.eventEmitted(
        internalTokenTx,
        'TransferSingle',
        (ev) => {
          return ev._operator === contractVoucherKernel.address 
                 && ev._from === users.seller.address 
                 && ev._to === constants.ZERO_ADDRESS
                 && ev._id.eq(tokenSupplyKey1) 
                 && ev._value.eq(new BN(1));
        },
        'transfer event incorrect'
      );

      //Check BosonRouter state
      assert.equal(await contractBosonRouter.correlationIds(users.buyer.address), 1, "Correlation Id incorrect"); 

      //Check Voucher Kernel state
      const voucherStatus = await contractVoucherKernel.vouchersStatus(tokenVoucherKey1);
      voucherStatus.status.eq(7);
      assert.isFalse(voucherStatus.isPaymentReleased, "Payment released not false");
      assert.isFalse(voucherStatus.isDepositsReleased, "Deposit released not false");

      //Check ERC1155ERC721 state
      const sellerERC1155ERC721Balance = await contractERC1155ERC721.balanceOf(users.seller.address, tokenSupplyKey1);
      sellerERC1155ERC721Balance.eq(new BN(0));

      const buerERC1155ERC721Balance = await contractERC1155ERC721.balanceOf(users.buyer.address, tokenSupplyKey1);
      buerERC1155ERC721Balance.eq(new BN(1));


    });

    it('fill second order (aka commit to buy a voucher)', async () => {
      const txFillOrder = await contractBosonRouter.requestVoucherETHETH(
        tokenSupplyKey2,
        users.seller.address,
        {
          from: users.buyer.address,
          to: contractBosonRouter.address,
          value: constants.PROMISE_PRICE2 + constants.PROMISE_DEPOSITBU2,
        }
      );
      const internalTx = await truffleAssert.createTransactionResult(
        contractVoucherKernel,
        txFillOrder.tx
      );

      truffleAssert.eventEmitted(
        internalTx,
        'LogVoucherDelivered',
        (ev) => {
          tokenVoucherKey2 = ev._tokenIdVoucher;
          return ev._tokenIdSupply.eq(tokenSupplyKey2)
               && ev._tokenIdVoucher.gt(new BN(0)) 
               && ev._issuer === users.seller.address
               && ev._holder === users.buyer.address 
               && ev._promiseId === promiseId2 
               && ev._correlationId.eq(new BN(1)); 
        },
        'order2 not filled successfully'
      );

        
      const internalTokenTx = await truffleAssert.createTransactionResult(
        contractERC1155ERC721,
        txFillOrder.tx
      );

      truffleAssert.eventEmitted(
        internalTokenTx,
        'TransferSingle',
        (ev) => {
          return ev._operator === contractVoucherKernel.address 
                 && ev._from === users.seller.address 
                 && ev._to === constants.ZERO_ADDRESS
                 && ev._id.eq(tokenSupplyKey2) 
                 && ev._value.eq(new BN(1));
        },
        'transfer event incorrect'
      );

      //Check BosonRouter state
      assert.equal(await contractBosonRouter.correlationIds(users.buyer.address), 2, "Correlation Id incorrect"); 

      //Check Voucher Kernel state
      const voucherStatus = await contractVoucherKernel.vouchersStatus(tokenVoucherKey2);
      voucherStatus.status.eq(7);
      assert.isFalse(voucherStatus.isPaymentReleased, "Payment released not false");
      assert.isFalse(voucherStatus.isDepositsReleased, "Deposit released not false");

      //Check ERC1155ERC721 state
      const sellerERC1155ERC721Balance = await contractERC1155ERC721.balanceOf(users.seller.address, tokenSupplyKey2);
      sellerERC1155ERC721Balance.eq(new BN(0));

      const buerERC1155ERC721Balance = await contractERC1155ERC721.balanceOf(users.buyer.address, tokenSupplyKey2);
      buerERC1155ERC721Balance.eq(new BN(1));
    });



    it('must fail: adding new order with incorrect value sent', async () => {
      await truffleAssert.reverts(
        contractBosonRouter.requestCreateOrderETHETH(
          [
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.ORDER_QUANTITY1,
          ],
          {
            from: users.seller.address,
            to: contractBosonRouter.address,
            value: 0,
          }
        ),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('must fail: fill an order with incorrect value', async () => {
      await truffleAssert.reverts(
        contractBosonRouter.requestVoucherETHETH(
          tokenSupplyKey1,
          users.seller.address,
          {
            from: users.buyer.address,
            to: contractBosonRouter.address,
            value: 0,
          }
        ),
        truffleAssert.ErrorType.REVERT
      );
    });
  });

  describe('Vouchers (ERC721)', function () {
    it('redeeming one voucher', async () => {
      const txRedeem = await contractBosonRouter.redeem(tokenVoucherKey1, {
        from: users.buyer.address,
      });
      const internalTx = await truffleAssert.createTransactionResult(
        contractVoucherKernel,
        txRedeem.tx
      );

      truffleAssert.eventEmitted(
        internalTx,
        'LogVoucherRedeemed',
        (ev) => {
          return ev._tokenIdVoucher.toString() === tokenVoucherKey1.toString();
        },
        'voucher not redeemed successfully'
      );
    });

    it('mark non-redeemed voucher as expired', async () => {
      const statusBefore = await contractVoucherKernel.getVoucherStatus.call(
        tokenVoucherKey2
      );

      // [1000.0000] = hex"80" = 128 = COMMITTED
      assert.equal(
        web3.utils.toHex(statusBefore[0]),
        web3.utils.numberToHex(128),
        'initial voucher status not as expected (COMMITTED)'
      );

      // fast-forward for a year
      await timemachine.advanceTimeSeconds(constants.SECONDS_IN_DAY * 365);
      await contractVoucherKernel.triggerExpiration(tokenVoucherKey2);

      const statusAfter = await contractVoucherKernel.getVoucherStatus.call(
        tokenVoucherKey2
      );

      //[1001.0000] = hex"90" = 144 = EXPIRED
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(144),
        'end voucher status not as expected (EXPIRED)'
      );
    });

    it('mark voucher as finalized', async () => {
      const txFinalize = await contractVoucherKernel.triggerFinalizeVoucher(
        tokenVoucherKey1,
        {
          from: users.buyer.address,
        }
      );

      truffleAssert.eventEmitted(
        txFinalize,
        'LogFinalizeVoucher',
        (ev) => {
          return ev._tokenIdVoucher.toString() === tokenVoucherKey1.toString();
        },
        'voucher not finalized successfully'
      );
    });

    it('must fail: unauthorized redemption', async () => {
      await truffleAssert.reverts(
        contractBosonRouter.redeem(tokenVoucherKey1, {
          from: users.attacker.address,
        }),
        truffleAssert.ErrorType.REVERT
      );
    });
  });

  describe('Withdrawals', function () {
    it('withdraw the escrowed payment from one redeemed voucher', async () => {
      const escrowedBefore = await contractCashier.getEscrowAmount.call(
        users.buyer.address
      );

      await contractCashier.withdraw(tokenVoucherKey1);

      const escrowedAfter = await contractCashier.getEscrowAmount.call(
        users.buyer.address
      );

      assert.isBelow(
        escrowedAfter.toNumber(),
        escrowedBefore.toNumber(),
        'escrowed amount not decreased'
      );
    });
  });

  after(async () => {
    await timemachine.revertToSnapShot(snapshot.id);
  });
});

contract('Voucher tests - UNHAPPY PATH', async (addresses) => {
  const users = new Users(addresses);

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractFundLimitsOracle;
  let tokenSupplyKey1, tokenVoucherKey1;

  before('setup promise dates based on the block timestamp', async () => {
    const sixtySeconds = 60;

    snapshot = await timemachine.takeSnapshot();

    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    contractFundLimitsOracle = await FundLimitsOracle.new();
    contractERC1155ERC721 = await ERC1155ERC721.new();
    contractVoucherKernel = await VoucherKernel.new(
      contractERC1155ERC721.address
    );
    contractCashier = await Cashier.new(contractVoucherKernel.address);
    contractBosonRouter = await BosonRouter.new(
      contractVoucherKernel.address,
      contractERC1155ERC721.address,
      contractFundLimitsOracle.address,
      contractCashier.address
    );

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address,
      'true'
    );
    await contractERC1155ERC721.setVoucherKernelAddress(
      contractVoucherKernel.address
    );
    await contractERC1155ERC721.setBosonRouterAddress(
      contractBosonRouter.address
    );

    await contractVoucherKernel.setBosonRouterAddress(
      contractBosonRouter.address
    );
    await contractVoucherKernel.setCashierAddress(contractCashier.address);

    await contractCashier.setBosonRouterAddress(contractBosonRouter.address);

    await contractVoucherKernel.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds);
  });

  beforeEach('setup contracts for tests', async () => {
    const txOrder = await contractBosonRouter.requestCreateOrderETHETH(
      [
        constants.PROMISE_VALID_FROM,
        constants.PROMISE_VALID_TO,
        constants.PROMISE_PRICE1,
        constants.PROMISE_DEPOSITSE1,
        constants.PROMISE_DEPOSITBU1,
        constants.ORDER_QUANTITY1,
      ],
      {
        from: users.seller.address,
        to: contractBosonRouter.address,
        value: constants.PROMISE_DEPOSITSE1,
      }
    );

    truffleAssert.eventEmitted(
      txOrder,
      'LogOrderCreated',
      (ev) => {
        tokenSupplyKey1 = ev._tokenIdSupply;
        return ev._seller === users.seller.address;
      },
      'order1 not created successfully'
    );

    const txFillOrder = await contractBosonRouter.requestVoucherETHETH(
      tokenSupplyKey1,
      users.seller.address,
      {
        from: users.buyer.address,
        to: contractBosonRouter.address,
        value: constants.PROMISE_PRICE1 + constants.PROMISE_DEPOSITBU1,
      }
    );
    const internalTx = await truffleAssert.createTransactionResult(
      contractVoucherKernel,
      txFillOrder.tx
    );

    truffleAssert.eventEmitted(
      internalTx,
      'LogVoucherDelivered',
      (ev) => {
        tokenVoucherKey1 = ev._tokenIdVoucher;
        return ev._issuer === users.seller.address;
      },
      'order1 not created successfully'
    );
  });

  describe('Wait periods', () => {
    it('change complain period', async () => {
      const complainPeriodSeconds =
        constants.PROMISE_CHALLENGE_PERIOD * constants.SECONDS_IN_DAY;

      const txChangePeriod = await contractVoucherKernel.setComplainPeriod(
        complainPeriodSeconds
      );

      truffleAssert.eventEmitted(
        txChangePeriod,
        'LogComplainPeriodChanged',
        (ev) => {
          return (
            ev._newComplainPeriod.toString() ===
            complainPeriodSeconds.toString()
          );
        },
        'complain period not changed successfully'
      );
    });

    it('must fail: unauthorized change of complain period', async () => {
      const complainPeriodSeconds =
        constants.PROMISE_CHALLENGE_PERIOD * constants.SECONDS_IN_DAY;

      await truffleAssert.reverts(
        contractVoucherKernel.setComplainPeriod(complainPeriodSeconds, {
          from: users.attacker.address,
        }),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('change cancelOrFault period', async () => {
      const cancelFaultPeriodSeconds =
        constants.PROMISE_CANCELORFAULT_PERIOD * constants.SECONDS_IN_DAY;
      const txChangePeriod = await contractVoucherKernel.setCancelFaultPeriod(
        cancelFaultPeriodSeconds
      );

      await truffleAssert.eventEmitted(
        txChangePeriod,
        'LogCancelFaultPeriodChanged',
        (ev) => {
          return (
            ev._newCancelFaultPeriod.toString() ===
            cancelFaultPeriodSeconds.toString()
          );
        },
        'complain period not changed successfully'
      );
    });

    it('must fail: unauthorized change of cancelOrFault period', async () => {
      const cancelFaultPeriodSeconds =
        constants.PROMISE_CANCELORFAULT_PERIOD * constants.SECONDS_IN_DAY;
      await truffleAssert.reverts(
        contractVoucherKernel.setCancelFaultPeriod(cancelFaultPeriodSeconds, {
          from: users.attacker.address,
        }),
        truffleAssert.ErrorType.REVERT
      );
    });
  });

  describe('Refunds ...', function () {
    it('refunding one voucher', async () => {
      await contractBosonRouter.refund(tokenVoucherKey1, {
        from: users.buyer.address,
      });

      const statusAfter = await contractVoucherKernel.getVoucherStatus.call(
        tokenVoucherKey1
      );

      // [1010.0000] = hex"A0" = 160 = REFUND
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(160),
        'end voucher status not as expected (REFUNDED)'
      );
    });

    it('refunding one voucher, then complain', async () => {
      await contractBosonRouter.refund(tokenVoucherKey1, {
        from: users.buyer.address,
      });
      await contractBosonRouter.complain(tokenVoucherKey1, {
        from: users.buyer.address,
      });

      const statusAfter = await contractVoucherKernel.getVoucherStatus.call(
        tokenVoucherKey1
      );

      // [1010.1000] = hex"A8" = 168 = REFUND_COMPLAIN
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(168),
        'end voucher status not as expected (REFUNDED_COMPLAINED)'
      );
    });

    it('refunding one voucher, then complain, then cancel/fault', async () => {
      await contractBosonRouter.refund(tokenVoucherKey1, {
        from: users.buyer.address,
      });
      await contractBosonRouter.complain(tokenVoucherKey1, {
        from: users.buyer.address,
      });
      await contractBosonRouter.cancelOrFault(tokenVoucherKey1, {
        from: users.seller.address,
      });

      const statusAfter = await contractVoucherKernel.getVoucherStatus.call(
        tokenVoucherKey1
      );

      // [1010.1100] = hex"AC" = 172 = REFUND_COMPLAIN_COF
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(172),
        'end voucher status not as expected ' +
          '(REFUNDED_COMPLAINED_CANCELORFAULT)'
      );
    });

    it('must fail: refund then try to redeem', async () => {
      await contractBosonRouter.refund(tokenVoucherKey1, {
        from: users.buyer.address,
      });

      await truffleAssert.reverts(
        contractBosonRouter.redeem(tokenVoucherKey1, {
          from: users.buyer.address,
        }),
        truffleAssert.ErrorType.REVERT
      );
    });
  });

  describe('Cancel/Fault by the seller ...', () => {
    it('canceling one voucher', async () => {
      await contractBosonRouter.cancelOrFault(tokenVoucherKey1, {
        from: users.seller.address,
      });

      const statusAfter = await contractVoucherKernel.getVoucherStatus.call(
        tokenVoucherKey1
      );

      // [1000.0100] = hex"84" = 132 = CANCELORFAULT
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(132),
        'end voucher status not as expected (CANCELORFAULT)'
      );
    });

    it('must fail: cancel/fault then try to redeem', async () => {
      await contractBosonRouter.cancelOrFault(tokenVoucherKey1, {
        from: users.seller.address,
      });

      await truffleAssert.reverts(
        contractBosonRouter.redeem(tokenVoucherKey1, {
          from: users.buyer.address,
        }),
        truffleAssert.ErrorType.REVERT
      );
    });
  });

  describe('Expirations (one universal test) ...', () => {
    it('Expired, then complain, then Cancel/Fault, then try to redeem', async () => {
      // fast-forward for three days
      const secondsInThreeDays = constants.SECONDS_IN_DAY * 3;
      await timemachine.advanceTimeSeconds(secondsInThreeDays);

      await contractVoucherKernel.triggerExpiration(tokenVoucherKey1);

      let statusAfter = await contractVoucherKernel.getVoucherStatus.call(
        tokenVoucherKey1
      );

      // [1001.0000] = hex"90" = 144 = EXPIRED
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(144),
        'end voucher status not as expected (EXPIRED)'
      );

      await contractBosonRouter.complain(tokenVoucherKey1, {
        from: users.buyer.address,
      });

      statusAfter = await contractVoucherKernel.getVoucherStatus.call(
        tokenVoucherKey1
      );

      // [1001.1000] = hex"98" = 152 = EXPIRED_COMPLAIN
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(152),
        'end voucher status not as expected (EXPIRED_COMPLAINED)'
      );

      // in the same test, because the EVM time machine is funky ...
      await contractBosonRouter.cancelOrFault(tokenVoucherKey1, {
        from: users.seller.address,
      });

      statusAfter = await contractVoucherKernel.getVoucherStatus.call(
        tokenVoucherKey1
      );

      // [1001.1000] = hex"9C" = 156 = EXPIRED_COMPLAINED_CANCELORFAULT
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(156),
        'end voucher status not as expected ' +
          '(EXPIRED_COMPLAINED_CANCELORFAULT)'
      );

      // in the same test, because the EVM time machine is funky ...
      await truffleAssert.reverts(
        contractBosonRouter.redeem(tokenVoucherKey1, {
          from: users.buyer.address,
        }),
        truffleAssert.ErrorType.REVERT
      );
    });

    after(async () => {
      await timemachine.revertToSnapShot(snapshot.id);
    });
  });
});
