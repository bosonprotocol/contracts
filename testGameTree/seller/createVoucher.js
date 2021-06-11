let Web3 = require('web3');
const BN = require('bn.js');
let Contract = require('web3-eth-contract');
const helpers = require('../helpers/constants');
const Tx = require('ethereumjs-tx').Transaction;
const Utils = require('../helpers/utils');
let converter = require('hex2dec');
const BosonRouter = require('../../build/contracts/BosonRouter.json').abi;
const VoucherKernel = require('../../build/contracts/VoucherKernel.json').abi;
const ERC1155ERC721 = require('../../build/contracts/ERC1155ERC721.json').abi;
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
const networkId = web3.eth.net.getId();

console.log("networkId in createVoucher.js", networkId);

function CreateOrderETHETH(timestamp) {
  return new Promise((resolve, reject) => {
    const bosonRouter = new Contract(BosonRouter, Utils.contractBSNRouter.address);
    const voucherKernel = new Contract(VoucherKernel, Utils.contractVoucherKernel.address);
    const erc1155erc721 = new Contract(ERC1155ERC721, Utils.contractERC1155ERC721.address);

    let gasSent = '0xF458F';

    helpers.PROMISE_VALID_FROM = timestamp;
    helpers.PROMISE_VALID_TO = timestamp + 2 * helpers.SECONDS_IN_DAY;

    // gets the current nonce of the sellers account and the proceeds to structure the transaction
    web3.eth.getTransactionCount(seller, function (error, txCount) {
      const txValue = new BN(helpers.PROMISE_PRICE1);
      const encoded = bosonRouter.methods
        .requestCreateOrderETHETH([
          new BN(helpers.PROMISE_VALID_FROM),
          new BN(helpers.PROMISE_VALID_TO),
          new BN(helpers.PROMISE_PRICE1),
          new BN(helpers.PROMISE_DEPOSITSE1),
          new BN(helpers.PROMISE_DEPOSITBU1),
          new BN(helpers.ORDER_QUANTITY1),
        ])
        .encodeABI();
      let rawTransaction = {
        nonce: web3.utils.toHex(txCount),
        gasPrice: '0x04e3b29200',
        gasLimit: gasSent,
        to: Utils.contractBSNRouter.address,
        value: txValue,
        data: encoded,
      };
      let privKey = Buffer.from(SELLER_SECRET, 'hex');
      let tx = new Tx(rawTransaction, {chain: 'rinkeby' });
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
          bosonRouter
            .getPastEvents('LogOrderCreated', {
              fromBlock: 'latest',
              toBlock: 'latest',
            })
            .then(function (logOrderCreatedEvents) {
              voucherKernel
                .getPastEvents('LogPromiseCreated', {
                  fromBlock: 'latest',
                  toBlock: 'latest',
                })
                .then(function (logPromiseCreatedEvents) {
                  erc1155erc721
                    .getPastEvents('TransferSingle', {
                      fromBlock: 'latest',
                      toBlock: 'latest',
                    })
                    .then(function (logTransferSingEvents) {
                      let txhash = receipt.transactionHash;
                      let gasUsed = receipt.gasUsed;
                      let validFrom =
                        logPromiseCreatedEvents[0].returnValues._validFrom;
                      let validTo =
                        logPromiseCreatedEvents[0].returnValues._validTo;
                      let nftID =
                        logOrderCreatedEvents[0].returnValues._tokenIdSupply;
                      let nftSupply =
                        logOrderCreatedEvents[0].returnValues._quantity;
                      let nftSeller =
                        logOrderCreatedEvents[0].returnValues._seller;
                      let paymentType =
                        logOrderCreatedEvents[0].returnValues._paymentType;
                      let operator =
                        logTransferSingEvents[0].returnValues._operator;
                      let transferFrom =
                        logTransferSingEvents[0].returnValues._from;
                      let transferTo =
                        logTransferSingEvents[0].returnValues._to;
                      let transferValue =
                        logTransferSingEvents[0].returnValues._value;

                      let output = {
                        TransactionHash: txhash,
                        ValidFrom: validFrom,
                        ValidTo: validTo,
                        createdVoucherSetID: nftID,
                        nftSupply: nftSupply,
                        nftSeller: nftSeller,
                        paymentType: paymentType,
                        operator: operator,
                        transferFrom: transferFrom,
                        transferTo: transferTo,
                        transferValue: transferValue,
                        gasPaid: converter.hexToDec(gasSent),
                        gasUsed: gasUsed,
                      };
                      resolve(output);
                    })
                    .catch(reject);
                })
                .catch(reject);
            })
            .catch(reject);
        })
        .on('error', console.error);
    });
  });
}

module.exports = CreateOrderETHETH;
