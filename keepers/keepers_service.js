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

var cfg = require('./config');
var ethers = require('ethers');
var load_dummy = require('./load_dummy');	//for testing


var contractNFT = new ethers.Contract(cfg.contractNFTaddress, cfg.abiNFT, cfg.wallet);
var contractVK = new ethers.Contract(cfg.contractVKAddress, cfg.abiVK, cfg.wallet);
var contractCashier = new ethers.Contract(cfg.contractCashierAddress, cfg.abiCashier, cfg.wallet);


var arrSupplyIds = []
var arrVouchers = []


async function initContracts() {
    const blockNo = await cfg.provider.getBlockNumber();
    const block = await cfg.provider.getBlock(blockNo);
    console.log('[Block]', blockNo, block.timestamp, "\n");

    cfg.startBlock = blockNo;
	
	//TODO: do this only once
	await contractNFT.setVoucherKernelAddress(cfg.contractVKAddress);
	await contractVK.setCashierAddress(cfg.contractCashierAddress);
	await contractNFT.setApprovalForAll(cfg.contractVKAddress, 'true');	
}


async function loadLogsOrders() {
	const filter = contractCashier.filters.LogOrderCreated();
	const logs = await contractCashier.queryFilter(filter, cfg.startBlock, "latest").then((logs) => {
	    logs.forEach((log) => {
	        arrSupplyIds.push(log.args._tokenIdSupply.toString());
	    })
	})	
	console.log("Loaded", arrSupplyIds.length, "events LogOrderCreated.\n");
}


async function loadLogsVoucherDeliveredEvents() {
	var filter = contractCashier.filters.LogVoucherDelivered();
	var logs = await contractCashier.queryFilter(filter, cfg.startBlock, "latest").then((logs) => {
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
	var logs = await contractVK.queryFilter(filter, cfg.startBlock, "latest").then((logs) => {
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
	var logs = await contractVK.queryFilter(filter, cfg.startBlock, "latest").then((logs) => {
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
	var logs = await contractVK.queryFilter(filter, cfg.startBlock, "latest").then((logs) => {
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
	var logs = await contractVK.queryFilter(filter, cfg.startBlock, "latest").then((logs) => {
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
	var logs = await contractVK.queryFilter(filter, cfg.startBlock, "latest").then((logs) => {
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
		console.log("Loaded", cntP, "events LogFundsReleased(_,0) - payments.\n");
		console.log("Loaded", cntD, "events LogFundsReleased(_,1) - deposits.\n");	    
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
		if (arrVouchers[i][1]    == 'commitment' 
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
		if (arrVouchers[i][1]    == 'commitment' 
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
	console.log("\n[Keepers start]", new Date().toUTCString(), "\n");

	try {
		await initContracts();
		if (cfg.flagLoadDummy) await load_dummy.loadDummyOrders(contractCashier);

		await loadLogsOrders();	
		if (cfg.flagLoadDummy) await load_dummy.loadDummyVoucherCommitments(contractCashier, arrSupplyIds, cfg.wallet);

		await loadLogsVoucherDeliveredEvents();
		if (cfg.flagLoadDummy) await load_dummy.loadDummyVoucherRedeem(contractVK, arrVouchers);
		
		await loadLogsVoucherEvents();
		
		//actually do txs
		await triggerExpirations();
		await triggerFinalizations();
		await triggerWithdrawals();
	} catch (error) {
		console.error("\n\n[ERROR]", error);
	}	

	console.log("\n[Keepers end]", new Date().toUTCString(), "\n");
}



doStuff();