let Web3 = require('web3');
let Contract = require('web3-eth-contract');
const helpers = require('../helpers/constants');
const Tx = require('ethereumjs-tx').Transaction;
const Utils = require('../helpers/utils');
let converter = require('hex2dec');
const BosonRouter = require('../../artifacts/contracts/BosonRouter.sol/BosonRouter.json')
  .abi;
const VoucherKernel = require('../../artifacts/contracts/VoucherKernel.sol/VoucherKernel.json')
  .abi;
const ERC1155ERC721 = require('../../artifacts/contracts/ERC1155ERC721.sol/ERC1155ERC721.json')
  .abi;
const Cashier = require('../../artifacts/contracts/Cashier.sol/Cashier.json')
  .abi;
let web3 = new Web3(new Web3.providers.HttpProvider(helpers.PROVIDER));

// set provider for all later instances to use
Contract.setProvider(helpers.PROVIDER);

function requestCancelorFault(_voucherSetID, users) {
  return new Promise((resolve, reject) => {
    const bosonRouter = new Contract(
      BosonRouter,
      Utils.contractBSNRouter.address
    );
    const voucherKernel = new Contract(
      VoucherKernel,
      Utils.contractVoucherKernel.address
    );
    const erc1155erc721 = new Contract(
      ERC1155ERC721,
      Utils.contractERC1155ERC721.address
    );
    const cashier = new Contract(Cashier, Utils.contractCashier.address);

    let gasSent = '0xF458F';
    // gets the current nounce of the sellers account and the proceeds to structure the transaction
    web3.eth.getTransactionCount(
      users.seller.address,
      function (error, txCount) {
        const encoded = bosonRouter.methods
          .requestCancelOrFaultVoucherSet(_voucherSetID)
          .encodeABI();
        let rawTransaction = {
          nonce: web3.utils.toHex(txCount),
          gasPrice: '0x04e3b29200',
          gasLimit: gasSent,
          to: Utils.contractBSNRouter.address,
          value: 0x0,
          data: encoded,
        };
        let privKey = Buffer.from(
          users.privateKeys[users.seller.address.toLowerCase()],
          'hex'
        );
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
              .getPastEvents('LogVoucherSetFaultCancel', {
                fromBlock: 'latest',
                toBlock: 'latest',
              })
              .then(function (logVoucherSetFaultCancelEvents) {
                erc1155erc721
                  .getPastEvents('TransferSingle', {
                    fromBlock: 'latest',
                    toBlock: 'latest',
                  })
                  .then(function (logTransferSingEvents) {
                    cashier
                      .getPastEvents('LogWithdrawal', {
                        fromBlock: 'latest',
                        toBlock: 'latest',
                      })
                      .then(function (logWithdrawalEvents) {
                        let gasUsed = receipt.gasUsed;
                        let txHash = receipt.transactionHash;
                        let VoucherSetID =
                          logVoucherSetFaultCancelEvents[0].returnValues
                            ._tokenIdSupply;
                        let SellerAddress =
                          logVoucherSetFaultCancelEvents[0].returnValues
                            ._issuer;
                        let operator =
                          logTransferSingEvents[0].returnValues._operator;
                        let transferFrom =
                          logTransferSingEvents[0].returnValues._from;
                        let transferTo =
                          logTransferSingEvents[0].returnValues._to;
                        let transferValue =
                          logTransferSingEvents[0].returnValues._value;
                        let redfundSellerDeposit =
                          logWithdrawalEvents[0].returnValues._payment;
                        let redfundSellerDepositRecipient =
                          logWithdrawalEvents[0].returnValues._payee;
                        let output = {
                          TransactionHash: txHash,
                          CanceledVoucherSetID: VoucherSetID,
                          SellerAddress: SellerAddress,
                          gasPaid: converter.hexToDec(gasSent),
                          gasUsed: gasUsed,
                          operator: operator,
                          transferFrom: transferFrom,
                          transferTo: transferTo,
                          transferValue: transferValue,
                          redfundedSellerDeposit: redfundSellerDeposit,
                          redfundSellerDepositRecipient: redfundSellerDepositRecipient,
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
      }
    );
  });
}

module.exports = requestCancelorFault;
