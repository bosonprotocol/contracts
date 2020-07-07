//configuration

var fs 		= require('fs');
var ethers 	= require('ethers');
var path 	= require( "path" );


const flagLoadDummy	= true;			//loading dummy data
const abiDirectory 	= "../build/contracts/";
const URL 			= "http://localhost:8545";
var startBlock		= 0;

//read settings
var myArgs = process.argv.slice(2);
var contractNFTaddress		= myArgs[0];
var contractVKAddress 		= myArgs[1];
var contractCashierAddress 	= myArgs[2];
var privateKey 				= myArgs[3];

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
var contractNFTAbi = JSON.parse(fs.readFileSync( path.join(abiDirectory, 'ERC1155ERC721.json') ).toString())
var contractVKAbi = JSON.parse(fs.readFileSync( path.join(abiDirectory, 'VoucherKernel.json') ).toString())
var contractCashierAbi = JSON.parse(fs.readFileSync( path.join(abiDirectory, 'Cashier.json') ).toString())
var abiNFT = contractNFTAbi.abi;
var abiVK = contractVKAbi.abi;
var abiCashier = contractCashierAbi.abi;


module.exports = {
	flagLoadDummy,
	startBlock,
	provider,
	wallet,
	contractNFTaddress, abiNFT,
	contractVKAddress, abiVK,
	contractCashierAddress, abiCashier
}