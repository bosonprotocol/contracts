let Web3 = require('web3');
const BN = require('bn.js');
let Contract = require('web3-eth-contract');
const helpers = require('../helpers/constants')
const Tx = require('ethereumjs-tx').Transaction;
let converter = require('hex2dec');


const BosonRouter = require("../../build/contracts/BosonRouter.json").abi;
const { SELLER_SECRET, SELLER_PUBLIC, contracts, PROVIDER } = require('../helpers/config');

let web3 = new Web3(new Web3.providers.HttpProvider(PROVIDER));

// set provider for all later instances to use
Contract.setProvider(PROVIDER);

// const seller = new ethers.Wallet(SELLER_SECRET, PROVIDER);
const seller = SELLER_PUBLIC;

// let SellerCreateOrderETHETH =
    function CreateOrderETHETH() {
    return new Promise((resolve, reject) => {
        const bosonRouterAddr = contracts.BosonRouterContrctAddress;
        const bosonRouter = new Contract(BosonRouter,bosonRouterAddr);
            // gets the current nounce of the sellers account and the proceeds to structure the transaction
            web3.eth.getTransactionCount(seller, function(error, txCount) {
            const txValue = new BN(helpers.PROMISE_PRICE1);
                const encoded = bosonRouter.methods.requestCreateOrderETHETH(
                [
                    new BN(helpers.PROMISE_VALID_FROM),
                    new BN(helpers.PROMISE_VALID_TO),
                    new BN(helpers.PROMISE_PRICE1),
                    new BN(helpers.PROMISE_DEPOSITSE1),
                    new BN(helpers.PROMISE_DEPOSITBU1),
                    new BN(helpers.ORDER_QUANTITY1),
                ]
            ).encodeABI();
            let rawTransaction = {
                "nonce": web3.utils.toHex(txCount),
                "gasPrice": "0x04e3b29200",
                "gasLimit": "0xF458F",
                "to": bosonRouterAddr,
                "value": txValue,
                "data": encoded
            };

            let privKey = Buffer.from(SELLER_SECRET, 'hex');
            let tx = new Tx(rawTransaction,  {'chain':'rinkeby'});

            tx.sign(privKey);
            let serializedTx = tx.serialize();

            // executes the transaction
            web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), (err, hash) => {
                if(err) {
                    console.log(err)
                    reject(new Error(err.message))
                }

                resolve(hash)
            }).on('transactionHash', function(hash){
                console.log("Transaction Hash : "+hash);
                }).on('receipt', function(receipt){
                    // console.log(receipt)
                    let logdata1 = receipt.logs[0].data;
                    let logdata2 = receipt.logs[1].data;
                    let logdata3 = receipt.logs[2].data;
                    let validFrom = converter.hexToDec(logdata1.slice(0, 66));
                    let validTo = converter.hexToDec(logdata1.slice(66, 130));
                    let nftID = (converter.hexToDec(logdata2.slice(0, 66))).toString();
                    let nftSupply = converter.hexToDec(logdata2.slice(66, 130));
                    let nftSeller = (converter.hexToDec(logdata3.slice(0, 66))).toString();

                    let output = {
                        "ValidFrom":validFrom,
                        "ValidTo":validTo,
                        "voucherSetID":nftID,
                        "nftSupply":nftSupply,
                        "nftSeller":"0x"+nftSeller,
                        "logReceipt1": receipt.logs[0].id,
                        "logReceipt2": receipt.logs[1].id,
                        "logReceipt3": receipt.logs[2].id
                    }

                    console.log(output)
                    return(output)
                }).on('error', console.error);
        })
    })
}

(async function newOrder () {
    await CreateOrderETHETH();
})();

// module.exports = SellerCreateOrderETHETH;


