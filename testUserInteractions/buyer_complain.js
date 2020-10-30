const VoucherKernel = require("../build/VoucherKernel.json");

const ethers = require('ethers');
const provider = new ethers.providers.JsonRpcProvider();
const { VOUCHER_ID, BUYER_SECRET, contracts } = require('./config');
const accountBuyer = new ethers.Wallet(BUYER_SECRET, provider); 

(async() => {
    let voucherKernelContract_Buyer = new ethers.Contract(contracts.VoucherKernelContractAddress, VoucherKernel.abi, accountBuyer)
    
    const tokenIdVoucher = VOUCHER_ID
    
    let txOrder = await voucherKernelContract_Buyer.complain(
        tokenIdVoucher, {gasLimit: '4000000'});
    
    const receipt = await txOrder.wait()
    
    let parsedEvent = await findEventByName(receipt, 'LogVoucherComplain', '_tokenIdVoucher')
    console.log('parsedEvent');
    console.log(parsedEvent);
    
})();

async function findEventByName(txReceipt, eventName, ...eventFields) {

    for (const key in txReceipt.events) {
        if (txReceipt.events[key].event == eventName) {
            const event = txReceipt.events[key]

            const resultObj = {
                txHash: txReceipt.transactionHash
            }

            for (let index = 0; index < eventFields.length; index++) {
                resultObj[eventFields[index]] = event.args[eventFields[index]].toString();
            }
            return resultObj
        }
    }
}

/**
 * EXAMPLE EVENT
{ txHash:
   '0xa00ae1284ad381e1aa2e172be82ca1c16968ea3cb25dec0ab67abd4cac7311c8',
  _tokenIdVoucher:
   '57896044618658097711785492504343953957600687722625682194895881280247472062467' }
 */