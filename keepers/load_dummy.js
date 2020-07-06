//dummy data for test

async function loadDummyOrders(contractCashier) {
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


async function loadDummyVoucherCommitments(contractCashier, arrSupplyIds, wallet) {
	tx = await contractCashier.requestVoucher(
	                arrSupplyIds[0], //_tokenIdSupply
	                wallet.address //_issuer	                
	                , {value: 11}
	        );

	console.log("VoucherCommit TX hash: ", tx.hash);	
}


async function loadDummyVoucherRedeem(contractVK, arrVouchers) {
	tx = await contractVK.redeem(
	                arrVouchers[0][0] //_tokenIdVoucher
	        );

	console.log("Redeem", 0, " TX hash: ", tx.hash);	
}


module.exports = {
	loadDummyOrders,
	loadDummyVoucherCommitments,
	loadDummyVoucherRedeem
}