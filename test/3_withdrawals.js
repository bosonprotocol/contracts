const chai = require('chai')
const assert = chai.assert

const BN = web3.utils.BN
const UtilsBuilder = require('../testHelpers/utilsBuilder')
const Utils = require('../testHelpers/utils')
let utils

const ERC1155ERC721 = artifacts.require("ERC1155ERC721")
const VoucherKernel = artifacts.require("VoucherKernel")
const Cashier = artifacts.require("Cashier")
const BosonRouter = artifacts.require("BosonRouter")
const BosonTKN = artifacts.require("BosonTokenPrice")
const FundLimitsOracle 	= artifacts.require('FundLimitsOracle');

const helpers = require("../testHelpers/constants")
const timemachine = require('../testHelpers/timemachine')
const truffleAssert = require('truffle-assertions')
const config = require('../testHelpers/config.json')

let TOKEN_SUPPLY_ID

contract("Cashier withdrawals ", async accounts => {

    let Deployer = config.accounts.deployer
    let Seller = config.accounts.seller
    let Buyer = config.accounts.buyer
    let Attacker = config.accounts.attacker
    let RandomUser = config.accounts.randomUser // will be used to clear tokens received after every successful test

    let contractERC1155ERC721,
        contractVoucherKernel,
        contractCashier,
        contractBosonRouter,
        contractBSNTokenPrice,
        contractBSNTokenDeposit,
        contractFundLimitsOracle
    const PAUSED_WITHPERMIT = 1;
    const PAUSED_LABEL = "[PAUSED]";

    let distributedAmounts = {
        buyerAmount: new BN(0),
        sellerAmount: new BN(0),
        escrowAmount: new BN(0)
    }

    async function deployContracts() {
        contractFundLimitsOracle = await FundLimitsOracle.new()
        contractERC1155ERC721 = await ERC1155ERC721.new()
        contractVoucherKernel = await VoucherKernel.new(contractERC1155ERC721.address)
        contractCashier = await Cashier.new(contractVoucherKernel.address);
        contractBosonRouter = await BosonRouter.new(contractVoucherKernel.address, contractERC1155ERC721.address, contractFundLimitsOracle.address, contractCashier.address);
        contractBSNTokenPrice = await BosonTKN.new('BosonTokenPrice', 'BPRC');
        contractBSNTokenDeposit = await BosonTKN.new('BosonTokenDeposit', 'BDEP');

        await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
        await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
		await contractERC1155ERC721.setBosonRouterAddress(contractBosonRouter.address);

		await contractVoucherKernel.setBosonRouterAddress(contractBosonRouter.address);
        await contractVoucherKernel.setCashierAddress(contractCashier.address)

		await contractCashier.setBosonRouterAddress(contractBosonRouter.address);

        await contractFundLimitsOracle.setTokenLimit(contractBSNTokenPrice.address, helpers.TOKEN_LIMIT)
        await contractFundLimitsOracle.setTokenLimit(contractBSNTokenDeposit.address, helpers.TOKEN_LIMIT)
		await contractFundLimitsOracle.setETHLimit(helpers.ETHER_LIMIT)

        await contractVoucherKernel.setComplainPeriod(60); //60 seconds
        await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds
    } 

    // this function is used after each interaction with tokens to clear balances
    async function giveAwayToRandom() {
        const balanceBuyerFromPayment = await contractBSNTokenPrice.balanceOf(Buyer.address)
        const balanceBuyerFromDesosits = await contractBSNTokenDeposit.balanceOf(Buyer.address)

        const balanceSellerFromPayment = await contractBSNTokenPrice.balanceOf(Seller.address)
        const balanceSellerFromDesosits = await contractBSNTokenDeposit.balanceOf(Seller.address)

        const escrowBalanceFromPayment = await contractBSNTokenPrice.balanceOf(Deployer.address)
        const escrowBalanceFromDeposits = await contractBSNTokenDeposit.balanceOf(Deployer.address)

        await contractBSNTokenPrice.transfer(RandomUser.address, balanceBuyerFromPayment, { from: Buyer.address })
        await contractBSNTokenDeposit.transfer(RandomUser.address, balanceBuyerFromDesosits, { from: Buyer.address })
        await contractBSNTokenPrice.transfer(RandomUser.address, balanceSellerFromPayment, { from: Seller.address })
        await contractBSNTokenDeposit.transfer(RandomUser.address, balanceSellerFromDesosits, { from: Seller.address })
        await contractBSNTokenPrice.transfer(RandomUser.address, escrowBalanceFromPayment, { from: Deployer.address })
        await contractBSNTokenDeposit.transfer(RandomUser.address, escrowBalanceFromDeposits, { from: Deployer.address })

    }

    async function withdraw(utils, index, voucherID) {
        if (index == 1) {
            await utils.pause(Deployer.address)
            return await utils.withdrawWhenPaused(voucherID, Seller.address);
        } else {
            return await utils.withdraw(voucherID, Deployer.address);
        }
    }

    for (let i = 0; i <= PAUSED_WITHPERMIT; i++) {
        describe('Withdraw scenarios', async () => {
        
            before(async () => {
                await deployContracts();
            })

            afterEach(async () => {
                distributedAmounts = {
                    buyerAmount: new BN(0),
                    sellerAmount: new BN(0),
                    escrowAmount: new BN(0)
                }

                const isPaused = await contractBosonRouter.paused();
                if (isPaused) {
                    await contractBosonRouter.unpause();
                }
            })

            describe(`ETH - ETH${i == PAUSED_WITHPERMIT ? PAUSED_LABEL : ''}`, async () => {
                
                before(async () => {

                    utils = UtilsBuilder
                        .NEW()
                        .ETH_ETH()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBosonRouter)

                    const timestamp = await Utils.getCurrTimestamp()

                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_10)
                
                })

                it("COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {

                    const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(new BN(helpers.product_price)).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.3 + 0.04 + 0.025
                    const expectedSellerAmount = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmount = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                    const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                    await utils.refund(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)
                    await utils.finalize(voucherID, Deployer.address)
                    const withdrawTx = await withdraw(utils, i, voucherID)

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', Buyer.address, Seller.address)
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
                    await utils.refund(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await timemachine.advanceTimeSeconds(60);

                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', Buyer.address, Seller.address)
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
                    await utils.refund(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)

                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', Buyer.address, Seller.address)
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
                    await utils.refund(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', Buyer.address, Seller.address)
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
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', Buyer.address, Seller.address)
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
                    await utils.redeem(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', Buyer.address, Seller.address)
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
                    await utils.redeem(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', Buyer.address, Seller.address)
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
                    await utils.redeem(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', Buyer.address, Seller.address)
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
                        await utils.redeem(voucherID, Buyer.address)
                        await utils.cancel(voucherID, Seller.address)

                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        const withdrawTx = await withdraw(utils, i, voucherID)

                        truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                            utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', Buyer.address, Seller.address)
                            return true
                        }, "Amounts not distributed successfully")

                        assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
                        assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
                        assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
                    });

                
            })

            describe(`TKN - TKN [WITH PERMIT]${i == PAUSED_WITHPERMIT ? PAUSED_LABEL : ''}`, async () => {
                let balanceBuyerFromPayment = new BN(0)
                let balanceBuyerFromDesosits = new BN(0)

                let balanceSellerFromPayment = new BN(0)
                let balanceSellerFromDesosits = new BN(0)

                let escrowBalanceFromPayment = new BN(0)
                let escrowBalanceFromDeposits = new BN(0)

                let cashierPaymentLeft = new BN(0)
                let cashierDepositLeft = new BN(0)


                async function getBalancesFromPiceTokenAndDepositToken() {
                    balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(Buyer.address)
                    balanceBuyerFromDesosits = await utils.contractBSNTokenDeposit.balanceOf(Buyer.address)

                    balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(Seller.address)
                    balanceSellerFromDesosits = await utils.contractBSNTokenDeposit.balanceOf(Seller.address)

                    escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(Deployer.address)
                    escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Deployer.address)

                    cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(utils.contractCashier.address)
                    cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(utils.contractCashier.address)
                }

                beforeEach(async () => {

                    utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .TKN_TKN()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBosonRouter, contractBSNTokenPrice, contractBSNTokenDeposit)
                    
                    const timestamp = await Utils.getCurrTimestamp()

                    const supplyQty = 1
                    const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(supplyQty))

                    await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMint);
                    await utils.mintTokens('contractBSNTokenPrice', Buyer.address, helpers.product_price);
                    await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, helpers.buyer_deposit);

                    TOKEN_SUPPLY_ID = await utils.createOrder(
                        Seller,
                        timestamp, 
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        supplyQty
                    )
                })

                it("COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {

                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountPrice = new BN(0)

                    await getBalancesFromPiceTokenAndDepositToken();

                    //Payments 
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");
                    
                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Buyer did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                });

                it("COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60);
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(0)
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).add(new BN(helpers.buyer_deposit)) // 0.09
                    const expectedEscrowAmountPrice = new BN(0)

                    await getBalancesFromPiceTokenAndDepositToken();

                    //Payments 
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                });

                it("COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)

                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountDeposit = new BN(0)
                    const expectedEscrowAmountPrice = new BN(0)

                    await getBalancesFromPiceTokenAndDepositToken();

                    //Payments 
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REFUND->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.refund(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(0)
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                    const expectedEscrowAmountDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedEscrowAmountPrice = new BN(0)

                    await getBalancesFromPiceTokenAndDepositToken();

                    //Payments 
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");
                

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountPrice = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesFromPiceTokenAndDepositToken();

                    //Payments 
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.redeem(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0) 
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerPrice = new BN(helpers.product_price) //// 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                    const expectedEscrowAmountDeposit = new BN(0) 
                    const expectedEscrowAmountPrice = new BN(0)

                    await getBalancesFromPiceTokenAndDepositToken();

                    //Payments 
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.redeem(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerDeposit = new BN(0) 
                    const expectedEscrowAmountPrice = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit) // 0.05

                    await getBalancesFromPiceTokenAndDepositToken();

                    //Payments 
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.redeem(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountPrice = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                    await getBalancesFromPiceTokenAndDepositToken();

                    //Payments 
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Buyer did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.redeem(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountPrice = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesFromPiceTokenAndDepositToken();

                    //Payments 
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                    
                });

                afterEach(async () => {
                        distributedAmounts = {
                            buyerAmount: new BN(0),
                            sellerAmount: new BN(0),
                            escrowAmount: new BN(0)
                        }

                        balanceBuyerFromPayment = new BN(0)
                        balanceBuyerFromDesosits = new BN(0)

                        balanceSellerFromPayment = new BN(0)
                        balanceSellerFromDesosits = new BN(0)

                        escrowBalanceFromPayment = new BN(0)
                        escrowBalanceFromDeposits = new BN(0)

                        cashierPaymentLeft = new BN(0)
                        cashierDepositLeft = new BN(0)

                        await giveAwayToRandom();
                    })

            })

            describe(`TKN - TKN SAME [WITH PERMIT]${i == PAUSED_WITHPERMIT ? PAUSED_LABEL : ''}`, async () => {

                let balanceBuyer = new BN(0)
                let balanceSeller = new BN(0)
                let escrowBalance = new BN(0)
                let cashierBalance = new BN(0)


                async function getBalancesFromSameTokenContract() {
                    balanceBuyer = await utils.contractBSNTokenSAME.balanceOf(Buyer.address)
                    balanceSeller = await utils.contractBSNTokenSAME.balanceOf(Seller.address)
                    escrowBalance = await utils.contractBSNTokenSAME.balanceOf(Deployer.address)
                    cashierBalance = await utils.contractBSNTokenSAME.balanceOf(utils.contractCashier.address)
                }

                beforeEach(async () => {

                    utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .TKN_TKN_SAME()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBosonRouter, contractBSNTokenPrice, contractBSNTokenDeposit)
                    
                    const timestamp = await Utils.getCurrTimestamp()

                    const supplyQty = 1
                    const tokensToMintSeller = new BN(helpers.seller_deposit).mul(new BN(supplyQty))
                    const tokensToMintBuyer = new BN(helpers.product_price).add(new BN(helpers.buyer_deposit))

                    await utils.mintTokens('contractBSNTokenSAME', Seller.address, tokensToMintSeller)
                    await utils.mintTokens('contractBSNTokenSAME', Buyer.address, tokensToMintBuyer)

                    TOKEN_SUPPLY_ID = await utils.createOrder(
                        Seller,
                        timestamp, 
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        supplyQty
                    )
                })

                afterEach(async () => {
                    distributedAmounts = {
                        buyerAmount: new BN(0),
                        sellerAmount: new BN(0),
                        escrowAmount: new BN(0)
                    }

                    balanceBuyer = new BN(0)
                    balanceSeller = new BN(0)
                    escrowBalance = new BN(0)
                    cashierBalance = new BN(0)

                    await giveAwayToRandom();
                })

                it("COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {

                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.refund(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountPrice = new BN(0)

                    await getBalancesFromSameTokenContract();

                    assert.isTrue(balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)), "Buyer did not get expected tokens from SameTokenContract");
                    assert.isTrue(balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)), "Seller did not get expected tokens from SameTokenContract");
                    assert.isTrue(escrowBalance.eq(expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)), "Escrow did not get expected tokens from SameTokenContract");
                    
                    //Cashier Should be Empty
                    assert.isTrue(cashierBalance.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                });

                it("COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60);
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(0)
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).add(new BN(helpers.buyer_deposit)) // 0.09
                    const expectedEscrowAmountPrice = new BN(0)

                    await getBalancesFromSameTokenContract();

                    assert.isTrue(balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)), "Buyer did not get expected tokens from SameTokenContract");
                    assert.isTrue(balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)), "Seller did not get expected tokens from SameTokenContract");
                    assert.isTrue(escrowBalance.eq(expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)), "Escrow did not get expected tokens from SameTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierBalance.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                });

                it("COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)

                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountDeposit = new BN(0)
                    const expectedEscrowAmountPrice = new BN(0)

                    await getBalancesFromSameTokenContract();

                    assert.isTrue(balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)), "Buyer did not get expected tokens from SameTokenContract");
                    assert.isTrue(balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)), "Seller did not get expected tokens from SameTokenContract");
                    assert.isTrue(escrowBalance.eq(expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)), "Escrow did not get expected tokens from SameTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierBalance.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REFUND->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.refund(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(0)
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                    const expectedEscrowAmountDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedEscrowAmountPrice = new BN(0)

                    await getBalancesFromSameTokenContract();

                    assert.isTrue(balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)), "Buyer did not get expected tokens from SameTokenContract");
                    assert.isTrue(balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)), "Seller did not get expected tokens from SameTokenContract");
                    assert.isTrue(escrowBalance.eq(expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)), "Escrow did not get expected tokens from SameTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierBalance.eq(new BN(0)), "Cashier Contract is not empty");
                

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountPrice = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesFromSameTokenContract();

                    assert.isTrue(balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)), "Buyer did not get expected tokens from SameTokenContract");
                    assert.isTrue(balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)), "Seller did not get expected tokens from SameTokenContract");
                    assert.isTrue(escrowBalance.eq(expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)), "Escrow did not get expected tokens from SameTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierBalance.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.redeem(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0) 
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerPrice = new BN(helpers.product_price) //// 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                    const expectedEscrowAmountDeposit = new BN(0) 
                    const expectedEscrowAmountPrice = new BN(0)
                    await getBalancesFromSameTokenContract();

                    assert.isTrue(balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)), "Buyer did not get expected tokens from SameTokenContract");
                    assert.isTrue(balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)), "Seller did not get expected tokens from SameTokenContract");
                    assert.isTrue(escrowBalance.eq(expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)), "Escrow did not get expected tokens from SameTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierBalance.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.redeem(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerDeposit = new BN(0) 
                    const expectedEscrowAmountPrice = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit) // 0.05

                    await getBalancesFromSameTokenContract();

                    assert.isTrue(balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)), "Buyer did not get expected tokens from SameTokenContract");
                    assert.isTrue(balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)), "Seller did not get expected tokens from SameTokenContract");
                    assert.isTrue(escrowBalance.eq(expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)), "Escrow did not get expected tokens from SameTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierBalance.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.redeem(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountPrice = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                    await getBalancesFromSameTokenContract();

                    assert.isTrue(balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)), "Buyer did not get expected tokens from SameTokenContract");
                    assert.isTrue(balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)), "Seller did not get expected tokens from SameTokenContract");
                    assert.isTrue(escrowBalance.eq(expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)), "Escrow did not get expected tokens from SameTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierBalance.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.redeem(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountPrice = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesFromSameTokenContract();

                    assert.isTrue(balanceBuyer.eq(expectedBuyerPrice.add(expectedBuyerDeposit)), "Buyer did not get expected tokens from SameTokenContract");
                    assert.isTrue(balanceSeller.eq(expectedSellerPrice.add(expectedSellerDeposit)), "Seller did not get expected tokens from SameTokenContract");
                    assert.isTrue(escrowBalance.eq(expectedEscrowAmountPrice.add(expectedEscrowAmountDeposit)), "Escrow did not get expected tokens from SameTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierBalance.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                    
                });

            })
                
            describe(`ETH - TKN [WITH PERMIT]${ i == PAUSED_WITHPERMIT ? PAUSED_LABEL : '' }`, async () => {
                let balanceBuyerFromPayment = new BN(0)
                let balanceBuyerFromDesosits = new BN(0)

                let balanceSellerFromPayment = new BN(0)
                let balanceSellerFromDesosits = new BN(0)

                let escrowBalanceFromPayment = new BN(0)
                let escrowBalanceFromDeposits = new BN(0)

                let cashierPaymentLeft = new BN(0)
                let cashierDepositLeft = new BN(0)

                async function getBalancesDepositToken() {
                    balanceBuyerFromDesosits = await utils.contractBSNTokenDeposit.balanceOf(Buyer.address)
                    balanceSellerFromDesosits = await utils.contractBSNTokenDeposit.balanceOf(Seller.address)
                    escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Deployer.address)
                    cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(utils.contractCashier.address)
                }

                beforeEach(async () => {
                    utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .ETH_TKN()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBosonRouter, contractBSNTokenPrice, contractBSNTokenDeposit)

                    const timestamp = await Utils.getCurrTimestamp()

                    const supplyQty = 1
                    const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(supplyQty))

                    await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMint);
                    await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, helpers.buyer_deposit);

                    TOKEN_SUPPLY_ID = await utils.createOrder(
                        Seller,
                        timestamp,
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
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
                    balanceBuyerFromDesosits = new BN(0)

                    balanceSellerFromPayment = new BN(0)
                    balanceSellerFromDesosits = new BN(0)

                    escrowBalanceFromPayment = new BN(0)
                    escrowBalanceFromDeposits = new BN(0)

                    cashierPaymentLeft = new BN(0)
                    cashierDepositLeft = new BN(0)

                    await giveAwayToRandom();
                })

                it("COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {

                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)
                    await utils.finalize(voucherID, Deployer.address)
                    
                    const withdrawTx = await withdraw(utils, i, voucherID)


                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                    await getBalancesDepositToken();

                    // Payment should have been returned to buyer
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, Buyer.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedBuyerPrice))
                        
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                });

                it("COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60);
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(0)
                    const expectedSellerDeposit = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).add(new BN(helpers.buyer_deposit)) // 0.09

                    await getBalancesDepositToken();

                    // Payment should have been returned to buyer
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, Buyer.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedBuyerPrice))

                        return true
                    }, "Event LogWithdrawal was not emitted")

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                });

                it("COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)

                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesDepositToken();

                    // Payment should have been returned to buyer
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, Buyer.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedBuyerPrice))

                        return true
                    }, "Event LogWithdrawal was not emitted")

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                });

                it("COMMIT->REFUND->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.refund(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                    const expectedEscrowAmountDeposit = new BN(helpers.buyer_deposit) // 0.04

                    await getBalancesDepositToken();

                    // Payment should have been returned to buyer
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, Buyer.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedBuyerPrice))

                        return true
                    }, "Event LogWithdrawal was not emitted")

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesDepositToken();

                    // Payment should have been returned to buyer
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, Buyer.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedBuyerPrice))

                        return true
                    }, "Event LogWithdrawal was not emitted")

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.redeem(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerPrice = new BN(helpers.product_price) //// 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesDepositToken();

                    // Payment should have been sent to seller
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, Seller.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedSellerPrice))

                        return true
                    }, "Event LogWithdrawal was not emitted")

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                    Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.redeem(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerDeposit = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit) // 0.05
                    
                    await getBalancesDepositToken();

                    // Payment should have been sent to seller
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, Seller.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedSellerPrice))

                        return true
                    }, "Event LogWithdrawal was not emitted")

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.redeem(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                    await getBalancesDepositToken();

                    // Payment should have been sent to seller
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, Seller.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedSellerPrice))

                        return true
                    }, "Event LogWithdrawal was not emitted")

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.redeem(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesDepositToken();

                    // Payment should have been sent to seller
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, Seller.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedSellerPrice))

                        return true
                    }, "Event LogWithdrawal was not emitted")

                    //Deposits
                    assert.isTrue(balanceBuyerFromDesosits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDesosits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

            })

            describe(`TKN - ETH [WITH PERMIT]${i == PAUSED_WITHPERMIT ? PAUSED_LABEL : ''}`, async () => {
                let balanceBuyerFromPayment = new BN(0)
                let balanceSellerFromPayment = new BN(0)
                let escrowBalanceFromPayment = new BN(0)

                let cashierPaymentLeft = new BN(0)
                let cashierDepositLeft = new BN(0)

                async function getBalancesPriceToken() {
                    balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(Buyer.address)
                    balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(Seller.address)
                    escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(Deployer.address)
                    cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(utils.contractCashier.address)
                }

                beforeEach(async () => {

                    utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .TKN_ETH()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBosonRouter, contractBSNTokenPrice, '')

                    const timestamp = await Utils.getCurrTimestamp()

                    await utils.mintTokens('contractBSNTokenPrice', Buyer.address, helpers.product_price);

                    TOKEN_SUPPLY_ID = await utils.createOrder(
                        Seller,
                        timestamp,
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        helpers.QTY_1
                    )
                })

                it("COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerPrice = new BN(0)
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                    await getBalancesPriceToken();

                    // Payments in TKN
                    // Payment should have been returned to buyer
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");
                    
                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', Buyer.address, Seller.address)
                        return true
                    }, "Amounts not distributed successfully")
                
                    assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerDeposit), 'Buyer Amount is not as expected')
                    assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerDeposit), 'Seller Amount is not as expected')
                    assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit), 'Escrow Amount is not as expected')

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                });

                it("COMMIT->REFUND->COMPLAIN->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60);
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerPrice = new BN(0)
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(0)
                    const expectedSellerDeposit = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).add(new BN(helpers.buyer_deposit)) // 0.09

                    await getBalancesPriceToken();

                    // Payments in TKN
                    // Payment should have been returned to buyer
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");

                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', Buyer.address, Seller.address)
                        return true
                    }, "Amounts not distributed successfully")

                    assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerDeposit), 'Buyer Amount is not as expected')
                    assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerDeposit), 'Seller Amount is not as expected')
                    assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit), 'Escrow Amount is not as expected')

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                });

                it("COMMIT->REFUND->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.refund(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)

                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerPrice = new BN(0)
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesPriceToken();

                    // Payments in TKN
                    // Payment should have been returned to buyer
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");

                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', Buyer.address, Seller.address)
                        return true
                    }, "Amounts not distributed successfully")

                    assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerDeposit), 'Buyer Amount is not as expected')
                    assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerDeposit), 'Seller Amount is not as expected')
                    assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit), 'Escrow Amount is not as expected')
                    
                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")

                });

                it("COMMIT->REFUND->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.refund(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerPrice = new BN(0)
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                    const expectedEscrowAmountDeposit = new BN(helpers.buyer_deposit) // 0.04

                    await getBalancesPriceToken();

                    // Payments in TKN
                    // Payment should have been returned to buyer
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");

                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', Buyer.address, Seller.address)
                        return true
                    }, "Amounts not distributed successfully")

                    assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerDeposit), 'Buyer Amount is not as expected')
                    assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerDeposit), 'Seller Amount is not as expected')
                    assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit), 'Escrow Amount is not as expected')

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");


                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerPrice = new BN(0)
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesPriceToken();

                    // Payments in TKN
                    // Payment should have been returned to buyer
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");

                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', Buyer.address, Seller.address)
                        return true
                    }, "Amounts not distributed successfully")

                    assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerDeposit), 'Buyer Amount is not as expected')
                    assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerDeposit), 'Seller Amount is not as expected')
                    assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit), 'Escrow Amount is not as expected')

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.redeem(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0)
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesPriceToken();

                    // Payments in TKN
                    // Payment should have been sent to seller
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");

                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', Buyer.address, Seller.address)
                        return true
                    }, "Amounts not distributed successfully")

                    assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerDeposit), 'Buyer Amount is not as expected')
                    assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerDeposit), 'Seller Amount is not as expected')
                    assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit), 'Escrow Amount is not as expected')

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->COMPLAIN->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.redeem(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0)
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerDeposit = new BN(0)
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit) // 0.05

                    await getBalancesPriceToken();

                    // Payments in TKN
                    // Payment should have been sent to seller
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");

                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', Buyer.address, Seller.address)
                        return true
                    }, "Amounts not distributed successfully")

                    assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerDeposit), 'Buyer Amount is not as expected')
                    assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerDeposit), 'Seller Amount is not as expected')
                    assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit), 'Escrow Amount is not as expected')

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )
                    await utils.redeem(voucherID, Buyer.address)
                    await utils.complain(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0)
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                    await getBalancesPriceToken();

                    // Payments in TKN
                    // Payment should have been sent to seller
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");

                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', Buyer.address, Seller.address)
                        return true
                    }, "Amounts not distributed successfully")

                    assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerDeposit), 'Buyer Amount is not as expected')
                    assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerDeposit), 'Seller Amount is not as expected')
                    assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit), 'Escrow Amount is not as expected')

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                it("COMMIT->REDEEM->CANCEL->FINALIZE->WITHDRAW", async () => {
                    const voucherID = await utils.commitToBuy(
                        Buyer,
                        Seller,
                        TOKEN_SUPPLY_ID
                    )

                    await utils.redeem(voucherID, Buyer.address)
                    await utils.cancel(voucherID, Seller.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    const withdrawTx = await withdraw(utils, i, voucherID)

                    const expectedBuyerPrice = new BN(0)
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                    const expectedEscrowAmountDeposit = new BN(0)

                    await getBalancesPriceToken();
                    // Payments in TKN
                    // Payment should have been sent to seller
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");

                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', Buyer.address, Seller.address)
                        return true
                    }, "Amounts not distributed successfully")

                    assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerDeposit), 'Buyer Amount is not as expected')
                    assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerDeposit), 'Seller Amount is not as expected')
                    assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit), 'Escrow Amount is not as expected')

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
                });

                afterEach(async () => {
                    distributedAmounts = {
                        buyerAmount: new BN(0),
                        sellerAmount: new BN(0),
                        escrowAmount: new BN(0)
                    }

                    balanceBuyerFromPayment = new BN(0)
                    balanceSellerFromPayment = new BN(0)
                    escrowBalanceFromPayment = new BN(0)

                    cashierPaymentLeft = new BN(0)
                    cashierDepositLeft = new BN(0)

                    await giveAwayToRandom();
                })
            })

        })
    }

    describe("[WHEN PAUSED] Seller withdraws deposit locked in escrow", async () => {

        let remQty = 10;
        let voucherToBuyBeforeBurn = 5
        let tokensToMintSeller, tokensToMintBuyer

        describe("ETH ETH", () => {

            before(async () => {
                await deployContracts();

                utils = UtilsBuilder
                    .NEW()
                    .ETH_ETH()
                    .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBosonRouter);

                const timestamp = await Utils.getCurrTimestamp()

                TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_10)
            
            })

            after(() => {
                remQty = 10;
                voucherToBuyBeforeBurn = 5
            }) 

            it("[NEGATIVE] Should revert if called when contract is not paused", async () => {
                await truffleAssert.reverts(
                    contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address}),
                    truffleAssert.ErrorType.REVERT
                )
            })

            it("Should pause the contract", async () => {
                // Does nothing in particular .. 
                // Buys 5 vouchers before pausing the contract so as to test if the locked seller deposit should be returned correctly
                // Pauses contract as below tests are dependant to paused contract

                for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
                    await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                    remQty--;
                }

                await contractBosonRouter.pause();
            })

            it("[NEGATIVE] should revert if not called from the seller", async () => {
                await truffleAssert.reverts(
                    contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Attacker.address}),
                    truffleAssert.ErrorType.REVERT
                )
            })

            it("Seller should be able to withdraw deposits for the remaining QTY in Token Supply", async () => {
                let withdrawTx = await contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address});
                const expectedSellerDeposit = new BN(helpers.seller_deposit).mul(new BN(remQty))
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                    assert.equal(ev._payee, Seller.address, "Incorrect Payee")
                    assert.isTrue(ev._payment.eq(expectedSellerDeposit))
                        
                    return true
                }, "Event LogWithdrawal was not emitted")
            });

            it("Escrow should have correct balance after burning the rest of the supply", async () => {
                const expectedBalance = new BN(helpers.seller_deposit).mul(new BN(voucherToBuyBeforeBurn))
                const escrowAmount = await contractCashier.getEscrowAmount(Seller.address);

                assert.isTrue(escrowAmount.eq(expectedBalance), "Escrow amount is incorrect")
            });

            it("Remaining QTY for Token Supply should be ZERO", async () => {
                let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(TOKEN_SUPPLY_ID, Seller.address)

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
                    contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address}),
                    truffleAssert.ErrorType.REVERT
                )
            });
        
        })

        describe("[WITH PERMIT]", () => {
            
            describe("ETH_TKN", () => {
                before(async () => {
                    await deployContracts();
                    utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .ETH_TKN()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBosonRouter, contractBSNTokenPrice, contractBSNTokenDeposit)

                    const timestamp = await Utils.getCurrTimestamp()

                    tokensToMintSeller = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_10))
                    tokensToMintBuyer = new BN(helpers.product_price).mul(new BN(helpers.QTY_10))

                    await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMintSeller);
                    await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, tokensToMintBuyer);

                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_10)

                })

                after(() => {
                    remQty = 10;
                    voucherToBuyBeforeBurn = 5
                }) 

                it("[NEGATIVE] Should revert if called when contract is not paused", async () => {
                await truffleAssert.reverts(
                    contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address}),
                    truffleAssert.ErrorType.REVERT
                )
            })

                it("Should pause the contract", async () => {
                    // Does nothing in particular .. 
                    // Buys 5 vouchers before pausing the contract so as to test if the locked seller deposit should be returned correctly
                    // Pauses contract as below tests are dependant to paused contract

                    for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
                        await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        remQty--;
                    }

                    await contractBosonRouter.pause();
                })

                it("[NEGATIVE] should revert if not called from the seller", async () => {
                    await truffleAssert.reverts(
                        contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Attacker.address}),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("Seller should be able to withdraw deposits for the remaining QTY in Token Supply", async () => {
                    let withdrawTx = await contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address});
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).mul(new BN(remQty))
                    const internalTx = (await truffleAssert.createTransactionResult(contractBSNTokenDeposit, withdrawTx.tx))

                    truffleAssert.eventEmitted(internalTx, 'Transfer', (ev) => {
                        assert.equal(ev.to, Seller.address, "Incorrect Payee")
                        assert.isTrue(ev.value.eq(expectedSellerDeposit))
                            
                        return true
                    }, "Event Transfer was not emitted")
                });

                it("Escrow should have correct balance after burning the rest of the supply", async () => {
                    const expectedBalance = new BN(helpers.seller_deposit).mul(new BN(voucherToBuyBeforeBurn))
                    const escrowAmount = await contractBSNTokenDeposit.balanceOf(Seller.address);

                    assert.isTrue(escrowAmount.eq(expectedBalance), "Escrow amount is incorrect")
                });

                it("Remaining QTY for Token Supply should be ZERO", async () => {
                    let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(TOKEN_SUPPLY_ID, Seller.address)

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
                    contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address}),
                    truffleAssert.ErrorType.REVERT
                )
            });
        
            })

            describe("TKN_ETH", () => {
                before(async () => {
                    await deployContracts();
                    utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .TKN_ETH()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBosonRouter, contractBSNTokenPrice, '')

                    const timestamp = await Utils.getCurrTimestamp()

                    tokensToMintBuyer = new BN(helpers.product_price).mul(new BN(helpers.QTY_10))

                    await utils.mintTokens('contractBSNTokenPrice', Buyer.address, tokensToMintBuyer);

                    TOKEN_SUPPLY_ID = await utils.createOrder(
                        Seller,
                        timestamp,
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        helpers.QTY_10
                    )
                })
            
                 after(() => {
                    remQty = 10;
                    voucherToBuyBeforeBurn = 5
                }) 

                it("[NEGATIVE] Should revert if called when contract is not paused", async () => {
                await truffleAssert.reverts(
                    contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address}),
                    truffleAssert.ErrorType.REVERT
                )
            })

                it("Should pause the contract", async () => {
                    // Does nothing in particular .. 
                    // Buys 5 vouchers before pausing the contract so as to test if the locked seller deposit should be returned correctly
                    // Pauses contract as below tests are dependant to paused contract

                    for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
                        await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        remQty--;
                    }

                    await contractBosonRouter.pause();
                })

                it("[NEGATIVE] should revert if not called from the seller", async () => {
                    await truffleAssert.reverts(
                        contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Attacker.address}),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("Seller should be able to withdraw deposits for the remaining QTY in Token Supply", async () => {
                    let withdrawTx = await contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address});
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).mul(new BN(remQty))
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        assert.equal(ev._payee, Seller.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedSellerDeposit))
                            
                        return true
                    }, "Event LogWithdrawal was not emitted")
                });

                it("Escrow should have correct balance after burning the rest of the supply", async () => {
                    const expectedBalance = new BN(helpers.seller_deposit).mul(new BN(voucherToBuyBeforeBurn))
                    const escrowAmount = await contractCashier.getEscrowAmount(Seller.address);

                    assert.isTrue(escrowAmount.eq(expectedBalance), "Escrow amount is incorrect")
                });

                it("Remaining QTY for Token Supply should be ZERO", async () => {
                    let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(TOKEN_SUPPLY_ID, Seller.address)

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
                    contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address}),
                    truffleAssert.ErrorType.REVERT
                )
            });
        
            
            })

            describe("TKN_TKN", () => {
                before(async () => {
                    await deployContracts();
                    utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .TKN_TKN()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBosonRouter, contractBSNTokenPrice, contractBSNTokenDeposit)
                    
                    const timestamp = await Utils.getCurrTimestamp()

                    tokensToMintSeller = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_10))
                    tokensToMintBuyer = new BN(helpers.product_price).mul(new BN(helpers.QTY_10))

                    await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMintSeller);
                    await utils.mintTokens('contractBSNTokenPrice', Buyer.address, tokensToMintBuyer);
                    await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, tokensToMintBuyer);

                    TOKEN_SUPPLY_ID = await utils.createOrder(
                        Seller,
                        timestamp, 
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        helpers.QTY_10
                    )
                })

                after(() => {
                    remQty = 10;
                    voucherToBuyBeforeBurn = 5
                }) 

                it("[NEGATIVE] Should revert if called when contract is not paused", async () => {
                    await truffleAssert.reverts(
                        contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address}),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("Should pause the contract", async () => {
                    // Does nothing in particular .. 
                    // Buys 5 vouchers before pausing the contract so as to test if the locked seller deposit should be returned correctly
                    // Pauses contract as below tests are dependant to paused contract

                    for (let i = 0; i < voucherToBuyBeforeBurn; i++) {
                        await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        remQty--;
                    }

                    await contractBosonRouter.pause();
                })

                it("[NEGATIVE] should revert if not called from the seller", async () => {
                    await truffleAssert.reverts(
                        contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Attacker.address}),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("Seller should be able to withdraw deposits for the remaining QTY in Token Supply", async () => {
                    let withdrawTx = await contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address});
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).mul(new BN(remQty))
                    const internalTx = (await truffleAssert.createTransactionResult(contractBSNTokenDeposit, withdrawTx.tx))

                    truffleAssert.eventEmitted(internalTx, 'Transfer', (ev) => {
                        assert.equal(ev.to, Seller.address, "Incorrect Payee")
                        assert.isTrue(ev.value.eq(expectedSellerDeposit))
                            
                        return true
                    }, "Event Transfer was not emitted")
                });

                it("Escrow should have correct balance after burning the rest of the supply", async () => {
                    const expectedBalance = new BN(helpers.seller_deposit).mul(new BN(voucherToBuyBeforeBurn))
                    const escrowAmount = await contractBSNTokenDeposit.balanceOf(Seller.address);

                    assert.isTrue(escrowAmount.eq(expectedBalance), "Escrow amount is incorrect")
                });

                it("Remaining QTY for Token Supply should be ZERO", async () => {
                    let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(TOKEN_SUPPLY_ID, Seller.address)

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
                        contractCashier.withdrawDeposits(TOKEN_SUPPLY_ID, {from: Seller.address}),
                        truffleAssert.ErrorType.REVERT
                    )
                });
        
            })

        })
    })

})

