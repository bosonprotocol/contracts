let Web3 = require('web3');
let Contract = require('web3-eth-contract');
const Tx = require('ethereumjs-tx').Transaction;
let converter = require('hex2dec');
const VoucherKernelAbi = require('../../build/contracts/VoucherKernel.json')
  .abi;
const {
  SELLER_SECRET,
  SELLER_PUBLIC,
  contracts,
  PROVIDER,
} = require('../helpers/config');
let web3 = new Web3(new Web3.providers.HttpProvider(PROVIDER));
// set provider for all later instances to use
Contract.setProvider(PROVIDER);
const seller = SELLER_PUBLIC;

function TriggerExpiry(_voucherId) {
  return new Promise((resolve, reject) => {
    const voucherKernelAddr = contracts.VoucherKernelContractAddress;
    const voucherKernel = new Contract(VoucherKernelAbi, voucherKernelAddr);
    let gasSent = '0xF458F';
    // gets the current nonce of the sellers account and the proceeds to structure the transaction
    web3.eth.getTransactionCount(seller, function (error, txCount) {
      const encoded = voucherKernel.methods
        .triggerExpiration(_voucherId)
        .encodeABI();
      let rawTransaction = {
        nonce: web3.utils.toHex(txCount),
        gasPrice: '0x04e3b29200',
        gasLimit: gasSent,
        to: voucherKernelAddr,
        value: 0x0,
        data: encoded,
      };
      let privKey = Buffer.from(SELLER_SECRET, 'hex');
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
            console.log('Transaction Hash : ', hash);
          }
        )
        .on('receipt', function (receipt) {
          //Events array and args  not present in receipt, so retrieving explicitly
          voucherKernel
            .getPastEvents('LogExpirationTriggered', {
              fromBlock: 'latest',
              toBlock: 'latest',
            })
            .then(function (logExpirationTriggeredEvents) {
              let txhash = receipt.transactionHash;
              let gasUsed = receipt.gasUsed;
              let output = {
                TransactionHash: txhash,
                ExpiredVoucherID:
                  logExpirationTriggeredEvents[0].returnValues._tokenIdVoucher,
                TriggeredBy:
                  logExpirationTriggeredEvents[0].returnValues._triggeredBy,
                gasPaid: converter.hexToDec(gasSent),
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

module.exports = TriggerExpiry;
