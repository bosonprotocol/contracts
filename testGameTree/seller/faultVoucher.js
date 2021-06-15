let Web3 = require('web3');
let Contract = require('web3-eth-contract');
const Tx = require('ethereumjs-tx').Transaction;
const Utils = require('../helpers/utils');
let converter = require('hex2dec');
const BosonRouter = require('../../build/contracts/BosonRouter.json').abi;
const VoucherKernel = require('../../build/contracts/VoucherKernel.json').abi;
const helpers = require('../helpers/constants');
let web3 = new Web3(new Web3.providers.HttpProvider(helpers.PROVIDER));

// set provider for all later instances to use
Contract.setProvider(helpers.PROVIDER);


function faultVoucher(_voucherSetID, users) {
  return new Promise((resolve, reject) => {
    const bosonRouter = new Contract(BosonRouter, Utils.contractBSNRouter.address);
    const voucherKernel = new Contract(VoucherKernel, Utils.contractVoucherKernel.address);

    let gasPaid = '0xF458F';
    // gets the current nounce of the sellers account and the proceeds to structure the transaction
    web3.eth.getTransactionCount(users.seller.address, function (error, txCount) {
      const encoded = bosonRouter.methods
        .cancelOrFault(_voucherSetID)
        .encodeABI();
      let rawTransaction = {
        nonce: web3.utils.toHex(txCount),
        gasPrice: '0x04e3b29200',
        gasLimit: gasPaid,
        to: Utils.contractBSNRouter.address,
        value: 0x0,
        data: encoded,
      };
      let privKey = Buffer.from(users.privateKeys[users.seller.address.toLowerCase()], 'hex');
      let tx = new Tx(rawTransaction, {chain: 'rinkeby'});
      tx.sign(privKey);
      let serializedTx = tx.serialize();
      // executes the transaction
      web3.eth
        .sendSignedTransaction(
          '0x' + serializedTx.toString('hex'),
          (err, hash) => {
            if (err) {
              reject(new Error(err.message));
            }
            console.log('Transaction Hash : ' + hash);
          }
        )
        .on('receipt', function (receipt) {
          //Events array and args  not present in receipt, so retrieving explicitly
          voucherKernel
            .getPastEvents('LogVoucherFaultCancel', {
              fromBlock: 'latest',
              toBlock: 'latest',
            })
            .then(function (logVoucherFaultCancelEvents) {
              let gasUsed = receipt.gasUsed;
              let txHash = receipt.transactionHash;
              let txStatus = receipt.status;
              let FaultedVoucherID =
                logVoucherFaultCancelEvents[0].returnValues._tokenIdVoucher;
              let output = {
                TransactionHash: txHash,
                FaultedVoucherID: FaultedVoucherID,
                gasPaid: converter.hexToDec(gasPaid),
                gasUsed: gasUsed,
                status: txStatus,
              };
              resolve(output);
            })
            .catch(reject);
        })
        .on('error', console.error);
    });
  });
}

module.exports = faultVoucher;
