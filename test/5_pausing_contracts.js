const { assert } = require('chai')
const truffleAssert = require('truffle-assertions')

const constants = require("../testHelpers/constants")
const timemachine = require('../testHelpers/timemachine')
const Users = require('../testHelpers/users')
const UtilsBuilder = require('../testHelpers/utilsBuilder')
const Utils = require('../testHelpers/utils')

const ERC1155ERC721 = artifacts.require("ERC1155ERC721")
const VoucherKernel = artifacts.require("VoucherKernel")
const Cashier = artifacts.require("Cashier")
const BosonTKN = artifacts.require("BosonTokenPrice")
const FundLimitsOracle = artifacts.require('FundLimitsOracle')

const BN = web3.utils.BN
let utils

let TOKEN_SUPPLY_ID
let VOUCHER_ID

contract("Cashier && VK", async addresses => {
  const users = new Users(addresses)

  let Attacker = users.attacker

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBSNTokenPrice,
    contractBSNTokenDeposit,
    contractFundLimitsOracle
  let tokensToMint
  let timestamp

  async function deployContracts () {
    const sixtySeconds = 60

    contractFundLimitsOracle = await FundLimitsOracle.new()
    contractERC1155ERC721 = await ERC1155ERC721.new()
    contractVoucherKernel = await VoucherKernel.new(
      contractERC1155ERC721.address)
    contractCashier = await Cashier.new(
      contractVoucherKernel.address,
      contractERC1155ERC721.address,
      contractFundLimitsOracle.address)
    contractBSNTokenPrice = await BosonTKN.new('BosonTokenPrice', 'BPRC')
    contractBSNTokenDeposit = await BosonTKN.new('BosonTokenDeposit', 'BDEP')

    await contractERC1155ERC721
      .setApprovalForAll(contractVoucherKernel.address, 'true')
    await contractERC1155ERC721
      .setVoucherKernelAddress(contractVoucherKernel.address)
    await contractVoucherKernel
      .setCashierAddress(contractCashier.address)

    await contractVoucherKernel.setComplainPeriod(sixtySeconds)
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds)

    await contractFundLimitsOracle
      .setTokenLimit(contractBSNTokenPrice.address, constants.TOKEN_LIMIT)
    await contractFundLimitsOracle
      .setTokenLimit(contractBSNTokenDeposit.address, constants.TOKEN_LIMIT)
    await contractFundLimitsOracle
      .setETHLimit(constants.ETHER_LIMIT)

    utils = UtilsBuilder.create()
      .ETHETH()
      .build(
        contractERC1155ERC721,
        contractVoucherKernel,
        contractCashier)

    timestamp = await Utils.getCurrTimestamp()
  }

  describe('Pausing Scenarios', function () {
    describe("CASHIER", () => {
      describe("COMMON PAUSING", () => {
        before(async () => {
          await deployContracts()
        })

        it("Should not be paused on deployment", async () => {
          const isPaused = await contractCashier.paused()

          assert.isFalse(isPaused)
        })

        it("Owner should pause the contract", async () => {
          await contractCashier.pause()

          const isPaused = await contractCashier.paused()

          assert.isTrue(isPaused)
        })

        it("Owner should unpause the contract", async () => {
          await contractCashier.pause()
          await contractCashier.unpause()

          const isPaused = await contractCashier.paused()

          assert.isFalse(isPaused)
        })

        it("[NEGATIVE] Attacker should not be able to pause the contract",
          async () => {
            await truffleAssert.reverts(
              contractCashier.pause({ from: Attacker.address }),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Attacker should not be able to unpause the contract",
          async () => {
            await contractCashier.pause()

            await truffleAssert.reverts(
              contractCashier.unpause({ from: Attacker.address }),
              truffleAssert.ErrorType.REVERT
            )
          })
      })

      describe("ETHETH", () => {
        before(async () => {
          await deployContracts()
          utils = UtilsBuilder.create()
            .ETHETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier)

          const timestamp = await Utils.getCurrTimestamp()

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10)
        })

        it("[NEGATIVE] Should not create voucher supply when " +
          "contract is paused",
          async () => {
            await contractCashier.pause()

            await truffleAssert.reverts(
              utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("Should create voucher supply when contract is unpaused",
          async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1)

            assert.isNotEmpty(TOKEN_SUPPLY_ID)
          })

        it("[NEGATIVE] Should not create voucherID from Buyer when paused",
          async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1)

            await contractCashier.pause()

            await truffleAssert.reverts(
              utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not process withdrawals when paused",
          async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1)

            const voucherID = await utils
              .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
            await utils.refund(voucherID, users.buyer.address)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, users.deployer.address)

            await contractCashier.pause()

            await truffleAssert.reverts(
              utils.withdraw(voucherID, users.deployer.address),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("withdrawWhenPaused - Buyer should be able to withdraw " +
          "funds when paused",
          async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1)

            const voucherID = await utils
              .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
            await utils.refund(voucherID, users.buyer.address)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, users.deployer.address)

            await contractCashier.pause()
            const withdrawTx = await utils
              .withdrawWhenPaused(voucherID, users.buyer.address)

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
                return true
              }, "Amounts not distributed successfully")
          })

        it("[NEGATIVE] withdrawWhenPaused - Buyer should not be " +
          "able to withdraw funds when not paused",
          async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1)

            const voucherID = await utils.commitToBuy(
              users.buyer,
              users.seller,
              TOKEN_SUPPLY_ID)
            await utils.refund(voucherID, users.buyer.address)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, users.deployer.address)

            await truffleAssert.reverts(
              utils.withdrawWhenPaused(voucherID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("withdrawWhenPaused - Seller should be able to withdraw " +
          "funds when paused",
          async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1)

            const voucherID = await utils
              .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
            await utils.refund(voucherID, users.buyer.address)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, users.deployer.address)

            await contractCashier.pause()
            const withdrawTx = await utils
              .withdrawWhenPaused(voucherID, users.seller.address)

            truffleAssert.eventEmitted(
              withdrawTx,
              'LogAmountDistribution',
              (ev) => {
                return true
              }, "Amounts not distributed successfully")
          })

        it("[NEGATIVE] withdrawWhenPaused - Seller should not be " +
          "able to withdraw funds when not paused",
          async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1)

            const voucherID = await utils
              .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
            await utils.refund(voucherID, users.buyer.address)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, users.deployer.address)

            await truffleAssert.reverts(
              utils.withdrawWhenPaused(voucherID, users.seller.address),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] withdrawWhenPaused - Attacker should not be " +
          "able to withdraw funds when paused",
          async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1)

            const voucherID = await utils
              .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
            await utils.refund(voucherID, users.buyer.address)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, users.deployer.address)

            await contractCashier.pause()

            await truffleAssert.reverts(
              utils.withdrawWhenPaused(voucherID, Attacker.address),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] withdrawWhenPaused - Attacker should not be " +
          "able to withdraw funds when not paused",
          async () => {
            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_1)

            const voucherID = await utils
              .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
            await utils.refund(voucherID, users.buyer.address)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, users.deployer.address)

            await truffleAssert.reverts(
              utils.withdrawWhenPaused(voucherID, Attacker.address),
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

            const timestamp = await Utils.getCurrTimestamp()

            tokensToMint =
              new BN(constants.product_price)
                .mul(new BN(constants.QTY_10))

            await utils.mintTokens(
              'contractBSNTokenDeposit',
              users.seller.address,
              tokensToMint)
            await utils.mintTokens(
              'contractBSNTokenDeposit',
              users.buyer.address,
              tokensToMint)

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10)
          })

          it("[NEGATIVE] Should not create voucher supply when " +
            "contract is paused",
            async () => {
              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("Should create voucher supply when contract is unpaused",
            async () => {
              TOKEN_SUPPLY_ID = await utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1)

              assert.isNotEmpty(TOKEN_SUPPLY_ID)
            })

          it("[NEGATIVE] Should not create voucherID from Buyer " +
            "when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process withdrawals when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.withdraw(voucherID, users.deployer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("withdrawWhenPaused - Buyer should be able to " +
            "withdraw funds when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()
              const withdrawTx = await utils
                .withdrawWhenPaused(voucherID, users.buyer.address)

              truffleAssert.eventEmitted(
                withdrawTx,
                'LogAmountDistribution',
                (ev) => {
                  return true
                }, "Amounts not distributed successfully")
            })

          it("[NEGATIVE] withdrawWhenPaused - Buyer should not be " +
            "able to withdraw funds when not paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("withdrawWhenPaused - Seller should be able to " +
            "withdraw funds when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()
              const withdrawTx = await utils
                .withdrawWhenPaused(voucherID, users.seller.address)

              truffleAssert.eventEmitted(
                withdrawTx,
                'LogAmountDistribution',
                (ev) => {
                  return true
                }, "Amounts not distributed successfully")
            })

          it("[NEGATIVE] withdrawWhenPaused - Seller should not be " +
            "able to withdraw funds when not paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, users.seller.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] withdrawWhenPaused - Attacker should not be " +
            "able to withdraw funds when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, Attacker.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] withdrawWhenPaused - Attacker should not " +
            "be able to withdraw funds when not paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, Attacker.address),
                truffleAssert.ErrorType.REVERT
              )
            })
        })

        describe("TKNETH", () => {
          before(async () => {
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

            tokensToMint =
              new BN(constants.product_price)
                .mul(new BN(constants.QTY_10))

            await utils.mintTokens(
              'contractBSNTokenPrice',
              users.buyer.address,
              tokensToMint)

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10
            )
          })

          it("[NEGATIVE] Should not create voucher supply when " +
            "contract is paused", async () => {
            await contractCashier.pause()

            await truffleAssert.reverts(
              utils.createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_1),
              truffleAssert.ErrorType.REVERT
            )
          })

          it("Should create voucher supply when contract is unpaused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              assert.isNotEmpty(TOKEN_SUPPLY_ID)
            })

          it("[NEGATIVE] Should not create voucherID from Buyer " +
            "when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process withdrawals when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.withdraw(voucherID, users.deployer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("withdrawWhenPaused - Buyer should be able to withdraw " +
            "funds when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()
              const withdrawTx = await utils
                .withdrawWhenPaused(voucherID, users.buyer.address)

              truffleAssert.eventEmitted(
                withdrawTx,
                'LogAmountDistribution',
                (ev) => {
                  return true
                }, "Amounts not distributed successfully")
            })

          it("[NEGATIVE] withdrawWhenPaused - Buyer should not be " +
            "able to withdraw funds when not paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("withdrawWhenPaused - Seller should be able to withdraw " +
            "funds when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit, constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()
              const withdrawTx = await utils
                .withdrawWhenPaused(voucherID, users.seller.address)

              truffleAssert.eventEmitted(
                withdrawTx,
                'LogAmountDistribution',
                (ev) => {
                  return true
                }, "Amounts not distributed successfully")
            })

          it("[NEGATIVE] withdrawWhenPaused - Seller should not be " +
            "able to withdraw funds when not paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, users.seller.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] withdrawWhenPaused - Attacker should not be " +
            "able to withdraw funds when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, Attacker.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] withdrawWhenPaused - Attacker should not " +
            "be able to withdraw funds when not paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, Attacker.address),
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

            tokensToMint =
              new BN(constants.seller_deposit)
                .mul(new BN(constants.QTY_10))
            tokensToMint =
              new BN(constants.product_price)
                .mul(new BN(constants.QTY_10))

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
          })

          it("[NEGATIVE] Should not create voucher supply when " +
            "contract is paused",
            async () => {
              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("Should create voucher supply when contract is unpaused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              assert.isNotEmpty(TOKEN_SUPPLY_ID)
            })

          it("[NEGATIVE] Should not create voucherID from Buyer when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process withdrawals when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.withdraw(voucherID, users.deployer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("withdrawWhenPaused - Buyer should be able to withdraw " +
            "funds when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()
              const withdrawTx = await utils
                .withdrawWhenPaused(voucherID, users.buyer.address)

              truffleAssert.eventEmitted(
                withdrawTx,
                'LogAmountDistribution',
                (ev) => {
                  return true
                }, "Amounts not distributed successfully")
            })

          it("[NEGATIVE] withdrawWhenPaused - Buyer should not be " +
            "able to withdraw funds when not paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("withdrawWhenPaused - Seller should be able to withdraw " +
            "funds when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()
              const withdrawTx = await utils
                .withdrawWhenPaused(voucherID, users.seller.address)

              truffleAssert.eventEmitted(
                withdrawTx,
                'LogAmountDistribution',
                (ev) => {
                  return true
                }, "Amounts not distributed successfully")
            })

          it("[NEGATIVE] withdrawWhenPaused - Seller should not be " +
            "able to withdraw funds when not paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, users.seller.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] withdrawWhenPaused - Attacker should not be " +
            "able to withdraw funds when paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, Attacker.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] withdrawWhenPaused - Attacker should not be " +
            "able to withdraw funds when not paused",
            async () => {
              TOKEN_SUPPLY_ID = await utils
                .createOrder(
                  users.seller,
                  timestamp,
                  timestamp + constants.SECONDS_IN_DAY,
                  constants.seller_deposit,
                  constants.QTY_1)

              const voucherID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.refund(voucherID, users.buyer.address)

              await timemachine.advanceTimeSeconds(60)
              await utils.finalize(voucherID, users.deployer.address)

              await truffleAssert.reverts(
                utils.withdrawWhenPaused(voucherID, Attacker.address),
                truffleAssert.ErrorType.REVERT
              )
            })
        })
      })
    })

    describe("VOUCHER KERNEL", () => {
      describe("COMMON PAUSING", () => {
        before(async () => {
          await deployContracts()
        })

        it("Should not be paused on deployment", async () => {
          const isPaused = await contractVoucherKernel.paused()
          assert.isFalse(isPaused)
        })

        it("Should be paused from cashier", async () => {
          await contractCashier.pause()

          const isPaused = await contractVoucherKernel.paused()
          assert.isTrue(isPaused)
        })

        it("Should be unpaused from cashier", async () => {
          await contractCashier.pause()
          await contractCashier.unpause()

          const isPaused = await contractVoucherKernel.paused()
          assert.isFalse(isPaused)
        })

        it("[NEGATIVE] Pause should not be called directly",
          async () => {
            await truffleAssert.reverts(
              contractVoucherKernel.pause(),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Pause should not be called directly",
          async () => {
            await truffleAssert.reverts(
              contractVoucherKernel.unpause(),
              truffleAssert.ErrorType.REVERT
            )
          })
      })

      describe("ETHETH", () => {
        before(async () => {
          await deployContracts()

          utils = UtilsBuilder.create()
            .ETHETH()
            .build(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier)

          const timestamp = await Utils.getCurrTimestamp()

          TOKEN_SUPPLY_ID = await utils
            .createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10)
        })

        it("[NEGATIVE] Should not process refund when paused",
          async () => {
            VOUCHER_ID = await utils
              .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

            await contractCashier.pause()

            await truffleAssert.reverts(
              utils.refund(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not process complain when paused",
          async () => {
            VOUCHER_ID = await utils
              .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

            await utils.refund(VOUCHER_ID, users.buyer.address)

            await contractCashier.pause()

            await truffleAssert.reverts(
              utils.complain(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not process redeem when paused",
          async () => {
            VOUCHER_ID = await utils
              .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

            await contractCashier.pause()

            await truffleAssert.reverts(
              utils.redeem(VOUCHER_ID, users.buyer.address),
              truffleAssert.ErrorType.REVERT
            )
          })

        it("[NEGATIVE] Should not process cancel when paused",
          async () => {
            VOUCHER_ID = await utils
              .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

            await utils.redeem(VOUCHER_ID, users.buyer.address)

            await contractCashier.pause()

            await truffleAssert.reverts(
              utils.cancel(VOUCHER_ID, users.seller.address),
              truffleAssert.ErrorType.REVERT
            )
          })
      })

      describe("[WITH PERMIT]", () => {
        describe("ETHTKN", () => {
          before(async () => {
            await deployContracts()
            await deployContracts()
            utils = UtilsBuilder
              .create()
              .ERC20withPermit()
              .ETHTKN()
              .build(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBSNTokenPrice,
                contractBSNTokenDeposit)

            const timestamp = await Utils.getCurrTimestamp()

            tokensToMint =
              new BN(constants.product_price)
                .mul(new BN(constants.QTY_10))

            await utils.mintTokens(
              'contractBSNTokenDeposit',
              users.seller.address,
              tokensToMint)
            await utils.mintTokens(
              'contractBSNTokenDeposit',
              users.buyer.address,
              tokensToMint)

            TOKEN_SUPPLY_ID = await utils
              .createOrder(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_10)
          })

          it("[NEGATIVE] Should not process refund when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.refund(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process complain when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await utils.refund(VOUCHER_ID, users.buyer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.complain(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process redeem when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.redeem(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process cancel when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.redeem(VOUCHER_ID, users.buyer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.cancel(VOUCHER_ID, users.seller.address),
                truffleAssert.ErrorType.REVERT
              )
            })
        })

        describe("TKNETH", () => {
          before(async () => {
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

            tokensToMint =
              new BN(constants.product_price)
                .mul(new BN(constants.QTY_10))

            await utils.mintTokens(
              'contractBSNTokenPrice',
              users.buyer.address,
              tokensToMint)

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10
            )
          })

          it("[NEGATIVE] Should not process refund when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.refund(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process complain when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await utils.refund(VOUCHER_ID, users.buyer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.complain(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process redeem when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.redeem(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process cancel when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.redeem(VOUCHER_ID, users.buyer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.cancel(VOUCHER_ID, users.seller.address),
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

            const timestamp = await Utils.getCurrTimestamp()

            tokensToMint =
              new BN(constants.product_price)
                .mul(new BN(constants.QTY_10))

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

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10
            )
          })

          it("[NEGATIVE] Should not process refund when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.refund(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process complain when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await utils.refund(VOUCHER_ID, users.buyer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.complain(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process redeem when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.redeem(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process cancel when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.redeem(VOUCHER_ID, users.buyer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.cancel(VOUCHER_ID, users.seller.address),
                truffleAssert.ErrorType.REVERT
              )
            })
        })

        // Ignored due to deployment failure.
        xdescribe("TKNTKNSAME", () => {
          before(async () => {
            await deployContracts()
            utils = UtilsBuilder.create()
              .ERC20withPermit()
              .TKNTKNSAME()
              .build(
                contractERC1155ERC721,
                contractVoucherKernel,
                contractCashier,
                contractBSNTokenPrice,
                contractBSNTokenDeposit)

            const timestamp = await Utils.getCurrTimestamp()

            tokensToMint =
              new BN(constants.product_price)
                .mul(new BN(constants.QTY_10))

            await utils.mintTokens(
              'contractBSNTokenSAME',
              users.seller.address,
              tokensToMint)
            await utils.mintTokens(
              'contractBSNTokenSAME',
              users.buyer.address,
              tokensToMint)

            TOKEN_SUPPLY_ID = await utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.SECONDS_IN_DAY,
              constants.seller_deposit,
              constants.QTY_10
            )
          })

          it("[NEGATIVE] Should not process refund when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.refund(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process complain when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await utils.refund(VOUCHER_ID, users.buyer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.complain(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process redeem when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.redeem(VOUCHER_ID, users.buyer.address),
                truffleAssert.ErrorType.REVERT
              )
            })

          it("[NEGATIVE] Should not process cancel when paused",
            async () => {
              VOUCHER_ID = await utils
                .commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
              await utils.redeem(VOUCHER_ID, users.buyer.address)

              await contractCashier.pause()

              await truffleAssert.reverts(
                utils.cancel(VOUCHER_ID, users.seller.address),
                truffleAssert.ErrorType.REVERT
              )
            })
        })
      })
    })

    afterEach(async () => {
      const isPaused = await contractCashier.paused()
      if (isPaused) {
        await contractCashier.unpause()
      }
    })
  })
})
