const helpers 		= require("../testHelpers/constants");
const timemachine 	= require('../testHelpers/timemachine');
const truffleAssert = require('truffle-assertions');
//later consider using https://github.com/OpenZeppelin/openzeppelin-test-helpers

const ERC1155ERC721 = artifacts.require("ERC1155ERC721");
const VoucherKernel = artifacts.require("VoucherKernel");
const Cashier 		= artifacts.require("Cashier");

contract("Voucher tests", async accounts => {
	let Seller 		= accounts[0];
	let Buyer 		= accounts[1];
	let Attacker 	= accounts[2];

    let contractERC1155ERC721, contractVoucherKernel, contractCashier;
    let promiseKey1, promiseKey2;
    let order1payment, order1depositSe, order1depositBu;
    let ordersCount;
    let tokenSupplyKey1, tokenSupplyKey2, tokenVoucherKey1, tokenVoucherKey2;

    before('setup contracts for tests', async () => {
        contractERC1155ERC721 	= await ERC1155ERC721.new();
        contractVoucherKernel 	= await VoucherKernel.new(contractERC1155ERC721.address);
        contractCashier 		= await Cashier.new(contractVoucherKernel.address);

        await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true');
        await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address);
        await contractVoucherKernel.setCashierAddress(contractCashier.address);

        console.log("Seller:   " + Seller);
        console.log("Buyer:    " + Buyer);
        console.log("Attacker: " + Attacker + "\n");
    })


	describe('Direct minting', function() {

		it("must fail: unauthorized minting ERC-1155", async () => {
			truffleAssert.reverts(contractERC1155ERC721.mint(Attacker, 666, 1, []), 
				truffleAssert.ErrorType.REVERT
			);
		});	

		it("must fail: unauthorized minting ERC-721", async () => {
			truffleAssert.reverts(contractERC1155ERC721.mint(Attacker, 666), 
				truffleAssert.ErrorType.REVERT
			);
		});	
	})


    describe('Promises (aka offers)', function() {

		it("adding one new promise", async () => {
			// console.log("helpers.PROMISE_VALID_FROM: ", helpers.PROMISE_VALID_FROM, ", helpers.PROMISE_VALID_TO: ", helpers.PROMISE_VALID_TO);
			await contractVoucherKernel.createAssetPromise(helpers.ASSET_TITLE, helpers.ASSET_PIN1, helpers.ASSET_QR1, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE1, helpers.PROMISE_DEPOSITSE1, helpers.PROMISE_DEPOSITBU1, helpers.PROMISE_CHALLENGE_PERIOD, helpers.PROMISE_CANCELORFAULT_PERIOD);

			promiseKey1 = await contractVoucherKernel.promiseKeys.call(0);
			
			assert.notEqual(promiseKey1, helpers.ZERO_ADDRESS, "promise not added");
		});	

		it("adding second new promise", async () => {
			await contractVoucherKernel.createAssetPromise(helpers.ASSET_TITLE2, helpers.ASSET_PIN2, helpers.ASSET_QR2, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE2, helpers.PROMISE_DEPOSITSE2, helpers.PROMISE_DEPOSITBU2, helpers.PROMISE_CHALLENGE_PERIOD, helpers.PROMISE_CANCELORFAULT_PERIOD);

			promiseKey2 = await contractVoucherKernel.promiseKeys.call(1);
			
			assert.notEqual(promiseKey2, helpers.ZERO_ADDRESS, "second promise not added");
		});				

		it("must fail: adding new promise with invalid validity", async () => {			
			truffleAssert.reverts(contractVoucherKernel.createAssetPromise(helpers.ASSET_TITLE, helpers.ASSET_PIN1, helpers.ASSET_QR1, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_FROM - 1, helpers.PROMISE_PRICE1, helpers.PROMISE_DEPOSITSE1, helpers.PROMISE_DEPOSITBU1, helpers.PROMISE_CHALLENGE_PERIOD, helpers.PROMISE_CANCELORFAULT_PERIOD),
				truffleAssert.ErrorType.REVERT
			);						
		});			
			  	
    })


    describe('Orders (aka supply tokens - ERC1155)', function() {

		it("adding one new order", async () => {			

			let txOrder = await contractCashier.requestCreateOrder(promiseKey1, helpers.ORDER_QUANTITY1, {from: Seller, to: contractCashier.address, value: helpers.PROMISE_DEPOSITSE1});

			//would need truffle-events as the event emitted is from a nested contract, so truffle-assert doesn't detect it
			// truffleAssert.eventEmitted(txOrder, 'LogOrderCreated', (ev) => {
			//     tokenSupplyKey = ev._tokenIdSupply;
			//     return ev._seller === Seller;
			// }, "order1 not created successfully");

			// //instead, we check that the escrow increased for the seller
			// let escrowAmount = await contractCashier.getEscrowAmount.call(Seller);
			// assert.isAbove(escrowAmount.toNumber(), 0, "seller's escrowed deposit should be more than zero");

			//move events from VoucherKernel to Cashier:
			truffleAssert.eventEmitted(txOrder, 'LogOrderCreated', (ev) => {
			    tokenSupplyKey1 = ev._tokenIdSupply;
			    return ev._seller === Seller;
			}, "order1 not created successfully");			
			
		});	

		it("adding second order", async () => {			

			let txOrder = await contractCashier.requestCreateOrder(promiseKey2, helpers.ORDER_QUANTITY2, {from: Seller, to: contractCashier.address, value: helpers.PROMISE_DEPOSITSE2});

			truffleAssert.eventEmitted(txOrder, 'LogOrderCreated', (ev) => {
			    tokenSupplyKey2 = ev._tokenIdSupply;
			    return ev._seller === Seller;
			}, "order2 not created successfully");			
			
		});	


		it("fill one order (aka buy a voucher)", async () => {			

			let txFillOrder = await contractCashier.requestVoucher(tokenSupplyKey1, Seller, {from: Buyer, to: contractCashier.address, value: helpers.PROMISE_PRICE1 + helpers.PROMISE_DEPOSITBU1});

// //Why .toString()? Because ... either that or chai: https://spectrum.chat/trufflesuite/truffle/truffle-5-test-equality-assertions-on-bns~59f4b31c-6547-4d8a-bee1-e3fc43f0bf0a

// //console.log("ev._tokenIdSupply: ", ev._tokenIdSupply); //<BN: 8000000000000000000000000000000100000000000000000000000000000000>
// //console.log("ev._tokenIdSupply.toNumber(): ", ev._tokenIdSupply.toNumber()); //Error: Number can only safely store up to 53 bits at assert (/usr/lib/node_modules/truffle/build/webpack:/~/bn.js/lib/bn.js:6:1)
// //console.log("ev._tokenIdSupply.toString(): ", ev._tokenIdSupply.toString()); //57896044618658097711785492504343953926975274699741220483192166611388333031424
// 			    return ev._tokenIdSupply.toString() == tokenSupplyKey.toString();
// 			}, "order1 not created successfully");

			//move events from VoucherKernel to Cashier:
			truffleAssert.eventEmitted(txFillOrder, 'LogVoucherDelivered', (ev) => {
			    tokenVoucherKey1 = ev._tokenIdVoucher;

			    return ev._tokenIdSupply.toString() === tokenSupplyKey1.toString();
			}, "order1 not filled successfully");		
			
		});	


		it("fill second order (aka buy a voucher)", async () => {			

			let txFillOrder = await contractCashier.requestVoucher(tokenSupplyKey2, Seller, {from: Buyer, to: contractCashier.address, value: helpers.PROMISE_PRICE2 + helpers.PROMISE_DEPOSITBU2});

			truffleAssert.eventEmitted(txFillOrder, 'LogVoucherDelivered', (ev) => {
			    tokenVoucherKey2 = ev._tokenIdVoucher;

			    return ev._tokenIdSupply.toString() === tokenSupplyKey2.toString();
			}, "order1 not filled successfully");		
			
		});			


		it("must fail: unauthorized adding of new order", async () => {			

			truffleAssert.reverts(contractCashier.requestCreateOrder(promiseKey1, helpers.ORDER_QUANTITY1, {from: Attacker, to: contractCashier.address, value: helpers.PROMISE_DEPOSITSE1}),
				truffleAssert.ErrorType.REVERT
			);			
			
		});		


		it("must fail: adding new order with incorrect value sent", async () => {			

			truffleAssert.reverts(contractCashier.requestCreateOrder(promiseKey1, helpers.ORDER_QUANTITY1, {from: Seller, to: contractCashier.address, value: 0}),
				truffleAssert.ErrorType.REVERT
			);			
			
		});	

		it("must fail: fill an order with incorrect value", async () => {			

			truffleAssert.reverts(contractCashier.requestVoucher(tokenSupplyKey1, Seller, {from: Buyer, to: contractCashier.address, value: 0}),
				truffleAssert.ErrorType.REVERT
			);			
			
		});					
			  	
    })    


    describe('Voucher tokens', function() {

		it("redeeming one voucher", async () => {
			let txRedeem = await contractVoucherKernel.redeem(tokenVoucherKey1, {from: Buyer});

			truffleAssert.eventEmitted(txRedeem, 'LogVoucherRedeemed', (ev) => {
			    return ev._tokenIdVoucher.toString() === tokenVoucherKey1.toString();
			}, "voucher not redeemed successfully");				
		});		


		it("mark non-redeemed voucher as expired", async () => {
			let statusBefore = await contractVoucherKernel.getVoucherStatus.call(tokenVoucherKey2);	//[1000.0000] = hex"80" = 128 = COMMITTED
			assert.equal(web3.utils.toHex(statusBefore[0]), web3.utils.numberToHex(128), "initial voucher status not as expected (COMMITTED)");

			await timemachine.advanceTimeSeconds(helpers.SECONDS_IN_DAY*365); //fast-forward for a year
			await contractVoucherKernel.triggerExpiration(tokenVoucherKey2);

			let statusAfter = await contractVoucherKernel.getVoucherStatus.call(tokenVoucherKey2);	//[1001.0000] = hex"90" = 144 = EXPIRED
			assert.equal(web3.utils.toHex(statusAfter[0]), web3.utils.numberToHex(144), "end voucher status not as expected (EXPIRED)");
		});


		it("mark voucher as finalized", async () => {
			let txFinalize = await contractVoucherKernel.triggerFinalizeVoucher(tokenVoucherKey1, {from: Buyer});

			truffleAssert.eventEmitted(txFinalize, 'LogFinalizeVoucher', (ev) => {
			    return ev._tokenIdVoucher.toString() === tokenVoucherKey1.toString();
			}, "voucher not finalized successfully");				
		});	

			  	
		it("must fail: unauthorized redemption", async () => {
			truffleAssert.reverts(contractVoucherKernel.redeem(tokenVoucherKey1, {from: Attacker}),
				truffleAssert.ErrorType.REVERT
			);				
		});		
				  	
    })       


    describe('Withdrawals', function() {

		it("withdraw the escrowed payment from one redeemed voucher", async () => {
			let escrowedBefore = await contractCashier.getEscrowAmount.call(Buyer);

			await contractCashier.withdraw([tokenVoucherKey1]);

			let escrowedAfter = await contractCashier.getEscrowAmount.call(Buyer);

			assert.isBelow(escrowedAfter.toNumber(), escrowedBefore.toNumber(), "escrowed amount not decreased");
		});		


		// it("must fail: unauthorized withdrawal of escrowed pool", async () => {
		// 	truffleAssert.reverts(contractCashier.withdrawPool({from: Attacker}),
		// 		truffleAssert.ErrorType.REVERT
		// 	);				
		// });			
			  	
    }) 

});






contract("Voucher tests - UNHAPPY PATH", async accounts => {    

	let Seller 		= accounts[0];
	let Buyer 		= accounts[1];
	let Attacker 	= accounts[2];

    let contractERC1155ERC721, contractVoucherKernel, contractCashier;
    let promiseKey1, promiseKey2;
    let order1payment, order1depositSe, order1depositBu;
    let ordersCount;
    let tokenSupplyKey1, tokenSupplyKey2, tokenVoucherKey1, tokenVoucherKey2;	

    beforeEach('setup contracts for tests', async () => {

        contractERC1155ERC721 	= await ERC1155ERC721.new();
        contractVoucherKernel 	= await VoucherKernel.new(contractERC1155ERC721.address);
        contractCashier 		= await Cashier.new(contractVoucherKernel.address);

        await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true');
        await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address);
        await contractVoucherKernel.setCashierAddress(contractCashier.address);


        //INIT
		await contractVoucherKernel.createAssetPromise(helpers.ASSET_TITLE, helpers.ASSET_PIN1, helpers.ASSET_QR1, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE1, helpers.PROMISE_DEPOSITSE1, helpers.PROMISE_DEPOSITBU1, helpers.PROMISE_CHALLENGE_PERIOD * helpers.SECONDS_IN_DAY, helpers.PROMISE_CANCELORFAULT_PERIOD * helpers.SECONDS_IN_DAY);

		promiseKey1 = await contractVoucherKernel.promiseKeys.call(0);

		// assert.notEqual(promiseKey1, helpers.ZERO_ADDRESS, "promise not added");

	

		let txOrder = await contractCashier.requestCreateOrder(promiseKey1, helpers.ORDER_QUANTITY1, {from: Seller, to: contractCashier.address, value: helpers.PROMISE_DEPOSITSE1});

		truffleAssert.eventEmitted(txOrder, 'LogOrderCreated', (ev) => {
		    tokenSupplyKey1 = ev._tokenIdSupply;
		    return ev._seller === Seller;
		}, "order1 not created successfully");	



		let txFillOrder = await contractCashier.requestVoucher(tokenSupplyKey1, Seller, {from: Buyer, to: contractCashier.address, value: helpers.PROMISE_PRICE1 + helpers.PROMISE_DEPOSITBU1});

		truffleAssert.eventEmitted(txFillOrder, 'LogVoucherDelivered', (ev) => {
		    tokenVoucherKey1 = ev._tokenIdVoucher;

		    return ev._tokenIdSupply.toString() === tokenSupplyKey1.toString();
		}, "order1 not created successfully"); 
		//\INIT
    })


	describe('Refunds ...', function() {

		it("refunding one voucher", async () => {
			let txRefund = await contractVoucherKernel.refund(tokenVoucherKey1, {from: Buyer});

			let statusAfter = await contractVoucherKernel.getVoucherStatus.call(tokenVoucherKey1);	//[1010.0000] = hex"A0" = 160 = REFUND
			assert.equal(web3.utils.toHex(statusAfter[0]), web3.utils.numberToHex(160), "end voucher status not as expected (REFUNDED)");			
		});	


		it("refunding one voucher, then complain", async () => {
			let txRefund = await contractVoucherKernel.refund(tokenVoucherKey1, {from: Buyer});
			let txComplain = await contractVoucherKernel.complain(tokenVoucherKey1, {from: Buyer});

			let statusAfter = await contractVoucherKernel.getVoucherStatus.call(tokenVoucherKey1);	//[1010.1000] = hex"A8" = 168 = REFUND_COMPLAIN
			assert.equal(web3.utils.toHex(statusAfter[0]), web3.utils.numberToHex(168), "end voucher status not as expected (REFUNDED_COMPLAINED)");			
		});	


		it("refunding one voucher, then complain, then cancel/fault", async () => {
			let txRefund = await contractVoucherKernel.refund(tokenVoucherKey1, {from: Buyer});
			let txComplain = await contractVoucherKernel.complain(tokenVoucherKey1, {from: Buyer});
			let txCoF = await contractVoucherKernel.cancelOrFault(tokenVoucherKey1, {from: Seller});

			let statusAfter = await contractVoucherKernel.getVoucherStatus.call(tokenVoucherKey1);	//[1010.1100] = hex"AC" = 172 = REFUND_COMPLAIN_COF
			assert.equal(web3.utils.toHex(statusAfter[0]), web3.utils.numberToHex(172), "end voucher status not as expected (REFUNDED_COMPLAINED_CANCELORFAULT)");			
		});		


		it("must fail: refund then try to redeem", async () => {
			let txRefund = await contractVoucherKernel.refund(tokenVoucherKey1, {from: Buyer});

			truffleAssert.reverts(contractVoucherKernel.redeem(tokenVoucherKey1, {from: Buyer}),
				truffleAssert.ErrorType.REVERT
			);				
		});	

    }) 


	describe('Cancel/Fault by the seller ...', function() {

		it("canceling one voucher", async () => {
			let txCoF = await contractVoucherKernel.cancelOrFault(tokenVoucherKey1, {from: Seller});

			let statusAfter = await contractVoucherKernel.getVoucherStatus.call(tokenVoucherKey1);	//[1000.0100] = hex"84" = 132 = CANCELORFAULT
			assert.equal(web3.utils.toHex(statusAfter[0]), web3.utils.numberToHex(132), "end voucher status not as expected (CANCELORFAULT)");			
		});		


		it("must fail: cancel/fault then try to redeem", async () => {
			let txCoF = await contractVoucherKernel.cancelOrFault(tokenVoucherKey1, {from: Seller});

			truffleAssert.reverts(contractVoucherKernel.redeem(tokenVoucherKey1, {from: Buyer}),
				truffleAssert.ErrorType.REVERT
			);				
		});	

    })     


	describe('Expirations (one universal test) ...', function() {

		it("Expired, then complain, then Cancel/Fault, then try to redeem", async () => {
			await timemachine.advanceTimeSeconds(helpers.SECONDS_IN_DAY*3); //fast-forward for three days
			await contractVoucherKernel.triggerExpiration(tokenVoucherKey1);

			let statusAfter = await contractVoucherKernel.getVoucherStatus.call(tokenVoucherKey1);	//[1001.0000] = hex"90" = 144 = EXPIRED			
			let txComplain = await contractVoucherKernel.complain(tokenVoucherKey1, {from: Buyer});

			statusAfter = await contractVoucherKernel.getVoucherStatus.call(tokenVoucherKey1);	//[1001.1000] = hex"98" = 152 = EXPIRED_COMPLAIN
			assert.equal(web3.utils.toHex(statusAfter[0]), web3.utils.numberToHex(152), "end voucher status not as expected (EXPIRED_COMPLAINED)");			

			//in the same test, because the EVM time machine is funky ...
			let txCoF = await contractVoucherKernel.cancelOrFault(tokenVoucherKey1, {from: Seller});
			statusAfter = await contractVoucherKernel.getVoucherStatus.call(tokenVoucherKey1);	//[1001.1000] = hex"9C" = 156 = EXPIRED_COMPLAINED_CANCELORFAULT
			assert.equal(web3.utils.toHex(statusAfter[0]), web3.utils.numberToHex(156), "end voucher status not as expected (EXPIRED_COMPLAINED_CANCELORFAULT)");

			//in the same test, because the EVM time machine is funky ...
			truffleAssert.reverts(contractVoucherKernel.redeem(tokenVoucherKey1, {from: Buyer}),
				truffleAssert.ErrorType.REVERT
			);
		});    	

    })    

});