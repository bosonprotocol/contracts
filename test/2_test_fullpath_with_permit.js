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

contract("Voucher tests", async accounts => {
	let Deployer = config.accounts.deployer
	let Seller = config.accounts.seller
	let Buyer = config.accounts.buyer
	let Attacker = config.accounts.attacker

	let contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit;
    let tokenSupplyKey1, tokenSupplyKey2, tokenVoucherKey1, tokenVoucherKey2;


	describe('Order Creation', function () {

		const paymentMethods = {
			ETH_ETH: 1,
			ETH_TKN: 2,
			TKN_ETH: 3,
			TKN_TKN: 4,

		}

		const zeroAddress = '0x0000000000000000000000000000000000000000';

		before(async () => {

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

			const orderQty = 4
			const tokensToMint = new BN(helpers.seller_deposit).mul(new BN(orderQty))
			await contractBSNTokenDeposit.mint(Seller.address, tokensToMint)

			console.log("Seller:   " + Seller);
			console.log("Buyer:    " + Buyer);
			console.log("Attacker: " + Attacker + "\n");
		})

		describe("ETH_ETH", () => { 
			it("Should create payment method ETH_ETH", async () => {
				const sellerDepoist = helpers.seller_deposit;
				const qty = 1
				const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))

				let txOrder = await contractCashier.requestCreateOrder_ETH_ETH(
					[
						helpers.PROMISE_VALID_FROM,
						helpers.PROMISE_VALID_TO,
						helpers.PROMISE_PRICE1,
						sellerDepoist,
						helpers.PROMISE_DEPOSITBU1,
						helpers.ORDER_QUANTITY1
					],
					{ from: Seller.address, value: txValue.toString() }
				);

				tokenSupplyKey1 = txOrder.logs[0].args._tokenIdSupply.toString()

				const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey1);

				assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.ETH_ETH, "Payment Method ETH_ETH not set correctly")
				assert.equal(paymentDetails.addressTokenPrice.toString(), zeroAddress, "ETH_ETH Method Price Token Address mismatch")
				assert.equal(paymentDetails.addressTokenDeposits.toString(), zeroAddress, "ETH_ETH Method Deposit Token Address mismatch")
			})

			it("Should should fail if additional token address is provided", async () => {
				const sellerDepoist = helpers.seller_deposit;
				const qty = 1
				const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))

				await truffleAssert.fails(
					contractCashier.requestCreateOrder_ETH_ETH(
						contractBSNTokenDeposit.address,
						[
							helpers.PROMISE_VALID_FROM,
							helpers.PROMISE_VALID_TO,
							helpers.PROMISE_PRICE1,
							sellerDepoist,
							helpers.PROMISE_DEPOSITBU1,
							helpers.ORDER_QUANTITY1
						],
						{ from: Seller.address, value: txValue.toString() }
					)
				);

			})

		})

		describe("[WITH PERMI]", () => {
			describe("ETH_TKN", () => {

				it("Should create payment method ETH_TKN", async () => {
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1
					const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
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
						txValue.toString(),
						deadline,
						v, r, s,
						[
							helpers.PROMISE_VALID_FROM,
							helpers.PROMISE_VALID_TO,
							helpers.PROMISE_PRICE1,
							sellerDepoist,
							helpers.PROMISE_DEPOSITBU1,
							helpers.ORDER_QUANTITY1
						],
						{ from: Seller.address }
					);

					tokenSupplyKey1 = txOrder.logs[0].args._tokenIdSupply.toString()

					const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey1);

					assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.ETH_TKN, "Payment Method ETH_TKN not set correctly")
					assert.equal(paymentDetails.addressTokenPrice.toString(), zeroAddress, "ETH_TKN Method Price Token Address mismatch")
					assert.equal(paymentDetails.addressTokenDeposits.toString(), contractBSNTokenDeposit.address, "ETH_TKN Method Deposit Token Address mismatch")
				})

				it("Should fail if token deposit address is not provided", async () => {
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1
					const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
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

					await truffleAssert.fails(
						contractCashier.requestCreateOrder_ETH_TKN_WithPermit(
							'',
							txValue.toString(),
							deadline,
							v, r, s,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								sellerDepoist,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						)
					)
				})

				it("Should revert if token deposit address is zero address", async () => {
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1
					const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
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
						contractCashier.requestCreateOrder_ETH_TKN_WithPermit(
							zeroAddress,
							txValue.toString(),
							deadline,
							v, r, s,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								sellerDepoist,
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
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1
					const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))


					let txOrder = await contractCashier.requestCreateOrder_TKN_ETH_WithPermit(
						contractBSNTokenPrice.address,
						[
							helpers.PROMISE_VALID_FROM,
							helpers.PROMISE_VALID_TO,
							helpers.PROMISE_PRICE1,
							sellerDepoist,
							helpers.PROMISE_DEPOSITBU1,
							helpers.ORDER_QUANTITY1
						],
						{ from: Seller.address, value: txValue.toString() }
					);

					tokenSupplyKey1 = txOrder.logs[0].args._tokenIdSupply.toString()

					const paymentDetails = await contractVoucherKernel.paymentDetails(tokenSupplyKey1);

					assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.TKN_ETH, "Payment Method TKN_ETH not set correctly")
					assert.equal(paymentDetails.addressTokenPrice.toString(), contractBSNTokenPrice.address, "TKN_ETH Method Price Token Address mismatch")
					assert.equal(paymentDetails.addressTokenDeposits.toString(), zeroAddress, "TKN_ETH Method Deposit Token Address mismatch")
				})

				it("Should fail if price token is not proviced", async () => {
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1
					const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))

					await truffleAssert.fails(
						contractCashier.requestCreateOrder_TKN_ETH_WithPermit(
							'',
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								sellerDepoist,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address, value: txValue.toString() }
						)
					);

				})

				it("Should fail if zero address for price token is not proviced", async () => {
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1

					await truffleAssert.reverts(
						contractCashier.requestCreateOrder_TKN_ETH_WithPermit(
							zeroAddress,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								sellerDepoist,
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
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1
					const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
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
							sellerDepoist,
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

				it("Should fail if price token is not proviced", async () => {
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1
					const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
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
								sellerDepoist,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						)
					);

				})

				it("Should fail if deposit token is not proviced", async () => {
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1
					const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
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
								sellerDepoist,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						)
					);

				})

				it("Should revert if zero address for price token is proviced", async () => {
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1
					const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
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
							zeroAddress,
							contractBSNTokenDeposit.address,
							txValue,
							deadline,
							v, r, s,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								sellerDepoist,
								helpers.PROMISE_DEPOSITBU1,
								helpers.ORDER_QUANTITY1
							],
							{ from: Seller.address }
						),
						truffleAssert.ErrorType.REVERT
					);

				})

				it("Should revert if zero address for deposit token is proviced", async () => {
					const sellerDepoist = helpers.seller_deposit;
					const qty = 1
					const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
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
							zeroAddress,
							txValue,
							deadline,
							v, r, s,
							[
								helpers.PROMISE_VALID_FROM,
								helpers.PROMISE_VALID_TO,
								helpers.PROMISE_PRICE1,
								sellerDepoist,
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


	describe.only("VOUCHER TESTS", () => {
		
		describe.only("[WITH PERMIT]", () => {
			const buyerDeposit = helpers.buyer_deposit;
			const sellerDepoist = helpers.seller_deposit;
			const qty = 1
			const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
			const deadline = toWei(1)
			let TOKEN_SUPPLY_ID;

			describe("ETH_TKN", async () => {

				beforeEach(async () => {
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

					const orderQty = 1;
					const tokensToMintSeller = new BN(helpers.seller_deposit).mul(new BN(orderQty))
					const tokensToMintBuyer = new BN(helpers.seller_deposit).mul(new BN(orderQty))

					await contractBSNTokenDeposit.mint(Seller.address, tokensToMintSeller)
					await contractBSNTokenDeposit.mint(Buyer.address, tokensToMintBuyer)

					utils = UtilsBuilder
						.NEW()
						.ERC20withPermit()
						.ETH_TKN()
						.build(contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBSNTokenPrice, contractBSNTokenDeposit)
				

					TOKEN_SUPPLY_ID = await utils.createOrder(
						Seller,
						helpers.PROMISE_VALID_FROM,
						helpers.PROMISE_VALID_TO,
						helpers.seller_deposit,
						qty
					)
				
				})

				it.only("Buyer Should buy a voucher", async () => {
					const nonce = await contractBSNTokenDeposit.nonces(Buyer.address);
					const digestDeposit = await getApprovalDigest(
						contractBSNTokenDeposit,
						Buyer.address,
						contractCashier.address,
						buyerDeposit.toString(),
						nonce,
						deadline
					)

					const { v, r, s } = ecsign(
						Buffer.from(digestDeposit.slice(2), 'hex'),
						Buffer.from(Buyer.pk.slice(2), 'hex'));

					const txFillOrder = await contractCashier.requestVoucher_ETH_TKN_WithPermit(
						TOKEN_SUPPLY_ID,
						Seller.address,
						buyerDeposit,
						deadline,
						v, r, s,
						{ from: Buyer.address, value: helpers.product_price.toString()}
					)

					let internalTx = (await truffleAssert.createTransactionResult(contractVoucherKernel, txFillOrder.tx))
					
					truffleAssert.eventEmitted(internalTx, 'LogVoucherDelivered', (ev) => {
						tokenVoucherKey1 = ev._tokenIdVoucher
						return ev._issuer === Seller.address;
					}, "order1 not created successfully");


					// assert.equal(paymentDetails.paymentMethod.toString(), paymentMethods.ETH_TKN, "Payment Method ETH_TKN not set correctly")
					// assert.equal(paymentDetails.addressTokenPrice.toString(), zeroAddress, "ETH_TKN Method Price Token Address mismatch")
					// assert.equal(paymentDetails.addressTokenDeposits.toString(), contractBSNTokenDeposit.address, "ETH_TKN Method Deposit Token Address mismatch")
				})
			})
		})
	})


	describe('[WITH PERMIT] ETH - TKN Orders (aka supply tokens - ERC1155)', function() {

		beforeEach('setup contracts for tests', async () => {

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
		
		})

		it("adding one new order / promise", async () => {	
			const tokensToMint = helpers.seller_deposit	
			await contractBSNTokenDeposit.mint(Seller.address, tokensToMint)

			const sellerDepoist = helpers.seller_deposit;
			const qty = 1
			const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
			const nonce = await contractBSNTokenDeposit.nonces(Seller.address);
			const deadline = toWei(1)
			
			const digest = await getApprovalDigest(
				contractBSNTokenDeposit,
				Seller.address,
				contractCashier.address,
				txValue.toString(),
				nonce,
				deadline
			)

			const supplyQty = 1
			const { v, r, s } = ecsign(
				Buffer.from(digest.slice(2), 'hex'),
				Buffer.from(Seller.pk.slice(2), 'hex'));

			let txOrder = await contractCashier.requestCreateOrder_TKN_TKN_WithPermit(
				contractBSNTokenPrice.address,
				contractBSNTokenDeposit.address,
				txValue.toString(),
				deadline,
				v, r, s,
				[
					helpers.PROMISE_VALID_FROM,
					helpers.PROMISE_VALID_TO, 
					helpers.PROMISE_PRICE1, 
					sellerDepoist, 
					helpers.PROMISE_DEPOSITBU1, 
					helpers.ORDER_QUANTITY1
				], 
				{ from: Seller.address }
			);

		
			truffleAssert.eventEmitted(txOrder, 'LogOrderCreated', (ev) => {
				tokenSupplyKey1 = ev._tokenIdSupply;
				return ev._seller === Seller.address;
			}, "order1 not created successfully");			

			const sellerBalance = await contractBSNTokenDeposit.balanceOf(Seller.address)
			const cashierBalance = await contractBSNTokenDeposit.balanceOf(contractCashier.address)

			assert.isTrue(sellerBalance.eq(new BN(tokensToMint).sub(new BN(sellerDepoist))), "seller balance is not as expected")
			assert.isTrue(cashierBalance.eq(new BN(sellerDepoist)), "cashier balance is not as expected")
			
		});	



		// it("fill one order (aka buy a voucher)", async () => {			

		// 	let txFillOrder = await contractCashier.requestVoucher(tokenSupplyKey1, Seller, {from: Buyer, to: contractCashier.address, value: helpers.PROMISE_PRICE1 + helpers.PROMISE_DEPOSITBU1});


		// 	truffleAssert.eventEmitted(txFillOrder, 'LogVoucherDelivered', (ev) => {
		// 	    tokenVoucherKey1 = ev._tokenIdVoucher;

		// 	    return ev._tokenIdSupply.toString() === tokenSupplyKey1.toString();
		// 	}, "order1 not filled successfully");		
			
		// });	


		// it("fill second order (aka buy a voucher)", async () => {			

		// 	let txFillOrder = await contractCashier.requestVoucher(tokenSupplyKey2, Seller, {from: Buyer, to: contractCashier.address, value: helpers.PROMISE_PRICE2 + helpers.PROMISE_DEPOSITBU2});

		// 	truffleAssert.eventEmitted(txFillOrder, 'LogVoucherDelivered', (ev) => {
		// 	    tokenVoucherKey2 = ev._tokenIdVoucher;

		// 	    return ev._tokenIdSupply.toString() === tokenSupplyKey2.toString();
		// 	}, "order1 not filled successfully");		
			
		// });			

		// it("must fail: adding new order with incorrect value sent", async () => {	

		// 	truffleAssert.reverts(contractCashier.requestCreateOrder([helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE1, helpers.PROMISE_DEPOSITSE1, helpers.PROMISE_DEPOSITBU1, helpers.ORDER_QUANTITY1], {from: Seller, to: contractCashier.address, value: 0}),
		// 		truffleAssert.ErrorType.REVERT
		// 	);			
			
		// });	

		// it("must fail: fill an order with incorrect value", async () => {			

		// 	truffleAssert.reverts(contractCashier.requestVoucher(tokenSupplyKey1, Seller, {from: Buyer, to: contractCashier.address, value: 0}),
		// 		truffleAssert.ErrorType.REVERT
		// 	);			
			
		// });					
				
	})

});






