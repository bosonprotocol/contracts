let Web3 = require('web3');
let Contract = require('web3-eth-contract');
const Tx = require('ethereumjs-tx').Transaction;
let converter = require('hex2dec');
const BosonRouter = require('../../build/contracts/BosonRouter.json').abi;
const VoucherKernel = require('../../build/contracts/VoucherKernel.json').abi;
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

function faultVoucher(_voucherSetID) {
  return new Promise((resolve, reject) => {
    const bosonRouterAddr = contracts.BosonRouterContrctAddress;
    const bosonRouter = new Contract(BosonRouter, bosonRouterAddr);

    const voucherKernelAddr = contracts.VoucherKernelContractAddress;
    const voucherKernel = new Contract(VoucherKernel, voucherKernelAddr);

    let gasPaid = '0xF458F';
    // gets the current nounce of the sellers account and the proceeds to structure the transaction
    web3.eth.getTransactionCount(seller, function (error, txCount) {
      const encoded = bosonRouter.methods
        .cancelOrFault(_voucherSetID)
        .encodeABI();
      let rawTransaction = {
        nonce: web3.utils.toHex(txCount),
        gasPrice: '0x04e3b29200',
        gasLimit: gasPaid,
        to: bosonRouterAddr,
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
