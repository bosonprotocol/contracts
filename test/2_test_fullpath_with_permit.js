const helpers 		= require("../testHelpers/constants");
const timemachine 	= require('../testHelpers/timemachine');
const truffleAssert = require('truffle-assertions');
//later consider using https://github.com/OpenZeppelin/openzeppelin-test-helpers

const ERC1155ERC721 = artifacts.require("ERC1155ERC721");
const VoucherKernel = artifacts.require("VoucherKernel");
const Cashier 		= artifacts.require("Cashier");
const BosonToken 	= artifacts.require('BosonToken');

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
const { product_price } = require("../testHelpers/constants");

contract("Voucher tests", async accounts => {
	let Deployer = config.accounts.deployer
	let Seller = config.accounts.seller
	let Buyer = config.accounts.buyer
	let Attacker = config.accounts.attacker

	let contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit;
    let tokenSupplyKey1, tokenSupplyKey2, tokenVoucherKey1, tokenVoucherKey2;
	const ONE_VOUCHER = 1
	const deadline = toWei(1)


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
	}

	describe('TOKEN SUPPLY CREATION (Voucher batch creation)', function () {

		const paymentMethods = {
			ETH_ETH: 1,
			ETH_TKN: 2,
			TKN_ETH: 3,
			TKN_TKN: 4,

		}

		before(async () => {
			await deployContracts();

			const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_10))
			await contractBSNTokenDeposit.mint(Seller.address, tokensToMint)
		})

		describe("ETH_ETH", () => { 
			it("Should create payment method ETH_ETH", async () => {
				const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))

				let txOrder = await contractCashier.requestCreateOrder_ETH_ETH(
					[
						helpers.PROMISE_VALID_FROM,
						helpers.PROMISE_VALID_TO,
						helpers.PROMISE_PRICE1,
						helpers.seller_deposit,
						helpers.PROMISE_DEPOSITBU1,
						helpers.ORDER_QUANTITY1
					],
					{ from: Seller.address, value: txValue }
				);

				tokenSupplyKey1 = txOrder.logs[0].args._tokenIdSupply.toString()

				const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey1);

				assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.ETH_ETH, "Payment Method ETH_ETH not set correctly")
				assert.equal(paymentDetails.addressTokenPrice.toString(), helpers.ZERO_ADDRESS, "ETH_ETH Method Price Token Address mismatch")
				assert.equal(paymentDetails.addressTokenDeposits.toString(), helpers.ZERO_ADDRESS, "ETH_ETH Method Deposit Token Address mismatch")
			})

			it("[NEGATIVE] Should fail if additional token address is provided", async () => {
				const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))

				await truffleAssert.fails(
					contractCashier.requestCreateOrder_ETH_ETH(
						contractBSNTokenDeposit.address,
						[
							helpers.PROMISE_VALID_FROM,
							helpers.PROMISE_VALID_TO,
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

				it("Should create payment method ETH_TKN", async () => {
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

					let txOrder = await contractCashier.requestCreateOrder_ETH_TKN_WithPermit(
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
					);

					tokenSupplyKey1 = txOrder.logs[0].args._tokenIdSupply.toString()

					const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey1);

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

			describe("TKN ETH", () => {

				it("Should create payment method TKN_ETH", async () => {
					const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))

					let txOrder = await contractCashier.requestCreateOrder_TKN_ETH_WithPermit(
						contractBSNTokenPrice.address,
						[
							helpers.PROMISE_VALID_FROM,
							helpers.PROMISE_VALID_TO,
							helpers.PROMISE_PRICE1,
							helpers.seller_deposit,
							helpers.PROMISE_DEPOSITBU1,
							helpers.ORDER_QUANTITY1
						],
						{ from: Seller.address, value: txValue.toString() }
					);

					tokenSupplyKey1 = txOrder.logs[0].args._tokenIdSupply.toString()

					const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey1);

					assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.TKN_ETH, "Payment Method TKN_ETH not set correctly")
					assert.equal(paymentDetails.addressTokenPrice.toString(), contractBSNTokenPrice.address, "TKN_ETH Method Price Token Address mismatch")
					assert.equal(paymentDetails.addressTokenDeposits.toString(), helpers.ZERO_ADDRESS, "TKN_ETH Method Deposit Token Address mismatch")
				})

				it("[NEGATIVE] Should fail if price token contract address is not proviced", async () => {
					const txValue = new BN(helpers.seller_deposit).mul(new BN(ONE_VOUCHER))

					await truffleAssert.fails(
						contractCashier.requestCreateOrder_TKN_ETH_WithPermit(
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
						contractCashier.requestCreateOrder_TKN_ETH_WithPermit(
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

			describe("TKN TKN", () => {
				it("Should create payment method TKN_TKN", async () => {
					const txValue = new BN(helpers.seller_deposit).mul(new BN(helpers.QTY_1))
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


					let txOrder = await contractCashier.requestCreateOrder_TKN_TKN_WithPermit(
						contractBSNTokenPrice.address,
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
					);

					tokenSupplyKey1 = txOrder.logs[0].args._tokenIdSupply.toString()

					const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey1);

					assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.TKN_TKN, "Payment Method TKN_TKN not set correctly")
					assert.equal(paymentDetails.addressTokenPrice.toString(), contractBSNTokenPrice.address, "TKN_TKN Method Price Token Address mismatch")
					assert.equal(paymentDetails.addressTokenDeposits.toString(), contractBSNTokenDeposit.address, "TKN_TKN Method Deposit Token Address mismatch")
				})

				it("[NEGATIVE] Should fail if token price contract address is not proviced", async () => {
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

				it("[NEGATIVE] Should fail if token deposit contract address is not proviced", async () => {
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

				TOKEN_SUPPLY_ID = await utils.createOrder(Seller.address, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO)
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

			it("[NEGATIVE] Should not create order with incorrect депосит", async () => {
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
					const tokensToMintBuyer = new BN(product_price).mul(new BN(ORDER_QTY))

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

					const tokensToMintBuyer = new BN(product_price).mul(new BN(ORDER_QTY))

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
});






