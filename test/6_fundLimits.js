const helpers 		= require("../testHelpers/constants");
const truffleAssert = require('truffle-assertions');

const ERC1155ERC721 = artifacts.require("ERC1155ERC721");
const VoucherKernel = artifacts.require("VoucherKernel");
const Cashier 		= artifacts.require("Cashier");
const BosonToken 	= artifacts.require('BosonTokenPrice');
const FundLimitsOracle 	= artifacts.require('FundLimitsOracle');

const BN = web3.utils.BN

const UtilsBuilder = require('../testHelpers/utilsBuilder');
const Utils = require('../testHelpers/utils');
let utils;
const config = require('../testHelpers/config.json');
const { assert } = require("chai");

contract("FundLimitsOracle", async accounts => {
	let Deployer = config.accounts.deployer
    let Attacker = config.accounts.attacker
    
	let contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit, contractFundLimitsOracle;
    let expectedLimit
    const FIVE_ETHERS = (5 * 10 ** 18).toString()
    const FIVE_TOKENS = (5 * 10 ** 16).toString()

    async function deployContracts() {
		const timestamp = await Utils.getCurrTimestamp()
		helpers.PROMISE_VALID_FROM = timestamp
        helpers.PROMISE_VALID_TO = timestamp + 2 * helpers.SECONDS_IN_DAY;
        
        contractFundLimitsOracle = await FundLimitsOracle.new();

		contractERC1155ERC721 = await ERC1155ERC721.new();
		contractVoucherKernel = await VoucherKernel.new(contractERC1155ERC721.address);
		contractCashier = await Cashier.new(contractVoucherKernel.address, contractFundLimitsOracle.address);

		contractBSNTokenPrice = await BosonToken.new("BosonTokenPrice", "BPRC");
		contractBSNTokenDeposit = await BosonToken.new("BosonTokenDeposit", "BDEP");


		await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true');
		await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address);
		await contractVoucherKernel.setCashierAddress(contractCashier.address);
    }

	describe('FundLimitsOracle interaction', function() {

        before(async () => {
            await deployContracts()
        })

        describe("ETH", () => {
            it("Should have set ETH Limit initially to 1 ETH", async () => {

                const ethLimit = await contractFundLimitsOracle.getETHLimit()
    
                assert.equal(ethLimit.toString(), helpers.ETHER_LIMIT, "ETH Limit not set properly")
            })
    
            it("Owner should change ETH Limit", async () => {
                
                await contractFundLimitsOracle.setETHLimit(FIVE_ETHERS);
    
                expectedLimit = await contractFundLimitsOracle.getETHLimit()
    
                assert.equal(expectedLimit.toString(), FIVE_ETHERS, "ETH Limit not correctly set")
            })
    
            it("Should emit LogETHLimitChanged", async () => {
    
                setLimitTx = await contractFundLimitsOracle.setETHLimit(FIVE_ETHERS);
    
                truffleAssert.eventEmitted(setLimitTx, 'LogETHLimitChanged', (ev) => {
                        return ev._triggeredBy == Deployer.address
                    }, 
                "LogETHLimitChanged was not emitted"
                )
            })
    
            it("[NEGATIVE] Should revert if attacker ties to change ETH Limit", async () => {
                await truffleAssert.reverts(
                    contractFundLimitsOracle.setETHLimit(FIVE_ETHERS, {from: Attacker.address}),
                    truffleAssert.ErrorType.REVERT
                )
            })
        })

        describe("Token", () => {

            it("Owner should set Token Limit", async () => {
                
                await contractFundLimitsOracle.setTokenLimit(contractBSNTokenPrice.address, FIVE_TOKENS);
    
                expectedLimit = await contractFundLimitsOracle.getTokenLimit(contractBSNTokenPrice.address)
    
                assert.equal(expectedLimit.toString(), FIVE_TOKENS, "ETH Limit not correctly set")
            })
    
            it("Should emit LogTokenLimitChanged", async () => {
    
                setLimitTx = await contractFundLimitsOracle.setTokenLimit(contractBSNTokenPrice.address, FIVE_TOKENS);
    
                truffleAssert.eventEmitted(setLimitTx, 'LogTokenLimitChanged', (ev) => {
                        return ev._triggeredBy == Deployer.address
                    }, 
                "LogETHLimitChanged was not emitted"
                )
            })
    
            it("[NEGATIVE] Should revert if attacker ties to change Token Limit", async () => {
                await truffleAssert.reverts(
                    contractFundLimitsOracle.setTokenLimit(contractBSNTokenPrice.address, FIVE_TOKENS, {from: Attacker.address}),
                    truffleAssert.ErrorType.REVERT
                )
            })
        })
		
	})

});