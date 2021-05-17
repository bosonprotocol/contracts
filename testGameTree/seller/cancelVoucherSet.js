let Web3 = require('web3');
let Contract = require('web3-eth-contract');
const Tx = require('ethereumjs-tx').Transaction;
let converter = require('hex2dec');

const BosonRouter = require("../../build/contracts/BosonRouter.json").abi;
const { SELLER_SECRET, SELLER_PUBLIC, contracts, PROVIDER } = require('../helpers/config');

let web3 = new Web3(new Web3.providers.HttpProvider(PROVIDER));

// set provider for all later instances to use
Contract.setProvider(PROVIDER);

const seller = SELLER_PUBLIC;

function requestCancelorFault(_voucherSetID) {
    return new Promise((resolve, reject) => {
        const bosonRouterAddr = contracts.BosonRouterContrctAddress;
        const bosonRouter = new Contract(BosonRouter,bosonRouterAddr);
        let gasSent = "0xF458F";
        // gets the current nounce of the sellers account and the proceeds to structure the transaction
        web3.eth.getTransactionCount(seller, function(error, txCount) {
            const encoded = bosonRouter.methods.requestCancelOrFaultVoucherSet(
                _voucherSetID
            ).encodeABI();
            let rawTransaction = {
                "nonce": web3.utils.toHex(txCount),
                "gasPrice": "0x04e3b29200",
                "gasLimit": gasSent,
                "to": bosonRouterAddr,
                "value": 0x0,
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

                console.log("Transaction Hash : ",hash);
            }).on('receipt', function(receipt){
                let logdata1 = receipt.logs[0].data;
                let logdata3 = receipt.logs[2].data;
                let gasUsed = receipt.gasUsed;
                let txHash = receipt.transactionHash;
                let VoucherSetID = converter.hexToDec(logdata1.slice(0, 66)).toString();
                let VoucherSetQuantity = converter.hexToDec(logdata1.slice(66, 130));
                let SellerAddress = converter.hexToDec(logdata3.slice(66, 130)).toString();
                let redfundSellerDeposit = converter.hexToDec(logdata3.slice(130, 194));

                let output = {
                    "TransactionHash":txHash,
                    "CanceledVoucherSetID":VoucherSetID,
                    "VoucherSetQuantity":VoucherSetQuantity,
                    "SellerAddress":"0x"+SellerAddress,
                    "gasPaid":converter.hexToDec(gasSent),
                    "gasUsed":gasUsed,
                    "redfundedSellerDeposit":redfundSellerDeposit,
                    "logReceipt1": receipt.logs[0].id,
                    "logReceipt2": receipt.logs[1].id,
                    "logReceipt3": receipt.logs[2].id
                }

                resolve(output)
            }).on('error', console.error);
        })
    })
}

module.exports = requestCancelorFault;