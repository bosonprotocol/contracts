let Contract = require('web3-eth-contract');
const VoucherKernelAbi = require('../../build/contracts/VoucherKernel.json')
  .abi;
const {contracts, PROVIDER} = require('../helpers/config');
// set provider for all later instances to use
Contract.setProvider(PROVIDER);

function checkVoucherStatus(_voucherID) {
  return new Promise((resolve) => {
    const voucherKernelAddr = contracts.VoucherKernelContractAddress;
    const voucherKernel = new Contract(VoucherKernelAbi, voucherKernelAddr);
    voucherKernel.methods
      .getVoucherStatus(_voucherID)
      .call()
      .then(function (result) {
        let output = {
          voucherID: _voucherID,
          Status: result[0],
        };
        return resolve(output);
      });
  });
}

module.exports = checkVoucherStatus;
