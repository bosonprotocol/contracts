const chai = require('chai')
let chaiAsPromised = require("chai-as-promised")
chai.use(chaiAsPromised)
const assert = chai.assert

const BN = web3.utils.BN
const Utils = require('../testHelpers/utils')
let utils

const ERC1155ERC721 = artifacts.require("ERC1155ERC721")
const VoucherKernel = artifacts.require("VoucherKernel")
const Cashier = artifacts.require("Cashier")

const helpers = require("../testHelpers/constants")
const timemachine = require('../testHelpers/timemachine')
const truffleAssert = require('truffle-assertions')

let TOKEN_SUPPLY_ID
let VOUCHER_ID

contract("Cashier withdrawals ", async accounts => {

    let Deployer = accounts[0] //0xD9995BAE12FEe327256FFec1e3184d492bD94C31
    let Seller = accounts[1] //0xd4Fa489Eacc52BA59438993f37Be9fcC20090E39
    let Buyer = accounts[2] //0x760bf27cd45036a6C486802D30B5D90CfFBE31FE
    let Attacker = accounts[3] //0x56A32fFf5E5A8B40d6A21538579fB8922DF5258c

    let contractERC1155ERC721, contractVoucherKernel, contractCashier
    let timestamp

    async function deployContracts() {
        contractERC1155ERC721 = await ERC1155ERC721.new()
        contractVoucherKernel = await VoucherKernel.new(contractERC1155ERC721.address)
        contractCashier = await Cashier.new(contractVoucherKernel.address)

        await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
        await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
        await contractVoucherKernel.setCashierAddress(contractCashier.address)

        await contractVoucherKernel.setComplainPeriod(60); //60 seconds
        await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds

        utils = Utils.getInstance(contractERC1155ERC721, contractVoucherKernel, contractCashier)
        timestamp = await Utils.getCurrTimestamp()
    }
   

    describe('Pausing Scenarios', function () {

        describe("CASHIER", () => {

            before(async () => {
               await deployContracts();
            })


            it("Should not be paused on deployment", async () => {
                const isPaused = await contractCashier.paused();
                assert.isFalse(isPaused)
            });

            it("Owner should pause the contract", async () => {
                await contractCashier.pause();

                const isPaused = await contractCashier.paused();
                assert.isTrue(isPaused)
            });

            it("Owner should unpause the contract", async () => {
                await contractCashier.pause();
                await contractCashier.unpause();

                const isPaused = await contractCashier.paused();
                assert.isFalse(isPaused)
            });

            it("[NEGATIVE] Attacker should not be able to pause the contract", async () => {
                await truffleAssert.reverts(
                    contractCashier.pause({ from: Attacker }),
                    truffleAssert.ErrorType.REVERT
                )
            });

            it("[NEGATIVE] Attacker should not be able to unpause the contract", async () => {
                await contractCashier.pause();

                await truffleAssert.reverts(
                    contractCashier.unpause({ from: Attacker }),
                    truffleAssert.ErrorType.REVERT
                )
            });

            it("[NEGATIVE] Should not create voucher supply when contract is paused", async () => {
                await contractCashier.pause();

                await truffleAssert.reverts(
                    utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY),
                    truffleAssert.ErrorType.REVERT
                )
            })

            it("Should create voucher supply when contract is unpaused", async () => {
                TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
                
                assert.isNotEmpty(TOKEN_SUPPLY_ID)
            })
            
            //TODO When all tests are run below 8 will fail, but this will be fixed from PR#16 when gets merged
            xit("[NEGATIVE] Should not create voucherID from Buyer when paused", async () => {
                TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)

                await contractCashier.pause();

                await truffleAssert.reverts(
                    utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID),
                    truffleAssert.ErrorType.REVERT
                )  
            })

            xit("[NEGATIVE] Should not process withdrawals when paused", async () => {
                TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
                
                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.refund(voucherID, Buyer)
                
                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();
                
                await truffleAssert.reverts(
                    utils.withdraw(voucherID, Deployer),
                    truffleAssert.ErrorType.REVERT
                )
            })

            xit("withdrawWhenPaused - Buyer should be able to withdraw funds when paused", async () => {
                TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
                
                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.refund(voucherID, Buyer)
                
                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();
                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer)

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    return true
                }, "Amounts not distributed successfully")
            })

            xit("[NEGATIVE] withdrawWhenPaused - Buyer should not be able to withdraw funds when not paused", async () => {
                TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
                
                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.refund(voucherID, Buyer)
                
                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await truffleAssert.reverts(
                    utils.withdrawWhenPaused(voucherID, Buyer),
                    truffleAssert.ErrorType.REVERT
                )
            })

            xit("withdrawWhenPaused - Seller should be able to withdraw funds when paused", async () => {
                TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
                
                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.refund(voucherID, Buyer)
                
                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();
                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Seller)

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    return true
                }, "Amounts not distributed successfully")
            })

            xit("[NEGATIVE] withdrawWhenPaused - Seller should not be able to withdraw funds when not paused", async () => {
                TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
                
                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.refund(voucherID, Buyer)
                
                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await truffleAssert.reverts(
                    utils.withdrawWhenPaused(voucherID, Seller),
                    truffleAssert.ErrorType.REVERT
                )
            })

            xit("[NEGATIVE] withdrawWhenPaused - Attacker should not be able to withdraw funds when paused", async () => {
                TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
                
                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.refund(voucherID, Buyer)
                
                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();

                await truffleAssert.reverts(
                    utils.withdrawWhenPaused(voucherID, Attacker),
                    truffleAssert.ErrorType.REVERT
                )
            })

            xit("[NEGATIVE] withdrawWhenPaused - Attacker should not be able to withdraw funds when not paused", async () => {
                TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
                
                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.refund(voucherID, Buyer)
                
                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await truffleAssert.reverts(
                    utils.withdrawWhenPaused(voucherID, Attacker),
                    truffleAssert.ErrorType.REVERT
                )
            })
         
        })
    
        describe("VOUCHER KERNEL", () => {

            before(async () => {
                await deployContracts();

                // Create Voucher Supply of 10
                TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
            })

            it("Should not be paused on deployment", async () => {
                const isPaused = await contractVoucherKernel.paused();
                assert.isFalse(isPaused)
            });

            it("Should be paused from cashier", async () => {
                await contractCashier.pause();

                const isPaused = await contractVoucherKernel.paused();
                assert.isTrue(isPaused)
            });

            it("Should be unpaused from cashier", async () => {
                await contractCashier.pause();
                await contractCashier.unpause();

                const isPaused = await contractVoucherKernel.paused();
                assert.isFalse(isPaused)
            });

            it("[NEGATIVE] Pause should not be called directly", async () => {
                await truffleAssert.reverts(
                    contractVoucherKernel.pause(),
                    truffleAssert.ErrorType.REVERT
                )
            });

            it("[NEGATIVE] Pause should not be called directly", async () => {
                await truffleAssert.reverts(
                    contractVoucherKernel.unpause(),
                    truffleAssert.ErrorType.REVERT
                )
            });

            it("[NEGATIVE] Should not process refund when paused", async () => {
                VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                await contractCashier.pause();

                await truffleAssert.reverts(
                    utils.refund(VOUCHER_ID, Buyer),
                    truffleAssert.ErrorType.REVERT
                )
            })

            it("[NEGATIVE] Should not process complain when paused", async () => {
                VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                await utils.refund(VOUCHER_ID, Buyer)
                
                await contractCashier.pause();

                await truffleAssert.reverts(
                    utils.complain(VOUCHER_ID, Buyer),
                    truffleAssert.ErrorType.REVERT
                )
            })

            it("[NEGATIVE] Should not process redeem when paused", async () => {
                VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                await contractCashier.pause();

                await truffleAssert.reverts(
                    utils.redeem(VOUCHER_ID, Buyer),
                    truffleAssert.ErrorType.REVERT
                )
            })

            it("[NEGATIVE] Should not process cancel when paused", async () => {
                VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID);
                await utils.redeem(VOUCHER_ID, Buyer)

                await contractCashier.pause();

                await truffleAssert.reverts(
                    utils.cancel(VOUCHER_ID, Seller),
                    truffleAssert.ErrorType.REVERT
                )
            })
        })

        afterEach(async () => {
            const isPaused = await contractCashier.paused();
            if (isPaused) {
                await contractCashier.unpause();
            }
        })
    })
})

