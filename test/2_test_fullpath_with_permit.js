const helpers 		= require("../testHelpers/constants");
const timemachine 	= require('../testHelpers/timemachine');
const truffleAssert = require('truffle-assertions');
//later consider using https://github.com/OpenZeppelin/openzeppelin-test-helpers

const ERC1155ERC721 = artifacts.require("ERC1155ERC721");
const VoucherKernel = artifacts.require("VoucherKernel");
const Cashier 		= artifacts.require("Cashier");
const BosonToken 	= artifacts.require("BosonTokenPrice");

const BN = web3.utils.BN

const UtilsBuilder = require('../testHelpers/utilsBuilder');
const Utils = require('../testHelpers/utils');
let utils;
const config = require('../testHelpers/config.json')


const { ecsign } = require('ethereumjs-util');
const {
	PERMIT_TYPEHASH,
	toWei,
	getApprovalDigest
} = require('../testHelpers/permitUtils');
const { assert } = require("chai");

contract("Voucher tests", async accounts => {
	let Deployer = config.accounts.deployer
	let Seller = config.accounts.seller
	let Buyer = config.accounts.buyer
	let Attacker = config.accounts.attacker

	let contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit;
    let tokenSupplyKey;
	const ONE_VOUCHER = 1
	const deadline = toWei(1)
	let timestamp
	let ZERO = new BN(0);

	let distributedAmounts = {
		buyerAmount: new BN(0),
		sellerAmount: new BN(0),
		escrowAmount: new BN(0)
	}

	async function deployContracts() {
		const timestamp = await Utils.getCurrTimestamp()
		helpers.PROMISE_VALID_FROM = timestamp
		helpers.PROMISE_VALID_TO = timestamp + 2 * helpers.SECONDS_IN_DAY;

		contractERC1155ERC721 = await ERC1155ERC721.new();
		contractVoucherKernel = await VoucherKernel.new(contractERC1155ERC721.address);
		contractCashier = await Cashier.new(contractVoucherKernel.address);

		contractBSNTokenPrice = await BosonToken.new("BosonTokenPrice", "BPRC");
		contractBSNTokenDeposit = await BosonToken.new("BosonTokenDeposit", "BDEP");

		await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true');
		await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address);
		await contractVoucherKernel.setCashierAddress(contractCashier.address);

		await contractERC1155ERC721.setCashierContract(contractCashier.address);
		await contractCashier.setTokenContractAddress(contractERC1155ERC721.address);

		await contractVoucherKernel.setComplainPeriod(60); //60 seconds
        await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds

	}

	describe('TOKEN SUPPLY CREATION (Voucher batch creation)', () =>  {

		let remQty = helpers.QTY_10
		let vouchersToBuy = 5
		
		const paymentMethods = {
			ETH_ETH: 1,
			ETH_TKN: 2,
			TKN_ETH: 3,
			TKN_TKN: 4
		}

		afterEach(() => {
			remQty = helpers.QTY_10
		}) 

		describe("ETH_ETH", () => { 

			before(async() => {
				await deployContracts();

				utils = UtilsBuilder
                    .NEW()
                    .ETH_ETH()
                    .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, helpers.QTY_10);

				timestamp = await Utils.getCurrTimestamp()
				
                tokenSupplyKey = await utils.createOrder(
					Seller, 
					timestamp, 
					timestamp + helpers.SECONDS_IN_DAY,
					helpers.seller_deposit,
					helpers.QTY_10)
			})

			it("ESCROW has correct initial balance", async () => {
                const expectedBalance = new BN(helpers.seller_deposit).mul(new BN(remQty))
				const escrowAmount = await contractCashier.getEscrowAmount(Seller.address);
				
                assert.isTrue(escrowAmount.eq(expectedBalance), "Escrow amount is incorrect")
			})
			
			it("Get correct remaining qty for supply", async () => {
                let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(tokenSupplyKey, Seller.address)

                assert.equal(remainingQtyInContract, remQty, "Remaining qty is not correct")

                for (let i = 0; i < vouchersToBuy; i++) {
					await utils.commitToBuy(Buyer, Seller, tokenSupplyKey)
					remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(tokenSupplyKey, Seller.address)
					
                    assert.equal(remainingQtyInContract, --remQty , "Remaining qty is not correct")
                }
                
            });

			it("Should create payment method ETH_ETH", async () => {
				timestamp = await Utils.getCurrTimestamp()
				let tokenSupplyKey = await utils.createOrder(Seller, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_10);

				const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey);

				assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.ETH_ETH, "Payment Method ETH_ETH not set correctly")
				assert.equal(paymentDetails.addressTokenPrice.toString(), helpers.ZERO_ADDRESS, "ETH_ETH Method Price Token Address mismatch")
				assert.equal(paymentDetails.addressTokenDeposits.toString(), helpers.ZERO_ADDRESS, "ETH_ETH Method Deposit Token Address mismatch")
			})

			it("[NEGATIVE] Should fail if additional token address is provided", async () => {
				const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))
				timestamp = await Utils.getCurrTimestamp()
				
				await truffleAssert.fails(
					contractCashier.requestCreateOrder_ETH_ETH(
						contractBSNTokenDeposit.address,
						[
							timestamp,
							timestamp + helpers.SECONDS_IN_DAY,
							helpers.PROMISE_PRICE1,
							helpers.seller_deposit,
							helpers.PROMISE_DEPOSITBU1,
							helpers.ORDER_QUANTITY1
						],
						{ from: Seller.address, value: txValue}
					)
				);

			})

		})

		describe("[WITH PERMIT]", () => {

			describe("ETH_TKN", () => {
				
				before(async() => {
					await deployContracts();

					utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .ETH_TKN()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)

					const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_20))

					await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMint);
					await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, tokensToMint);
					
					timestamp = await Utils.getCurrTimestamp()
					tokenSupplyKey = await utils.createOrder(
                        Seller,
                        timestamp,
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        helpers.QTY_10
					)

				})

				it("ESCROW has correct initial balance", async () => {
					const expectedBalance = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_10))
					const escrowAmount = await contractBSNTokenDeposit.balanceOf(contractCashier.address)

					assert.isTrue(escrowAmount.eq(expectedBalance), "Escrow amount is incorrect")
				})

				it("Get correct remaining qty for supply", async () => {
					let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(tokenSupplyKey, Seller.address)
					assert.equal(remainingQtyInContract, remQty, "Remaining qty is not correct")

					for (let i = 0; i < vouchersToBuy; i++) {
						await utils.commitToBuy(Buyer, Seller, tokenSupplyKey)
						remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(tokenSupplyKey, Seller.address)
						
						assert.equal(remainingQtyInContract, --remQty , "Remaining qty is not correct")
					}
            	});

				it("Should create payment method ETH_TKN", async () => {
					tokenSupplyKey = await utils.createOrder(
						Seller,
                        timestamp,
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
						helpers.QTY_10,
					);
					
					const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey);

					assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.ETH_TKN, "Payment Method ETH_TKN not set correctly")
					assert.equal(paymentDetails.addressTokenPrice.toString(), helpers.ZERO_ADDRESS, "ETH_TKN Method Price Token Address mismatch")
					assert.equal(paymentDetails.addressTokenDeposits.toString(), contractBSNTokenDeposit.address, "ETH_TKN Method Deposit Token Address mismatch")
				})

				it("[NEGATIVE] Should fail if token deposit contract address is not provided", async () => {
					const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))
					const nonce = await contractBSNTokenDeposit.nonces(Seller.address);

					const digest = await getApprovalDigest(
						contractBSNTokenDeposit,
						Seller.address,
						contractCashier.address,
						txValue,
						nonce,
						deadline
					)

					const { v, r, s } = ecsign(
						Buffer.from(digest.slice(2), 'hex'),
						Buffer.from(Seller.pk.slice(2), 'hex'));

					await truffleAssert.fails(
						contractCashier.requestCreateOrder_ETH_TKN_WithPermit(
							'',
							txValue,
							deadline,
							v, r, s,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								helpers.seller_deposit,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						)
					)
				})

				it("[NEGATIVE] Should revert if token deposit contract address is zero address", async () => {
					const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))
					const nonce = await contractBSNTokenDeposit.nonces(Seller.address);

					const digest = await getApprovalDigest(
						contractBSNTokenDeposit,
						Seller.address,
						contractCashier.address,
						txValue,
						nonce,
						deadline
					)

					const { v, r, s } = ecsign(
						Buffer.from(digest.slice(2), 'hex'),
						Buffer.from(Seller.pk.slice(2), 'hex'));

					await truffleAssert.reverts(
						contractCashier.requestCreateOrder_ETH_TKN_WithPermit(
							helpers.ZERO_ADDRESS,
							txValue,
							deadline,
							v, r, s,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								helpers.seller_deposit,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						),
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

					timestamp = await Utils.getCurrTimestamp()

                    const tokensToMint = new BN(helpers.product_price).mul(new BN(helpers.QTY_10))
                    await utils.mintTokens('contractBSNTokenPrice', Buyer.address, tokensToMint);

					tokenSupplyKey = await utils.createOrder(
                        Seller,
                        timestamp,
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        helpers.QTY_10
					)
				})

				it("ESCROW has correct initial balance", async () => {
					const expectedBalance = new BN(helpers.seller_deposit).mul(new BN(remQty))
					const escrowAmount = await contractCashier.getEscrowAmount(Seller.address);
					
					assert.isTrue(escrowAmount.eq(expectedBalance), "Escrow amount is incorrect")
				})

				it("Get correct remaining qty for supply", async () => {
					let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(tokenSupplyKey, Seller.address)

					assert.equal(remainingQtyInContract, remQty, "Remaining qty is not correct")

					for (let i = 0; i < vouchersToBuy; i++) {
						await utils.commitToBuy(Buyer, Seller, tokenSupplyKey)
						remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(tokenSupplyKey, Seller.address)
						
						assert.equal(remainingQtyInContract, --remQty , "Remaining qty is not correct")
					}
            	});

				it("Should create payment method TKN_ETH", async () => {
					tokenSupplyKey = await utils.createOrder(
                        Seller,
                        timestamp,
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        helpers.QTY_1
                    )

					const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey);

					assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.TKN_ETH, "Payment Method TKN_ETH not set correctly")
					assert.equal(paymentDetails.addressTokenPrice.toString(), contractBSNTokenPrice.address, "TKN_ETH Method Price Token Address mismatch")
					assert.equal(paymentDetails.addressTokenDeposits.toString(), helpers.ZERO_ADDRESS, "TKN_ETH Method Deposit Token Address mismatch")
				})

				it("[NEGATIVE] Should fail if price token contract address is not provided", async () => {
					const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))

					await truffleAssert.fails(
						contractCashier.requestCreateOrder_TKN_ETH(
							'',
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								helpers.seller_deposit,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address, value: txValue.toString() }
						)
					);

				})

				it("[NEGATIVE] Should fail if token price contract is zero address", async () => {

					await truffleAssert.reverts(
						contractCashier.requestCreateOrder_TKN_ETH(
							helpers.ZERO_ADDRESS,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								helpers.seller_deposit,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						),
						truffleAssert.ErrorType.REVERT
					);

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
                    
                    timestamp = await Utils.getCurrTimestamp()

                    const tokensToMint = new BN(helpers.product_price).mul(new BN(helpers.QTY_20))

                    await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMint);
                    await utils.mintTokens('contractBSNTokenPrice', Buyer.address, tokensToMint);
                    await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, tokensToMint);

                    tokenSupplyKey = await utils.createOrder(
                        Seller,
                        timestamp, 
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        helpers.QTY_10
					)
				})

				it("ESCROW has correct initial balance", async () => {
					const expectedBalance = new BN(helpers.seller_deposit).mul(new BN(remQty))
					const escrowAmount = await contractBSNTokenDeposit.balanceOf(contractCashier.address)

					assert.isTrue(escrowAmount.eq(expectedBalance), "Escrow amount is incorrect")
				})

				it("Get correct remaining qty for supply", async () => {
					let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(tokenSupplyKey, Seller.address)

					assert.equal(remainingQtyInContract, remQty, "Remaining qty is not correct")

					for (let i = 0; i < vouchersToBuy; i++) {
						await utils.commitToBuy(Buyer, Seller, tokenSupplyKey)
						remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(tokenSupplyKey, Seller.address)
						
						assert.equal(remainingQtyInContract, --remQty , "Remaining qty is not correct")
					}
            	});

				it("Should create payment method TKN_TKN", async () => {
					  tokenSupplyKey = await utils.createOrder(
                        Seller,
                        timestamp, 
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        helpers.QTY_1
					)

					const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey);

					assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.TKN_TKN, "Payment Method TKN_TKN not set correctly")
					assert.equal(paymentDetails.addressTokenPrice.toString(), contractBSNTokenPrice.address, "TKN_TKN Method Price Token Address mismatch")
					assert.equal(paymentDetails.addressTokenDeposits.toString(), contractBSNTokenDeposit.address, "TKN_TKN Method Deposit Token Address mismatch")
				})

				it("[NEGATIVE] Should fail if token price contract address is not provided", async () => {
					const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))
					const nonce = await contractBSNTokenDeposit.nonces(Seller.address);

					const digest = await getApprovalDigest(
						contractBSNTokenDeposit,
						Seller.address,
						contractCashier.address,
						txValue,
						nonce,
						deadline
					)

					const { v, r, s } = ecsign(
						Buffer.from(digest.slice(2), 'hex'),
						Buffer.from(Seller.pk.slice(2), 'hex'));


					await truffleAssert.fails(
						contractCashier.requestCreateOrder_TKN_TKN_WithPermit(
							'',
							contractBSNTokenDeposit.address,
							txValue,
							deadline,
							v, r, s,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								helpers.seller_deposit,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						)
					);

				})

				it("[NEGATIVE] Should fail if token deposit contract address is not provided", async () => {
					const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))
					const nonce = await contractBSNTokenDeposit.nonces(Seller.address);

					const digest = await getApprovalDigest(
						contractBSNTokenDeposit,
						Seller.address,
						contractCashier.address,
						txValue,
						nonce,
						deadline
					)

					const { v, r, s } = ecsign(
						Buffer.from(digest.slice(2), 'hex'),
						Buffer.from(Seller.pk.slice(2), 'hex'));


					await truffleAssert.fails(
						contractCashier.requestCreateOrder_TKN_TKN_WithPermit(
							contractBSNTokenPrice.address,
							'',
							txValue,
							deadline,
							v, r, s,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								helpers.seller_deposit,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						)
					);

				})

				it("[NEGATIVE] Should revert if token price contract address is zero address", async () => {
					const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))
					const nonce = await contractBSNTokenDeposit.nonces(Seller.address);

					const digest = await getApprovalDigest(
						contractBSNTokenDeposit,
						Seller.address,
						contractCashier.address,
						txValue,
						nonce,
						deadline
					)

					const { v, r, s } = ecsign(
						Buffer.from(digest.slice(2), 'hex'),
						Buffer.from(Seller.pk.slice(2), 'hex'));


					await truffleAssert.reverts(
						contractCashier.requestCreateOrder_TKN_TKN_WithPermit(
							helpers.ZERO_ADDRESS,
							contractBSNTokenDeposit.address,
							txValue,
							deadline,
							v, r, s,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								helpers.seller_deposit,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						),
						truffleAssert.ErrorType.REVERT
					);

				})

				it("[NEGATIVE] Should revert if token deposit contract address is zero address", async () => {
					const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))
					const nonce = await contractBSNTokenDeposit.nonces(Seller.address);
					const deadline = toWei(1)

					const digest = await getApprovalDigest(
						contractBSNTokenDeposit,
						Seller.address,
						contractCashier.address,
						txValue,
						nonce,
						deadline
					)

					const { v, r, s } = ecsign(
						Buffer.from(digest.slice(2), 'hex'),
						Buffer.from(Seller.pk.slice(2), 'hex'));


					await truffleAssert.reverts(
						contractCashier.requestCreateOrder_TKN_TKN_WithPermit(
							contractBSNTokenPrice.address,
							helpers.ZERO_ADDRESS,
							txValue,
							deadline,
							v, r, s,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								helpers.seller_deposit,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						),
						truffleAssert.ErrorType.REVERT
					);

				})
			})

		})
	})

	describe("VOUCHER CREATION (Commit to buy)", () => {
		const ORDER_QTY = 5
		let TOKEN_SUPPLY_ID;

		before(async()=>{
			await deployContracts();
		})

		describe("ETH_ETH", async () => {
			before(async () => {
				utils = UtilsBuilder
					.NEW()
					.ETH_ETH()
					.build(contractERC1155ERC721, contractVoucherKernel, contractCashier)

				TOKEN_SUPPLY_ID = await utils.createOrder(Seller, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.seller_deposit, helpers.QTY_10)
			})

			it("Should create order", async () => {
				const txValue = new BN(helpers.buyer_deposit).add(new BN(helpers.product_price))
				let txFillOrder = await contractCashier.requestVoucher_ETH_ETH(
					TOKEN_SUPPLY_ID,
					Seller.address,
					{
						from: Buyer.address, value: txValue
					});

				let internalTx = (await truffleAssert.createTransactionResult(contractVoucherKernel, txFillOrder.tx))

				truffleAssert.eventEmitted(internalTx, 'LogVoucherDelivered', (ev) => {
					tokenVoucherKey1 = ev._tokenIdVoucher
					return ev._issuer === Seller.address;
				}, "order1 not created successfully");
			})

			it("[NEGATIVE] Should not create order with incorrect price", async () => {
				const txValue = new BN(helpers.buyer_deposit).add(new BN(helpers.incorrect_product_price))
				
				await truffleAssert.reverts(
					contractCashier.requestVoucher_ETH_ETH(
						TOKEN_SUPPLY_ID,
						Seller.address,
						{ from: Buyer.address, value: txValue}),
					truffleAssert.ErrorType.REVERT
				)
					
			})

			it("[NEGATIVE] Should not create order with incorrect deposit", async () => {
				const txValue = new BN(helpers.buyer_incorrect_deposit).add(new BN(helpers.product_price))

				await truffleAssert.reverts(
					contractCashier.requestVoucher_ETH_ETH(
						TOKEN_SUPPLY_ID,
						Seller.address,
						{ from: Buyer.address, value: txValue }),
					truffleAssert.ErrorType.REVERT
				)
			})
		})
		
		describe("[WITH PERMIT]", () => {

			describe("ETH_TKN", async () => {

				before(async () => {
					utils = UtilsBuilder
						.NEW()
						.ERC20withPermit()
						.ETH_TKN()
						.build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)
				

					const tokensToMintSeller = new BN(helpers.seller_deposit).mul(new BN(ORDER_QTY))
					const tokensToMintBuyer = new BN(helpers.buyer_deposit).mul(new BN(ORDER_QTY))

					await contractBSNTokenDeposit.mint(Seller.address, tokensToMintSeller)
					await contractBSNTokenDeposit.mint(Buyer.address, tokensToMintBuyer)

					TOKEN_SUPPLY_ID = await utils.createOrder(
						Seller,
						helpers.PROMISE_VALID_FROM,
						helpers.PROMISE_VALID_TO,
						helpers.seller_deposit,
						ORDER_QTY
					)
				
				})

				it("Should create order", async () => {
					const nonce = await contractBSNTokenDeposit.nonces(Buyer.address);
					const digestDeposit = await getApprovalDigest(
						contractBSNTokenDeposit,
						Buyer.address,
						contractCashier.address,
						helpers.buyer_deposit,
						nonce,
						deadline
					)

					const { v, r, s } = ecsign(
						Buffer.from(digestDeposit.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

					const txFillOrder = await contractCashier.requestVoucher_ETH_TKN_WithPermit(
						TOKEN_SUPPLY_ID,
						Seller.address,
						helpers.buyer_deposit,
						deadline,
						v, r, s,
						{ from: Buyer.address, value: helpers.product_price}
					)

					let internalTx = (await truffleAssert.createTransactionResult(contractVoucherKernel, txFillOrder.tx))
					
					truffleAssert.eventEmitted(internalTx, 'LogVoucherDelivered', (ev) => {
						tokenVoucherKey1 = ev._tokenIdVoucher
						return ev._issuer === Seller.address;
					}, "order1 not created successfully");
				})

				it("[NEGATIVE] Should not create order with incorrect price", async () => {
					const nonce = await contractBSNTokenDeposit.nonces(Buyer.address);
					const digestDeposit = await getApprovalDigest(
						contractBSNTokenDeposit,
						Buyer.address,
						contractCashier.address,
						helpers.buyer_deposit,
						nonce,
						deadline
					)

					const { v, r, s } = ecsign(
						Buffer.from(digestDeposit.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));


					await truffleAssert.reverts(
						contractCashier.requestVoucher_ETH_TKN_WithPermit(
							TOKEN_SUPPLY_ID,
							Seller.address,
							helpers.buyer_deposit, 
							deadline,
							v, r, s,
							{ from: Buyer.address, value: helpers.incorrect_product_price }
						), 
						truffleAssert.ErrorType.REVERT
					)
				})

				it("[NEGATIVE] Should not create order with incorrect deposit", async () => {
					const nonce = await contractBSNTokenDeposit.nonces(Buyer.address);
					const digestDeposit = await getApprovalDigest(
						contractBSNTokenDeposit,
						Buyer.address,
						contractCashier.address,
						helpers.buyer_deposit,
						nonce,
						deadline
					)

					const { v, r, s } = ecsign(
						Buffer.from(digestDeposit.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));


					await truffleAssert.reverts(
						contractCashier.requestVoucher_ETH_TKN_WithPermit(
							TOKEN_SUPPLY_ID,
							Seller.address,
							helpers.buyer_incorrect_deposit,
							deadline,
							v, r, s,
							{ from: Buyer.address, value: helpers.product_price }
						), 
						truffleAssert.ErrorType.REVERT
					)
				})
			})

			describe("TKN_TKN", () => {
				before(async () => {
					utils = UtilsBuilder
						.NEW()
						.ERC20withPermit()
						.TKN_TKN()
						.build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)
				

					const tokensToMintSeller = new BN(helpers.seller_deposit).mul(new BN(ORDER_QTY))
					const tokensToMintBuyer = new BN(helpers.product_price).mul(new BN(ORDER_QTY))

					await contractBSNTokenDeposit.mint(Seller.address, tokensToMintSeller)
					await contractBSNTokenDeposit.mint(Buyer.address, tokensToMintBuyer)
					await contractBSNTokenPrice.mint(Buyer.address, tokensToMintBuyer)

					TOKEN_SUPPLY_ID = await utils.createOrder(
						Seller,
						helpers.PROMISE_VALID_FROM,
						helpers.PROMISE_VALID_TO,
						helpers.seller_deposit,
						ORDER_QTY
					)
				
				})

				it("Should create order", async () => {
					const nonce1 = await contractBSNTokenDeposit.nonces(Buyer.address);
					const tokensToSend = new BN(helpers.product_price).add(new BN(helpers.buyer_deposit))

					const digestDeposit = await getApprovalDigest(
						contractBSNTokenDeposit,
						Buyer.address,
						contractCashier.address,
						helpers.buyer_deposit,
						nonce1,
						deadline
					)

					let VRS_DEPOSIT = ecsign(
						Buffer.from(digestDeposit.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

					let vDeposit = VRS_DEPOSIT.v
					let rDeposit = VRS_DEPOSIT.r
					let sDeposit = VRS_DEPOSIT.s

					const nonce2 = await contractBSNTokenPrice.nonces(Buyer.address);

					const digestPrice = await getApprovalDigest(
						contractBSNTokenPrice,
						Buyer.address,
						contractCashier.address,
						helpers.product_price,
						nonce2,
						deadline
					)

					let VRS_PRICE = ecsign(
						Buffer.from(digestPrice.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

					let vPrice = VRS_PRICE.v
					let rPrice = VRS_PRICE.r
					let sPrice = VRS_PRICE.s

					let txFillOrder = await contractCashier.requestVoucher_TKN_TKN_WithPermit(
						TOKEN_SUPPLY_ID,
						Seller.address,
						tokensToSend,
						deadline,
						vPrice, rPrice, sPrice,
						vDeposit, rDeposit, sDeposit,
						{ from: Buyer.address });

					let internalTx = (await truffleAssert.createTransactionResult(contractVoucherKernel, txFillOrder.tx))

					truffleAssert.eventEmitted(internalTx, 'LogVoucherDelivered', (ev) => {
						tokenVoucherKey1 = ev._tokenIdVoucher
						return ev._issuer === Seller.address;
					}, "order1 not created successfully");
				})

				it("[NEGATIVE] Should not create order with incorrect price", async () => {
					const nonce1 = await contractBSNTokenDeposit.nonces(Buyer.address);
					const tokensToSend = new BN(helpers.incorrect_product_price).add(new BN(helpers.buyer_deposit))

					const digestDeposit = await getApprovalDigest(
						contractBSNTokenDeposit,
						Buyer.address,
						contractCashier.address,
						helpers.buyer_deposit,
						nonce1,
						deadline
					)

					let VRS_DEPOSIT = ecsign(
						Buffer.from(digestDeposit.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

					let vDeposit = VRS_DEPOSIT.v
					let rDeposit = VRS_DEPOSIT.r
					let sDeposit = VRS_DEPOSIT.s

					const nonce2 = await contractBSNTokenPrice.nonces(Buyer.address);

					const digestPrice = await getApprovalDigest(
						contractBSNTokenPrice,
						Buyer.address,
						contractCashier.address,
						helpers.product_price,
						nonce2,
						deadline
					)

					let VRS_PRICE = ecsign(
						Buffer.from(digestPrice.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

					let vPrice = VRS_PRICE.v
					let rPrice = VRS_PRICE.r
					let sPrice = VRS_PRICE.s

					await truffleAssert.reverts(
						contractCashier.requestVoucher_TKN_TKN_WithPermit(
							TOKEN_SUPPLY_ID,
							Seller.address,
							tokensToSend,
							deadline,
							vPrice, rPrice, sPrice,
							vDeposit, rDeposit, sDeposit,
							{ from: Buyer.address }),
						truffleAssert.ErrorType.REVERT
					)
				})

				it("[NEGATIVE] Should not create order with incorrect deposit", async () => {
					const nonce1 = await contractBSNTokenDeposit.nonces(Buyer.address);
					const tokensToSend = new BN(helpers.product_price).add(new BN(helpers.buyer_incorrect_deposit))

					const digestDeposit = await getApprovalDigest(
						contractBSNTokenDeposit,
						Buyer.address,
						contractCashier.address,
						helpers.buyer_deposit,
						nonce1,
						deadline
					)

					let VRS_DEPOSIT = ecsign(
						Buffer.from(digestDeposit.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

					let vDeposit = VRS_DEPOSIT.v
					let rDeposit = VRS_DEPOSIT.r
					let sDeposit = VRS_DEPOSIT.s

					const nonce2 = await contractBSNTokenPrice.nonces(Buyer.address);

					const digestPrice = await getApprovalDigest(
						contractBSNTokenPrice,
						Buyer.address,
						contractCashier.address,
						helpers.product_price,
						nonce2,
						deadline
					)

					let VRS_PRICE = ecsign(
						Buffer.from(digestPrice.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

					let vPrice = VRS_PRICE.v
					let rPrice = VRS_PRICE.r
					let sPrice = VRS_PRICE.s

					await truffleAssert.reverts(
						contractCashier.requestVoucher_TKN_TKN_WithPermit(
							TOKEN_SUPPLY_ID,
							Seller.address,
							tokensToSend,
							deadline,
							vPrice, rPrice, sPrice,
							vDeposit, rDeposit, sDeposit,
							{ from: Buyer.address }),
						truffleAssert.ErrorType.REVERT
					)
				})
			
			})

			describe("TKN_ETH", () => {
				before(async () => {
					utils = UtilsBuilder
						.NEW()
						.ERC20withPermit()
						.TKN_ETH()
						.build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)

					const tokensToMintBuyer = new BN(helpers.product_price).mul(new BN(ORDER_QTY))

					await contractBSNTokenPrice.mint(Buyer.address, tokensToMintBuyer)

					TOKEN_SUPPLY_ID = await utils.createOrder(
						Seller,
						helpers.PROMISE_VALID_FROM,
						helpers.PROMISE_VALID_TO,
						helpers.seller_deposit,
						ORDER_QTY
					)

				})

				it("Should create order", async () => {
					const nonce = await contractBSNTokenPrice.nonces(Buyer.address);

					const digestDeposit = await getApprovalDigest(
						contractBSNTokenPrice,
						Buyer.address,
						contractCashier.address,
						helpers.product_price,
						nonce,
						deadline
					)

					let { v, r, s } = ecsign(
						Buffer.from(digestDeposit.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

					let txFillOrder = await contractCashier.requestVoucher_TKN_ETH_WithPermit(
						TOKEN_SUPPLY_ID,
						Seller.address,
						helpers.product_price,
						deadline,
						v, r, s,
						{ from: Buyer.address, value: helpers.buyer_deposit }
					);

					let internalTx = (await truffleAssert.createTransactionResult(contractVoucherKernel, txFillOrder.tx))

					truffleAssert.eventEmitted(internalTx, 'LogVoucherDelivered', (ev) => {
						tokenVoucherKey1 = ev._tokenIdVoucher
						return ev._issuer === Seller.address;
					}, "order1 not created successfully");
				})

				it("[NEGATIVE] Should not create order with incorrect deposit", async () => {
					const nonce = await contractBSNTokenPrice.nonces(Buyer.address);

					const digestDeposit = await getApprovalDigest(
						contractBSNTokenPrice,
						Buyer.address,
						contractCashier.address,
						helpers.product_price,
						nonce,
						deadline
					)

					let { v, r, s } = ecsign(
						Buffer.from(digestDeposit.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

		
					await truffleAssert.reverts(
						contractCashier.requestVoucher_TKN_ETH_WithPermit(
							TOKEN_SUPPLY_ID,
							Seller.address,
							helpers.product_price,
							deadline,
							v, r, s,
							{ from: Buyer.address, value: helpers.buyer_incorrect_deposit }
						),
						truffleAssert.ErrorType.REVERT
					)
				})

				it("[NEGATIVE] Should not create order with incorrect price", async () => {
					const nonce = await contractBSNTokenPrice.nonces(Buyer.address);

					const digestDeposit = await getApprovalDigest(
						contractBSNTokenPrice,
						Buyer.address,
						contractCashier.address,
						helpers.product_price,
						nonce,
						deadline
					)

					let { v, r, s } = ecsign(
						Buffer.from(digestDeposit.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

					await truffleAssert.reverts(
						contractCashier.requestVoucher_TKN_ETH_WithPermit(
							TOKEN_SUPPLY_ID,
							Seller.address,
							helpers.incorrect_product_price,
							deadline,
							v, r, s,
							{ from: Buyer.address, value: helpers.buyer_deposit }
						),
						truffleAssert.ErrorType.REVERT
					)
				})
			})
		})
	})

	describe("TOKEN SUPPLY TRANSFER", () => {
		let OldSupplyOwner = config.accounts.randomUser 
		let NewSupplyOwner = config.accounts.randomUser2 

		let actualOldOwnerBalanceFromEscrow = new BN(0);
		let actualNewOwnerBalanceFromEscrow = new BN(0);
		let expectedBalanceInEscrow = new BN(0);

		afterEach(()=> {
			distributedAmounts = {
				buyerAmount: new BN(0),
				sellerAmount: new BN(0),
				escrowAmount: new BN(0)
			}
		})
	
		describe("Common transfer", () => {

			beforeEach(async () => {
				await deployContracts();
				utils = UtilsBuilder
					.NEW()
					.ETH_ETH()
					.build(contractERC1155ERC721, contractVoucherKernel, contractCashier)

				const timestamp = await Utils.getCurrTimestamp()

				tokenSupplyKey = await utils.createOrder(OldSupplyOwner, timestamp, timestamp + helpers.SECONDS_IN_DAY, helpers.seller_deposit, helpers.QTY_10)
			
			})

			it("Should transfer voucher supply", async () => {

				let transferTx = await utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_10, {from: OldSupplyOwner.address});
							
				truffleAssert.eventEmitted(transferTx, 'TransferSingle', (ev) => {
					assert.equal(ev._from, OldSupplyOwner.address)
					assert.equal(ev._to, NewSupplyOwner.address)
					assert.equal(ev._id.toString(), tokenSupplyKey)
					assert.equal(ev._value.toString(), helpers.QTY_10)

					return true
				}, "TransferSingle not emitted")
				
			})

			it("[NEGATIVE] Should revert if owner tries to transfer voucher supply partially", async () => {

				await truffleAssert.reverts(
					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address}),
					truffleAssert.ErrorType.REVERT
				)
				
			})

			it("[NEGATIVE] Should revert if Attacker tries to transfer voucher supply", async () => {

				await truffleAssert.reverts(
					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_10, {from: Attacker.address}),
					truffleAssert.ErrorType.REVERT
				)
				
			})

			it("Should transfer batch voucher supply", async () => {

				let transferTx = await utils.safeBatchTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, [tokenSupplyKey], [helpers.QTY_10], {from: OldSupplyOwner.address});
							
				truffleAssert.eventEmitted(transferTx, 'TransferBatch', (ev) => {

					assert.equal(ev._from, OldSupplyOwner.address)
					assert.equal(ev._to, NewSupplyOwner.address)
					assert.equal(JSON.stringify(ev._ids), JSON.stringify([new BN(tokenSupplyKey)]))
					assert.equal(JSON.stringify(ev._values), JSON.stringify([new BN(helpers.QTY_10)]))

					return true
				}, "TransferSingle not emitted")

			})

			it("[NEGATIVE] Should revert if owner tries to transfer voucher supply batch partially", async () => {

				await truffleAssert.reverts(
					utils.safeBatchTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, [tokenSupplyKey], [helpers.QTY_1], {from: OldSupplyOwner.address}),
					truffleAssert.ErrorType.REVERT
				)

			})

			it("[NEGATIVE] Should revert if Attacker tries to transfer batch voucher supply", async () => {

				await truffleAssert.reverts(
					utils.safeBatchTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, [tokenSupplyKey], [helpers.QTY_10], {from: Attacker.address}),
					truffleAssert.ErrorType.REVERT
				)

			})

		})

		describe("ETH_ETH", () => {

			beforeEach(async () => {

				await deployContracts();
				
				utils = UtilsBuilder
					.NEW()
					.ETH_ETH()
					.build(contractERC1155ERC721, contractVoucherKernel, contractCashier)

				tokenSupplyKey = await utils.createOrder(OldSupplyOwner, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.seller_deposit, helpers.QTY_1)
			})

			it("Should update escrow amounts after transfer", async () => {

				expectedBalanceInEscrow = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_1))
				
				actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(OldSupplyOwner.address)
				actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(NewSupplyOwner.address)

				assert.isTrue(actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow), "Old owner balance from escrow does not match")
				assert.isTrue(actualNewOwnerBalanceFromEscrow.eq(ZERO), "New owner balance from escrow does not match")

				utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address}),

				actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(OldSupplyOwner.address)
				actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(NewSupplyOwner.address)

				assert.isTrue(actualOldOwnerBalanceFromEscrow.eq(ZERO), "Old owner balance from escrow does not match")
				assert.isTrue(actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow), "New owner balance from escrow does not match")
			
			})

			it("Should finalize 1 voucher to ensure payments are sent to the new owner", async () => {

				const expectedBuyerAmount = new BN(helpers.buyer_deposit) // 0.04
				const expectedSellerAmount = new BN(helpers.seller_deposit).add(new BN(helpers.product_price)) // 0.35
				const expectedEscrowAmount = new BN(0) // 0

				utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
				
				const voucherID = await utils.commitToBuy(Buyer, NewSupplyOwner, tokenSupplyKey)

				await utils.redeem(voucherID, Buyer.address)

				await timemachine.advanceTimeSeconds(60)
				await utils.finalize(voucherID, Deployer.address)

				let withdrawTx = await utils.withdraw(voucherID, Deployer.address);

				truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
					utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', Buyer.address, NewSupplyOwner.address)
					return true
				}, "Amounts not distributed successfully")

				assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
				assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
				assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')

			})

			it("New owner should be able to COF", async () => {

				utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
				
				const voucherID = await utils.commitToBuy(Buyer, NewSupplyOwner, tokenSupplyKey)

				await utils.redeem(voucherID, Buyer.address)

				await utils.cancel(voucherID, NewSupplyOwner.address)
			})

			it("[NEGATIVE] Old owner should not be able to COF", async () => {

				utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
				
				const voucherID = await utils.commitToBuy(Buyer, NewSupplyOwner, tokenSupplyKey)

				await utils.redeem(voucherID, Buyer.address)

				await truffleAssert.reverts(
					utils.cancel(voucherID, OldSupplyOwner.address),
					truffleAssert.ErrorType.REVERT
				)
			})

		})

		describe("[WITH PERMIT]", () => {

			describe("ETH_TKN", () => {

                let balanceBuyerFromDeposits = new BN(0)

                let balanceSellerFromDeposits = new BN(0)

                let escrowBalanceFromDeposits = new BN(0)

                let cashierPaymentLeft = new BN(0)
				let cashierDepositLeft = new BN(0)
				
				beforeEach(async () => {

					await deployContracts();
					
					utils = UtilsBuilder
						.NEW()
						.ERC20withPermit()
						.ETH_TKN()
						.build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)

					const timestamp = await Utils.getCurrTimestamp()

					const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_1))

					await utils.mintTokens('contractBSNTokenDeposit', OldSupplyOwner.address, tokensToMint);
					await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, helpers.buyer_deposit);

					tokenSupplyKey = await utils.createOrder(
						OldSupplyOwner,
						timestamp,
						timestamp + helpers.SECONDS_IN_DAY,
						helpers.seller_deposit,
						helpers.QTY_1
					)
				
				})

				async function getBalancesDepositToken() {

                    balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Buyer.address)
                    balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(NewSupplyOwner.address)
                    escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Deployer.address)
					cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(utils.contractCashier.address)
					
                }

				it("Should finalize 1 voucher to ensure payments are sent to the new owner", async () => {

					const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerPrice = new BN(helpers.product_price) //// 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                    const expectedEscrowAmountDeposit = new BN(0)
					
					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})

					const voucherID = await utils.commitToBuy(
                        Buyer,
                        NewSupplyOwner,
                        tokenSupplyKey
					)

                    await utils.redeem(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    let withdrawTx = await utils.withdraw(voucherID, Deployer.address);

                    await getBalancesDepositToken();

                    // Payment should have been sent to seller
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, NewSupplyOwner.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedSellerPrice))

                        return true
                    }, "Event LogWithdrawal was not emitted")

                    //Deposits
                    assert.isTrue(balanceBuyerFromDeposits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
                    assert.isTrue(balanceSellerFromDeposits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
                    assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

                    //Cashier Should be Empty
                    assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
                    assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

                    truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
				})

				it("New owner should be able to COF", async () => {

					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
					
					const voucherID = await utils.commitToBuy(Buyer, NewSupplyOwner, tokenSupplyKey)

					await utils.redeem(voucherID, Buyer.address)

					await utils.cancel(voucherID, NewSupplyOwner.address)
				})

				it("[NEGATIVE] Old owner should not be able to COF", async () => {

					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
					
					const voucherID = await utils.commitToBuy(Buyer, NewSupplyOwner, tokenSupplyKey)

					await utils.redeem(voucherID, Buyer.address)

					await truffleAssert.reverts(
						utils.cancel(voucherID, OldSupplyOwner.address),
						truffleAssert.ErrorType.REVERT
					)
				})
				
			})

			describe("TKN_TKN", () => {

				let balanceBuyerFromPayment = new BN(0)
                let balanceBuyerFromDeposits = new BN(0)

                let balanceSellerFromPayment = new BN(0)
                let balanceSellerFromDeposits = new BN(0)

                let escrowBalanceFromPayment = new BN(0)
                let escrowBalanceFromDeposits = new BN(0)

                let cashierPaymentLeft = new BN(0)
                let cashierDepositLeft = new BN(0)

				beforeEach(async () => {

					await deployContracts();
				
					utils = UtilsBuilder
						.NEW()
						.ERC20withPermit()
						.TKN_TKN()
						.build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)
				
					const timestamp = await Utils.getCurrTimestamp()

					const supplyQty = 1
					const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(supplyQty))

					await utils.mintTokens('contractBSNTokenDeposit', OldSupplyOwner.address, tokensToMint);
					await utils.mintTokens('contractBSNTokenPrice', Buyer.address, helpers.product_price);
					await utils.mintTokens('contractBSNTokenDeposit', Buyer.address, helpers.buyer_deposit);

					tokenSupplyKey = await utils.createOrder(
						OldSupplyOwner,
						timestamp, 
						timestamp + helpers.SECONDS_IN_DAY,
						helpers.seller_deposit,
						supplyQty
					)
				
				})

				async function getBalancesFromPiceTokenAndDepositToken() {

                    balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(Buyer.address)
                    balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Buyer.address)

                    balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(NewSupplyOwner.address)
                    balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(NewSupplyOwner.address)

                    escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(Deployer.address)
                    escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Deployer.address)

                    cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(utils.contractCashier.address)
                    cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(utils.contractCashier.address)
				
				}
				
				it("Should finalize 1 voucher to ensure payments are sent to the new owner", async () => {

					const expectedBuyerPrice = new BN(0) 
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerPrice = new BN(helpers.product_price) //// 0.3
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
                    const expectedEscrowAmountDeposit = new BN(0) 
                    const expectedEscrowAmountPrice = new BN(0)
					
					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
					
					voucherID = await utils.commitToBuy(Buyer, NewSupplyOwner, tokenSupplyKey)
					
					await utils.redeem(voucherID, Buyer.address)

					await timemachine.advanceTimeSeconds(60)
					await utils.finalize(voucherID, Deployer.address)
					
					const withdrawTx = await utils.withdraw(voucherID, Deployer.address);

					await getBalancesFromPiceTokenAndDepositToken();

					//Payments 
					assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
					assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
					assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");

					//Deposits
					assert.isTrue(balanceBuyerFromDeposits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
					assert.isTrue(balanceSellerFromDeposits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
					assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");

					//Cashier Should be Empty
					assert.isTrue(cashierPaymentLeft.eq(ZERO), "Cashier Contract is not empty");
					assert.isTrue(cashierDepositLeft.eq(ZERO), "Cashier Contract is not empty");

					truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
						return true
					}, "Event LogAmountDistribution was not emitted")
	
				})

				it("New owner should be able to COF", async () => {

					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
					
					const voucherID = await utils.commitToBuy(Buyer, NewSupplyOwner, tokenSupplyKey)
	
					await utils.redeem(voucherID, Buyer.address)
	
					await utils.cancel(voucherID, NewSupplyOwner.address)
				})
	
				it("[NEGATIVE] Old owner should not be able to COF", async () => {
	
					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
					
					const voucherID = await utils.commitToBuy(Buyer, NewSupplyOwner, tokenSupplyKey)
	
					await utils.redeem(voucherID, Buyer.address)
	
					await truffleAssert.reverts(
						utils.cancel(voucherID, OldSupplyOwner.address),
						truffleAssert.ErrorType.REVERT
					)
				})

			})

			describe("TKN_ETH", () => {
				let balanceBuyerFromPayment = new BN(0)
                let balanceSellerFromPayment = new BN(0)
                let escrowBalanceFromPayment = new BN(0)

                let cashierPaymentLeft = new BN(0)
				let cashierDepositLeft = new BN(0)
				
				beforeEach(async () => {

					await deployContracts();

                    utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .TKN_ETH()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, '')

                    const timestamp = await Utils.getCurrTimestamp()

                    await utils.mintTokens('contractBSNTokenPrice', Buyer.address, helpers.product_price);

                    tokenSupplyKey = await utils.createOrder(
                        OldSupplyOwner,
                        timestamp,
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        helpers.QTY_1
                    )
				})

				async function getBalancesPriceToken() {
                    balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(Buyer.address)
                    balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(NewSupplyOwner.address)
                    escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(Deployer.address)
                    cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(utils.contractCashier.address)
                }
				
				it("Should update escrow amounts after transfer", async () => {

					expectedBalanceInEscrow = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_1))
					
					actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(OldSupplyOwner.address)
					actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(NewSupplyOwner.address)
	
					assert.isTrue(actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow), "Old owner balance from escrow does not match")
					assert.isTrue(actualNewOwnerBalanceFromEscrow.eq(ZERO), "New owner balance from escrow does not match")
	
					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
	
					actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(OldSupplyOwner.address)
					actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(NewSupplyOwner.address)
	
					assert.isTrue(actualOldOwnerBalanceFromEscrow.eq(ZERO), "Old owner balance from escrow does not match")
					assert.isTrue(actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow), "New owner balance from escrow does not match")
				})

				it("Should finalize 1 voucher to ensure payments are sent to the new owner", async () => {

					const expectedBuyerPrice = new BN(0)
                    const expectedSellerPrice = new BN(helpers.product_price) // 0.3
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit) // 0.04
                    const expectedSellerDeposit = new BN(helpers.seller_deposit) // 0.05
					const expectedEscrowAmountDeposit = new BN(0)
					
					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})

					const voucherID = await utils.commitToBuy(
                        Buyer,
                        NewSupplyOwner,
                        tokenSupplyKey
                    )
                    await utils.redeem(voucherID, Buyer.address)

                    await timemachine.advanceTimeSeconds(60)
                    await utils.finalize(voucherID, Deployer.address)

                    let withdrawTx = await utils.withdraw(voucherID, Deployer.address);

                    await getBalancesPriceToken();

                    // Payments in TKN
                    // Payment should have been sent to seller
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");

                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', Buyer.address, NewSupplyOwner.address)
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
				})

				it("New owner should be able to COF", async () => {

					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
					
					const voucherID = await utils.commitToBuy(Buyer, NewSupplyOwner, tokenSupplyKey)
	
					await utils.redeem(voucherID, Buyer.address)
	
					await utils.cancel(voucherID, NewSupplyOwner.address)
				})
	
				it("[NEGATIVE] Old owner should not be able to COF", async () => {
	
					utils.safeTransfer1155(OldSupplyOwner.address, NewSupplyOwner.address, tokenSupplyKey, helpers.QTY_1, {from: OldSupplyOwner.address})
					
					const voucherID = await utils.commitToBuy(Buyer, NewSupplyOwner, tokenSupplyKey)
	
					await utils.redeem(voucherID, Buyer.address)
	
					await truffleAssert.reverts(
						utils.cancel(voucherID, OldSupplyOwner.address),
						truffleAssert.ErrorType.REVERT
					)
				})

			})
		})
	})

	describe("VOUCHER TRANSFER", () => {

		let OldVoucherOwner = config.accounts.randomUser 
		let NewVoucherOwner = config.accounts.randomUser2 

		let actualOldOwnerBalanceFromEscrow = new BN(0);
		let actualNewOwnerBalanceFromEscrow = new BN(0);
		let expectedBalanceInEscrow = new BN(0);

		afterEach(() => {
			distributedAmounts = {
				buyerAmount: new BN(0),
				sellerAmount: new BN(0),
				escrowAmount: new BN(0)
			}
	
			actualOldOwnerBalanceFromEscrow = new BN(0);
			actualNewOwnerBalanceFromEscrow = new BN(0);
			expectedBalanceInEscrow = new BN(0);
		})

		describe("Common transfer", () => {

			before(async () => {

				await deployContracts();
				
				utils = UtilsBuilder
					.NEW()
					.ETH_ETH()
					.build(contractERC1155ERC721, contractVoucherKernel, contractCashier)

				tokenSupplyKey = await utils.createOrder(Seller, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.seller_deposit, helpers.QTY_10)
			})

			it("Should transfer a voucher", async () => {

				voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)

				let transferTx = await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address})

				truffleAssert.eventEmitted(transferTx, 'Transfer', (ev) => {

					assert.equal(ev._from, OldVoucherOwner.address)
					assert.equal(ev._to, NewVoucherOwner.address)
					assert.equal(ev._tokenId.toString(), voucherID)

					return true
				}, "Transfer not emitted")
			})
		})

		describe("ETH_ETH", async () => {

			beforeEach(async () => {

				await deployContracts();
				
				utils = UtilsBuilder
					.NEW()
					.ETH_ETH()
					.build(contractERC1155ERC721, contractVoucherKernel, contractCashier)

				tokenSupplyKey = await utils.createOrder(Seller, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.seller_deposit, helpers.QTY_10)
			})

			it("Should update escrow amounts after transfer", async () => {
				
				expectedBalanceInEscrow = new BN(helpers.product_price).add(new BN(helpers.buyer_deposit))
				voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)

				actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(OldVoucherOwner.address)
				actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(NewVoucherOwner.address)

				assert.isTrue(actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow), "Old owner balance from escrow does not match")
				assert.isTrue(actualNewOwnerBalanceFromEscrow.eq(ZERO), "New owner balance from escrow does not match")

				await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address})

				actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(OldVoucherOwner.address)
				actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(NewVoucherOwner.address)

				assert.isTrue(actualOldOwnerBalanceFromEscrow.eq(ZERO), "Old owner balance from escrow does not match")
				assert.isTrue(actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow), "New owner balance from escrow does not match")
			})

			it("Should finalize 1 voucher to ensure payments are sent to the new owner", async () => {

				const expectedBuyerAmount = new BN(helpers.buyer_deposit).add(new BN(helpers.product_price)).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.3 + 0.04 + 0.025
				const expectedSellerAmount = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
				const expectedEscrowAmount = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
				
				voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)

				await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address})
				
				await utils.refund(voucherID, NewVoucherOwner.address)
				await utils.complain(voucherID, NewVoucherOwner.address)
				await utils.cancel(voucherID, Seller.address)
				await utils.finalize(voucherID, Deployer.address)
				
				const withdrawTx = await utils.withdraw(voucherID, Deployer.address);

				truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
					utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', NewVoucherOwner.address, Seller.address)
					return true
				}, "Amounts not distributed successfully")

				assert.isTrue(distributedAmounts.buyerAmount.eq(expectedBuyerAmount), 'Buyer Amount is not as expected')
				assert.isTrue(distributedAmounts.sellerAmount.eq(expectedSellerAmount), 'Seller Amount is not as expected')
				assert.isTrue(distributedAmounts.escrowAmount.eq(expectedEscrowAmount), 'Escrow Amount is not as expected')
			})

			it("[NEGATIVE] Old owner should not be able to interact with the voucher", async () => {

				voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)

				await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address})
				
				await truffleAssert.reverts(
					utils.redeem(voucherID, OldVoucherOwner.address),
					truffleAssert.ErrorType.REVERT
				)

				await truffleAssert.reverts(
					utils.refund(voucherID, OldVoucherOwner.address),
					truffleAssert.ErrorType.REVERT
				)

			})

			it("[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer", async () => {

				voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)

				await truffleAssert.reverts(
					utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: Attacker.address}),
					truffleAssert.ErrorType.REVERT
				)
			})
		})

		describe("[WITH PERMIT]", () => {

			describe("ETH_TKN", () => {
                let balanceBuyerFromDeposits = new BN(0)
                let balanceSellerFromDeposits = new BN(0)
                let escrowBalanceFromDeposits = new BN(0)

                let cashierPaymentLeft = new BN(0)
                let cashierDepositLeft = new BN(0)
			

				async function getBalancesDepositToken() {
                    balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(NewVoucherOwner.address)
                    balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Seller.address)
                    escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Deployer.address)
                    cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(utils.contractCashier.address)
				}
				
				beforeEach(async () => {

					await deployContracts();

                    utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .ETH_TKN()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)

                    const timestamp = await Utils.getCurrTimestamp()

                    const supplyQty = 1
                    const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(supplyQty))

                    await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMint);
                    await utils.mintTokens('contractBSNTokenDeposit', OldVoucherOwner.address, helpers.buyer_deposit);

                    tokenSupplyKey = await utils.createOrder(
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
                    balanceBuyerFromDeposits = new BN(0)

                    balanceSellerFromPayment = new BN(0)
                    balanceSellerFromDeposits = new BN(0)

                    escrowBalanceFromPayment = new BN(0)
                    escrowBalanceFromDeposits = new BN(0)

                    cashierPaymentLeft = new BN(0)
                    cashierDepositLeft = new BN(0)

                    const isPaused = await contractCashier.paused();
                    if (isPaused) {
                        await contractCashier.unpause();
                    }
				
				})
				
				it("Should update escrow amounts after transfer", async () => {

					expectedBalanceInEscrow = new BN(helpers.product_price)
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)

					actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(OldVoucherOwner.address)
					actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(NewVoucherOwner.address)
	
					assert.isTrue(actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow), "Old owner balance from escrow does not match")
					assert.isTrue(actualNewOwnerBalanceFromEscrow.eq(ZERO), "New owner balance from escrow does not match")
	
					await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address})
				
					actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(OldVoucherOwner.address)
					actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(NewVoucherOwner.address)
	
					assert.isTrue(actualOldOwnerBalanceFromEscrow.eq(ZERO), "Old owner balance from escrow does not match")
					assert.isTrue(actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow), "New owner balance from escrow does not match")
				})
	
				it("Should finalize 1 voucher to ensure payments are sent to the new owner", async () => {
					
                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
					
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)
	
					await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address})
					
					await utils.refund(voucherID, NewVoucherOwner.address)
					await utils.complain(voucherID, NewVoucherOwner.address)
					await utils.cancel(voucherID, Seller.address)
					await utils.finalize(voucherID, Deployer.address)
					
					const withdrawTx = await utils.withdraw(voucherID, Deployer.address);

					await getBalancesDepositToken();
					
					 // Payment should have been returned to buyer
					 truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {

                        assert.equal(ev._payee, NewVoucherOwner.address, "Incorrect Payee")
                        assert.isTrue(ev._payment.eq(expectedBuyerPrice))
                        
                        return true
					}, "Event LogAmountDistribution was not emitted")
					
					  //Deposits
					  assert.isTrue(balanceBuyerFromDeposits.eq(expectedBuyerDeposit), "NewVoucherOwner did not get expected tokens from DepositTokenContract");
					  assert.isTrue(balanceSellerFromDeposits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
					  assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Escrow did not get expected tokens from DepositTokenContract");
  
					  //Cashier Should be Empty
					  assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
					  assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");
	
					truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
						utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_to', NewVoucherOwner.address, Seller.address)
						return true
					}, "Amounts not distributed successfully")
	
				})
	
				it("[NEGATIVE] Old owner should not be able to interact with the voucher", async () => {
	
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)
	
					await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address})
					
					await truffleAssert.reverts(
						utils.redeem(voucherID, OldVoucherOwner.address),
						truffleAssert.ErrorType.REVERT
					)
	
					await truffleAssert.reverts(
						utils.refund(voucherID, OldVoucherOwner.address),
						truffleAssert.ErrorType.REVERT
					)
	
				})
	
				it("[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer", async () => {
	
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)
	
					await truffleAssert.reverts(
						utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: Attacker.address}),
						truffleAssert.ErrorType.REVERT
					)
				})

			})

			describe("TKN_TKN", () => {

				let balanceBuyerFromPayment = new BN(0)
                let balanceBuyerFromDeposits = new BN(0)

                let balanceSellerFromPayment = new BN(0)
                let balanceSellerFromDeposits = new BN(0)

                let escrowBalanceFromPayment = new BN(0)
                let escrowBalanceFromDeposits = new BN(0)

                let cashierPaymentLeft = new BN(0)
                let cashierDepositLeft = new BN(0)


                async function getBalancesFromPiceTokenAndDepositToken() {
                    balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(NewVoucherOwner.address)
                    balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(NewVoucherOwner.address)

                    balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(Seller.address)
                    balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Seller.address)

                    escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(Deployer.address)
                    escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(Deployer.address)

                    cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(utils.contractCashier.address)
					cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(utils.contractCashier.address)
                }

				beforeEach(async () => {

					await deployContracts();

					utils = UtilsBuilder
                    .NEW()
                    .ERC20withPermit()
                    .TKN_TKN()
                    .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)
                 
					const timestamp = await Utils.getCurrTimestamp()

					const supplyQty = 1
					const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(supplyQty))

					await utils.mintTokens('contractBSNTokenDeposit', Seller.address, tokensToMint);
					await utils.mintTokens('contractBSNTokenPrice', OldVoucherOwner.address, helpers.product_price);
					await utils.mintTokens('contractBSNTokenDeposit', OldVoucherOwner.address, helpers.buyer_deposit);

					tokenSupplyKey = await utils.createOrder(
						Seller,
						timestamp, 
						timestamp + helpers.SECONDS_IN_DAY,
						helpers.seller_deposit,
						supplyQty
					)
				})

				it("Should finalize 1 voucher to ensure payments are sent to the new owner", async () => {
	
					const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerPrice = new BN(0)
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountPrice = new BN(0)
					
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)

					await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address})
					
					await utils.refund(voucherID, NewVoucherOwner.address)
					await utils.complain(voucherID, NewVoucherOwner.address)
					await utils.cancel(voucherID, Seller.address)
					await utils.finalize(voucherID, Deployer.address)
					
					const withdrawTx = await utils.withdraw(voucherID, Deployer.address);

					await getBalancesFromPiceTokenAndDepositToken();
				
					//Payments 
					assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PriceTokenContract");
					assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PriceTokenContract");
					assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowAmountPrice), "Escrow did not get expected tokens from PriceTokenContract");
					
					//Deposits
					assert.isTrue(balanceBuyerFromDeposits.eq(expectedBuyerDeposit), "Buyer did not get expected tokens from DepositTokenContract");
					assert.isTrue(balanceSellerFromDeposits.eq(expectedSellerDeposit), "Seller did not get expected tokens from DepositTokenContract");
					assert.isTrue(escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit), "Buyer did not get expected tokens from DepositTokenContract");

					//Cashier Should be Empty
					assert.isTrue(cashierPaymentLeft.eq(new BN(0)), "Cashier Contract is not empty");
					assert.isTrue(cashierDepositLeft.eq(new BN(0)), "Cashier Contract is not empty");

					truffleAssert.eventEmitted(withdrawTx, 'LogAmountDistribution', (ev) => {
                        return true
                    }, "Event LogAmountDistribution was not emitted")
				})
	
				it("[NEGATIVE] Old owner should not be able to interact with the voucher", async () => {
	
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)
	
					await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address})
					
					await truffleAssert.reverts(
						utils.redeem(voucherID, OldVoucherOwner.address),
						truffleAssert.ErrorType.REVERT
					)
	
					await truffleAssert.reverts(
						utils.refund(voucherID, OldVoucherOwner.address),
						truffleAssert.ErrorType.REVERT
					)
	
				})
	
				it("[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer", async () => {
	
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)
	
					await truffleAssert.reverts(
						utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: Attacker.address}),
						truffleAssert.ErrorType.REVERT
					)
				})
			
			})

			describe("TKN_ETH", () => {

				let balanceBuyerFromPayment = new BN(0)
                let balanceSellerFromPayment = new BN(0)
                let escrowBalanceFromPayment = new BN(0)

                let cashierPaymentLeft = new BN(0)
				let cashierDepositLeft = new BN(0)
				
				beforeEach(async () => {

					await deployContracts();

					utils = UtilsBuilder
                        .NEW()
                        .ERC20withPermit()
                        .TKN_ETH()
                        .build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, '')

                    const timestamp = await Utils.getCurrTimestamp()

                    await utils.mintTokens('contractBSNTokenPrice', OldVoucherOwner.address, helpers.product_price);

                    tokenSupplyKey = await utils.createOrder(
                        Seller,
                        timestamp,
                        timestamp + helpers.SECONDS_IN_DAY,
                        helpers.seller_deposit,
                        helpers.QTY_1
					)
					
				})

				async function getBalancesPriceToken() {
                    balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(NewVoucherOwner.address)
                    balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(Seller.address)
                    escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(Deployer.address)
                    cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(utils.contractCashier.address)
                }

				it("Should update escrow amounts after transfer", async () => {

					expectedBalanceInEscrow = new BN(helpers.buyer_deposit)
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)

					actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(OldVoucherOwner.address)
					actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(NewVoucherOwner.address)
	
					assert.isTrue(actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow), "Old owner balance from escrow does not match")
					assert.isTrue(actualNewOwnerBalanceFromEscrow.eq(ZERO), "New owner balance from escrow does not match")
	
					await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address}),
	
					actualOldOwnerBalanceFromEscrow = await contractCashier.escrow(OldVoucherOwner.address)
					actualNewOwnerBalanceFromEscrow = await contractCashier.escrow(NewVoucherOwner.address)
	
					assert.isTrue(actualOldOwnerBalanceFromEscrow.eq(ZERO), "Old owner balance from escrow does not match")
					assert.isTrue(actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow), "New owner balance from escrow does not match")
				})
	
				it("Should finalize 1 voucher to ensure payments are sent to the new owner", async () => {
					
                    const expectedBuyerPrice = new BN(helpers.product_price) // 0.3
                    const expectedSellerPrice = new BN(0)
                    const expectedEscrowPrice = new BN(0)
                    const expectedBuyerDeposit = new BN(helpers.buyer_deposit).add(new BN(helpers.seller_deposit).div(new BN(2))) // 0.065
                    const expectedSellerDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125
                    const expectedEscrowAmountDeposit = new BN(helpers.seller_deposit).div(new BN(4)) // 0.0125

					
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)
	
					await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address}),
					
					await utils.refund(voucherID, NewVoucherOwner.address)
					await utils.complain(voucherID, NewVoucherOwner.address)
					await utils.cancel(voucherID, Seller.address)
					await utils.finalize(voucherID, Deployer.address)
					
					const withdrawTx = await utils.withdraw(voucherID, Deployer.address);

					await getBalancesPriceToken();

					// Payments in TKN
                    // Payment should have been returned to buyer
                    assert.isTrue(balanceBuyerFromPayment.eq(expectedBuyerPrice), "Buyer did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(balanceSellerFromPayment.eq(expectedSellerPrice), "Seller did not get expected tokens from PaymentTokenContract");
                    assert.isTrue(escrowBalanceFromPayment.eq(expectedEscrowPrice), "Escrow did not get expected tokens from PaymentTokenContract");
                    
                    //Deposits in ETH
                    truffleAssert.eventEmitted(withdrawTx, 'LogWithdrawal', (ev) => {
                        utils.calcTotalAmountToRecipients(ev, distributedAmounts, '_payee', NewVoucherOwner.address, Seller.address)
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
	
				})
	
				it("[NEGATIVE] Old owner should not be able to interact with the voucher", async () => {
	
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)
	
					await utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: OldVoucherOwner.address}),
					
					await truffleAssert.reverts(
						utils.redeem(voucherID, OldVoucherOwner.address),
						truffleAssert.ErrorType.REVERT
					)
	
					await truffleAssert.reverts(
						utils.refund(voucherID, OldVoucherOwner.address),
						truffleAssert.ErrorType.REVERT
					)
	
				})
	
				it("[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer", async () => {
	
					voucherID = await utils.commitToBuy(OldVoucherOwner, Seller, tokenSupplyKey)
	
					await truffleAssert.reverts(
						utils.safeTransfer721(OldVoucherOwner.address, NewVoucherOwner.address, voucherID, {from: Attacker.address}),
						truffleAssert.ErrorType.REVERT
					)
				})
			})

		})

	})
});






