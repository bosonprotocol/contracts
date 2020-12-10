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
const BosonTKN = artifacts.require("BosonToken")

const helpers = require("../testHelpers/constants")
const timemachine = require('../testHelpers/timemachine')
const truffleAssert = require('truffle-assertions')
const config = require('../testHelpers/config.json')

let TOKEN_SUPPLY_ID
let VOUCHER_ID

contract("Cashier withdrawals ", async accounts => {

    let Deployer = config.accounts.deployer
    let Seller = config.accounts.seller
    let Buyer = config.accounts.buyer
    let Attacker = config.accounts.attacker

    let contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit
    let tokensToMint
    let timestamp

    async function deployContracts() {
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
            .ETH_ETH()
            .build(contractERC1155ERC721, contractVoucherKernel, contractCashier)
        timestamp = await Utils.getCurrTimestamp()
    }

    describe('Pausing Scenarios', function () {

        describe("CASHIER", () => {

            describe("COMMON PAUSING", () => {
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
                        contractCashier.pause({ from: Attacker.address }),
                        truffleAssert.ErrorType.REVERT
                    )
                });

                it("[NEGATIVE] Attacker should not be able to unpause the contract", async () => {
                    await contractCashier.pause();

                    await truffleAssert.reverts(
                        contractCashier.unpause({ from: Attacker.address }),
                        truffleAssert.ErrorType.REVERT
                    )
                });
            })

            describe("ETH_ETH", () => {

                before(async () => {
                    await deployContracts();
                    utils = UtilsBuilder
                        .NEW()
                        .ETH_ETH()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier);

                    const timestamp = await Utils.getCurrTimestamp()

                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_10)
            
                })

                it("[NEGATIVE] Should not create voucher supply when contract is paused", async () => {
                    await contractCashier.pause();

                    await truffleAssert.reverts(
                        utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("Should create voucher supply when contract is unpaused", async () => {
                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                    
                    assert.isNotEmpty(TOKEN_SUPPLY_ID)
                })
                
                it("[NEGATIVE] Should not create voucherID from Buyer when paused", async () => {
                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)

                    await contractCashier.pause();

                    await truffleAssert.reverts(
                        utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID),
                        truffleAssert.ErrorType.REVERT
                    )  
                })

                it("[NEGATIVE] Should not process withdrawals when paused", async () => {
                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                    
                    const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                    await utils.refund(voucherID, Buyer.address)
                    
                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    await contractCashier.pause();
                    
                    await truffleAssert.reverts(
                        utils.withdraw(voucherID, Deployer.address),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("withdrawWhenPaused - Buyer should be able to withdraw funds when paused", async () => {
                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                    
                    const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                    await utils.refund(voucherID, Buyer.address)
                    
                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    await contractCashier.pause();
                    const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer.address)

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Amounts not distributed successfully")
                })

                it("[NEGATIVE] withdrawWhenPaused - Buyer should not be able to withdraw funds when not paused", async () => {
                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                    
                    const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                    await utils.refund(voucherID, Buyer.address)
                    
                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    await truffleAssert.reverts(
                        utils.withdrawWhenPaused(voucherID, Buyer.address),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("withdrawWhenPaused - Seller should be able to withdraw funds when paused", async () => {
                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                    
                    const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                    await utils.refund(voucherID, Buyer.address)
                    
                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    await contractCashier.pause();
                    const withdrawTx = await utils.withdrawWhenPaused(voucherID, Seller.address)

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Amounts not distributed successfully")
                })

                it("[NEGATIVE] withdrawWhenPaused - Seller should not be able to withdraw funds when not paused", async () => {
                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                    
                    const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                    await utils.refund(voucherID, Buyer.address)
                    
                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    await truffleAssert.reverts(
                        utils.withdrawWhenPaused(voucherID, Seller.address),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("[NEGATIVE] withdrawWhenPaused - Attacker should not be able to withdraw funds when paused", async () => {
                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                    
                    const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                    await utils.refund(voucherID, Buyer.address)
                    
                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    await contractCashier.pause();

                    await truffleAssert.reverts(
                        utils.withdrawWhenPaused(voucherID, Attacker.address),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("[NEGATIVE] withdrawWhenPaused - Attacker should not be able to withdraw funds when not paused", async () => {
                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                    
                    const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                    await utils.refund(voucherID, Buyer.address)
                    
                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    await truffleAssert.reverts(
                        utils.withdrawWhenPaused(voucherID, Attacker.address),
                        truffleAssert.ErrorType.REVERT
                    )
                })
         
            })
        
            describe("[WITH PERMIT]", () => {

                describe("ETH_TKN", () => {

                    before(async () => {

                        await deployContracts();

                        utils = UtilsBuilder
                            .NEW()
                            .ERC20withPermit()
                            .ETH_TKN()
                            .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)

                        const timestamp = await Utils.getCurrTimestamp()

                        tokensToMint = new BN(helpers.product_price).mul(new BN(helpers.QTY_10))

                        await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMint);
                        await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, tokensToMint);

                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_10)
                    })
                
                    it("[NEGATIVE] Should not create voucher supply when contract is paused", async () => {
                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("Should create voucher supply when contract is unpaused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        assert.isNotEmpty(TOKEN_SUPPLY_ID)
                    })
                    
                    it("[NEGATIVE] Should not create voucherID from Buyer when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID),
                            truffleAssert.ErrorType.REVERT
                        )  
                    })

                    it("[NEGATIVE] Should not process withdrawals when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();
                        
                        await truffleAssert.reverts(
                            utils.withdraw(voucherID, Deployer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("withdrawWhenPaused - Buyer should be able to withdraw funds when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();
                        const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer.address)

                        truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                            return true
                        }, "Amounts not distributed successfully")
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Buyer should not be able to withdraw funds when not paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("withdrawWhenPaused - Seller should be able to withdraw funds when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();
                        const withdrawTx = await utils.withdrawWhenPaused(voucherID, Seller.address)

                        truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                            return true
                        }, "Amounts not distributed successfully")
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Seller should not be able to withdraw funds when not paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Seller.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Attacker should not be able to withdraw funds when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Attacker.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Attacker should not be able to withdraw funds when not paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Attacker.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })
         
                })
            
                describe("TKN_ETH", () => {

                    before(async () => {
                        await deployContracts();
                        utils = UtilsBuilder
                            .NEW()
                            .ERC20withPermit()
                            .TKN_ETH()
                            .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, '')

                        const timestamp = await Utils.getCurrTimestamp()

                        tokensToMint = new BN(helpers.product_price).mul(new BN(helpers.QTY_10))

                        await utils.mintTokens('contractBSNTokenPrice', Buyer.address, tokensToMint);

                        TOKEN_SUPPLY_ID = await utils.createOrder(
                            Seller,
                            timestamp,
                            timestamp + helpers.SECONDS_IN_DAY,
                            helpers.seller_deposit,
                            helpers.QTY_10
                        )
                    })

                    it("[NEGATIVE] Should not create voucher supply when contract is paused", async () => {
                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("Should create voucher supply when contract is unpaused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        assert.isNotEmpty(TOKEN_SUPPLY_ID)
                    })
                    
                    it("[NEGATIVE] Should not create voucherID from Buyer when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID),
                            truffleAssert.ErrorType.REVERT
                        )  
                    })

                    it("[NEGATIVE] Should not process withdrawals when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();
                        
                        await truffleAssert.reverts(
                            utils.withdraw(voucherID, Deployer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("withdrawWhenPaused - Buyer should be able to withdraw funds when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();
                        const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer.address)

                        truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                            return true
                        }, "Amounts not distributed successfully")
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Buyer should not be able to withdraw funds when not paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("withdrawWhenPaused - Seller should be able to withdraw funds when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();
                        const withdrawTx = await utils.withdrawWhenPaused(voucherID, Seller.address)

                        truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                            return true
                        }, "Amounts not distributed successfully")
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Seller should not be able to withdraw funds when not paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Seller.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Attacker should not be able to withdraw funds when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Attacker.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Attacker should not be able to withdraw funds when not paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Attacker.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })
         

                })

                describe("TKN_TKN", () => {
                    before(async () => {
                        await deployContracts();
                        utils = UtilsBuilder
                            .NEW()
                            .ERC20withPermit()
                            .TKN_TKN()
                            .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)
                        
                        tokensToMint = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_10))
                        tokensToMint = new BN(helpers.product_price).mul(new BN(helpers.QTY_10))

                        await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMint);
                        await utils.mintTokens('contractBSNTokenPrice', Buyer.address, tokensToMint);
                        await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, tokensToMint);
                    })


                    it("[NEGATIVE] Should not create voucher supply when contract is paused", async () => {
                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("Should create voucher supply when contract is unpaused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        assert.isNotEmpty(TOKEN_SUPPLY_ID)
                    })
                    
                    it("[NEGATIVE] Should not create voucherID from Buyer when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID),
                            truffleAssert.ErrorType.REVERT
                        )  
                    })

                    it("[NEGATIVE] Should not process withdrawals when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();
                        
                        await truffleAssert.reverts(
                            utils.withdraw(voucherID, Deployer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("withdrawWhenPaused - Buyer should be able to withdraw funds when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();
                        const withdrawTx = await utils.withdrawWhenPaused(voucherID, Buyer.address)

                        truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                            return true
                        }, "Amounts not distributed successfully")
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Buyer should not be able to withdraw funds when not paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("withdrawWhenPaused - Seller should be able to withdraw funds when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();
                        const withdrawTx = await utils.withdrawWhenPaused(voucherID, Seller.address)

                        truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                            return true
                        }, "Amounts not distributed successfully")
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Seller should not be able to withdraw funds when not paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Seller.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Attacker should not be able to withdraw funds when paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.withdrawWhenPaused(voucherID, Attacker.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] withdrawWhenPaused - Attacker should not be able to withdraw funds when not paused", async () => {
                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_1)
                        
                        const voucherID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)
                        await utils.refund(voucherID, Buyer.address)
                        
                        await timemachine.advanceTimeSeconds(60)
                        await utils.finalize(voucherID, Deployer.address)

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
                    await deployContracts();
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

            })

            describe("ETH_ETH", () => {
                before(async () => {
                    await deployContracts();

                    utils = UtilsBuilder
                        .NEW()
                        .ETH_ETH()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier);

                    const timestamp = await Utils.getCurrTimestamp()

                    TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_10)
            
                })
            
                it("[NEGATIVE] Should not process refund when paused", async () => {
                    VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                    await contractCashier.pause();

                    await truffleAssert.reverts(
                        utils.refund(VOUCHER_ID, Buyer.address),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("[NEGATIVE] Should not process complain when paused", async () => {
                    VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                    await utils.refund(VOUCHER_ID, Buyer.address)
                    
                    await contractCashier.pause();

                    await truffleAssert.reverts(
                        utils.complain(VOUCHER_ID, Buyer.address),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("[NEGATIVE] Should not process redeem when paused", async () => {
                    VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                    await contractCashier.pause();

                    await truffleAssert.reverts(
                        utils.redeem(VOUCHER_ID, Buyer.address),
                        truffleAssert.ErrorType.REVERT
                    )
                })

                it("[NEGATIVE] Should not process cancel when paused", async () => {
                    VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID);
                    await utils.redeem(VOUCHER_ID, Buyer.address)

                    await contractCashier.pause();

                    await truffleAssert.reverts(
                        utils.cancel(VOUCHER_ID, Seller.address),
                        truffleAssert.ErrorType.REVERT
                    )
                })
        
            })
            
            describe("[WITH PERMIT]", () => {

                describe("ETH_TKN", () => {

                    before(async () => {
                        await deployContracts()
                        await deployContracts();
                        utils = UtilsBuilder
                            .NEW()
                            .ERC20withPermit()
                            .ETH_TKN()
                            .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)

                        const timestamp = await Utils.getCurrTimestamp()

                        tokensToMint = new BN(helpers.product_price).mul(new BN(helpers.QTY_10))

                        await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMint);
                        await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, tokensToMint);

                        TOKEN_SUPPLY_ID = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_10)

                    })

                    it("[NEGATIVE] Should not process refund when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.refund(VOUCHER_ID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] Should not process complain when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                        await utils.refund(VOUCHER_ID, Buyer.address)
                        
                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.complain(VOUCHER_ID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] Should not process redeem when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.redeem(VOUCHER_ID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] Should not process cancel when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID);
                        await utils.redeem(VOUCHER_ID, Buyer.address)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.cancel(VOUCHER_ID, Seller.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })
        

                })

                describe("TKN_ETH", () => {

                    before(async () => {
                         await deployContracts();
                        utils = UtilsBuilder
                            .NEW()
                            .ERC20withPermit()
                            .TKN_ETH()
                            .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, '')

                        const timestamp = await Utils.getCurrTimestamp()

                        tokensToMint = new BN(helpers.product_price).mul(new BN(helpers.QTY_10))

                        await utils.mintTokens('contractBSNTokenPrice', Buyer.address, tokensToMint);

                        TOKEN_SUPPLY_ID = await utils.createOrder(
                            Seller,
                            timestamp,
                            timestamp + helpers.SECONDS_IN_DAY,
                            helpers.seller_deposit,
                            helpers.QTY_10
                        )
                    })

                    it("[NEGATIVE] Should not process refund when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.refund(VOUCHER_ID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] Should not process complain when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                        await utils.refund(VOUCHER_ID, Buyer.address)
                        
                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.complain(VOUCHER_ID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] Should not process redeem when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.redeem(VOUCHER_ID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] Should not process cancel when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID);
                        await utils.redeem(VOUCHER_ID, Buyer.address)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.cancel(VOUCHER_ID, Seller.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })
                })

                describe("TKN_TKN", () => {

                    before(async () => {

                        await deployContracts();
                        utils = UtilsBuilder
                            .NEW()
                            .ERC20withPermit()
                            .TKN_TKN()
                            .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)
                        
                        const timestamp = await Utils.getCurrTimestamp()

                        tokensToMint = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_10))
                        tokensToMint = new BN(helpers.product_price).mul(new BN(helpers.QTY_10))

                        await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMint);
                        await utils.mintTokens('contractBSNTokenPrice', Buyer.address, tokensToMint);
                        await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, tokensToMint);

                        TOKEN_SUPPLY_ID = await utils.createOrder(
                            Seller,
                            timestamp, 
                            timestamp + helpers.SECONDS_IN_DAY,
                            helpers.seller_deposit,
                            helpers.QTY_10
                        )
                    })

                    it("[NEGATIVE] Should not process refund when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.refund(VOUCHER_ID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] Should not process complain when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                        await utils.refund(VOUCHER_ID, Buyer.address)
                        
                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.complain(VOUCHER_ID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] Should not process redeem when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.redeem(VOUCHER_ID, Buyer.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })

                    it("[NEGATIVE] Should not process cancel when paused", async () => {
                        VOUCHER_ID = await utils.commitToBuy(Buyer, Seller, TOKEN_SUPPLY_ID);
                        await utils.redeem(VOUCHER_ID, Buyer.address)

                        await contractCashier.pause();

                        await truffleAssert.reverts(
                            utils.cancel(VOUCHER_ID, Seller.address),
                            truffleAssert.ErrorType.REVERT
                        )
                    })
                })
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

