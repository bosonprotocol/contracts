const VoucherKernel = require("../build/VoucherKernel.json");

const ethers = require('ethers');
const provider = new ethers.providers.JsonRpcProvider();

const { SELLER_SECRET, VOUCHER_ID,
    DB_VOUCHER_TO_MODIFY, contracts, SEND_TO_DB } = require('./config');

const seller = new ethers.Wallet(SELLER_SECRET, provider); 
const axios = require('axios').default;

(async() => {
    let voucherKernelContract_Buyer = new ethers.Contract(contracts.VoucherKernelContractAddress, VoucherKernel.abi, seller)
    const tokenIdVoucher = VOUCHER_ID 
    
    let txOrder = await voucherKernelContract_Buyer.triggerFinalizeVoucher(
        tokenIdVoucher, {gasLimit: '4000000'});
    
    const receipt = await txOrder.wait()
    let parsedEvent = await findEventByName(receipt, 'LogFinalizeVoucher', '_tokenIdVoucher', '_triggeredBy')


    if(parsedEvent) {
        parsedEvent[0]._tokenIdVoucher = DB_VOUCHER_TO_MODIFY
        const payload = [{
            ...parsedEvent[0],
            status: "FINALIZED"
        }]
        console.log('Payload!');
        console.log(payload);

        if(!SEND_TO_DB) return

        try {
            await axios.patch(`http://localhost:3000/user-vouchers/finalize`, payload)
        } catch (error) {
            console.log(error);
        }
    }
    
})();

async function findEventByName(txReceipt, eventName, ...eventFields) {
    let eventsArr = [];

    for (const key in txReceipt.events) {
        if (txReceipt.events[key].event == eventName) {
            const event = txReceipt.events[key]

            const resultObj = {
                txHash: txReceipt.transactionHash
            }

            for (let index = 0; index < eventFields.length; index++) {
                resultObj[eventFields[index]] = event.args[eventFields[index]].toString();
            }
            eventsArr.push(resultObj)
        }
    }

    return eventsArr
}

/**
{ txHash:
   '0xa96d9f92e73f1aa2a489a492c0cecb6d799b3cac807a93a298a84662c078b574',
  _tokenIdVoucher:
   '57896044618658097711785492504343953926975274699741220483192166611388333031426',
  _triggeredBy: '0x5aF2b312eC207D78C4de4E078270F0d8700C01e2' }
 */

 //should be like this
 /**
 { "txHash":"0xa96d9f92e73f1aa2a489a492c0cecb6d799b3cac807a93a298a84662c078b574",
  "_tokenIdVoucher":"57896044618658097711785492504343953926975274699741220483192166611388333031426",
  "_triggeredBy": "0x5aF2b312eC207D78C4de4E078270F0d8700C01e2",
  "status": "FINALIZED"
}
  */