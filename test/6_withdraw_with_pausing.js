const chai = require('chai')
let chaiAsPromised = require("chai-as-promised")
chai.use(chaiAsPromised)
const assert = chai.assert

const BN = web3.utils.BN
const UtilsBuilder = require('../testHelpers/utilsBuilder')
const Utils = require('../testHelpers/utils')
let utils

const ERC1155ERC721 = artifacts.require("ERC1155ERC721")
const VoucherKernel = artifacts.require("VoucherKernel")
const Cashier = artifacts.require("Cashier")

const helpers = require("../testHelpers/constants")
const timemachine = require('../testHelpers/timemachine')
const truffleAssert = require('truffle-assertions')
const { seller_deposit } = require('../testHelpers/constants')

let TOKEN_SUPPLY_ID

contract("Cashier withdrawals ", async accounts => {

    let Deployer = accounts[0] //0xD9995BAE12FEe327256FFec1e3184d492bD94C31
    let Seller = accounts[1] //0xd4Fa489Eacc52BA59438993f37Be9fcC20090E39
    let Buyer = accounts[2] //0x760bf27cd45036a6C486802D30B5D90CfFBE31FE
    let Attacker = accounts[3] //0x56A32fFf5E5A8B40d6A21538579fB8922DF5258c

    let contractERC1155ERC721, contractVoucherKernel, contractCashier


    async function deployContracts() {
        contractERC1155ERC721 = await ERC1155ERC721.new()
        contractVoucherKernel = await VoucherKernel.new(contractERC1155ERC721.address)
        contractCashier = await Cashier.new(contractVoucherKernel.address)

        await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
        await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
        await contractVoucherKernel.setCashierAddress(contractCashier.address)

        await contractVoucherKernel.setComplainPeriod(60); //60 seconds
        await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds
    } 


    describe("[WHEN PAUSED] Withdrawals", async () => {
        describe("ETH ETH", () => {
             before(async () => {
                await deployContracts();

                utils = UtilsBuilder
                    .NEW()
                    .ETH_ETH()
                    .build(contractERC1155ERC721, contractVoucherKernel, contractCashier);

                const timestamp = await Utils.getCurrTimestamp()

                TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)

            })

            let distributedAmounts = {
                buyerAmount: new BN(0),
                sellerAmount: new BN(0),
                escrowAmount: new BN(0)
            }

            it("COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {
                const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(new BN(helpers.product_price)).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.3 + 0.04 + 0.025
                const expectedSellerAmount = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                const expectedEscrowAmount = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.refund(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60);

                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();

                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer);

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to')
                    return true
                }, "Amounts not distributed successfully")

                assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
                assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
                assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
            });

            it("COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW", async () => {
                const expectedBuyerAmount = new BN(helpers.product_price) // 0.3
                const expectedSellerAmount = new BN(0) // 0
                const expectedEscrowAmount = new BN(helpers.seller_deposit).add(new BN(helpers.buyer_deposit)) // 0.09
                
                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID);
                await utils.refund(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)
                await timemachine.advanceTimeSeconds(60);

                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();

                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer);

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to')
                    return true
                }, "Amounts not distributed successfully")


                assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
                assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
                assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
            });

            it("COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW", async () => {
                const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(new BN(helpers.product_price)).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.3 + 0.04 + 0.025
                const expectedSellerAmount = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                const expectedEscrowAmount = new BN(0) //0

                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.refund(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)

                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();

                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer);

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to')
                    return true
                }, "Amounts not distributed successfully")

                assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
                assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
                assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
            });

            it("COMMIT->REFUND->FINALIZE->WITHDRAW", async () => {
                const expectedBuyerAmount = new BN(helpers.product_price) // 0.3
                const expectedSellerAmount = new BN(helpers.seller_deposit) // 0.05
                const expectedEscrowAmount = new BN(helpers.buyer_deposit) // 0.04

                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.refund(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();

                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer);

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to')
                    return true
                }, "Amounts not distributed successfully")

                assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
                assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
                assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
            });

            it("COMMIT->CANCEL->FINALIZE->WITHDRAW", async () => {
                const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(new BN(helpers.product_price)).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.3 + 0.04 + 0.025
                const expectedSellerAmount = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                const expectedEscrowAmount = new BN(0) // 0

                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();

                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer);

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to')
                    return true
                }, "Amounts not distributed successfully")

                assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
                assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
                assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
            });

            it("COMMIT->REDEEM->FINALIZE->WITHDRAW", async () => {
                const expectedBuyerAmount = new BN(helpers.buyer_deposit) // 0.04
                const expectedSellerAmount = new BN(helpers.seller_deposit).add(new BN(helpers.product_price)) // 0.35
                const expectedEscrowAmount = new BN(0) // 0

                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.redeem(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();

                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer);

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to')
                    return true
                }, "Amounts not distributed successfully")

                assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
                assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
                assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
            });

            it("COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW", async () => {
                const expectedBuyerAmount = new BN(helpers.buyer_deposit) // 0.04
                const expectedSellerAmount = new BN(helpers.product_price) // 0.3
                const expectedEscrowAmount = new BN(helpers.seller_deposit) // 0.05

                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                await utils.redeem(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();

                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer);

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to')
                    return true
                }, "Amounts not distributed successfully")

                assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
                assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
                assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
            });

            it("COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {
                const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                const expectedSellerAmount = new BN(helpers.product_price).add(new BN(helpers.seller_deposit).div(new BN(4))) // 0.3125 
                const expectedEscrowAmount = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID);
                await utils.redeem(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();

                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer);

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to')
                    return true
                }, "Amounts not distributed successfully")

                assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
                assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
                assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
            });

            it("COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW", async () => {
                const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                const expectedSellerAmount = new BN(helpers.product_price).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.325
                const expectedEscrowAmount = new BN(0) // 0

                const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID);
                await utils.redeem(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                await contractCashier.pause();

                const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer);

                truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                    utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to')
                    return true
                }, "Amounts not distributed successfully")

                assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
                assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
                assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
            });

            afterEach(async () => {
                distributedAmounts = {
                    buyerAmount: new BN(0),
                    sellerAmount: new BN(0),
                    escrowAmount: new BN(0)
                }

                const isPaused = await contractCashier.paused();
                if (isPaused) {
                    await contractCashier.unpause();
                }
            })
        })
       
    })

    describe("[WHEN PAUSED] Seller withdraws deposit locked in escrow", async () => {
        describe("ETH ETH", () => {
            let remQty = 10;
            let voucherToBuyBeforeBurn = 5

            before(async () => {
                await deployContracts();

                utils = UtilsBuilder
                    .NEW()
                    .ETH_ETH()
                    .build(contractERC1155ERC721, contractVoucherKernel, contractCashier);

                const timestamp = await Utils.getCurrTimestamp()

                // Seller has created order for 10 vouchers
                TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
            })

            it("ESCROW has correct initial balance", async () => {
                const expectedBalance = new BN(helpers.seller_deposit).mul(new BN(remQty))
                const escrowAmount = await contractCashier.getEscrowAmount(Seller);

                assert.isTrue(escrowAmount.eq(expectedBalance), "Escrow amount is incorrect")
            })

            it("Get correct remaining qty for supply", async () => {
                
                let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(TOKEN_SUPPLY_ID, Seller)

                assert.equal(remainingQtyInContract, remQty, "Remaining qty is not correct")

                for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
                    await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                    remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(TOKEN_SUPPLY_ID, Seller)
                    assert.equal(remainingQtyInContract, --remQty , "Remaining qty is not correct")
                }
                
            });

            it("[NEGATIVE] Should revert if called when contract is not paused", async () => {
                await truffleAssert.reverts(
                    contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller}),
                    truffleAssert.ErrorType.REVERT
                )
            })

            it("Should pause the contract", async () => {
                //Does nothing in particular .. Pauses contract as below tests are dependant to paused contract
                await contractCashier.pause();
            })

            it("[NEGATIVE] should revert if not called from the seller", async () => {
                await truffleAssert.reverts(
                    contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Attacker}),
                    truffleAssert.ErrorType.REVERT
                )
            })

            it("Seller should be able to withdraw deposits for the remaining QTY in Token Supply", async () => {
                let withdrawTx = await contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller});
                const expectedSellerDeposit = new BN(helpers.seller_deposit).mul(new BN(remQty))
                
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                    assert.equal(ev._payee, Seller, "Incorrect Payee")
                    assert.isTrue(ev._payment.eq(expectedSellerDeposit))
                        
                    return true
                }, "Event LogWithdrawal was not emitted")
            });

            it("Escrow should have correct balance after burning the rest of the supply", async () => {
                const expectedBalance = new BN(helpers.seller_deposit).mul(new BN(voucherToBuyBeforeBurn))
                const escrowAmount = await contractCashier.getEscrowAmount(Seller);

                assert.isTrue(escrowAmount.eq(expectedBalance), "Escrow amount is incorrect")
            });

            it("Remaining QTY for Token Supply should be ZERO", async () => {
                let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(TOKEN_SUPPLY_ID, Seller)

                assert.isTrue(remainingQtyInContract.eq(new BN(0)), "Escrow amount is incorrect")
            })

            it("[NEGATIVE] Buyer should not be able to commit to buy anything from the burnt supply", async () => {
                await truffleAssert.reverts(
                    utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID),
                    truffleAssert.ErrorType.REVERT
                )
            });

            it("[NEGATIVE] Seller should not be able withdraw its deposit for the Token Supply twice", async () => {
                await truffleAssert.reverts(
                    contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller}),
                    truffleAssert.ErrorType.REVERT
                )
            });
        })

    })
})