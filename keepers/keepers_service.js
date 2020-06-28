/*
	Boson Protocol - background keepers service, for ease of use (scheduling, withdrawals etc.) and paying for gas of these txs

	Requirements:
	- have a node running at $URL$ (default ganache)
	- contract ERC1155ERC721 is deployed at address $contractNFTAddress$
	- contract VoucherKernel is deployed at address $contractVKAddress$
	- contract Cashier is deployed at address $contractCashierAddress$


	Run the script by: 
	$ node loader.js <addresses of the contracts separated by space> <private key of the transacting account>
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
	Whis is what we get with a hybrid contract ERC1155ERC721:
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


