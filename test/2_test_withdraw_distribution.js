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

contract("Boson -> ", async accounts => {

    let Deployer = accounts[0] //0xD9995BAE12FEe327256FFec1e3184d492bD94C31
    let Seller = accounts[1] //0xd4Fa489Eacc52BA59438993f37Be9fcC20090E39
    let Buyer = accounts[2] //0x760bf27cd45036a6C486802D30B5D90CfFBE31FE
    let Attacker = accounts[3] //0x56A32fFf5E5A8B40d6A21538579fB8922DF5258c

    let contractERC1155ERC721, contractVoucherKernel, contractCashier

    before(async () => {
        contractERC1155ERC721 = await ERC1155ERC721.new()
        contractVoucherKernel = await VoucherKernel.new(contractERC1155ERC721.address)
        contractCashier = await Cashier.new(contractVoucherKernel.address)
        
        await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
        await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
        await contractVoucherKernel.setCashierAddress(contractCashier.address)
        
        await contractVoucherKernel.setComplainPeriod(60); //60 seconds
        await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds

        utils = Utils.getInstance(contractERC1155ERC721, contractVoucherKernel, contractCashier)

        const timestamp = await Utils.getCurrTimestamp()

        TOKEN_SUPPLY_ID = await utils.requestCreateOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
    })

    describe('Withdraw scenarios', function () {

        let distributedAmaounts = {
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
            await utils.finalize(voucherID, Deployer)
            const withdrawTx = await utils.withdraw(voucherID, Deployer);

            truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                utils.calcTotalAmountToRecipients(ev, distributedAmaounts)
                return true
            }, "Amounts not distributed successfully")


            assert.isTrue(distributedAmaounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
            assert.isTrue(distributedAmaounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
            assert.isTrue(distributedAmaounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
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

            const withdrawTx = await utils.withdraw(voucherID, Deployer)

            truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                utils.calcTotalAmountToRecipients(ev, distributedAmaounts)
                return true
            }, "Amounts not distributed successfully")


            assert.isTrue(distributedAmaounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
            assert.isTrue(distributedAmaounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
            assert.isTrue(distributedAmaounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
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

            const withdrawTx = await utils.withdraw(voucherID, Deployer);

            truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                utils.calcTotalAmountToRecipients(ev, distributedAmaounts)
                return true
            }, "Amounts not distributed successfully")

            assert.isTrue(distributedAmaounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
            assert.isTrue(distributedAmaounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
            assert.isTrue(distributedAmaounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
        });

        it("COMMIT->REFUND->FINALIZE->WITHDRAW", async () => {
            const expectedBuyerAmount = new BN(helpers.product_price) // 0.3
            const expectedSellerAmount = new BN(helpers.seller_deposit) // 0.05
            const expectedEscrowAmount = new BN(helpers.buyer_deposit) // 0.04

            const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
            await utils.refund(voucherID, Buyer)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, Deployer)

            const withdrawTx = await utils.withdraw(voucherID, Deployer);

            truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                utils.calcTotalAmountToRecipients(ev, distributedAmaounts)
                return true
            }, "Amounts not distributed successfully")

            assert.isTrue(distributedAmaounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
            assert.isTrue(distributedAmaounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
            assert.isTrue(distributedAmaounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
        });

        it("COMMIT->CANCEL->FINALIZE->WITHDRAW", async () => {
            const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(new BN(helpers.product_price)).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.3 + 0.04 + 0.025
            const expectedSellerAmount = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
            const expectedEscrowAmount = new BN(0) // 0

            const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
            await utils.cancel(voucherID, Seller)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, Deployer)

            const withdrawTx = await utils.withdraw(voucherID, Deployer);

            truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                utils.calcTotalAmountToRecipients(ev, distributedAmaounts)
                return true
            }, "Amounts not distributed successfully")

            assert.isTrue(distributedAmaounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
            assert.isTrue(distributedAmaounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
            assert.isTrue(distributedAmaounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
        });

        it("COMMIT->REDEEM->FINALIZE->WITHDRAW", async () => {
            const expectedBuyerAmount = new BN(helpers.buyer_deposit) // 0.04
            const expectedSellerAmount = new BN(helpers.seller_deposit).add(new BN(helpers.product_price)) // 0.35
            const expectedEscrowAmount = new BN(0) // 0

            const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
            await utils.redeem(voucherID, Buyer)

            await timemachine.advanceTimeSeconds(60)
            await utils.finalize(voucherID, Deployer)

            const withdrawTx = await utils.withdraw(voucherID, Deployer)

            truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                utils.calcTotalAmountToRecipients(ev, distributedAmaounts)
                return true
            }, "Amounts not distributed successfully")

            assert.isTrue(distributedAmaounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
            assert.isTrue(distributedAmaounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
            assert.isTrue(distributedAmaounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
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

            const withdrawTx = await utils.withdraw(voucherID, Deployer);

            truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                utils.calcTotalAmountToRecipients(ev, distributedAmaounts)
                return true
            }, "Amounts not distributed successfully")

            assert.isTrue(distributedAmaounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
            assert.isTrue(distributedAmaounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
            assert.isTrue(distributedAmaounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
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

            const withdrawTx = await utils.withdraw(voucherID, Deployer);

            truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                utils.calcTotalAmountToRecipients(ev, distributedAmaounts)
                return true
            }, "Amounts not distributed successfully")

            assert.isTrue(distributedAmaounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
            assert.isTrue(distributedAmaounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
            assert.isTrue(distributedAmaounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
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

            const withdrawTx = await utils.withdraw(voucherID, Deployer);

            truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                utils.calcTotalAmountToRecipients(ev, distributedAmaounts)
                return true
            }, "Amounts not distributed successfully")

            assert.isTrue(distributedAmaounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
            assert.isTrue(distributedAmaounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
            assert.isTrue(distributedAmaounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
        });

        afterEach(() => {
            distributedAmaounts = {
                buyerAmount: new BN(0),
                sellerAmount: new BN(0),
                escrowAmount: new BN(0)
            }
        })
    })
})

