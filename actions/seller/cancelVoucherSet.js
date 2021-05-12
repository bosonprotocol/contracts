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

// let sellerRequestCancelorFault =
    function requestCancelorFault(_voucherSetID) {
    return new Promise((resolve, reject) => {
        const bosonRouterAddr = contracts.BosonRouterContrctAddress;
        const bosonRouter = new Contract(BosonRouter,bosonRouterAddr);
        // gets the current nounce of the sellers account and the proceeds to structure the transaction
        web3.eth.getTransactionCount(seller, function(error, txCount) {
            const encoded = bosonRouter.methods.requestCancelOrFaultVoucherSet(
                _voucherSetID
            ).encodeABI();
            let rawTransaction = {
                "nonce": web3.utils.toHex(txCount),
                "gasPrice": "0x04e3b29200",
                "gasLimit": "0xF458F",
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

                resolve(hash)
            }).on('transactionHash', function(hash){
                console.log("Transaction Hash : "+hash);
            }).on('receipt', function(receipt){
                // console.log(receipt)
                let logdata1 = receipt.logs[0].data;
                let logdata3 = receipt.logs[2].data;
                let VoucherSetID = converter.hexToDec(logdata1.slice(0, 66)).toString();
                let VoucherSetQuantity = converter.hexToDec(logdata1.slice(66, 130));
                let SellerAddress = converter.hexToDec(logdata3.slice(66, 130)).toString();
                let redfundSellerDeposit = converter.hexToDec(logdata3.slice(130, 194));

                let output = {
                    "VoucherSetID":VoucherSetID,
                    "VoucherSetQuantity":VoucherSetQuantity,
                    "SellerAddress":"0x"+SellerAddress,
                    "redfundSellerDeposit":redfundSellerDeposit,
                }

                console.log(output)
                return(output)
            }).on('error', console.error);
        })
    })
}

(async function newOrder () {
    await requestCancelorFault("57896044618658097711785492504343954004219371990794251689378202498399717031936");
})();

// module.exports = sellerRequestCancelorFault;


