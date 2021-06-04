let Web3 = require('web3');
const BN = require('bn.js');
let Contract = require('web3-eth-contract');
const helpers = require('../helpers/constants')
const Tx = require('ethereumjs-tx').Transaction;
let converter = require('hex2dec');
const BosonRouter = require("../../build/contracts/BosonRouter.json").abi;
const VoucherKernel = require("../../build/contracts/VoucherKernel.json").abi;
const { BUYER_SECRET, BUYER_PUBLIC, contracts, PROVIDER, SELLER_PUBLIC } = require('../helpers/config');
let web3 = new Web3(new Web3.providers.HttpProvider(PROVIDER));
// set provider for all later instances to use
Contract.setProvider(PROVIDER);
const buyer = BUYER_PUBLIC;

function requestVoucherETHETH(_voucherID) {
    return new Promise((resolve, reject) => {
        const bosonRouterAddr = contracts.BosonRouterContrctAddress;
        const bosonRouter = new Contract(BosonRouter,bosonRouterAddr);

        const voucherKernelAddr = contracts.VoucherKernelContractAddress;
        const voucherKernel = new Contract(VoucherKernel,voucherKernelAddr);

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
                    reject(new Error(err.message))
                }
                console.log("Transaction Hash : "+hash);
            }).on('receipt', function(receipt){
                //Events array and args  not present in receipt, so retrieving explicitly
                voucherKernel.getPastEvents('LogVoucherDelivered', {
                    fromBlock: 'latest',
                    toBlock: 'latest'
                }).then(function(logVoucherDeliveredEvents) {
                    let logdata1 = receipt.logs[0].data;
                    let logdata3 = receipt.logs[2].data;
                    let gasUsed = receipt.gasUsed;
                    let txhash = receipt.transactionHash;
                    let voucherSetID = logVoucherDeliveredEvents[0].returnValues._tokenIdSupply;
                    let mintedVoucherID = logVoucherDeliveredEvents[0].returnValues._tokenIdVoucher;
                    let issuer = logVoucherDeliveredEvents[0].returnValues._issuer;
                    let holder = logVoucherDeliveredEvents[0].returnValues._holder;
                    let promiseID = logVoucherDeliveredEvents[0].returnValues._promiseId;
                    let output = {
                        "TransactionHash":txhash,
                        "VoucherSetID":voucherSetID,
                        "MintedVoucherID":mintedVoucherID,
                        "issuer":issuer,
                        "holder":holder,
                        "promiseID":promiseID,
                        "gasPaid":converter.hexToDec(gasPaid),
                        "gasUsed":gasUsed
                    }
                    resolve(output)

                }).catch( reject );

            }).on('error', console.error);
        })
    })
}

module.exports = requestVoucherETHETH;