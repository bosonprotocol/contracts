const truffleAssert = require('truffle-assertions')
// later consider using
// https://github.com/OpenZeppelin/openzeppelin-test-helpers

const constants = require("../testHelpers/constants")
const timemachine = require('../testHelpers/timemachine')
const Utils = require('../testHelpers/utils')
const Users = require('../testHelpers/users')

const ERC1155ERC721 = artifacts.require("ERC1155ERC721")
const VoucherKernel = artifacts.require("VoucherKernel")
const Cashier = artifacts.require("Cashier")
const FundLimitsOracle = artifacts.require('FundLimitsOracle')

let snapshot

contract("Voucher tests", async addresses => {
  const users = new Users(addresses)

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractFundLimitsOracle
  let tokenSupplyKey1,
    tokenSupplyKey2,
    tokenVoucherKey1,
    tokenVoucherKey2

  before('setup contracts for tests', async () => {
    snapshot = await timemachine.takeSnapshot()

    const timestamp = await Utils.getCurrTimestamp()
    constants.PROMISE_VALID_FROM = timestamp
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY

    contractFundLimitsOracle = await FundLimitsOracle.new()
    contractERC1155ERC721 = await ERC1155ERC721.new()
    contractVoucherKernel = await VoucherKernel.new(
      contractERC1155ERC721.address)
    contractCashier = await Cashier.new(
      contractVoucherKernel.address,
      contractERC1155ERC721.address,
      contractFundLimitsOracle.address)

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address, 'true')
    await contractERC1155ERC721.setVoucherKernelAddress(
      contractVoucherKernel.address)
    await contractVoucherKernel.setCashierAddress(
      contractCashier.address)

    console.log("Seller:   " + users.seller.address)
    console.log("Buyer:    " + users.buyer.address)
    console.log("Attacker: " + users.attacker.address)
    console.log()
  })

  describe('Direct minting', function () {
    it("must fail: unauthorized minting ERC-1155", async () => {
      await truffleAssert.reverts(
        contractERC1155ERC721.mint(users.attacker.address, 666, 1, []),
        truffleAssert.ErrorType.REVERT
      )
    })

    it("must fail: unauthorized minting ERC-721", async () => {
      await truffleAssert.reverts(
        contractERC1155ERC721.mint(users.attacker.address, 666),
        truffleAssert.ErrorType.REVERT
      )
    })
  })

  describe('Orders (aka supply tokens - ERC1155)', () => {
    it("adding one new order / promise", async () => {
      const txOrder = await contractCashier
        .requestCreateOrderETHETH([
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.ORDER_QUANTITY1
        ], {
          from: users.buyer.address,
          to: contractCashier.address,
          value: constants.PROMISE_DEPOSITSE1
        })

      // // would need truffle-events as the event emitted is from a nested
      // // contract, so truffle-assert doesn't detect it
      // truffleAssert.eventEmitted(txOrder, 'LogOrderCreated', (ev) => {
      //     tokenSupplyKey = ev._tokenIdSupply;
      //     return ev._seller === Seller;
      // }, "order1 not created successfully");

      // // instead, we check that the escrow increased for the seller
      // let escrowAmount = await contractCashier.getEscrowAmount.call(Seller);
      // assert.isAbove(escrowAmount.toNumber(), 0,
      //   "seller's escrowed deposit should be more than zero");

      // move events from VoucherKernel to Cashier:
      truffleAssert.eventEmitted(
        txOrder,
        'LogOrderCreated',
        (ev) => {
          tokenSupplyKey1 = ev._tokenIdSupply
          return ev._seller === users.buyer.address
        }, "order1 not created successfully")

    })

    it("adding second order", async () => {
      const txOrder = await contractCashier
        .requestCreateOrderETHETH([
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE2,
          constants.PROMISE_DEPOSITSE2,
          constants.PROMISE_DEPOSITBU2,
          constants.ORDER_QUANTITY2
        ], {
          from: users.buyer.address,
          to: contractCashier.address,
          value: constants.PROMISE_DEPOSITSE2
        })

      truffleAssert.eventEmitted(
        txOrder,
        'LogOrderCreated',
        (ev) => {
          tokenSupplyKey2 = ev._tokenIdSupply
          return ev._seller === users.buyer.address
        }, "order2 not created successfully")
    })

    it("fill one order (aka buy a voucher)", async () => {
      const txFillOrder = await contractCashier
        .requestVoucherETHETH(
          tokenSupplyKey1,
          users.buyer.address, {
            from: users.buyer.address,
            to: contractCashier.address,
            value: constants.PROMISE_PRICE1 + constants.PROMISE_DEPOSITBU1
          })
      const internalTx = await truffleAssert
        .createTransactionResult(contractVoucherKernel, txFillOrder.tx)

      truffleAssert.eventEmitted(
        internalTx,
        'LogVoucherDelivered',
        (ev) => {
          return ev._issuer === users.buyer.address
        }, "order1 not created successfully")

      const filtered = internalTx.logs
        .filter(e => e.event === 'LogVoucherDelivered')[0]

      tokenVoucherKey1 = filtered.returnValues['_tokenIdVoucher']
    })

    it("fill second order (aka buy a voucher)", async () => {
      const txFillOrder = await contractCashier
        .requestVoucherETHETH(
          tokenSupplyKey2,
          users.buyer.address, {
            from: users.buyer.address,
            to: contractCashier.address,
            value: constants.PROMISE_PRICE2 + constants.PROMISE_DEPOSITBU2
          })
      const internalTx = await truffleAssert
        .createTransactionResult(contractVoucherKernel, txFillOrder.tx)

      truffleAssert.eventEmitted(
        internalTx,
        'LogVoucherDelivered',
        (ev) => {
          tokenVoucherKey2 = ev._tokenIdVoucher
          return ev._tokenIdSupply.toString() === tokenSupplyKey2.toString()
        }, "order1 not filled successfully")
    })

    it("must fail: adding new order with incorrect value sent",
      async () => {
        await truffleAssert.reverts(
          contractCashier.requestCreateOrderETHETH([
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.ORDER_QUANTITY1
          ], {
            from: users.buyer.address,
            to: contractCashier.address,
            value: 0
          }),
          truffleAssert.ErrorType.REVERT
        )
      })

    it("must fail: fill an order with incorrect value", async () => {
      await truffleAssert.reverts(
        contractCashier.requestVoucherETHETH(
          tokenSupplyKey1,
          users.buyer.address, {
            from: users.buyer.address,
            to: contractCashier.address,
            value: 0
          }),
        truffleAssert.ErrorType.REVERT
      )
    })
  })

  describe('Voucher tokens', function () {
    it("redeeming one voucher", async () => {
      const txRedeem = await contractVoucherKernel
        .redeem(tokenVoucherKey1, { from: users.buyer.address })

      truffleAssert.eventEmitted(
        txRedeem,
        'LogVoucherRedeemed',
        (ev) => {
          return ev._tokenIdVoucher.toString() === tokenVoucherKey1.toString()
        }, "voucher not redeemed successfully")
    })

    it("mark non-redeemed voucher as expired", async () => {
      const statusBefore = await contractVoucherKernel
        .getVoucherStatus.call(tokenVoucherKey2)

      // [1000.0000] = hex"80" = 128 = COMMITTED
      assert.equal(
        web3.utils.toHex(statusBefore[0]),
        web3.utils.numberToHex(128),
        "initial voucher status not as expected (COMMITTED)")

      // fast-forward for a year
      await timemachine.advanceTimeSeconds(
        constants.SECONDS_IN_DAY * 365)
      await contractVoucherKernel.triggerExpiration(tokenVoucherKey2)

      const statusAfter = await contractVoucherKernel
        .getVoucherStatus.call(tokenVoucherKey2)

      //[1001.0000] = hex"90" = 144 = EXPIRED
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(144),
        "end voucher status not as expected (EXPIRED)")
    })

    it("mark voucher as finalized", async () => {
      const txFinalize = await contractVoucherKernel
        .triggerFinalizeVoucher(tokenVoucherKey1, { from: users.buyer.address })

      truffleAssert.eventEmitted(
        txFinalize,
        'LogFinalizeVoucher',
        (ev) => {
          return ev._tokenIdVoucher.toString() === tokenVoucherKey1.toString()
        }, "voucher not finalized successfully")
    })

    it("must fail: unauthorized redemption", async () => {
      await truffleAssert.reverts(
        contractVoucherKernel.redeem(
          tokenVoucherKey1, { from: users.attacker.address }),
        truffleAssert.ErrorType.REVERT
      )
    })
  })

  describe('Withdrawals', function () {
    it("withdraw the escrowed payment from one redeemed voucher",
      async () => {
        const escrowedBefore = await contractCashier
          .getEscrowAmount.call(users.buyer.address)

        await contractCashier.withdraw(tokenVoucherKey1)

        const escrowedAfter = await contractCashier
          .getEscrowAmount.call(users.buyer.address)

        assert.isBelow(
          escrowedAfter.toNumber(),
          escrowedBefore.toNumber(),
          "escrowed amount not decreased")
      })

    // it("must fail: unauthorized withdrawal of escrowed pool", async () => {
    // 	await truffleAssert.reverts(
    //	  contractCashier.withdrawPool({from: Attacker}),
    // 		truffleAssert.ErrorType.REVERT
    // 	);
    // });

  })

  after(async () => {
    await timemachine.revertToSnapShot(snapshot.id)
  })
})

contract("Voucher tests - UNHAPPY PATH", async addresses => {
  const users = new Users(addresses)

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractFundLimitsOracle
  let tokenSupplyKey1,
    tokenVoucherKey1

  before('setup promise dates based on the block timestamp',
    async () => {
      snapshot = await timemachine.takeSnapshot()

      const timestamp = await Utils.getCurrTimestamp()

      constants.PROMISE_VALID_FROM = timestamp
      constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY
    })

  beforeEach('setup contracts for tests', async () => {
    contractFundLimitsOracle = await FundLimitsOracle.new()
    contractERC1155ERC721 = await ERC1155ERC721.new()
    contractVoucherKernel = await VoucherKernel.new(
      contractERC1155ERC721.address)
    contractCashier = await Cashier.new(
      contractVoucherKernel.address,
      contractERC1155ERC721.address,
      contractFundLimitsOracle.address)

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address, 'true')
    await contractERC1155ERC721.setVoucherKernelAddress(
      contractVoucherKernel.address)
    await contractVoucherKernel.setCashierAddress(
      contractCashier.address)

    const txOrder = await contractCashier
      .requestCreateOrderETHETH([
        constants.PROMISE_VALID_FROM,
        constants.PROMISE_VALID_TO,
        constants.PROMISE_PRICE1,
        constants.PROMISE_DEPOSITSE1,
        constants.PROMISE_DEPOSITBU1,
        constants.ORDER_QUANTITY1
      ], {
        from: users.seller.address,
        to: contractCashier.address,
        value: constants.PROMISE_DEPOSITSE1
      })

    truffleAssert.eventEmitted(
      txOrder,
      'LogOrderCreated',
      (ev) => {
        tokenSupplyKey1 = ev._tokenIdSupply
        return ev._seller === users.seller.address
      }, "order1 not created successfully")

    const txFillOrder = await contractCashier
      .requestVoucherETHETH(
        tokenSupplyKey1,
        users.seller.address,
        {
          from: users.buyer.address,
          to: contractCashier.address,
          value: constants.PROMISE_PRICE1 + constants.PROMISE_DEPOSITBU1
        })
    const internalTx = await truffleAssert
      .createTransactionResult(contractVoucherKernel, txFillOrder.tx)

    truffleAssert.eventEmitted(
      internalTx,
      'LogVoucherDelivered',
      (ev) => {
        tokenVoucherKey1 = ev._tokenIdVoucher
        return ev._issuer === users.seller.address
      }, "order1 not created successfully")
  })

  describe('Wait periods', () => {
    it("change complain period", async () => {
      const complainPeriodSeconds =
        constants.PROMISE_CHALLENGE_PERIOD * constants.SECONDS_IN_DAY

      const txChangePeriod = await contractVoucherKernel
        .setComplainPeriod(complainPeriodSeconds)

      truffleAssert.eventEmitted(
        txChangePeriod,
        'LogComplainPeriodChanged',
        (ev) => {
          return ev._newComplainPeriod.toString() ===
            complainPeriodSeconds.toString()
        }, "complain period not changed successfully")
    })

    it("must fail: unauthorized change of complain period",
      async () => {
        const complainPeriodSeconds =
          constants.PROMISE_CHALLENGE_PERIOD * constants.SECONDS_IN_DAY

        await truffleAssert.reverts(
          contractVoucherKernel.setComplainPeriod(
            complainPeriodSeconds, { from: users.attacker.address }),
          truffleAssert.ErrorType.REVERT
        )
      })

    it("change cancelOrFault period", async () => {
      const cancelFaultPeriodSeconds =
        constants.PROMISE_CANCELORFAULT_PERIOD * constants.SECONDS_IN_DAY
      const txChangePeriod = await contractVoucherKernel
        .setCancelFaultPeriod(cancelFaultPeriodSeconds)

      await truffleAssert.eventEmitted(
        txChangePeriod,
        'LogCancelFaultPeriodChanged',
        (ev) => {
          return ev._newCancelFaultPeriod.toString() ===
            cancelFaultPeriodSeconds.toString()
        }, "complain period not changed successfully")
    })

    it("must fail: unauthorized change of cancelOrFault period",
      async () => {
        const cancelFaultPeriodSeconds =
          constants.PROMISE_CANCELORFAULT_PERIOD * constants.SECONDS_IN_DAY
        await truffleAssert.reverts(
          contractVoucherKernel.setCancelFaultPeriod(
            cancelFaultPeriodSeconds, { from: users.attacker.address }),
          truffleAssert.ErrorType.REVERT
        )
      })
  })

  describe('Refunds ...', function () {
    it("refunding one voucher", async () => {
      const txRefund = await contractVoucherKernel.refund(
        tokenVoucherKey1, {
          from: users.buyer.address
        })

      const statusAfter = await contractVoucherKernel
        .getVoucherStatus.call(tokenVoucherKey1)

      // [1010.0000] = hex"A0" = 160 = REFUND
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(160),
        "end voucher status not as expected (REFUNDED)")
    })

    it("refunding one voucher, then complain", async () => {
      const txRefund = await contractVoucherKernel.refund(
        tokenVoucherKey1, {
          from: users.buyer.address
        })
      const txComplain = await contractVoucherKernel.complain(
        tokenVoucherKey1, {
          from: users.buyer.address
        })

      const statusAfter = await contractVoucherKernel
        .getVoucherStatus.call(tokenVoucherKey1)

      // [1010.1000] = hex"A8" = 168 = REFUND_COMPLAIN
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(168),
        "end voucher status not as expected (REFUNDED_COMPLAINED)")
    })

    it("refunding one voucher, then complain, then cancel/fault",
      async () => {
        const txRefund = await contractVoucherKernel.refund(
          tokenVoucherKey1, {
            from: users.buyer.address
          })
        const txComplain = await contractVoucherKernel.complain(
          tokenVoucherKey1, {
            from: users.buyer.address
          })
        const txCoF = await contractVoucherKernel.cancelOrFault(
          tokenVoucherKey1, {
            from: users.seller.address
          })

        const statusAfter = await contractVoucherKernel
          .getVoucherStatus.call(tokenVoucherKey1)

        // [1010.1100] = hex"AC" = 172 = REFUND_COMPLAIN_COF
        assert.equal(
          web3.utils.toHex(statusAfter[0]),
          web3.utils.numberToHex(172),
          "end voucher status not as expected " +
          "(REFUNDED_COMPLAINED_CANCELORFAULT)")
      })

    it("must fail: refund then try to redeem", async () => {
      const txRefund = await contractVoucherKernel.refund(
        tokenVoucherKey1, {
          from: users.buyer.address
        })

      await truffleAssert.reverts(
        contractVoucherKernel.redeem(
          tokenVoucherKey1, { from: users.buyer.address }),
        truffleAssert.ErrorType.REVERT
      )
    })
  })

  describe('Cancel/Fault by the seller ...', () => {
    it("canceling one voucher", async () => {
      const txCoF = await contractVoucherKernel
        .cancelOrFault(
          tokenVoucherKey1, {
            from: users.seller.address
          })

      const statusAfter = await contractVoucherKernel
        .getVoucherStatus.call(tokenVoucherKey1)

      // [1000.0100] = hex"84" = 132 = CANCELORFAULT
      assert.equal(
        web3.utils.toHex(statusAfter[0]),
        web3.utils.numberToHex(132),
        "end voucher status not as expected (CANCELORFAULT)")
    })

    it("must fail: cancel/fault then try to redeem", async () => {
      const txCoF = await contractVoucherKernel
        .cancelOrFault(
          tokenVoucherKey1, {
            from: users.seller.address
          })

      await truffleAssert.reverts(
        contractVoucherKernel.redeem(
          tokenVoucherKey1, { from: users.buyer.address }),
        truffleAssert.ErrorType.REVERT
      )
    })

  })

  describe('Expirations (one universal test) ...', () => {
    it("Expired, then complain, then Cancel/Fault, then try to redeem",
      async () => {
        // fast-forward for three days
        const secondsInThreeDays = constants.SECONDS_IN_DAY * 3
        await timemachine.advanceTimeSeconds(secondsInThreeDays)

        await contractVoucherKernel.triggerExpiration(tokenVoucherKey1)

        let statusAfter = await contractVoucherKernel
          .getVoucherStatus.call(tokenVoucherKey1)

        // [1001.0000] = hex"90" = 144 = EXPIRED
        assert.equal(
          web3.utils.toHex(statusAfter[0]),
          web3.utils.numberToHex(144),
          "end voucher status not as expected (EXPIRED)")

        const txComplain = await contractVoucherKernel
          .complain(tokenVoucherKey1, { from: users.buyer.address })

        statusAfter = await contractVoucherKernel
          .getVoucherStatus.call(tokenVoucherKey1)

        // [1001.1000] = hex"98" = 152 = EXPIRED_COMPLAIN
        assert.equal(
          web3.utils.toHex(statusAfter[0]),
          web3.utils.numberToHex(152),
          "end voucher status not as expected (EXPIRED_COMPLAINED)")

        // in the same test, because the EVM time machine is funky ...
        const txCoF = await contractVoucherKernel
          .cancelOrFault(tokenVoucherKey1, { from: users.seller.address })

        statusAfter = await contractVoucherKernel
          .getVoucherStatus.call(tokenVoucherKey1)

        // [1001.1000] = hex"9C" = 156 = EXPIRED_COMPLAINED_CANCELORFAULT
        assert.equal(
          web3.utils.toHex(statusAfter[0]),
          web3.utils.numberToHex(156),
          "end voucher status not as expected " +
          "(EXPIRED_COMPLAINED_CANCELORFAULT)")

        // in the same test, because the EVM time machine is funky ...
        await truffleAssert.reverts(
          contractVoucherKernel.redeem(
            tokenVoucherKey1, { from: users.buyer.address }),
          truffleAssert.ErrorType.REVERT
        )
      })

    after(async () => {
      await timemachine.revertToSnapShot(snapshot.id)
    })
  })
})
