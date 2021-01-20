const { assert } = require("chai")
const { ecsign } = require('ethereumjs-util')
const truffleAssert = require('truffle-assertions')
// later consider using
// https://github.com/OpenZeppelin/openzeppelin-test-helpers

const constants = require("../testHelpers/constants")
const timemachine = require('../testHelpers/timemachine')
const Users = require('../testHelpers/users')
const Utils = require('../testHelpers/utils')
const UtilsBuilder = require('../testHelpers/utilsBuilder')
const { toWei, getApprovalDigest } = require('../testHelpers/permitUtils')

const ERC1155ERC721 = artifacts.require("ERC1155ERC721")
const VoucherKernel = artifacts.require("VoucherKernel")
const Cashier = artifacts.require("Cashier")
const BosonToken = artifacts.require('BosonTokenPrice')
const FundLimitsOracle = artifacts.require('FundLimitsOracle')

const BN = web3.utils.BN

let utils

contract("Cashier && VK", async addresses => {
  const users = new Users(addresses)

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBSNTokenPrice,
    contractBSNTokenDeposit,
    contractFundLimitsOracle
  let tokenSupplyKey,
    tokenVoucherKey

  const ZERO = new BN(0)
  const ONE_VOUCHER = 1
  const deadline = toWei(1)

  let timestamp

  let distributedAmounts = {
    buyerAmount: new BN(0),
    sellerAmount: new BN(0),
    escrowAmount: new BN(0)
  }

  async function deployContracts () {
    const timestamp = await Utils.getCurrTimestamp()
    const sixtySeconds = 60

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

    contractBSNTokenPrice = await BosonToken.new("BosonTokenPrice", "BPRC")
    contractBSNTokenDeposit = await BosonToken.new("BosonTokenDeposit", "BDEP")

    await contractERC1155ERC721
      .setApprovalForAll(contractVoucherKernel.address, 'true')
    await contractERC1155ERC721
      .setVoucherKernelAddress(contractVoucherKernel.address)
    await contractVoucherKernel
      .setCashierAddress(contractCashier.address)

    await contractERC1155ERC721
      .setCashierContract(contractCashier.address)
    await contractCashier
      .setTokenContractAddress(contractERC1155ERC721.address)

    await contractVoucherKernel.setComplainPeriod(sixtySeconds)
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds)

    await contractFundLimitsOracle
      .setTokenLimit(contractBSNTokenPrice.address, constants.TOKEN_LIMIT)
    await contractFundLimitsOracle
      .setTokenLimit(contractBSNTokenDeposit.address, constants.TOKEN_LIMIT)
    await contractFundLimitsOracle
      .setETHLimit(constants.ETHER_LIMIT)
  }

  describe('TOKEN SUPPLY CREATION (Voucher batch creation)', () => {
    let remQty = constants.QTY_10
    let vouchersToBuy = 5

    const paymentMethods = {
      ETHETH: 1,
      ETHTKN: 2,
      TKNETH: 3,
      TKNTKN: 4
    }

    afterEach(() => {
      remQty = constants.QTY_10
    })

    describe("ETHETH", () => {
      before(async () => {
        await deployContracts()

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            constants.QTY_10)

        timestamp = await Utils.getCurrTimestamp()

        tokenSupplyKey = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10)
      })

      it("ESCROW has correct initial balance", async () => {
        const expectedBalance =
          new BN(constants.seller_deposit).mul(new BN(remQty))
        const escrowAmount = await contractCashier
          .getEscrowAmount(users.seller.address)

        assert.isTrue(
          escrowAmount.eq(expectedBalance),
          "Escrow amount is incorrect")
      })

      it("Get correct remaining qty for supply", async () => {
        let remainingQtyInContract = await contractVoucherKernel
          .getRemQtyForSupply(tokenSupplyKey, users.seller.address)

        assert.equal(
          remainingQtyInContract,
          remQty,
          "Remaining qty is not correct")

        for (let i = 0; i < vouchersToBuy; i++) {
          await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey)
          remainingQtyInContract = await contractVoucherKernel
            .getRemQtyForSupply(tokenSupplyKey, users.seller.address)

          assert.equal(
            remainingQtyInContract,
            --remQty,
            "Remaining qty is not correct")
        }
      })

      it("Should create payment method ETHETH", async () => {
        timestamp = await Utils.getCurrTimestamp()

        let tokenSupplyKey = await utils
          .createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10)

        const paymentDetails = await contractVoucherKernel
          .paymentDetails(tokenSupplyKey)

        assert.equal(
          paymentDetails.paymentMethod.toString(),
          paymentMethods.ETHETH,
          "Payment Method ETHETH not set correctly")
        assert.equal(
          paymentDetails.addressTokenPrice.toString(),
          constants.ZERO_ADDRESS,
          "ETHETH Method Price Token Address mismatch")
        assert.equal(
          paymentDetails.addressTokenDeposits.toString(),
          constants.ZERO_ADDRESS,
          "ETHETH Method Deposit Token Address mismatch")
      })

      it("[NEGATIVE] Should fail if additional token address is provided",
        async () => {
          const txValue =
            new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))

          timestamp = await Utils.getCurrTimestamp()

          await truffleAssert.fails(
            contractCashier.requestCreateOrderETHETH(
              contractBSNTokenDeposit.address,
              [
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1
              ], {
                from: users.seller.address,
                value: txValue
              }
            )
          )
        })

      it("[NEGATIVE] Should not create a supply if price is above the limit",
        async () => {
          const txValue =
            new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))

          await truffleAssert.reverts(
            contractCashier.requestCreateOrderETHETH(
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.ABOVE_ETH_LIMIT,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1
              ], {
                from: users.seller.address,
                value: txValue
              }
            ),
            truffleAssert.ErrorType.REVERT
          )
        })

      it("[NEGATIVE] Should not create a supply if depositBu is above the limit",
        async () => {
          const txValue =
            new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))

          await truffleAssert.reverts(
            contractCashier.requestCreateOrderETHETH(
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.ABOVE_ETH_LIMIT,
                constants.ORDER_QUANTITY1
              ], {
                from: users.seller.address,
                value: txValue
              }
            ),
            truffleAssert.ErrorType.REVERT
          )
        })

      it("[NEGATIVE] Should not create a supply if depositSe is above the limit",
        async () => {
          const txValue =
            new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))

          await truffleAssert.reverts(
            contractCashier.requestCreateOrderETHETH(
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.ABOVE_ETH_LIMIT,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1
              ], {
                from: users.seller.address,
                value: txValue
              }
            ),
            truffleAssert.ErrorType.REVERT
          )
        })
    })

    describe("[WITH PERMIT]", () => {
      describe("ETHTKN", () => {
        before(async () => {
          await deployContracts()

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              contractBSNTokenDeposit)

          const tokensToMint =
            new BN(constants.seller_deposit).mul(new BN(constants.QTY_20))

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint)
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            tokensToMint)

          timestamp = await Utils.getCurrTimestamp()

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          )
        })

        it("ESCROW has correct initial balance", async () => {
          const expectedBalance =
            new BN(constants.seller_deposit).mul(new BN(constants.QTY_10))
          const escrowAmount = await contractBSNTokenDeposit
            .balanceOf(contractCashier.address)

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            "Escrow amount is incorrect")
        })

        it("Get correct remaining qty for supply", async () => {
          let remainingQtyInContract = await contractVoucherKernel
            .getRemQtyForSupply(tokenSupplyKey, users.seller.address)

          assert.equal(
            remainingQtyInContract,
            remQty,
            "Remaining qty is not correct")

          for (let i = 0; i < vouchersToBuy; i++) {
            await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey)
            remainingQtyInContract = await contractVoucherKernel
              .getRemQtyForSupply(tokenSupplyKey, users.seller.address)

            assert.equal(
              remainingQtyInContract,
              --remQty,
              "Remaining qty is not correct")
          }
        })

        it("Should create payment method ETHTKN", async () => {
          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          )

          const paymentDetails = await contractVoucherKernel
            .paymentDetails(tokenSupplyKey)

          assert.equal(
            paymentDetails.paymentMethod.toString(),
            paymentMethods.ETHTKN,
            "Payment Method ETHTKN not set correctly")
          assert.equal(
            paymentDetails.addressTokenPrice.toString(),
            constants.ZERO_ADDRESS,
            "ETHTKN Method Price Token Address mismatch")
          assert.equal(
            paymentDetails.addressTokenDeposits.toString(),
            contractBSNTokenDeposit.address,
            "ETHTKN Method Deposit Token Address mismatch")
        })

        it("[NEGATIVE] Should fail if token deposit contract address is not provided",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.fails(
              contractCashier.requestCreateOrderETHTKNWithPermit(
                '',
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              )
            )
          })

        it("[NEGATIVE] Should revert if token deposit contract address is zero address",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderETHTKNWithPermit(
                constants.ZERO_ADDRESS,
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create a supply if price is above the limit",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)
            const deadline = toWei(1)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderETHTKNWithPermit(
                contractBSNTokenDeposit.address,
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.ABOVE_ETH_LIMIT,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create a supply if depositBu is above the limit",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)
            const deadline = toWei(1)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderETHTKNWithPermit(
                contractBSNTokenDeposit.address,
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.ABOVE_TOKEN_LIMIT,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create a supply if depositSe is above the limit",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)
            const deadline = toWei(1)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderETHTKNWithPermit(
                contractBSNTokenDeposit.address,
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.ABOVE_TOKEN_LIMIT,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })
      })

      describe("TKNETH", () => {
        before(async () => {
          await deployContracts()

          utils = UtilsBuilder
            .create()
            .ERC20withPermit()
            .TKNETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              '')

          timestamp = await Utils.getCurrTimestamp()

          const tokensToMint =
            new BN(constants.product_price).mul(new BN(constants.QTY_10))
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMint)

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          )
        })

        it("ESCROW has correct initial balance", async () => {
          const expectedBalance =
            new BN(constants.seller_deposit).mul(new BN(remQty))
          const escrowAmount = await contractCashier
            .getEscrowAmount(users.seller.address)

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            "Escrow amount is incorrect")
        })

        it("Get correct remaining qty for supply", async () => {
          let remainingQtyInContract = await contractVoucherKernel
            .getRemQtyForSupply(tokenSupplyKey, users.seller.address)

          assert.equal(
            remainingQtyInContract,
            remQty,
            "Remaining qty is not correct")

          for (let i = 0; i < vouchersToBuy; i++) {
            await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey)
            remainingQtyInContract = await contractVoucherKernel
              .getRemQtyForSupply(tokenSupplyKey, users.seller.address)

            assert.equal(
              remainingQtyInContract,
              --remQty,
              "Remaining qty is not correct")
          }
        })

        it("Should create payment method TKNETH", async () => {
          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          )

          const paymentDetails = await contractVoucherKernel
            .paymentDetails(tokenSupplyKey)

          assert.equal(
            paymentDetails.paymentMethod.toString(),
            paymentMethods.TKNETH,
            "Payment Method TKNETH not set correctly")
          assert.equal(
            paymentDetails.addressTokenPrice.toString(),
            contractBSNTokenPrice.address,
            "TKNETH Method Price Token Address mismatch")
          assert.equal(
            paymentDetails.addressTokenDeposits.toString(),
            constants.ZERO_ADDRESS,
            "TKNETH Method Deposit Token Address mismatch")
        })

        it("[NEGATIVE] Should fail if price token contract address is not provided",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))

            await truffleAssert.fails(
              contractCashier.requestCreateOrderTKNETH(
                '',
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address,
                  value: txValue.toString()
                }
              )
            )
          })

        it("[NEGATIVE] Should fail if token price contract is zero address",
          async () => {

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderTKNETH(
                constants.ZERO_ADDRESS,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create a supply if price is above the limit",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderTKNETH(
                contractBSNTokenPrice.address,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.ABOVE_TOKEN_LIMIT,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address, value: txValue.toString()
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create a supply if depositBu is above the limit",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderTKNETH(
                contractBSNTokenPrice.address,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.ABOVE_ETH_LIMIT,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address,
                  value: txValue.toString()
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create a supply if depositSe is above the limit",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderTKNETH(
                contractBSNTokenPrice.address,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.ABOVE_ETH_LIMIT,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address,
                  value: txValue.toString()
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })
      })

      describe("TKNTKN", () => {
        before(async () => {
          await deployContracts()

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              contractBSNTokenDeposit)

          timestamp = await Utils.getCurrTimestamp()

          const tokensToMint =
            new BN(constants.product_price).mul(new BN(constants.QTY_20))

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint)
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMint)
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            tokensToMint)

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          )
        })

        it("ESCROW has correct initial balance", async () => {
          const expectedBalance =
            new BN(constants.seller_deposit).mul(new BN(remQty))
          const escrowAmount = await contractBSNTokenDeposit
            .balanceOf(contractCashier.address)

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            "Escrow amount is incorrect")
        })

        it("Get correct remaining qty for supply", async () => {
          let remainingQtyInContract = await contractVoucherKernel
            .getRemQtyForSupply(tokenSupplyKey, users.seller.address)

          assert.equal(
            remainingQtyInContract,
            remQty,
            "Remaining qty is not correct")

          for (let i = 0; i < vouchersToBuy; i++) {
            await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey)
            remainingQtyInContract = await contractVoucherKernel
              .getRemQtyForSupply(tokenSupplyKey, users.seller.address)

            assert.equal(
              remainingQtyInContract,
              --remQty,
              "Remaining qty is not correct")
          }
        })

        it("Should create payment method TKNTKN", async () => {
          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          )

          const paymentDetails = await contractVoucherKernel
            .paymentDetails(tokenSupplyKey)

          assert.equal(
            paymentDetails.paymentMethod.toString(),
            paymentMethods.TKNTKN,
            "Payment Method TKNTKN not set correctly")
          assert.equal(
            paymentDetails.addressTokenPrice.toString(),
            contractBSNTokenPrice.address,
            "TKNTKN Method Price Token Address mismatch")
          assert.equal(
            paymentDetails.addressTokenDeposits.toString(),
            contractBSNTokenDeposit.address,
            "TKNTKN Method Deposit Token Address mismatch")
        })

        it("[NEGATIVE] Should fail if token price contract address is not provided",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.fails(
              contractCashier.requestCreateOrderTKNTKNWithPermit(
                '',
                contractBSNTokenDeposit.address,
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              )
            )

          })

        it("[NEGATIVE] Should fail if token deposit contract address is not provided",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.fails(
              contractCashier.requestCreateOrderTKNTKNWithPermit(
                contractBSNTokenPrice.address,
                '',
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              )
            )

          })

        it("[NEGATIVE] Should revert if token price contract address is zero address",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderTKNTKNWithPermit(
                constants.ZERO_ADDRESS,
                contractBSNTokenDeposit.address,
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )

          })

        it("[NEGATIVE] Should revert if token deposit contract address is zero address",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(ONE_VOUCHER))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)
            const deadline = toWei(1)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderTKNTKNWithPermit(
                contractBSNTokenPrice.address,
                constants.ZERO_ADDRESS,
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )

          })

        it("[NEGATIVE] Should not create a supply if price is above the limit",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(constants.QTY_1))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderTKNTKNWithPermit(
                contractBSNTokenPrice.address,
                contractBSNTokenDeposit.address,
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.ABOVE_TOKEN_LIMIT,
                  constants.seller_deposit,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create a supply if depositBu is above the limit",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(constants.QTY_1))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderTKNTKNWithPermit(
                contractBSNTokenPrice.address,
                contractBSNTokenDeposit.address,
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.seller_deposit,
                  constants.ABOVE_TOKEN_LIMIT,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create a supply if depositSe is above the limit",
          async () => {
            const txValue =
              new BN(constants.seller_deposit).mul(new BN(constants.QTY_1))
            const nonce = await contractBSNTokenDeposit
              .nonces(users.seller.address)

            const digest = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.seller.address,
              contractCashier.address,
              txValue,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digest.slice(2), 'hex'),
              Buffer.from(users.seller.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestCreateOrderTKNTKNWithPermit(
                contractBSNTokenPrice.address,
                contractBSNTokenDeposit.address,
                txValue,
                deadline,
                v, r, s,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.ABOVE_TOKEN_LIMIT,
                  constants.PROMISE_DEPOSITBU1,
                  constants.ORDER_QUANTITY1
                ], {
                  from: users.seller.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })
      })
    })
  })

  describe("VOUCHER CREATION (Commit to buy)", () => {
    const ORDER_QTY = 5
    let TOKEN_SUPPLY_ID

    before(async () => {
      await deployContracts()
    })

    describe("ETHETH", async () => {
      before(async () => {
        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier)

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_10)
      })

      it("Should create order", async () => {
        const txValue =
          new BN(constants.buyer_deposit).add(new BN(constants.product_price))
        let txFillOrder = await contractCashier
          .requestVoucherETHETH(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            {
              from: users.buyer.address,
              value: txValue
            })

        let internalTx = await truffleAssert
          .createTransactionResult(contractVoucherKernel, txFillOrder.tx)

        truffleAssert.eventEmitted(
          internalTx,
          'LogVoucherDelivered',
          (ev) => {
            tokenVoucherKey = ev._tokenIdVoucher
            return ev._issuer === users.seller.address
          }, "order1 not created successfully")
      })

      it("[NEGATIVE] Should not create order with incorrect price",
        async () => {
          const txValue =
            new BN(constants.buyer_deposit)
              .add(new BN(constants.incorrect_product_price))

          await truffleAssert.reverts(
            contractCashier.requestVoucherETHETH(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              {
                from: users.buyer.address,
                value: txValue
              }),
            truffleAssert.ErrorType.REVERT
          )
        })

      it("[NEGATIVE] Should not create order with incorrect deposit",
        async () => {
          const txValue =
            new BN(constants.buyer_incorrect_deposit)
              .add(new BN(constants.product_price))

          await truffleAssert.reverts(
            contractCashier.requestVoucherETHETH(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              {
                from: users.buyer.address,
                value: txValue
              }),
            truffleAssert.ErrorType.REVERT
          )
        })
    })

    describe("[WITH PERMIT]", () => {
      describe("ETHTKN", async () => {
        before(async () => {
          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              contractBSNTokenDeposit)

          const tokensToMintSeller =
            new BN(constants.seller_deposit).mul(new BN(ORDER_QTY))
          const tokensToMintBuyer =
            new BN(constants.buyer_deposit).mul(new BN(ORDER_QTY))

          await contractBSNTokenDeposit
            .mint(users.seller.address, tokensToMintSeller)
          await contractBSNTokenDeposit
            .mint(users.buyer.address, tokensToMintBuyer)

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          )
        })

        it("Should create order", async () => {
          const nonce = await contractBSNTokenDeposit
            .nonces(users.buyer.address)
          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractCashier.address,
            constants.buyer_deposit,
            nonce,
            deadline
          )

          const { v, r, s } = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

          const txFillOrder = await contractCashier
            .requestVoucherETHTKNWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              constants.buyer_deposit,
              deadline,
              v, r, s,
              {
                from: users.buyer.address,
                value: constants.product_price
              }
            )

          let internalTx = await truffleAssert
            .createTransactionResult(contractVoucherKernel, txFillOrder.tx)

          truffleAssert.eventEmitted(
            internalTx,
            'LogVoucherDelivered',
            (ev) => {
              tokenVoucherKey = ev._tokenIdVoucher
              return ev._issuer === users.seller.address
            }, "order1 not created successfully")
        })

        it("[NEGATIVE] Should not create order with incorrect price",
          async () => {
            const nonce = await contractBSNTokenDeposit
              .nonces(users.buyer.address)
            const digestDeposit = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.buyer.address,
              contractCashier.address,
              constants.buyer_deposit,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digestDeposit.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestVoucherETHTKNWithPermit(
                TOKEN_SUPPLY_ID,
                users.seller.address,
                constants.buyer_deposit,
                deadline,
                v, r, s,
                {
                  from: users.buyer.address,
                  value: constants.incorrect_product_price
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create order with incorrect deposit",
          async () => {
            const nonce = await contractBSNTokenDeposit
              .nonces(users.buyer.address)
            const digestDeposit = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.buyer.address,
              contractCashier.address,
              constants.buyer_deposit,
              nonce,
              deadline
            )

            const { v, r, s } = ecsign(
              Buffer.from(digestDeposit.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestVoucherETHTKNWithPermit(
                TOKEN_SUPPLY_ID,
                users.seller.address,
                constants.buyer_incorrect_deposit,
                deadline,
                v, r, s,
                {
                  from: users.buyer.address,
                  value: constants.product_price
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })
      })

      describe("TKNTKN", () => {
        before(async () => {
          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              contractBSNTokenDeposit)

          const tokensToMintSeller =
            new BN(constants.seller_deposit).mul(new BN(ORDER_QTY))
          const tokensToMintBuyer =
            new BN(constants.product_price).mul(new BN(ORDER_QTY))

          await contractBSNTokenDeposit
            .mint(users.seller.address, tokensToMintSeller)
          await contractBSNTokenDeposit
            .mint(users.buyer.address, tokensToMintBuyer)
          await contractBSNTokenPrice
            .mint(users.buyer.address, tokensToMintBuyer)

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          )
        })

        it("Should create order", async () => {
          const nonce1 = await contractBSNTokenDeposit
            .nonces(users.buyer.address)
          const tokensToSend =
            new BN(constants.product_price)
              .add(new BN(constants.buyer_deposit))

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractCashier.address,
            constants.buyer_deposit,
            nonce1,
            deadline
          )

          let VRS_DEPOSIT = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

          let vDeposit = VRS_DEPOSIT.v
          let rDeposit = VRS_DEPOSIT.r
          let sDeposit = VRS_DEPOSIT.s

          const nonce2 = await contractBSNTokenPrice.nonces(users.buyer.address)

          const digestPrice = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractCashier.address,
            constants.product_price,
            nonce2,
            deadline
          )

          let VRS_PRICE = ecsign(
            Buffer.from(digestPrice.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

          let vPrice = VRS_PRICE.v
          let rPrice = VRS_PRICE.r
          let sPrice = VRS_PRICE.s

          let txFillOrder = await contractCashier
            .requestVoucherTKNTKNWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              tokensToSend,
              deadline,
              vPrice, rPrice, sPrice,
              vDeposit, rDeposit, sDeposit,
              {
                from: users.buyer.address
              })

          let internalTx = await truffleAssert
            .createTransactionResult(contractVoucherKernel, txFillOrder.tx)

          truffleAssert.eventEmitted(
            internalTx,
            'LogVoucherDelivered',
            (ev) => {
              tokenVoucherKey = ev._tokenIdVoucher
              return ev._issuer === users.seller.address
            }, "order1 not created successfully")
        })

        it("[NEGATIVE] Should not create order with incorrect price",
          async () => {
            const nonce1 = await contractBSNTokenDeposit
              .nonces(users.buyer.address)
            const tokensToSend =
              new BN(constants.incorrect_product_price)
                .add(new BN(constants.buyer_deposit))

            const digestDeposit = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.buyer.address,
              contractCashier.address,
              constants.buyer_deposit,
              nonce1,
              deadline
            )

            let VRS_DEPOSIT = ecsign(
              Buffer.from(digestDeposit.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            let vDeposit = VRS_DEPOSIT.v
            let rDeposit = VRS_DEPOSIT.r
            let sDeposit = VRS_DEPOSIT.s

            const nonce2 = await contractBSNTokenPrice
              .nonces(users.buyer.address)

            const digestPrice = await getApprovalDigest(
              contractBSNTokenPrice,
              users.buyer.address,
              contractCashier.address,
              constants.product_price,
              nonce2,
              deadline
            )

            let VRS_PRICE = ecsign(
              Buffer.from(digestPrice.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            let vPrice = VRS_PRICE.v
            let rPrice = VRS_PRICE.r
            let sPrice = VRS_PRICE.s

            await truffleAssert.reverts(
              contractCashier.requestVoucherTKNTKNWithPermit(
                TOKEN_SUPPLY_ID,
                users.seller.address,
                tokensToSend,
                deadline,
                vPrice, rPrice, sPrice,
                vDeposit, rDeposit, sDeposit,
                {
                  from: users.buyer.address
                }),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create order with incorrect deposit",
          async () => {
            const nonce1 = await contractBSNTokenDeposit
              .nonces(users.buyer.address)
            const tokensToSend =
              new BN(constants.product_price)
                .add(new BN(constants.buyer_incorrect_deposit))

            const digestDeposit = await getApprovalDigest(
              contractBSNTokenDeposit,
              users.buyer.address,
              contractCashier.address,
              constants.buyer_deposit,
              nonce1,
              deadline
            )

            let VRS_DEPOSIT = ecsign(
              Buffer.from(digestDeposit.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            let vDeposit = VRS_DEPOSIT.v
            let rDeposit = VRS_DEPOSIT.r
            let sDeposit = VRS_DEPOSIT.s

            const nonce2 = await contractBSNTokenPrice
              .nonces(users.buyer.address)

            const digestPrice = await getApprovalDigest(
              contractBSNTokenPrice,
              users.buyer.address,
              contractCashier.address,
              constants.product_price,
              nonce2,
              deadline
            )

            let VRS_PRICE = ecsign(
              Buffer.from(digestPrice.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            let vPrice = VRS_PRICE.v
            let rPrice = VRS_PRICE.r
            let sPrice = VRS_PRICE.s

            await truffleAssert.reverts(
              contractCashier.requestVoucherTKNTKNWithPermit(
                TOKEN_SUPPLY_ID,
                users.seller.address,
                tokensToSend,
                deadline,
                vPrice, rPrice, sPrice,
                vDeposit, rDeposit, sDeposit,
                {
                  from: users.buyer.address
                }),
              truffleAssert.ErrorType.REVERT
            )
          })

      })

      // Ignored due to deployment failure.
      xdescribe("TKNTKNSAME", () => {
        const tokensToMintSeller =
          new BN(constants.seller_deposit)
            .mul(new BN(ORDER_QTY))
        const tokensToMintBuyer =
          new BN(constants.product_price)
            .mul(new BN(ORDER_QTY))

        before(async () => {
          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKNSAME()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              contractBSNTokenDeposit)

          await utils.contractBSNTokenSAME
            .mint(users.seller.address, tokensToMintSeller)
          await utils.contractBSNTokenSAME
            .mint(users.buyer.address, tokensToMintBuyer)

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          )
        })

        it("Should create voucher", async () => {
          const nonce = await utils.contractBSNTokenSAME
            .nonces(users.buyer.address)
          const tokensToSend =
            new BN(constants.product_price)
              .add(new BN(constants.buyer_deposit))

          const digestTokens = await getApprovalDigest(
            utils.contractBSNTokenSAME,
            users.buyer.address,
            contractCashier.address,
            tokensToSend,
            nonce,
            deadline
          )

          let VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

          let v = VRS_TOKENS.v
          let r = VRS_TOKENS.r
          let s = VRS_TOKENS.s

          let txFillOrder = await contractCashier
            .requestVoucherTKNTKNSameWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              tokensToSend,
              deadline,
              v, r, s,
              {
                from: users.buyer.address
              })

          let internalTx = await truffleAssert
            .createTransactionResult(contractVoucherKernel, txFillOrder.tx)

          truffleAssert.eventEmitted(
            internalTx,
            'LogVoucherDelivered',
            (ev) => {
              tokenVoucherKey1 = ev._tokenIdVoucher
              return ev._issuer === users.seller.address
            }, "order1 not created successfully")
        })

        it("[NEGATIVE] Should not create order with incorrect price",
          async () => {
            const nonce = await contractBSNTokenDeposit
              .nonces(users.buyer.address)
            const incorrectTokensToSign =
              new BN(constants.incorrect_product_price)
                .add(new BN(constants.buyer_deposit))
            const digestTokens = await getApprovalDigest(
              utils.contractBSNTokenSAME,
              users.buyer.address,
              contractCashier.address,
              incorrectTokensToSign,
              nonce,
              deadline
            )

            let VRS_TOKENS = ecsign(
              Buffer.from(digestTokens.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            let v = VRS_TOKENS.v
            let r = VRS_TOKENS.r
            let s = VRS_TOKENS.s

            await truffleAssert.reverts(
              contractCashier.requestVoucherTKNTKNSameWithPermit(
                TOKEN_SUPPLY_ID,
                users.seller.address,
                incorrectTokensToSign,
                deadline,
                v, r, s,
                {
                  from: users.buyer.address
                }),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create order with incorrect deposit",
          async () => {
            const nonce = await contractBSNTokenDeposit
              .nonces(users.buyer.address)
            const incorrectTokensToSign =
              new BN(constants.product_price)
                .add(new BN(constants.buyer_incorrect_deposit))
            const digestTokens = await getApprovalDigest(
              utils.contractBSNTokenSAME,
              users.buyer.address,
              contractCashier.address,
              incorrectTokensToSign,
              nonce,
              deadline
            )

            let VRS_TOKENS = ecsign(
              Buffer.from(digestTokens.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            let v = VRS_TOKENS.v
            let r = VRS_TOKENS.r
            let s = VRS_TOKENS.s

            await truffleAssert.reverts(
              contractCashier.requestVoucherTKNTKNSameWithPermit(
                TOKEN_SUPPLY_ID,
                users.seller.address,
                incorrectTokensToSign,
                deadline,
                v, r, s,
                {
                  from: users.buyer.address
                }),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should revert if Price Token and Deposit Token are diff contracts",
          async () => {
            let utilsTKNTKN = UtilsBuilder.create()
              .ERC20withPermit()
              .TKNTKN()
              .build(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBSNTokenPrice,
                contractBSNTokenDeposit)

            await contractBSNTokenDeposit
              .mint(users.seller.address, tokensToMintSeller)
            await contractBSNTokenDeposit
              .mint(users.buyer.address, tokensToMintBuyer)
            await contractBSNTokenPrice
              .mint(users.buyer.address, tokensToMintBuyer)

            TOKEN_SUPPLY_ID = await utilsTKNTKN.createOrder(
              users.seller,
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.seller_deposit,
              ORDER_QTY
            )

            const nonce = await utils.contractBSNTokenSAME
              .nonces(users.buyer.address)
            const tokensToSend =
              new BN(constants.product_price)
                .add(new BN(constants.buyer_deposit))

            const digestTokens = await getApprovalDigest(
              utils.contractBSNTokenSAME,
              users.buyer.address,
              contractCashier.address,
              tokensToSend,
              nonce,
              deadline
            )

            let VRS_TOKENS = ecsign(
              Buffer.from(digestTokens.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            let v = VRS_TOKENS.v
            let r = VRS_TOKENS.r
            let s = VRS_TOKENS.s

            await truffleAssert.reverts(
              contractCashier.requestVoucherTKNTKNSameWithPermit(
                TOKEN_SUPPLY_ID,
                users.seller.address,
                tokensToSend,
                deadline,
                v, r, s,
                {
                  from: users.buyer.address
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })
      })

      describe("TKNETH", () => {
        before(async () => {
          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              contractBSNTokenDeposit)

          const tokensToMintBuyer =
            new BN(constants.product_price).mul(new BN(ORDER_QTY))

          await contractBSNTokenPrice
            .mint(users.buyer.address, tokensToMintBuyer)

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          )
        })

        it("Should create order", async () => {
          const nonce = await contractBSNTokenPrice
            .nonces(users.buyer.address)

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractCashier.address,
            constants.product_price,
            nonce,
            deadline
          )

          let { v, r, s } = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

          let txFillOrder = await contractCashier
            .requestVoucherTKNETHWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              constants.product_price,
              deadline,
              v, r, s,
              {
                from: users.buyer.address,
                value: constants.buyer_deposit
              }
            )

          let internalTx = await truffleAssert
            .createTransactionResult(contractVoucherKernel, txFillOrder.tx)

          truffleAssert.eventEmitted(
            internalTx,
            'LogVoucherDelivered',
            (ev) => {
              tokenVoucherKey = ev._tokenIdVoucher
              return ev._issuer === users.seller.address
            }, "order1 not created successfully")
        })

        it("[NEGATIVE] Should not create order with incorrect deposit",
          async () => {
            const nonce = await contractBSNTokenPrice
              .nonces(users.buyer.address)

            const digestDeposit = await getApprovalDigest(
              contractBSNTokenPrice,
              users.buyer.address,
              contractCashier.address,
              constants.product_price,
              nonce,
              deadline
            )

            let { v, r, s } = ecsign(
              Buffer.from(digestDeposit.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestVoucherTKNETHWithPermit(
                TOKEN_SUPPLY_ID,
                users.seller.address,
                constants.product_price,
                deadline,
                v, r, s,
                {
                  from: users.buyer.address,
                  value: constants.buyer_incorrect_deposit
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not create order with incorrect price",
          async () => {
            const nonce = await contractBSNTokenPrice
              .nonces(users.buyer.address)

            const digestDeposit = await getApprovalDigest(
              contractBSNTokenPrice,
              users.buyer.address,
              contractCashier.address,
              constants.product_price,
              nonce,
              deadline
            )

            let { v, r, s } = ecsign(
              Buffer.from(digestDeposit.slice(2), 'hex'),
              Buffer.from(users.buyer.privateKey.slice(2), 'hex'))

            await truffleAssert.reverts(
              contractCashier.requestVoucherTKNETHWithPermit(
                TOKEN_SUPPLY_ID,
                users.seller.address,
                constants.incorrect_product_price,
                deadline,
                v, r, s,
                {
                  from: users.buyer.address,
                  value: constants.buyer_deposit
                }
              ),
              truffleAssert.ErrorType.REVERT
            )
          })
      })
    })
  })

  describe("TOKEN SUPPLY TRANSFER", () => {
    let actualOldOwnerBalanceFromEscrow = new BN(0)
    let actualNewOwnerBalanceFromEscrow = new BN(0)
    let expectedBalanceInEscrow = new BN(0)

    afterEach(() => {
      distributedAmounts = {
        buyerAmount: new BN(0),
        sellerAmount: new BN(0),
        escrowAmount: new BN(0)
      }
    })

    describe("Common transfer", () => {

      beforeEach(async () => {
        await deployContracts()
        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier)

        const timestamp = await Utils.getCurrTimestamp()

        tokenSupplyKey = await utils.createOrder(
          users.other1,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10)
      })

      it("Should transfer voucher supply", async () => {
        let transferTx = await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_10, {
            from: users.other1.address
          })

        truffleAssert.eventEmitted(
          transferTx,
          'TransferSingle',
          (ev) => {
            assert.equal(ev._from, users.other1.address)
            assert.equal(ev._to, users.other2.address)
            assert.equal(ev._id.toString(), tokenSupplyKey)
            assert.equal(ev._value.toString(), constants.QTY_10)

            return true
          }, "TransferSingle not emitted")

      })

      it("[NEGATIVE] Should revert if owner tries to transfer voucher supply partially",
        async () => {
          await truffleAssert.reverts(
            utils.safeTransfer1155(
              users.other1.address,
              users.other2.address,
              tokenSupplyKey,
              constants.QTY_1, {
                from: users.other1.address
              }),
            truffleAssert.ErrorType.REVERT
          )
        })

      it("[NEGATIVE] Should revert if Attacker tries to transfer voucher supply",
        async () => {
          await truffleAssert.reverts(
            utils.safeTransfer1155(
              users.other1.address,
              users.other2.address,
              tokenSupplyKey,
              constants.QTY_10, {
                from: users.attacker.address
              }),
            truffleAssert.ErrorType.REVERT
          )
        })

      it("Should transfer batch voucher supply", async () => {
        let transferTx = await utils.safeBatchTransfer1155(
          users.other1.address,
          users.other2.address,
          [ tokenSupplyKey ],
          [ constants.QTY_10 ], {
            from: users.other1.address
          })

        truffleAssert.eventEmitted(
          transferTx,
          'TransferBatch',
          (ev) => {
            assert.equal(ev._from, users.other1.address)
            assert.equal(ev._to, users.other2.address)
            assert.equal(
              JSON.stringify(ev._ids),
              JSON.stringify([ new BN(tokenSupplyKey) ]))
            assert.equal(
              JSON.stringify(ev._values),
              JSON.stringify([ new BN(constants.QTY_10) ]))

            return true
          }, "TransferSingle not emitted")
      })

      it("[NEGATIVE] Should revert if owner tries to transfer voucher supply batch partially",
        async () => {
          await truffleAssert.reverts(
            utils.safeBatchTransfer1155(
              users.other1.address,
              users.other2.address,
              [ tokenSupplyKey ],
              [ constants.QTY_1 ], {
                from: users.other1.address
              }),
            truffleAssert.ErrorType.REVERT
          )
        })

      it("[NEGATIVE] Should revert if Attacker tries to transfer batch voucher supply",
        async () => {
          await truffleAssert.reverts(
            utils.safeBatchTransfer1155(
              users.other1.address,
              users.other2.address,
              [ tokenSupplyKey ],
              [ constants.QTY_10 ], {
                from: users.attacker.address
              }),
            truffleAssert.ErrorType.REVERT
          )
        })
    })

    describe("ETHETH", () => {
      beforeEach(async () => {
        await deployContracts()

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier)

        tokenSupplyKey = await utils.createOrder(
          users.other1,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_1)
      })

      it("Should update escrow amounts after transfer", async () => {
        expectedBalanceInEscrow =
          new BN(constants.seller_deposit).mul(new BN(constants.QTY_1))

        actualOldOwnerBalanceFromEscrow = await contractCashier
          .escrow(users.other1.address)
        actualNewOwnerBalanceFromEscrow = await contractCashier
          .escrow(users.other2.address)

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          "Old owner balance from escrow does not match")
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(ZERO),
          "New owner balance from escrow does not match")

        utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1, {
            from: users.other1.address
          })

        actualOldOwnerBalanceFromEscrow = await contractCashier
          .escrow(users.other1.address)
        actualNewOwnerBalanceFromEscrow = await contractCashier
          .escrow(users.other2.address)

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(ZERO),
          "Old owner balance from escrow does not match")
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          "New owner balance from escrow does not match")
      })

      it("Should finalize 1 voucher to ensure payments are sent to the new owner",
        async () => {
          // 0.04
          const expectedBuyerAmount =
            new BN(constants.buyer_deposit)
          // 0.35
          const expectedSellerAmount =
            new BN(constants.seller_deposit)
              .add(new BN(constants.product_price))
          // 0
          const expectedEscrowAmount = new BN(0)

          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1, {
              from: users.other1.address
            })

          const voucherID = await utils
            .commitToBuy(users.buyer, users.other2, tokenSupplyKey)

          await utils.redeem(voucherID, users.buyer.address)

          await timemachine.advanceTimeSeconds(60)
          await utils.finalize(voucherID, users.deployer.address)

          let withdrawTx = await utils
            .withdraw(voucherID, users.deployer.address)

          truffleAssert.eventEmitted(
            withdrawTx,
            'LogAmountDistribution',
            (ev) => {
              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.buyer.address,
                users.other2.address)
              return true
            }, "Amounts not distributed successfully")

          assert.isTrue(
            distributedAmounts.buyerAmount.eq(expectedBuyerAmount),
            'Buyer Amount is not as expected')
          assert.isTrue(
            distributedAmounts.sellerAmount.eq(expectedSellerAmount),
            'Seller Amount is not as expected')
          assert.isTrue(
            distributedAmounts.escrowAmount.eq(expectedEscrowAmount),
            'Escrow Amount is not as expected')
        })

      it("New owner should be able to COF", async () => {
        utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1, {
            from: users.other1.address
          })

        const voucherID = await utils
          .commitToBuy(users.buyer, users.other2, tokenSupplyKey)

        await utils.redeem(voucherID, users.buyer.address)

        await utils.cancel(voucherID, users.other2.address)
      })

      it("[NEGATIVE] Old owner should not be able to COF", async () => {
        utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1, {
            from: users.other1.address
          })

        const voucherID = await utils
          .commitToBuy(users.buyer, users.other2, tokenSupplyKey)

        await utils.redeem(voucherID, users.buyer.address)

        await truffleAssert.reverts(
          utils.cancel(voucherID, users.other1.address),
          truffleAssert.ErrorType.REVERT
        )
      })
    })

    describe("[WITH PERMIT]", () => {
      describe("ETHTKN", () => {
        let balanceBuyerFromDeposits = new BN(0)

        let balanceSellerFromDeposits = new BN(0)

        let escrowBalanceFromDeposits = new BN(0)

        let cashierPaymentLeft = new BN(0)
        let cashierDepositLeft = new BN(0)

        beforeEach(async () => {
          await deployContracts()

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              contractBSNTokenDeposit)

          const timestamp = await Utils.getCurrTimestamp()

          const tokensToMint =
            new BN(constants.seller_deposit).mul(new BN(constants.QTY_1))

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            tokensToMint)
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            constants.buyer_deposit)

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          )
        })

        async function getBalancesDepositToken () {
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.buyer.address)
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.other2.address)
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.deployer.address)
          cashierDepositLeft = await utils.contractBSNTokenDeposit
            .balanceOf(utils.contractCashier.address)
        }

        it("Should finalize 1 voucher to ensure payments are sent to the new owner",
          async () => {
            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit)
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price)
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit)
            const expectedEscrowAmountDeposit = new BN(0)

            utils.safeTransfer1155(
              users.other1.address,
              users.other2.address,
              tokenSupplyKey,
              constants.QTY_1, {
                from: users.other1.address
              })

            const voucherID = await utils.commitToBuy(
              users.buyer,
              users.other2,
              tokenSupplyKey
            )

            await utils.redeem(voucherID, users.buyer.address)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, users.deployer.address)

            let withdrawTx = await utils
              .withdraw(voucherID, users.deployer.address)

            await getBalancesDepositToken()

            // Payment should have been sent to seller
            truffleAssert.eventEmitted(
              withdrawTx,
              'LogWithdrawal',
              (ev) => {
                assert.equal(
                  ev._payee,
                  users.other2.address,
                  "Incorrect Payee")
                assert.isTrue(ev._payment.eq(expectedSellerPrice))

                return true
              }, "Event LogWithdrawal was not emitted")

            // Deposits
            assert.isTrue(
              balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
              "Buyer did not get expected tokens from DepositTokenContract")
            assert.isTrue(
              balanceSellerFromDeposits.eq(expectedSellerDeposit),
              "Seller did not get expected tokens from DepositTokenContract")
            assert.isTrue(
              escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
              "Escrow did not get expected tokens from DepositTokenContract")

            // Cashier Should be Empty
            assert.isTrue(
              cashierPaymentLeft.eq(new BN(0)),
              "Cashier Contract is not empty")
            assert.isTrue(
              cashierDepositLeft.eq(new BN(0)),
              "Cashier Contract is not empty")

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
                return true
              }, "Event LogAmountDistribution was not emitted")
          })

        it("New owner should be able to COF", async () => {
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1, {
              from: users.other1.address
            })

          const voucherID = await utils
            .commitToBuy(users.buyer, users.other2, tokenSupplyKey)

          await utils.redeem(voucherID, users.buyer.address)

          await utils.cancel(voucherID, users.other2.address)
        })

        it("[NEGATIVE] Old owner should not be able to COF",
          async () => {
            utils.safeTransfer1155(
              users.other1.address,
              users.other2.address,
              tokenSupplyKey,
              constants.QTY_1, {
                from: users.other1.address
              })

            const voucherID = await utils
              .commitToBuy(users.buyer, users.other2, tokenSupplyKey)

            await utils.redeem(voucherID, users.buyer.address)

            await truffleAssert.reverts(
              utils.cancel(voucherID, users.other1.address),
              truffleAssert.ErrorType.REVERT
            )
          })
      })

      describe("TKNTKN", () => {
        let balanceBuyerFromPayment = new BN(0)
        let balanceBuyerFromDeposits = new BN(0)

        let balanceSellerFromPayment = new BN(0)
        let balanceSellerFromDeposits = new BN(0)

        let escrowBalanceFromPayment = new BN(0)
        let escrowBalanceFromDeposits = new BN(0)

        let cashierPaymentLeft = new BN(0)
        let cashierDepositLeft = new BN(0)

        beforeEach(async () => {
          await deployContracts()

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              contractBSNTokenDeposit)

          const timestamp = await Utils.getCurrTimestamp()

          const supplyQty = 1
          const tokensToMint =
            new BN(constants.seller_deposit).mul(new BN(supplyQty))

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            tokensToMint)
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            constants.product_price)
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            constants.buyer_deposit)

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            supplyQty
          )

        })

        async function getBalancesFromPriceTokenAndDepositToken () {

          balanceBuyerFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.buyer.address)
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.buyer.address)

          balanceSellerFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.other2.address)
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.other2.address)

          escrowBalanceFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.deployer.address)
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.deployer.address)

          cashierPaymentLeft = await utils.contractBSNTokenPrice
            .balanceOf(utils.contractCashier.address)
          cashierDepositLeft = await utils.contractBSNTokenDeposit
            .balanceOf(utils.contractCashier.address)
        }

        it("Should finalize 1 voucher to ensure payments are sent to the new owner",
          async () => {
            const expectedBuyerPrice = new BN(0)
            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit)
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price)
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit)
            const expectedEscrowAmountDeposit = new BN(0)
            const expectedEscrowAmountPrice = new BN(0)

            utils.safeTransfer1155(
              users.other1.address,
              users.other2.address,
              tokenSupplyKey,
              constants.QTY_1, {
                from: users.other1.address
              })

            voucherID = await utils
              .commitToBuy(users.buyer, users.other2, tokenSupplyKey)

            await utils.redeem(voucherID, users.buyer.address)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, users.deployer.address)

            const withdrawTx = await utils
              .withdraw(voucherID, users.deployer.address)

            await getBalancesFromPriceTokenAndDepositToken()

            // Payments
            assert.isTrue(
              balanceBuyerFromPayment.eq(expectedBuyerPrice),
              "Buyer did not get expected tokens from PriceTokenContract")
            assert.isTrue(
              balanceSellerFromPayment.eq(expectedSellerPrice),
              "Seller did not get expected tokens from PriceTokenContract")
            assert.isTrue(
              escrowBalanceFromPayment.eq(expectedEscrowAmountPrice),
              "Escrow did not get expected tokens from PriceTokenContract")

            // Deposits
            assert.isTrue(
              balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
              "Buyer did not get expected tokens from DepositTokenContract")
            assert.isTrue(
              balanceSellerFromDeposits.eq(expectedSellerDeposit),
              "Seller did not get expected tokens from DepositTokenContract")
            assert.isTrue(
              escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
              "Escrow did not get expected tokens from DepositTokenContract")

            // Cashier Should be Empty
            assert.isTrue(
              cashierPaymentLeft.eq(ZERO),
              "Cashier Contract is not empty")
            assert.isTrue(
              cashierDepositLeft.eq(ZERO),
              "Cashier Contract is not empty")

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
                return true
              }, "Event LogAmountDistribution was not emitted")
          })

        it("New owner should be able to COF", async () => {
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1, {
              from: users.other1.address
            })

          const voucherID = await utils
            .commitToBuy(users.buyer, users.other2, tokenSupplyKey)

          await utils.redeem(voucherID, users.buyer.address)

          await utils.cancel(voucherID, users.other2.address)
        })

        it("[NEGATIVE] Old owner should not be able to COF",
          async () => {
            utils.safeTransfer1155(
              users.other1.address,
              users.other2.address,
              tokenSupplyKey,
              constants.QTY_1, {
                from: users.other1.address
              })

            const voucherID = await utils
              .commitToBuy(users.buyer, users.other2, tokenSupplyKey)

            await utils.redeem(voucherID, users.buyer.address)

            await truffleAssert.reverts(
              utils.cancel(voucherID, users.other1.address),
              truffleAssert.ErrorType.REVERT
            )
          })
      })

      describe("TKNETH", () => {
        let balanceBuyerFromPayment = new BN(0)
        let balanceSellerFromPayment = new BN(0)
        let escrowBalanceFromPayment = new BN(0)

        let cashierPaymentLeft = new BN(0)
        let cashierDepositLeft = new BN(0)

        beforeEach(async () => {

          await deployContracts()

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              '')

          const timestamp = await Utils.getCurrTimestamp()

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            constants.product_price)

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          )
        })

        async function getBalancesPriceToken () {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.buyer.address)
          balanceSellerFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.other2.address)
          escrowBalanceFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.deployer.address)
          cashierPaymentLeft = await utils.contractBSNTokenPrice
            .balanceOf(utils.contractCashier.address)
        }

        it("Should update escrow amounts after transfer", async () => {
          expectedBalanceInEscrow =
            new BN(constants.seller_deposit).mul(new BN(constants.QTY_1))

          actualOldOwnerBalanceFromEscrow = await contractCashier
            .escrow(users.other1.address)
          actualNewOwnerBalanceFromEscrow = await contractCashier
            .escrow(users.other2.address)

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            "Old owner balance from escrow does not match")
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(ZERO),
            "New owner balance from escrow does not match")

          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1, {
              from: users.other1.address
            })

          actualOldOwnerBalanceFromEscrow = await contractCashier
            .escrow(users.other1.address)
          actualNewOwnerBalanceFromEscrow = await contractCashier
            .escrow(users.other2.address)

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(ZERO),
            "Old owner balance from escrow does not match")
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            "New owner balance from escrow does not match")
        })

        it("Should finalize 1 voucher to ensure payments are sent to the new owner",
          async () => {
            const expectedBuyerPrice = new BN(0)
            // 0.3
            const expectedSellerPrice = new BN(constants.product_price)
            const expectedEscrowPrice = new BN(0)
            // 0.04
            const expectedBuyerDeposit = new BN(constants.buyer_deposit)
            // 0.05
            const expectedSellerDeposit = new BN(constants.seller_deposit)
            const expectedEscrowAmountDeposit = new BN(0)

            utils.safeTransfer1155(
              users.other1.address,
              users.other2.address,
              tokenSupplyKey,
              constants.QTY_1, {
                from: users.other1.address
              })

            const voucherID = await utils.commitToBuy(
              users.buyer,
              users.other2,
              tokenSupplyKey
            )
            await utils.redeem(voucherID, users.buyer.address)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, users.deployer.address)

            let withdrawTx = await utils
              .withdraw(voucherID, users.deployer.address)

            await getBalancesPriceToken()

            // Payments in TKN
            // Payment should have been sent to seller
            assert.isTrue(
              balanceBuyerFromPayment.eq(expectedBuyerPrice),
              "Buyer did not get expected tokens from PaymentTokenContract")
            assert.isTrue(
              balanceSellerFromPayment.eq(expectedSellerPrice),
              "Seller did not get expected tokens from PaymentTokenContract")
            assert.isTrue(
              escrowBalanceFromPayment.eq(expectedEscrowPrice),
              "Escrow did not get expected tokens from PaymentTokenContract")

            //Deposits in ETH
            truffleAssert.eventEmitted(
              withdrawTx,
              'LogWithdrawal',
              (ev) => {
                utils.calcTotalAmountToRecipients(
                  ev,
                  distributedAmounts,
                  '_payee',
                  users.buyer.address,
                  users.other2.address)
                return true
              }, "Amounts not distributed successfully")

            assert.isTrue(
              distributedAmounts.buyerAmount.eq(expectedBuyerDeposit),
              'Buyer Amount is not as expected')
            assert.isTrue(
              distributedAmounts.sellerAmount.eq(expectedSellerDeposit),
              'Seller Amount is not as expected')
            assert.isTrue(
              distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit),
              'Escrow Amount is not as expected')

            //Cashier Should be Empty
            assert.isTrue(
              cashierPaymentLeft.eq(new BN(0)),
              "Cashier Contract is not empty")
            assert.isTrue(
              cashierDepositLeft.eq(new BN(0)),
              "Cashier Contract is not empty")

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
                return true
              }, "Event LogAmountDistribution was not emitted")
          })

        it("New owner should be able to COF", async () => {
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1, {
              from: users.other1.address
            })

          const voucherID = await utils
            .commitToBuy(users.buyer, users.other2, tokenSupplyKey)

          await utils.redeem(voucherID, users.buyer.address)

          await utils.cancel(voucherID, users.other2.address)
        })

        it("[NEGATIVE] Old owner should not be able to COF",
          async () => {
            utils.safeTransfer1155(
              users.other1.address,
              users.other2.address,
              tokenSupplyKey,
              constants.QTY_1, {
                from: users.other1.address
              })

            const voucherID = await utils
              .commitToBuy(users.buyer, users.other2, tokenSupplyKey)

            await utils.redeem(voucherID, users.buyer.address)

            await truffleAssert.reverts(
              utils.cancel(voucherID, users.other1.address),
              truffleAssert.ErrorType.REVERT
            )
          })
      })
    })
  })

  describe("VOUCHER TRANSFER", () => {
    let actualOldOwnerBalanceFromEscrow = new BN(0)
    let actualNewOwnerBalanceFromEscrow = new BN(0)
    let expectedBalanceInEscrow = new BN(0)

    afterEach(() => {
      distributedAmounts = {
        buyerAmount: new BN(0),
        sellerAmount: new BN(0),
        escrowAmount: new BN(0)
      }

      actualOldOwnerBalanceFromEscrow = new BN(0)
      actualNewOwnerBalanceFromEscrow = new BN(0)
      expectedBalanceInEscrow = new BN(0)
    })

    describe("Common transfer", () => {

      before(async () => {

        await deployContracts()

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier)

        tokenSupplyKey = await utils
          .createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            constants.QTY_10)
      })

      it("Should transfer a voucher", async () => {
        voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey)

        let transferTx = await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID, {
            from: users.other1.address
          })

        truffleAssert.eventEmitted(
          transferTx,
          'Transfer',
          (ev) => {
            assert.equal(ev._from, users.other1.address)
            assert.equal(ev._to, users.other2.address)
            assert.equal(ev._tokenId.toString(), voucherID)

            return true
          }, "Transfer not emitted")
      })
    })

    describe("ETHETH", async () => {
      beforeEach(async () => {
        await deployContracts()

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier)

        tokenSupplyKey = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_10)
      })

      it("Should update escrow amounts after transfer", async () => {
        expectedBalanceInEscrow =
          new BN(constants.product_price)
            .add(new BN(constants.buyer_deposit))
        voucherID = await utils
          .commitToBuy(users.other1, users.seller, tokenSupplyKey)

        actualOldOwnerBalanceFromEscrow = await contractCashier
          .escrow(users.other1.address)
        actualNewOwnerBalanceFromEscrow = await contractCashier
          .escrow(users.other2.address)

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          "Old owner balance from escrow does not match")
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(ZERO),
          "New owner balance from escrow does not match")

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address, voucherID, {
            from: users.other1.address
          })

        actualOldOwnerBalanceFromEscrow = await contractCashier
          .escrow(users.other1.address)
        actualNewOwnerBalanceFromEscrow = await contractCashier
          .escrow(users.other2.address)

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(ZERO),
          "Old owner balance from escrow does not match")
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          "New owner balance from escrow does not match")
      })

      it("Should finalize 1 voucher to ensure payments are sent to the new owner",
        async () => {
          // 0.3 + 0.04 + 0.025
          const expectedBuyerAmount =
            new BN(constants.buyer_deposit)
              .add(new BN(constants.product_price))
              .add(new BN(constants.seller_deposit).div(new BN(2)))
          // 0.0125
          const expectedSellerAmount =
            new BN(constants.seller_deposit).div(new BN(4))
          // 0.0125
          const expectedEscrowAmount =
            new BN(constants.seller_deposit).div(new BN(4))

          voucherID = await utils
            .commitToBuy(users.other1, users.seller, tokenSupplyKey)

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID, {
              from: users.other1.address
            })

          await utils.refund(voucherID, users.other2.address)
          await utils.complain(voucherID, users.other2.address)
          await utils.cancel(voucherID, users.seller.address)
          await utils.finalize(voucherID, users.deployer.address)

          const withdrawTx = await utils
            .withdraw(voucherID, users.deployer.address)

          truffleAssert.eventEmitted(
            withdrawTx,
            'LogAmountDistribution',
            (ev) => {
              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_to',
                users.other2.address,
                users.seller.address)
              return true
            }, "Amounts not distributed successfully")

          assert.isTrue(
            distributedAmounts.buyerAmount.eq(expectedBuyerAmount),
            'Buyer Amount is not as expected')
          assert.isTrue(
            distributedAmounts.sellerAmount.eq(expectedSellerAmount),
            'Seller Amount is not as expected')
          assert.isTrue(
            distributedAmounts.escrowAmount.eq(expectedEscrowAmount),
            'Escrow Amount is not as expected')
        })

      it("[NEGATIVE] Old owner should not be able to interact with the voucher",
        async () => {
          voucherID = await utils
            .commitToBuy(users.other1, users.seller, tokenSupplyKey)

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID, {
              from: users.other1.address
            })

          await truffleAssert.reverts(
            utils.redeem(voucherID, users.other1.address),
            truffleAssert.ErrorType.REVERT
          )

          await truffleAssert.reverts(
            utils.refund(voucherID, users.other1.address),
            truffleAssert.ErrorType.REVERT
          )
        })

      it("[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer",
        async () => {
          voucherID = await utils
            .commitToBuy(users.other1, users.seller, tokenSupplyKey)

          await truffleAssert.reverts(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID, {
                from: users.attacker.address
              }),
            truffleAssert.ErrorType.REVERT
          )
        })
    })

    describe("[WITH PERMIT]", () => {
      describe("ETHTKN", () => {
        let balanceBuyerFromDeposits = new BN(0)
        let balanceSellerFromDeposits = new BN(0)
        let escrowBalanceFromDeposits = new BN(0)

        let cashierPaymentLeft = new BN(0)
        let cashierDepositLeft = new BN(0)

        async function getBalancesDepositToken () {
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.other2.address)
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.seller.address)
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.deployer.address)
          cashierDepositLeft = await utils.contractBSNTokenDeposit
            .balanceOf(utils.contractCashier.address)
        }

        beforeEach(async () => {
          await deployContracts()

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              contractBSNTokenDeposit)

          const timestamp = await Utils.getCurrTimestamp()

          const supplyQty = 1
          const tokensToMint =
            new BN(constants.seller_deposit).mul(new BN(supplyQty))

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint)
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            constants.buyer_deposit)

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            supplyQty
          )
        })

        afterEach(async () => {
          distributedAmounts = {
            buyerAmount: new BN(0),
            sellerAmount: new BN(0),
            escrowAmount: new BN(0)
          }

          balanceBuyerFromPayment = new BN(0)
          balanceBuyerFromDeposits = new BN(0)

          balanceSellerFromPayment = new BN(0)
          balanceSellerFromDeposits = new BN(0)

          escrowBalanceFromPayment = new BN(0)
          escrowBalanceFromDeposits = new BN(0)

          cashierPaymentLeft = new BN(0)
          cashierDepositLeft = new BN(0)

          const isPaused = await contractCashier.paused()
          if (isPaused) {
            await contractCashier.unpause()
          }
        })

        it("Should update escrow amounts after transfer",
          async () => {
            expectedBalanceInEscrow = new BN(constants.product_price)
            voucherID = await utils
              .commitToBuy(users.other1, users.seller, tokenSupplyKey)

            actualOldOwnerBalanceFromEscrow = await contractCashier
              .escrow(users.other1.address)
            actualNewOwnerBalanceFromEscrow = await contractCashier
              .escrow(users.other2.address)

            assert.isTrue(
              actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
              "Old owner balance from escrow does not match")
            assert.isTrue(
              actualNewOwnerBalanceFromEscrow.eq(ZERO),
              "New owner balance from escrow does not match")

            await utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID, {
                from: users.other1.address
              })

            actualOldOwnerBalanceFromEscrow = await contractCashier
              .escrow(users.other1.address)
            actualNewOwnerBalanceFromEscrow = await contractCashier
              .escrow(users.other2.address)

            assert.isTrue(
              actualOldOwnerBalanceFromEscrow.eq(ZERO),
              "Old owner balance from escrow does not match")
            assert.isTrue(
              actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
              "New owner balance from escrow does not match")
          })

        it("Should finalize 1 voucher to ensure payments are sent to the new owner",
          async () => {
            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price)
            // 0.065
            const expectedBuyerDeposit =
              new BN(constants.buyer_deposit)
                .add(new BN(constants.seller_deposit).div(new BN(2)))
            // 0.0125
            const expectedSellerDeposit =
              new BN(constants.seller_deposit).div(new BN(4))
            // 0.0125
            const expectedEscrowAmountDeposit =
              new BN(constants.seller_deposit).div(new BN(4))

            voucherID = await utils
              .commitToBuy(users.other1, users.seller, tokenSupplyKey)

            await utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID, {
                from: users.other1.address
              })

            await utils.refund(voucherID, users.other2.address)
            await utils.complain(voucherID, users.other2.address)
            await utils.cancel(voucherID, users.seller.address)
            await utils.finalize(voucherID, users.deployer.address)

            const withdrawTx = await utils
              .withdraw(voucherID, users.deployer.address)

            await getBalancesDepositToken()

            // Payment should have been returned to buyer
            truffleAssert.eventEmitted(
              withdrawTx,
              'LogWithdrawal',
              (ev) => {
                assert.equal(
                  ev._payee,
                  users.other2.address,
                  "Incorrect Payee")
                assert.isTrue(ev._payment.eq(expectedBuyerPrice))

                return true
              }, "Event LogAmountDistribution was not emitted")

            //Deposits
            assert.isTrue(
              balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
              "NewVoucherOwner did not get expected tokens from " +
              "DepositTokenContract")
            assert.isTrue(
              balanceSellerFromDeposits.eq(expectedSellerDeposit),
              "Seller did not get expected tokens from DepositTokenContract")
            assert.isTrue(
              escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
              "Escrow did not get expected tokens from DepositTokenContract")

            //Cashier Should be Empty
            assert.isTrue(
              cashierPaymentLeft.eq(new BN(0)),
              "Cashier Contract is not empty")
            assert.isTrue(
              cashierDepositLeft.eq(new BN(0)),
              "Cashier Contract is not empty")

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
                utils.calcTotalAmountToRecipients(
                  ev,
                  distributedAmounts,
                  '_to',
                  users.other2.address,
                  users.seller.address)
                return true
              }, "Amounts not distributed successfully")

          })

        it("[NEGATIVE] Old owner should not be able to interact with the voucher",
          async () => {
            voucherID = await utils
              .commitToBuy(users.other1, users.seller, tokenSupplyKey)

            await utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID, {
                from: users.other1.address
              })

            await truffleAssert.reverts(
              utils.redeem(voucherID, users.other1.address),
              truffleAssert.ErrorType.REVERT
            )

            await truffleAssert.reverts(
              utils.refund(voucherID, users.other1.address),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer",
          async () => {
            voucherID = await utils
              .commitToBuy(users.other1, users.seller, tokenSupplyKey)

            await truffleAssert.reverts(
              utils.safeTransfer721(
                users.other1.address,
                users.other2.address,
                voucherID, {
                  from: users.attacker.address
                }),
              truffleAssert.ErrorType.REVERT
            )
          })
      })

      describe("TKNTKN", () => {
        let balanceBuyerFromPayment = new BN(0)
        let balanceBuyerFromDeposits = new BN(0)

        let balanceSellerFromPayment = new BN(0)
        let balanceSellerFromDeposits = new BN(0)

        let escrowBalanceFromPayment = new BN(0)
        let escrowBalanceFromDeposits = new BN(0)

        let cashierPaymentLeft = new BN(0)
        let cashierDepositLeft = new BN(0)

        async function getBalancesFromPriceTokenAndDepositToken () {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.other2.address)
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.other2.address)

          balanceSellerFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.seller.address)
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.seller.address)

          escrowBalanceFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.deployer.address)
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit
            .balanceOf(users.deployer.address)

          cashierPaymentLeft = await utils.contractBSNTokenPrice
            .balanceOf(utils.contractCashier.address)
          cashierDepositLeft = await utils.contractBSNTokenDeposit
            .balanceOf(utils.contractCashier.address)
        }

        beforeEach(async () => {
          await deployContracts()

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              contractBSNTokenDeposit)

          const timestamp = await Utils.getCurrTimestamp()

          const supplyQty = 1
          const tokensToMint =
            new BN(constants.seller_deposit).mul(new BN(supplyQty))

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint)
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.other1.address,
            constants.product_price)
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            constants.buyer_deposit)

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            supplyQty
          )
        })

        it("Should finalize 1 voucher to ensure payments are sent to the new owner",
          async () => {
            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price)
            // 0.065
            const expectedBuyerDeposit =
              new BN(constants.buyer_deposit)
                .add(new BN(constants.seller_deposit).div(new BN(2)))
            const expectedSellerPrice = new BN(0)
            // 0.0125
            const expectedSellerDeposit =
              new BN(constants.seller_deposit).div(new BN(4))
            // 0.0125
            const expectedEscrowAmountDeposit =
              new BN(constants.seller_deposit).div(new BN(4))
            const expectedEscrowAmountPrice = new BN(0)

            voucherID = await utils
              .commitToBuy(users.other1, users.seller, tokenSupplyKey)

            await utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID, {
                from: users.other1.address
              })

            await utils.refund(voucherID, users.other2.address)
            await utils.complain(voucherID, users.other2.address)
            await utils.cancel(voucherID, users.seller.address)
            await utils.finalize(voucherID, users.deployer.address)

            const withdrawTx = await utils
              .withdraw(voucherID, users.deployer.address)

            await getBalancesFromPriceTokenAndDepositToken()

            // Payments
            assert.isTrue(
              balanceBuyerFromPayment.eq(expectedBuyerPrice),
              "Buyer did not get expected tokens from PriceTokenContract")
            assert.isTrue(
              balanceSellerFromPayment.eq(expectedSellerPrice),
              "Seller did not get expected tokens from PriceTokenContract")
            assert.isTrue(
              escrowBalanceFromPayment.eq(expectedEscrowAmountPrice),
              "Escrow did not get expected tokens from PriceTokenContract")

            // Deposits
            assert.isTrue(
              balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
              "Buyer did not get expected tokens from DepositTokenContract")
            assert.isTrue(
              balanceSellerFromDeposits.eq(expectedSellerDeposit),
              "Seller did not get expected tokens from DepositTokenContract")
            assert.isTrue(
              escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
              "Buyer did not get expected tokens from DepositTokenContract")

            // Cashier Should be Empty
            assert.isTrue(
              cashierPaymentLeft.eq(new BN(0)),
              "Cashier Contract is not empty")
            assert.isTrue(
              cashierDepositLeft.eq(new BN(0)),
              "Cashier Contract is not empty")

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
                return true
              }, "Event LogAmountDistribution was not emitted")
          })

        it("[NEGATIVE] Old owner should not be able to interact with the voucher",
          async () => {
            voucherID = await utils
              .commitToBuy(users.other1, users.seller, tokenSupplyKey)

            await utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID, {
                from: users.other1.address
              })

            await truffleAssert.reverts(
              utils.redeem(voucherID, users.other1.address),
              truffleAssert.ErrorType.REVERT
            )

            await truffleAssert.reverts(
              utils.refund(voucherID, users.other1.address),
              truffleAssert.ErrorType.REVERT
            )

          })

        it("[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer",
          async () => {
            voucherID = await utils
              .commitToBuy(users.other1, users.seller, tokenSupplyKey)

            await truffleAssert.reverts(
              utils.safeTransfer721(
                users.other1.address,
                users.other2.address,
                voucherID, {
                  from: users.attacker.address
                }),
              truffleAssert.ErrorType.REVERT
            )
          })

      })

      describe("TKNETH", () => {
        let balanceBuyerFromPayment = new BN(0)
        let balanceSellerFromPayment = new BN(0)
        let escrowBalanceFromPayment = new BN(0)

        let cashierPaymentLeft = new BN(0)
        let cashierDepositLeft = new BN(0)

        beforeEach(async () => {
          await deployContracts()

          utils = UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBSNTokenPrice,
              '')

          const timestamp = await Utils.getCurrTimestamp()

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.other1.address,
            constants.product_price)

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          )
        })

        async function getBalancesPriceToken () {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.other2.address)
          balanceSellerFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.seller.address)
          escrowBalanceFromPayment = await utils.contractBSNTokenPrice
            .balanceOf(users.deployer.address)
          cashierPaymentLeft = await utils.contractBSNTokenPrice
            .balanceOf(utils.contractCashier.address)
        }

        it("Should update escrow amounts after transfer", async () => {
          expectedBalanceInEscrow = new BN(constants.buyer_deposit)
          voucherID = await utils
            .commitToBuy(users.other1, users.seller, tokenSupplyKey)

          actualOldOwnerBalanceFromEscrow = await contractCashier
            .escrow(users.other1.address)
          actualNewOwnerBalanceFromEscrow = await contractCashier
            .escrow(users.other2.address)

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            "Old owner balance from escrow does not match")
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(ZERO),
            "New owner balance from escrow does not match")

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID, {
              from: users.other1.address
            })

          actualOldOwnerBalanceFromEscrow = await contractCashier
            .escrow(users.other1.address)
          actualNewOwnerBalanceFromEscrow = await contractCashier
            .escrow(users.other2.address)

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(ZERO),
            "Old owner balance from escrow does not match")
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            "New owner balance from escrow does not match")
        })

        it("Should finalize 1 voucher to ensure payments are sent to the new owner",
          async () => {
            // 0.3
            const expectedBuyerPrice = new BN(constants.product_price)
            const expectedSellerPrice = new BN(0)
            const expectedEscrowPrice = new BN(0)
            // 0.065
            const expectedBuyerDeposit =
              new BN(constants.buyer_deposit)
                .add(new BN(constants.seller_deposit).div(new BN(2)))
            // 0.0125
            const expectedSellerDeposit =
              new BN(constants.seller_deposit).div(new BN(4))
            // 0.0125
            const expectedEscrowAmountDeposit =
              new BN(constants.seller_deposit).div(new BN(4))

            voucherID = await utils
              .commitToBuy(users.other1, users.seller, tokenSupplyKey)

            await utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID, {
                from: users.other1.address
              })

            await utils.refund(voucherID, users.other2.address)
            await utils.complain(voucherID, users.other2.address)
            await utils.cancel(voucherID, users.seller.address)
            await utils.finalize(voucherID, users.deployer.address)

            const withdrawTx = await utils
              .withdraw(voucherID, users.deployer.address)

            await getBalancesPriceToken()

            // Payments in TKN
            // Payment should have been returned to buyer
            assert.isTrue(
              balanceBuyerFromPayment.eq(expectedBuyerPrice),
              "Buyer did not get expected tokens from PaymentTokenContract")
            assert.isTrue(
              balanceSellerFromPayment.eq(expectedSellerPrice),
              "Seller did not get expected tokens from PaymentTokenContract")
            assert.isTrue(
              escrowBalanceFromPayment.eq(expectedEscrowPrice),
              "Escrow did not get expected tokens from PaymentTokenContract")

            // Deposits in ETH
            truffleAssert.eventEmitted(
              withdrawTx,
              'LogWithdrawal',
              (ev) => {
                utils.calcTotalAmountToRecipients(
                  ev,
                  distributedAmounts,
                  '_payee',
                  users.other2.address,
                  users.seller.address)
                return true
              }, "Amounts not distributed successfully")

            assert.isTrue(
              distributedAmounts.buyerAmount.eq(expectedBuyerDeposit),
              'Buyer Amount is not as expected')
            assert.isTrue(
              distributedAmounts.sellerAmount.eq(expectedSellerDeposit),
              'Seller Amount is not as expected')
            assert.isTrue(
              distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit),
              'Escrow Amount is not as expected')

            // Cashier Should be Empty
            assert.isTrue(
              cashierPaymentLeft.eq(new BN(0)),
              "Cashier Contract is not empty")
            assert.isTrue(
              cashierDepositLeft.eq(new BN(0)),
              "Cashier Contract is not empty")

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
                return true
              }, "Event LogAmountDistribution was not emitted")
          })

        it("[NEGATIVE] Old owner should not be able to interact with the voucher",
          async () => {
            voucherID = await utils
              .commitToBuy(users.other1, users.seller, tokenSupplyKey)

            await utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID, {
                from: users.other1.address
              })

            await truffleAssert.reverts(
              utils.redeem(voucherID, users.other1.address),
              truffleAssert.ErrorType.REVERT
            )

            await truffleAssert.reverts(
              utils.refund(voucherID, users.other1.address),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer",
          async () => {
            voucherID = await utils
              .commitToBuy(users.other1, users.seller, tokenSupplyKey)

            await truffleAssert.reverts(
              utils.safeTransfer721(
                users.other1.address,
                users.other2.address,
                voucherID, {
                  from: users.attacker.address
                }),
              truffleAssert.ErrorType.REVERT
            )
          })
      })
    })
  })
})
