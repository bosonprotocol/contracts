let Web3 = require('web3');
let Contract = require('web3-eth-contract');
const Tx = require('ethereumjs-tx').Transaction;
const Utils = require('../helpers/utils');
let converter = require('hex2dec');
const BosonRouter = require('../../build/contracts/BosonRouter.json').abi;
const VoucherKernel = require('../../build/contracts/VoucherKernel.json').abi;
const {
  BUYER_SECRET,
  BUYER_PUBLIC,
  contracts,
  PROVIDER,
} = require('../helpers/config');
let web3 = new Web3(new Web3.providers.HttpProvider(PROVIDER));
// set provider for all later instances to use
Contract.setProvider(PROVIDER);
const buyer = BUYER_PUBLIC;

function complainVoucher(_voucherID) {
  return new Promise((resolve, reject) => {
    const bosonRouter = new Contract(BosonRouter, Utils.contractBSNRouter.address);
    const voucherKernel = new Contract(VoucherKernel, Utils.contractVoucherKernel.address);

    let gasPaid = '0xF458F';
    web3.eth.getTransactionCount(buyer, function (error, txCount) {
      const encoded = bosonRouter.methods.complain(_voucherID).encodeABI();
      let rawTransaction = {
        nonce: web3.utils.toHex(txCount),
        gasPrice: '0x04e3b29200',
        gasLimit: gasPaid,
        to: Utils.contractBSNRouter.address,
        value: 0x0,
        data: encoded,
      };
      let privKey = Buffer.from(BUYER_SECRET, 'hex');
      let tx = new Tx(rawTransaction, {chain: 'rinkeby'});
      tx.sign(privKey);
      let serializedTx = tx.serialize();
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
            .getPastEvents('LogVoucherComplain', {
              fromBlock: 'latest',
              toBlock: 'latest',
            })
            .then(function (logVoucherComplainEvents) {
              let gasUsed = receipt.gasUsed;
              let complainedVoucherID =
                logVoucherComplainEvents[0].returnValues._tokenIdVoucher;
              let output = {
                complainedVoucherID: complainedVoucherID,
                gasPaid: converter.hexToDec(gasPaid),
                gasUsed: gasUsed,
              };
              resolve(output);
            })
            .catch(reject);
        })
        .on('error', console.error);
    });
  });
}

module.exports = complainVoucher;
