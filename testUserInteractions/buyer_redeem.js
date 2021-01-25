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

  const tokenIdVoucher = VOUCHER_ID;

  let txOrder = await voucherKernelContract_Buyer.redeem(tokenIdVoucher, {
    gasLimit: '4000000',
  });

  const receipt = await txOrder.wait();

  let parsedEvent = await findEventByName(
    receipt,
    'LogVoucherRedeemed',
    '_tokenIdVoucher',
    '_holder',
    '_promiseId'
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
 *  EXAMPLE EVENT
{ txHash:
   '0x5c3b4c2a0c7062ddbe6eeb87615541b0ac663ec5920cdbc3d536b7e264bb2fe3',
  _tokenIdVoucher:
   '57896044618658097711785492504343953957600687722625682194895881280247472062466',
  _holder: '0xd4Fa489Eacc52BA59438993f37Be9fcC20090E39',
  _promiseId:
   '0x201fb46fee4d1db3d3256ffd44a7be8d4035bbf504cb8413393d3bc891e849d4' }
 */
