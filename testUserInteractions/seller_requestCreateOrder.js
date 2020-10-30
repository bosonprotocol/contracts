
const Cashier = require("../build/Cashier.json");
const helpers = require('../testHelpers/constants')

const ethers = require('ethers');
const provider = new ethers.providers.JsonRpcProvider();
const { SELLER_SECRET, contracts } = require('./config');

const seller = new ethers.Wallet(SELLER_SECRET, provider); 

(async() => {
    let cashierContractSeller = new ethers.Contract(contracts.CashierContractAddress, Cashier.abi, seller)
    const sellerDepoist = helpers.seller_deposit;
    const qty = 50
    const txValue = ethers.BigNumber.from(sellerDepoist.toString()).mul(qty)

    let txOrder = await cashierContractSeller.requestCreateOrder(
        helpers.ASSET_TITLE,
        helpers.PROMISE_VALID_FROM,
        helpers.PROMISE_VALID_TO, 
        helpers.product_price, 
        sellerDepoist, 
        helpers.buyer_deposit,
        qty, 
        { value: txValue.toString(), gasLimit: 4600000 }); 

    const receipt = await txOrder.wait()
    
    let parsedEvent = await findEventByName(receipt, 'LogOrderCreated', '_tokenIdSupply', '_seller', '_promiseId', '_quantity')
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

//EXAMPLE
/**
{ tokenIdSuppy:
   '57896044618658097711785492504343953955558993521100051414115633635656862793728',
  seller: '0xD9995BAE12FEe327256FFec1e3184d492bD94C31',
  promiseID:
   '0x3c654b884252d1ea1fa50c47718de4a4868587631708d184b5f157da15ed2889',
  qty: '10',
  txHash:
   '0x8cfa03728d03dfb868e01caf3081f29f5f30d0173fbc191166ac9289275ff804' }
 */