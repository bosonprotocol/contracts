const helpers 		= require("../testHelpers/constants");
const timemachine 	= require('../testHelpers/timemachine');
const truffleAssert = require('truffle-assertions');
//later consider using https://github.com/OpenZeppelin/openzeppelin-test-helpers

const ERC1155ERC721 = artifacts.require("ERC1155ERC721");
const VoucherKernel = artifacts.require("VoucherKernel");
const Cashier 		= artifacts.require("Cashier");
const BosonToken 	= artifacts.require('BosonToken');

const BN = web3.utils.BN

const Utils = require('../testHelpers/utils')

const { ecsign } = require('ethereumjs-util');
const {
	PERMIT_TYPEHASH,
	toWei,
	getApprovalDigest
} = require('../testHelpers/permitUtils');
const { assert } = require("chai");

contract("Voucher tests", async accounts => {
	let Deployer = accounts[0] //0xD9995BAE12FEe327256FFec1e3184d492bD94C31
	let Deployer_PK = '0x7ab741b57e8d94dd7e1a29055646bafde7010f38a900f55bbd7647880faa6ee8'
	let Seller = accounts[1] //0xd4Fa489Eacc52BA59438993f37Be9fcC20090E39
	let Seller_PK = '0x2030b463177db2da82908ef90fa55ddfcef56e8183caf60db464bc398e736e6f';
	let Buyer = accounts[2] //0x760bf27cd45036a6C486802D30B5D90CfFBE31FE
	let Buyer_PK = '0x62ecd49c4ccb41a70ad46532aed63cf815de15864bc415c87d507afd6a5e8da2'
	let Attacker = accounts[3] //0x56A32fFf5E5A8B40d6A21538579fB8922DF5258c 
	let Attacker_PK = '0xf473040b1a83739a9c7cc1f5719fab0f5bf178f83314d98557c58aae1910e03a' 

	let contractERC1155ERC721, contractVoucherKernel, contractCashier, contractBosonTKN_Price, contractBosonTKN_Deposit;
    let tokenSupplyKey1, tokenSupplyKey2, tokenVoucherKey1, tokenVoucherKey2;

    beforeEach('setup contracts for tests', async () => {

		const timestamp = await Utils.getCurrTimestamp()
		helpers.PROMISE_VALID_FROM = timestamp
		helpers.PROMISE_VALID_TO = timestamp + 2 * helpers.SECONDS_IN_DAY;

        contractERC1155ERC721 	= await ERC1155ERC721.new();
        contractVoucherKernel 	= await VoucherKernel.new(contractERC1155ERC721.address);
		contractCashier 		= await Cashier.new(contractVoucherKernel.address);
		
		contractBosonTKN_Price = await BosonToken.new("BosonTokenPrice", "BPRC");
		contractBosonTKN_Deposit = await BosonToken.new("BosonTokenDeposit", "BDEP");


        await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true');
        await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address);
        await contractVoucherKernel.setCashierAddress(contractCashier.address);

        console.log("Seller:   " + Seller);
        console.log("Buyer:    " + Buyer);
        console.log("Attacker: " + Attacker + "\n");
	})
	
	

    describe('[WITH PERMIT] Orders (aka supply tokens - ERC1155)', function() {
		
		it("adding one new order / promise", async () => {	
			const tokensToMint = '52336000000000000'	
			await contractBosonTKN_Deposit.mint(Seller, tokensToMint)

			const sellerDepoist = helpers.seller_deposit;
			const qty = 1
			const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))
			const nonce = await contractBosonTKN_Deposit.nonces(Seller);
			const deadline = toWei(1)
			
			const digest = await getApprovalDigest(
				contractBosonTKN_Deposit,
				Seller,
				contractCashier.address,
				txValue.toString(),
				nonce,
				deadline
			)

			const { v, r, s } = ecsign(
				Buffer.from(digest.slice(2), 'hex'),
				Buffer.from(Seller_PK.slice(2), 'hex'));

			let txOrder = await contractCashier.requestCreateOrderTknTknWithPermit(
				contractBosonTKN_Price.address,
				contractBosonTKN_Deposit.address,
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
				{ from: Seller }
			);

		
			truffleAssert.eventEmitted(txOrder, 'LogOrderCreated', (ev) => {
			    tokenSupplyKey1 = ev._tokenIdSupply;
			    return ev._seller === Seller;
			}, "order1 not created successfully");			

			const sellerBalance = await contractBosonTKN_Deposit.balanceOf(Seller)
			const cashierBalance = await contractBosonTKN_Deposit.balanceOf(contractCashier.address)

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






