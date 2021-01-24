const VoucherKernel = require('../build/VoucherKernel.json');

const ethers = require('ethers');
const provider = new ethers.providers.JsonRpcProvider();
const {VOUCHER_ID, BUYER_SECRET, contracts} = require('./config');
const accountBuyer = new ethers.Wallet(BUYER_SECRET, provider);

(async () => {
  let voucherKernelContract_Buyer = new ethers.Contract(
    contracts.VoucherKernelContractAddress,
    VoucherKernel.abi,
    accountBuyer
  );

  let txOrder = await voucherKernelContract_Buyer.refund(VOUCHER_ID, {
    gasLimit: '4000000',
  });

  const receipt = await txOrder.wait();

  let parsedEvent = await findEventByName(
    receipt,
    'LogVoucherRefunded',
    '_tokenIdVoucher'
  );
  console.log('parsedEvent');
  console.log(parsedEvent);
})();

async function findEventByName(txReceipt, eventName, ...eventFields) {
  for (const key in txReceipt.events) {
    if (txReceipt.events[key].event == eventName) {
      const event = txReceipt.events[key];

      const resultObj = {
        txHash: txReceipt.transactionHash,
      };

      for (let index = 0; index < eventFields.length; index++) {
        resultObj[eventFields[index]] = event.args[
          eventFields[index]
        ].toString();
      }
      return resultObj;
    }
  }
}

/**
{ txHash:
   '0x8cd2840d6a2e2b9cf7995380256bb28606cd520aa345a1a61359ace0a31e1d5c',
  _tokenIdVoucher:
   '57896044618658097711785492504343953957600687722625682194895881280247472062467' }
 */
