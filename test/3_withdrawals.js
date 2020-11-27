const chai = require('chai')
let chaiAsPromised = require("chai-as-promised")
chai.use(chaiAsPromised)
const assert = chai.assert

const BN = web3.utils.BN
const UtilsBuilder = require('../testHelpers/builder')
const Utils = require('../testHelpers/utils')
let utils

const ERC1155ERC721 = artifacts.require("ERC1155ERC721")
const VoucherKernel = artifacts.require("VoucherKernel")
const Cashier = artifacts.require("Cashier")
const BosonTKN = artifacts.require("BosonToken")

const helpers = require("../testHelpers/constants")
const timemachine = require('../testHelpers/timemachine')
const truffleAssert = require('truffle-assertions')

let TOKEN_SUPPLY_ID

contract("Cashier withdrawals ", async accounts => {

    let Deployer = accounts[0] //0xD9995BAE12FEe327256FFec1e3184d492bD94C31
    let Deployer_PK = '0x7ab741b57e8d94dd7e1a29055646bafde7010f38a900f55bbd7647880faa6ee8'
    let Seller = accounts[1] //0xd4Fa489Eacc52BA59438993f37Be9fcC20090E39
    let Seller_PK = '0x2030b463177db2da82908ef90fa55ddfcef56e8183caf60db464bc398e736e6f';
    let Buyer = accounts[2] //0x760bf27cd45036a6C486802D30B5D90CfFBE31FE
    let Buyer_PK = '0x62ecd49c4ccb41a70ad46532aed63cf815de15864bc415c87d507afd6a5e8da2'
    let Attacker = accounts[3] //0x56A32fFf5E5A8B40d6A21538579fB8922DF5258c 
    let Attacker_PK = '0xf473040b1a83739a9c7cc1f5719fab0f5bf178f83314d98557c58aae1910e03a' 

    let contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit

    let distributedAmaounts = {
        buyerAmount: new BN(0),
        sellerAmount: new BN(0),
        escrowAmount: new BN(0)
    }

    describe.only('Withdraw scenarios', function () {
        
        describe('ETH - ETH', async () => {
            
            before(async () => {
                contractERC1155ERC721 = await ERC1155ERC721.new()
                contractVoucherKernel = await VoucherKernel.new(contractERC1155ERC721.address)
                contractCashier = await Cashier.new(contractVoucherKernel.address)

                await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
                await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
                await contractVoucherKernel.setCashierAddress(contractCashier.address)

                await contractVoucherKernel.setComplainPeriod(60); //60 seconds
                await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds

                utils = UtilsBuilder
                    .NEW()
                    .ETH_ETH()
                    .build(contractERC1155ERC721, contractVoucherKernel, contractCashier)

                const timestamp = await Utils.getCurrTimestamp()

                TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY)
            })

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

        describe('TKN - TKN [WITH PERMIT]', async () => {
            let balanceBuyerFromPayment = new BN(0)
            let balanceBuyerFromDesosits = new BN(0)

            let balanceSellerFromPayment = new BN(0)
            let balanceSellerFromDesosits = new BN(0)

            let escrowBalanceFromPayment = new BN(0)
            let escrowBalanceFromDeposits = new BN(0)

            let cashierPaymentLeft = new BN(0)
            let cashierDepositLeft = new BN(0)


            async function getBalancesFromPiceTokenAndDepositToken() {
                balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(Buyer)
                balanceBuyerFromDesosits = await utils.contractBSNTokenDeposit.balanceOf(Buyer)

                balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(Seller)
                balanceSellerFromDesosits = await utils.contractBSNTokenDeposit.balanceOf(Seller)

                escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(Deployer)
                escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Deployer)

                cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(utils.contractCashier.address)
                cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(utils.contractCashier.address)
            }

            beforeEach(async () => {
                contractERC1155ERC721 = await ERC1155ERC721.new()
                contractVoucherKernel = await VoucherKernel.new(contractERC1155ERC721.address)
                contractCashier = await Cashier.new(contractVoucherKernel.address)
                contractBSNTokenPrice = await BosonTKN.new('BosonTokenPrice', 'BPRC');
                contractBSNTokenDeposit = await BosonTKN.new('BosonTokenDeposit', 'BDEP');

                await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
                await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
                await contractVoucherKernel.setCashierAddress(contractCashier.address)

                await contractVoucherKernel.setComplainPeriod(60); //60 seconds
                await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds

                utils = UtilsBuilder
                    .NEW()
                    .withPermit()
                    .TKN_TKN()
                    .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)
                 
                const timestamp = await Utils.getCurrTimestamp()

                const supplyQty = 1
                const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(supplyQty))

                await utils.mintTokens('contractBSNTokenDeposit',Seller, tokensToMint);
                await utils.mintTokens('contractBSNTokenPrice', Buyer, helpers.product_price);
                await utils.mintTokens('contractBSNTokenDeposit', Buyer, helpers.buyer_deposit);

                TOKEN_SUPPLY_ID = await utils.createOrder(
                    {
                        address: Seller,
                        pk: Seller_PK
                    }, 
                    timestamp, 
                    timestamp + helpers.SECONDS_IN_DAY,
                    helpers.seller_deposit,
                    supplyQty
                )
            })

            it("COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {

                const voucherID = await utils.commitToBuy(
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    }, 
                    {
                        address: Seller,
                        pk: Seller
                    }, 
                    TOKEN_SUPPLY_ID
                )

                await utils.refund(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)
                await utils.finalize(voucherID, Deployer)
                const withdrawTx = await utils.withdraw(voucherID, Deployer);

                const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.025
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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.refund(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60);
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer)

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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.refund(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)

                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )
                await utils.refund(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )
                await utils.redeem(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer)

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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.redeem(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )
                await utils.redeem(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.redeem(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

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

            afterEach(() => {
                distributedAmaounts = {
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
            })
        })
       
        describe('ETH - TKN [WITH PERMIT]', async () => {
            let balanceBuyerFromPayment = new BN(0)
            let balanceBuyerFromDesosits = new BN(0)

            let balanceSellerFromPayment = new BN(0)
            let balanceSellerFromDesosits = new BN(0)

            let escrowBalanceFromPayment = new BN(0)
            let escrowBalanceFromDeposits = new BN(0)

            let cashierPaymentLeft = new BN(0)
            let cashierDepositLeft = new BN(0)

            async function getBalancesDepositToken() {
                balanceBuyerFromDesosits = await utils.contractBSNTokenDeposit.balanceOf(Buyer)
                balanceSellerFromDesosits = await utils.contractBSNTokenDeposit.balanceOf(Seller)
                escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Deployer)
                cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(utils.contractCashier.address)
            }

            beforeEach(async () => {
                contractERC1155ERC721 = await ERC1155ERC721.new()
                contractVoucherKernel = await VoucherKernel.new(contractERC1155ERC721.address)
                contractCashier = await Cashier.new(contractVoucherKernel.address)
                contractBSNTokenDeposit = await BosonTKN.new('BosonTokenDeposit', 'BDEP');

                await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
                await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
                await contractVoucherKernel.setCashierAddress(contractCashier.address)

                await contractVoucherKernel.setComplainPeriod(60); //60 seconds
                await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds


                utils = UtilsBuilder
                    .NEW()
                    .withPermit()
                    .ETH_TKN()
                    .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)

                const timestamp = await Utils.getCurrTimestamp()

                const supplyQty = 1
                const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(supplyQty))

                await utils.mintTokens('contractBSNTokenDeposit', Seller, tokensToMint);
                await utils.mintTokens('contractBSNTokenDeposit', Buyer, helpers.buyer_deposit);

                TOKEN_SUPPLY_ID = await utils.createOrder(
                    {
                        address: Seller,
                        pk: Seller_PK
                    },
                    timestamp,
                    timestamp + helpers.SECONDS_IN_DAY,
                    helpers.seller_deposit,
                    supplyQty
                )
            })

            it("COMMIT->REFUND->COMPLAIN->CANCEL->FINALIZE->WITHDRAW", async () => {

                const voucherID = await utils.commitToBuy(
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.refund(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)
                await utils.finalize(voucherID, Deployer)
                const withdrawTx = await utils.withdraw(voucherID, Deployer);

                const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.025
                const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                await getBalancesDepositToken();

                // Payment should have been returned to buyer
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                    assert.equal(ev._payee, Buyer, "Incorrect Payee")
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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.refund(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60);
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer)

                const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                const expectedBuyerDeposit = new BN(0)
                const expectedSellerDeposit = new BN(0)
                const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).add(new BN(helpers.buyer_deposit)) // 0.09

                await getBalancesDepositToken();

                // Payment should have been returned to buyer
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                    assert.equal(ev._payee, Buyer, "Incorrect Payee")
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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.refund(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)

                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

                const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                const expectedEscrowAmountDeposit = new BN(0)

                await getBalancesDepositToken();

                // Payment should have been returned to buyer
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                    assert.equal(ev._payee, Buyer, "Incorrect Payee")
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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )
                await utils.refund(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

                const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                const expectedBuyerDeposit = new BN(0)
                const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                const expectedEscrowAmountDeposit = new BN(helpers.buyer_deposit) // 0.04

                await getBalancesDepositToken();

                // Payment should have been returned to buyer
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                    assert.equal(ev._payee, Buyer, "Incorrect Payee")
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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

                const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                const expectedEscrowAmountDeposit = new BN(0)

                await getBalancesDepositToken();

                // Payment should have been returned to buyer
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                    assert.equal(ev._payee, Buyer, "Incorrect Payee")
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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )
                await utils.redeem(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer)

                const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                const expectedSellerPrice = new BN(helpers.product_price) //// 0.3
                const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                const expectedEscrowAmountDeposit = new BN(0)

                await getBalancesDepositToken();

                // Payment should have been sent to seller
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                    assert.equal(ev._payee, Seller, "Incorrect Payee")
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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.redeem(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

                const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                const expectedSellerDeposit = new BN(0)
                const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit) // 0.05
                
                await getBalancesDepositToken();

                // Payment should have been sent to seller
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                    assert.equal(ev._payee, Seller, "Incorrect Payee")
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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )
                await utils.redeem(voucherID, Buyer)
                await utils.complain(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

                const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

                await getBalancesDepositToken();

                // Payment should have been sent to seller
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                    assert.equal(ev._payee, Seller, "Incorrect Payee")
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
                    {
                        address: Buyer,
                        pk: Buyer_PK
                    },
                    {
                        address: Seller,
                        pk: Seller
                    },
                    TOKEN_SUPPLY_ID
                )

                await utils.redeem(voucherID, Buyer)
                await utils.cancel(voucherID, Seller)

                await timemachine.advanceTimeSeconds(60)
                await utils.finalize(voucherID, Deployer)

                const withdrawTx = await utils.withdraw(voucherID, Deployer);

                const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(2)) // 0.025
                const expectedEscrowAmountDeposit = new BN(0)

                await getBalancesDepositToken();

                // Payment should have been sent to seller
                truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                    assert.equal(ev._payee, Seller, "Incorrect Payee")
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

            afterEach(() => {
                distributedAmaounts = {
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
            })
        })

    })
})

