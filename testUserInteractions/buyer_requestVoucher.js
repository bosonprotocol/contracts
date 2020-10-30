const Cashier = require("../build/Cashier.json");
const helpers = require('../testHelpers/constants')

const ethers = require('ethers');
const provider = new ethers.providers.JsonRpcProvider();
const { SELLER_PUBLIC, BUYER_SECRET, contracts, TOKEN_SUPPLY_ID } = require('./config');
const accountBuyer = new ethers.Wallet(BUYER_SECRET, provider); 


(async () => {

    let cashierContract_Buyer = new ethers.Contract(contracts.CashierContractAddress, Cashier.abi, accountBuyer)

    const tokenSupplyKey = TOKEN_SUPPLY_ID
    
    const buyerDeposit = helpers.buyer_deposit;
    const price = helpers.product_price;
    const txValue = ethers.BigNumber.from(buyerDeposit).add(ethers.BigNumber.from(price))


    let txOrder = await cashierContract_Buyer.requestVoucher(
        tokenSupplyKey,
        SELLER_PUBLIC,
        { value: txValue.toString()}
    );

    const receipt = await txOrder.wait()

    let parsedEvent = await findEventByName(receipt, 'LogVoucherDelivered', '_tokenIdSupply', '_tokenIdVoucher', '_issuer', '_holder', '_promiseId')
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
  { tokenIdSuppy:
   '57896044618658097711785492504343953955558993521100051414115633635656862793728',
  tokenIdVoucher:
   '57896044618658097711785492504343953955558993521100051414115633635656862793733',
  issuer: '0xD9995BAE12FEe327256FFec1e3184d492bD94C31',
  holder: '0xd4Fa489Eacc52BA59438993f37Be9fcC20090E39',
  promiseId:
   '0x3c654b884252d1ea1fa50c47718de4a4868587631708d184b5f157da15ed2889',
  txHash:
   '0xa2acb1af433d4a4bde65e84e69c92817b3d8c37c81b19f7e1b42c3025b31d20b' }
 */