const helpers 		= require("../testHelpers/constants");
const timemachine 	= require('../testHelpers/timemachine');
const truffleAssert = require('truffle-assertions');
//later consider using https://github.com/OpenZeppelin/openzeppelin-test-helpers

const ERC1155ERC721 = artifacts.require("ERC1155ERC721");
const VoucherKernel = artifacts.require("VoucherKernel");
const Cashier 		= artifacts.require("Cashier");

const config = require('../testHelpers/config.json')

const Utils = require('../testHelpers/utils')
let snapshot;

contract("Voucher tests", async accounts => {
	let Seller = config.accounts.seller.address
	let Buyer = config.accounts.buyer.address
	let Attacker = config.accounts.attacker.address

    let contractERC1155ERC721, contractVoucherKernel, contractCashier;
    let promiseKey1, promiseKey2;
    let order1payment, order1depositSe, order1depositBu;
    let ordersCount;
    let tokenSupplyKey1, tokenSupplyKey2, tokenVoucherKey1, tokenVoucherKey2;

    before('setup contracts for tests', async () => {
		snapshot = await timemachine.takeSnapshot();

		const timestamp = await Utils.getCurrTimestamp()
		helpers.PROMISE_VALID_FROM = timestamp
		helpers.PROMISE_VALID_TO = timestamp + 2 * helpers.SECONDS_IN_DAY;

        contractERC1155ERC721 	= await ERC1155ERC721.new();
        contractVoucherKernel 	= await VoucherKernel.new(contractERC1155ERC721.address);
        contractCashier 		= await Cashier.new(contractVoucherKernel.address, contractERC1155ERC721.address);

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


//in the prototype, the creation of a promise is merged into creating an order
  //   describe('Promises (aka offers)', function() {

		// it("adding one new promise", async () => {
		// 	// console.log("helpers.PROMISE_VALID_FROM: ", helpers.PROMISE_VALID_FROM, ", helpers.PROMISE_VALID_TO: ", helpers.PROMISE_VALID_TO);
		// 	await contractVoucherKernel.createTokenSupplyID(helpers.ASSET_TITLE, helpers.ASSET_PIN1, helpers.ASSET_QR1, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE1, helpers.PROMISE_DEPOSITSE1, helpers.PROMISE_DEPOSITBU1, helpers.PROMISE_CHALLENGE_PERIOD, helpers.PROMISE_CANCELORFAULT_PERIOD);

		// 	promiseKey1 = await contractVoucherKernel.promiseKeys.call(0);
			
		// 	assert.notEqual(promiseKey1, helpers.ZERO_ADDRESS, "promise not added");
		// });	

		// it("adding second new promise", async () => {
		// 	await contractVoucherKernel.createTokenSupplyID(helpers.ASSET_TITLE2, helpers.ASSET_PIN2, helpers.ASSET_QR2, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE2, helpers.PROMISE_DEPOSITSE2, helpers.PROMISE_DEPOSITBU2, helpers.PROMISE_CHALLENGE_PERIOD, helpers.PROMISE_CANCELORFAULT_PERIOD);

		// 	promiseKey2 = await contractVoucherKernel.promiseKeys.call(1);
			
		// 	assert.notEqual(promiseKey2, helpers.ZERO_ADDRESS, "second promise not added");
		// });				

		// it("must fail: adding new promise with invalid validity", async () => {			
		// 	truffleAssert.reverts(contractVoucherKernel.createTokenSupplyID(helpers.ASSET_TITLE, helpers.ASSET_PIN1, helpers.ASSET_QR1, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_FROM - 1, helpers.PROMISE_PRICE1, helpers.PROMISE_DEPOSITSE1, helpers.PROMISE_DEPOSITBU1, helpers.PROMISE_CHALLENGE_PERIOD, helpers.PROMISE_CANCELORFAULT_PERIOD),
		// 		truffleAssert.ErrorType.REVERT
		// 	);						
		// });			
			  	
  //   })


    describe('Orders (aka supply tokens - ERC1155)', function() {

		it("adding one new order / promise", async () => {		

			let txOrder = await contractCashier.requestCreateOrder_ETH_ETH([helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE1, helpers.PROMISE_DEPOSITSE1, helpers.PROMISE_DEPOSITBU1, helpers.ORDER_QUANTITY1], {from: Seller, to: contractCashier.address, value: helpers.PROMISE_DEPOSITSE1});

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

			let txOrder = await contractCashier.requestCreateOrder_ETH_ETH([helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE2, helpers.PROMISE_DEPOSITSE2, helpers.PROMISE_DEPOSITBU2, helpers.ORDER_QUANTITY2], {from: Seller, to: contractCashier.address, value: helpers.PROMISE_DEPOSITSE2});

			truffleAssert.eventEmitted(txOrder, 'LogOrderCreated', (ev) => {
			    tokenSupplyKey2 = ev._tokenIdSupply;
			    return ev._seller === Seller;
			}, "order2 not created successfully");			
			
		});	


		it("fill one order (aka buy a voucher)", async () => {			

			let txFillOrder = await contractCashier.requestVoucher_ETH_ETH(tokenSupplyKey1, Seller, {from: Buyer, to: contractCashier.address, value: helpers.PROMISE_PRICE1 + helpers.PROMISE_DEPOSITBU1});
			let internalTx = (await truffleAssert.createTransactionResult(contractVoucherKernel, txFillOrder.tx))

			truffleAssert.eventEmitted(internalTx, 'LogVoucherDelivered', (ev) => {
				return ev._issuer === Seller;
			}, "order1 not created successfully");

			let filtered = internalTx.logs.filter(e => e.event == 'LogVoucherDelivered')[0]
			tokenVoucherKey1 = filtered.returnValues['_tokenIdVoucher']
		});	


		it("fill second order (aka buy a voucher)", async () => {			

			let txFillOrder = await contractCashier.requestVoucher_ETH_ETH(tokenSupplyKey2, Seller, {from: Buyer, to: contractCashier.address, value: helpers.PROMISE_PRICE2 + helpers.PROMISE_DEPOSITBU2});
			let internalTx = (await truffleAssert.createTransactionResult(contractVoucherKernel, txFillOrder.tx))

			truffleAssert.eventEmitted(internalTx, 'LogVoucherDelivered', (ev) => {
			    tokenVoucherKey2 = ev._tokenIdVoucher;
			    return ev._tokenIdSupply.toString() === tokenSupplyKey2.toString();
			}, "order1 not filled successfully");
		});			

		//in prototype, everyone can create an order
		// it("must fail: unauthorized adding of new order", async () => {			

		// 	truffleAssert.reverts(contractCashier.requestCreateOrder_ETH_ETH(promiseKey1, helpers.ORDER_QUANTITY1, {from: Attacker, to: contractCashier.address, value: helpers.PROMISE_DEPOSITSE1}),
		// 		truffleAssert.ErrorType.REVERT
		// 	);			
			
		// });		


		it("must fail: adding new order with incorrect value sent", async () => {	

			truffleAssert.reverts(contractCashier.requestCreateOrder_ETH_ETH([helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE1, helpers.PROMISE_DEPOSITSE1, helpers.PROMISE_DEPOSITBU1, helpers.ORDER_QUANTITY1], {from: Seller, to: contractCashier.address, value: 0}),
				truffleAssert.ErrorType.REVERT
			);			
			
		});	

		it("must fail: fill an order with incorrect value", async () => {			

			truffleAssert.reverts(contractCashier.requestVoucher_ETH_ETH(tokenSupplyKey1, Seller, {from: Buyer, to: contractCashier.address, value: 0}),
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

			await contractCashier.withdraw(tokenVoucherKey1);

			let escrowedAfter = await contractCashier.getEscrowAmount.call(Buyer);

			assert.isBelow(escrowedAfter.toNumber(), escrowedBefore.toNumber(), "escrowed amount not decreased");
		});		


		// it("must fail: unauthorized withdrawal of escrowed pool", async () => {
		// 	truffleAssert.reverts(contractCashier.withdrawPool({from: Attacker}),
		// 		truffleAssert.ErrorType.REVERT
		// 	);				
		// });			
			  	
	})  


	
	after(async () => {
		await timemachine.revertToSnapShot(snapshot.id)
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
	
	before('setup promise dates based on the block timestamp', async () => {
		snapshot = await timemachine.takeSnapshot();

		const timestamp = await Utils.getCurrTimestamp()

		helpers.PROMISE_VALID_FROM = timestamp
		helpers.PROMISE_VALID_TO = timestamp + 2 * helpers.SECONDS_IN_DAY;
	})

    beforeEach('setup contracts for tests', async () => {

        contractERC1155ERC721 	= await ERC1155ERC721.new();
        contractVoucherKernel 	= await VoucherKernel.new(contractERC1155ERC721.address);
        contractCashier 		= await Cashier.new(contractVoucherKernel.address, contractERC1155ERC721.address);

        await contractERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true');
        await contractERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address);
        await contractVoucherKernel.setCashierAddress(contractCashier.address);


        //INIT
		// await contractVoucherKernel.createTokenSupplyID(helpers.ASSET_TITLE, helpers.ASSET_PIN1, helpers.ASSET_QR1, helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE1, helpers.PROMISE_DEPOSITSE1, helpers.PROMISE_DEPOSITBU1, helpers.PROMISE_CHALLENGE_PERIOD * helpers.SECONDS_IN_DAY, helpers.PROMISE_CANCELORFAULT_PERIOD * helpers.SECONDS_IN_DAY);

		// promiseKey1 = await contractVoucherKernel.promiseKeys.call(0);

		// assert.notEqual(promiseKey1, helpers.ZERO_ADDRESS, "promise not added");

		let txOrder = await contractCashier.requestCreateOrder_ETH_ETH( [helpers.PROMISE_VALID_FROM, helpers.PROMISE_VALID_TO, helpers.PROMISE_PRICE1, helpers.PROMISE_DEPOSITSE1, helpers.PROMISE_DEPOSITBU1, helpers.ORDER_QUANTITY1], {from: Seller, to: contractCashier.address, value: helpers.PROMISE_DEPOSITSE1});

		truffleAssert.eventEmitted(txOrder, 'LogOrderCreated', (ev) => {
		    tokenSupplyKey1 = ev._tokenIdSupply;
		    return ev._seller === Seller;
		}, "order1 not created successfully");	

		let txFillOrder = await contractCashier.requestVoucher_ETH_ETH(tokenSupplyKey1, Seller, {from: Buyer, to: contractCashier.address, value: helpers.PROMISE_PRICE1 + helpers.PROMISE_DEPOSITBU1});
		let internalTx = (await truffleAssert.createTransactionResult(contractVoucherKernel, txFillOrder.tx))

		truffleAssert.eventEmitted(internalTx, 'LogVoucherDelivered', (ev) => {
			tokenVoucherKey1 = ev._tokenIdVoucher
			return ev._issuer === Seller;
		}, "order1 not created successfully");

		//\INIT
    })


    describe('Wait periods', function() {
		it("change complain period", async () => {
			let txChangePeriod = await contractVoucherKernel.setComplainPeriod(helpers.PROMISE_CHALLENGE_PERIOD * helpers.SECONDS_IN_DAY);

			truffleAssert.eventEmitted(txChangePeriod, 'LogComplainPeriodChanged', (ev) => {
			    return ev._newComplainPeriod.toString() === (helpers.PROMISE_CHALLENGE_PERIOD * helpers.SECONDS_IN_DAY).toString();
			}, "complain period not changed successfully");
		});		


		it("must fail: unauthorized change of complain period", async () => {
			truffleAssert.reverts(contractVoucherKernel.setComplainPeriod(helpers.PROMISE_CHALLENGE_PERIOD * helpers.SECONDS_IN_DAY, {from: Attacker}),
				truffleAssert.ErrorType.REVERT
			);				
		});		


		it("change cancelOrFault period", async () => {
			let txChangePeriod = await contractVoucherKernel.setCancelFaultPeriod(helpers.PROMISE_CANCELORFAULT_PERIOD * helpers.SECONDS_IN_DAY);

			truffleAssert.eventEmitted(txChangePeriod, 'LogCancelFaultPeriodChanged', (ev) => {
			    return ev._newCancelFaultPeriod.toString() === (helpers.PROMISE_CANCELORFAULT_PERIOD * helpers.SECONDS_IN_DAY).toString();
			}, "complain period not changed successfully");
		});		


		it("must fail: unauthorized change of cancelOrFault period", async () => {
			truffleAssert.reverts(contractVoucherKernel.setCancelFaultPeriod(helpers.PROMISE_CANCELORFAULT_PERIOD * helpers.SECONDS_IN_DAY, {from: Attacker}),
				truffleAssert.ErrorType.REVERT
			);				
		});					
			  	
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
		
		after(async () => {
			await timemachine.revertToSnapShot(snapshot.id)
		})

	})    
	
});