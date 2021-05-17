let Web3 = require('web3');
const BN = require('bn.js');
let Contract = require('web3-eth-contract');
const helpers = require('../helpers/constants')
const Tx = require('ethereumjs-tx').Transaction;
let converter = require('hex2dec');

const BosonRouter = require("../../build/contracts/BosonRouter.json").abi;
const { BUYER_SECRET, BUYER_PUBLIC, contracts, PROVIDER, SELLER_PUBLIC } = require('../helpers/config');

let web3 = new Web3(new Web3.providers.HttpProvider(PROVIDER));

// set provider for all later instances to use
Contract.setProvider(PROVIDER);

const buyer = BUYER_PUBLIC;

function requestVoucherETHETH(_voucherID) {
    return new Promise((resolve, reject) => {
        const bosonRouterAddr = contracts.BosonRouterContrctAddress;
        const bosonRouter = new Contract(BosonRouter,bosonRouterAddr);
        let gasPaid = "0xF458F";
        web3.eth.getTransactionCount(buyer, function(error, txCount) {
            let deposit = helpers.PROMISE_PRICE1+helpers.PROMISE_DEPOSITBU1;
            const txValue = new BN(deposit);
            const encoded = bosonRouter.methods.requestVoucherETHETH(
                _voucherID,
                SELLER_PUBLIC
            ).encodeABI();
            let rawTransaction = {
                "nonce": web3.utils.toHex(txCount),
                "gasPrice": "0x04e3b29200",
                "gasLimit": gasPaid,
                "to": bosonRouterAddr,
                "value": txValue,
                "data": encoded
            };

            let privKey = Buffer.from(BUYER_SECRET, 'hex');
            let tx = new Tx(rawTransaction,  {'chain':'rinkeby'});

            tx.sign(privKey);
            let serializedTx = tx.serialize();

            web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), (err, hash) => {
                if(err) {
                    console.log(err)
                    reject(new Error(err.message))
                }
                console.log("Transaction Hash : "+hash);
            }).on('receipt', function(receipt){
                // console.log(receipt);
                let logdata1 = receipt.logs[0].data;
                let logdata3 = receipt.logs[2].data;
                let gasUsed = receipt.gasUsed;
                let txhash = receipt.transactionHash;
                let voucherSetID = (converter.hexToDec(logdata1.slice(0, 66))).toString();
                let mintedVoucherID = (converter.hexToDec(logdata3.slice(0, 66))).toString();
                let issuer = (logdata3.slice(90, 130)).toString();
                let holder = (logdata3.slice(154, 194)).toString();
                let promiseID = (logdata3.slice(194, 258)).toString();
                let correlationID = converter.hexToDec(logdata3.slice(258, 322))

                let output = {
                    "TransactionHash":txhash,
                    "VoucherSetID":voucherSetID,
                    "MintedVoucherID":mintedVoucherID,
                    "issuer":"0x"+issuer,
                    "holder":"0x"+holder,
                    "promiseID":promiseID,
                    "gasPaid":converter.hexToDec(gasPaid),
                    "gasUsed":gasUsed,
                    "correlationID":correlationID,
                    "logReceipt1": receipt.logs[0].id,
                    "logReceipt2": receipt.logs[1].id,
                    "logReceipt3": receipt.logs[2].id
                }
                resolve(output)
            }).on('error', console.error);
        })
    })
}

module.exports = requestVoucherETHETH;