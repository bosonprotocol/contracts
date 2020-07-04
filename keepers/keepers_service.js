/*
	Boson Protocol - background keepers service, for ease of use (scheduling, withdrawals etc.) and paying for gas of these txs

	Requirements:
	- have a node running at $URL$ (default ganache)
	- contract ERC1155ERC721 is deployed at address $contractNFTAddress$
	- contract VoucherKernel is deployed at address $contractVKAddress$
	- contract Cashier is deployed at address $contractCashierAddress$


	Run the script by: 
	$ node keepers_service.js <addresses of the contracts separated by space> <private key of the transacting account>
*/


var fs = require('fs');
var ethers = require('ethers');

//read settings
var myArgs = process.argv.slice(2);
var contractNFTaddress = myArgs[0];
var contractVKAddress = myArgs[1];
var contractCashierAddress = myArgs[2];

var privateKey = myArgs[3];
var URL = "http://localhost:8545"

// //connect to web3 provider
var provider = new ethers.providers.JsonRpcProvider(URL); ////new ethers.providers.JsonRpcProvider(url);
var wallet = new ethers.Wallet(privateKey, provider);

// //get contract functions signatures

/*
	ethers complains about overloaded functions, because it wants to be on the safe side,
	see: https://github.com/ethers-io/ethers.js/issues/499
	Which is what we get with the hybrid contract ERC1155ERC721:
WARNING: Multiple definitions for safeTransferFrom
WARNING: Multiple definitions for safeTransferFrom
WARNING: Multiple definitions for balanceOf
WARNING: Multiple definitions for mint

	To silence it, we can uncomment the line below to decrease verbosity.
*/
//ethers.errors.setLogLevel("error");
var contractNFTAbi = JSON.parse(fs.readFileSync('../build/contracts/ERC1155ERC721.json').toString())
var contractVKAbi = JSON.parse(fs.readFileSync('../build/contracts/VoucherKernel.json').toString())
var contractCashierAbi = JSON.parse(fs.readFileSync('../build/contracts/Cashier.json').toString())
var abiNFT = contractNFTAbi.abi;
var abiVK = contractVKAbi.abi;
var abiCashier = contractCashierAbi.abi;

var contractNFT = new ethers.Contract(contractNFTaddress, abiNFT, wallet);
var contractVK = new ethers.Contract(contractVKAddress, abiVK, wallet);
var contractCashier = new ethers.Contract(contractCashierAddress, abiCashier, wallet);


var arrSupplyIds = []
var arrVouchers = []


async function initContracts() {
	
	//TODO: do this only once
	await contractNFT.setVoucherKernelAddress(contractVKAddress);
	await contractVK.setCashierAddress(contractCashierAddress);
	await contractNFT.setApprovalForAll(contractVKAddress, 'true');	
}


//dummy data for test
async function loadDummyOrders() {
  // contractNFT.owner().then((result) => { console.log("contractNFT.owner: ", result, "\n"); });
  // console.log("i am: ", wallet.address);
  	
	var today = new Date().valueOf();
	today = Math.floor( today / 1000 );

	//offers
	tx = await contractCashier.requestCreateOrder(
	                "abc", //_assetTitle
	                today - (3 * 1000 * 60 * 60 * 24), //_validFrom
	                today + (3 * 1000 * 60 * 60 * 24), //_validTo
	                10, //_price
	                1, //_depositSe
	                1, //_depositBu
	                10  //_quantity
	                //,{nonce: txcount}
	                , {value: 10}
	        );

	console.log("Order TX hash: ", tx.hash);
}


async function loadLogsOrders() {
	const filter = contractCashier.filters.LogOrderCreated();
	const logs = await contractCashier.queryFilter(filter, 0, "latest").then((logs) => {
	    logs.forEach((log) => {
	        arrSupplyIds.push(log.args._tokenIdSupply.toString());
	    })
	})	
	console.log("Loaded", arrSupplyIds.length, "events LogOrderCreated.\n");
}


async function loadDummyVoucherCommitments() {
	tx = await contractCashier.requestVoucher(
	                arrSupplyIds[0], //_tokenIdSupply
	                wallet.address //_issuer	                
	                , {value: 11}
	        );

	console.log("VoucherCommit TX hash: ", tx.hash);	
}


async function loadDummyVoucherRedeem() {
	tx = await contractVK.redeem(
	                arrVouchers[0][0] //_tokenIdVoucher
	        );

	console.log("Redeem", 0, " TX hash: ", tx.hash);	
}


async function loadLogsVoucherDeliveredEvents() {
	var filter = contractCashier.filters.LogVoucherDelivered();
	var logs = await contractCashier.queryFilter(filter, 0, "latest").then((logs) => {
	    logs.forEach((log) => {
	        arrVouchers.push([log.args._tokenIdVoucher.toString(), 'commitment']);
	    })
	})	
	console.log("Loaded", arrVouchers.length, "events LogVoucherDelivered.\n");
}


async function loadLogsVoucherEvents() {
	//redemptions
	var cnt = 0;
	var filter = contractVK.filters.LogVoucherRedeemed();
	var logs = await contractVK.queryFilter(filter, 0, "latest").then((logs) => {
	    logs.forEach((log) => {
	        for (let i = 0; i < arrVouchers.length; i++) {
	        	if (arrVouchers[i][0] == log.args._tokenIdVoucher) {
	        		arrVouchers[i][1] = 'redemption';
	        		cnt += 1;
	        	}
	        }
	    })
		console.log("Loaded", cnt, "events LogVoucherRedeemed.\n");
	})	

	//refunds
	cnt = 0;
	var filter = contractVK.filters.LogVoucherRefunded();
	var logs = await contractVK.queryFilter(filter, 0, "latest").then((logs) => {
	    logs.forEach((log) => {
	        for (let i = 0; i < arrVouchers.length; i++) {
	        	if (arrVouchers[i][0] == log.args._tokenIdVoucher) {
	        		arrVouchers[i][1] = 'refund';
	        		cnt += 1;
	        	}
	        }	        
	    })
	    console.log("Loaded", cnt, "events LogVoucherRefunded.\n");	
	})	

	//expirations
	cnt = 0;
	var filter = contractVK.filters.LogExpirationTriggered();
	var logs = await contractVK.queryFilter(filter, 0, "latest").then((logs) => {
	    logs.forEach((log) => {
	        for (let i = 0; i < arrVouchers.length; i++) {
	        	if (arrVouchers[i][0] == log.args._tokenIdVoucher) {
	        		arrVouchers[i][1] = 'expiration';
	        		cnt += 1;
	        	}
	        }	        
	    })
	    console.log("Loaded", cnt, "events LogExpirationTriggered.\n");	
	})	

	//finalized
	cnt = 0;
	var filter = contractVK.filters.LogFinalizeVoucher();
	var logs = await contractVK.queryFilter(filter, 0, "latest").then((logs) => {
	    logs.forEach((log) => {
	        for (let i = 0; i < arrVouchers.length; i++) {
	        	if (arrVouchers[i][0] == log.args._tokenIdVoucher) {
	        		arrVouchers[i][1] = 'final';
	        		cnt += 1;
	        	}
	        }	        
	    })
	    console.log("Loaded", cnt, "events LogFinalizeVoucher.\n");	
	})		

	//funds released
	var cntP = 0;
	var cntD = 0;
	var filter = contractVK.filters.LogFundsReleased();
	var logs = await contractVK.queryFilter(filter, 0, "latest").then((logs) => {
	    logs.forEach((log) => {
	        for (let i = 0; i < arrVouchers.length; i++) {
	        	if (arrVouchers[i][0] == log.args._tokenIdVoucher) {
	        		if (log.args._type == 0) {
		        		if (arrVouchers[i][1] == 'final') {
		        			arrVouchers[i][1] = 'releasedPayment';	
		        		} else {
		        			arrVouchers[i][1] = 'released';	
		        		}	
		        		cntP += 1;
		        	} else if (log.args._type == 1)  {
		        		if (arrVouchers[i][1] == 'final') {
		        			arrVouchers[i][1] = 'releasedDeposit';	
		        		} else {
		        			arrVouchers[i][1] = 'released';	
		        		}	
		        		cntD += 1;
		        	} else {
		        		console.log("LogFundsReleased unexpected type: ", log.args._type, " for ", log.args._tokenIdVoucher);
		        	}   			        	
	        	}
	        }	        
	    })
		console.log("Loaded", cntP, "events LogFundsReleased(_,0).\n");
		console.log("Loaded", cntD, "events LogFundsReleased(_,1).\n");	    
	})	
}


async function triggerExpirations() {
	for (let i = 0; i < arrVouchers.length; i++) {
		if (arrVouchers[i][1] == 'commitment') {
			tx = await contractVK.triggerExpiration(
			                arrVouchers[0][0] //_tokenIdVoucher
			        );

			console.log("Expire", i, "TX hash: ", tx.hash);			
		}
	}
}


async function triggerFinalizations() {
	for (let i = 0; i < arrVouchers.length; i++) {
		if (arrVouchers[i][1] == 'commitment' 
			|| arrVouchers[i][1] == 'redemption' 
			|| arrVouchers[i][1] == 'refund') 
		{
			tx = await contractVK.triggerExpiration(
			                arrVouchers[0][0] //_tokenIdVoucher
			        );

			console.log("Finalize", i, "TX hash: ", tx.hash);			
		}
	}
}


async function triggerWithdrawals() {
	for (let i = 0; i < arrVouchers.length; i++) {
		if (arrVouchers[i][1] == 'commitment' 
			|| arrVouchers[i][1] == 'redemption' 
			|| arrVouchers[i][1] == 'refund' 
			|| arrVouchers[i][1] == 'expiration' 
			|| arrVouchers[i][1] == 'final') 
		{
			tx = await contractCashier.withdraw(
			                [arrVouchers[0][0]] //_tokenIdVoucher
			        );

			console.log("Withdrawal", i, "TX hash: ", tx.hash);			
		}
	}
}


async function doStuff() {
	console.log("\nKeepers start ...", new Date().toUTCString(), "\n");
	await initContracts();

	// await loadDummyOrders();
	await loadLogsOrders();	
	// await loadDummyVoucherCommitments();
	await loadLogsVoucherDeliveredEvents();
	// await loadDummyVoucherRedeem();
	
	await loadLogsVoucherEvents();
	
	//actually do txs
	await triggerExpirations();
	await triggerFinalizations();
	await triggerWithdrawals();
	
	console.log("\nKeepers end ...", new Date().toUTCString(), "\n");
}



doStuff();