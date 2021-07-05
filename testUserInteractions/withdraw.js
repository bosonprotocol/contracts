const axios = require('axios').default;
const process = {
  env: {
    API_URL: 'http://localhost:3000',
  },
};

const endpoints = {
  finalize: '/user-vouchers/finalize',
  createPayment: '/payments/create-payment',
};

const Cashier = require('../build/Cashier.json');

const ethers = require('ethers');

const provider = new ethers.providers.JsonRpcProvider();
const {
  DEPLOYER_SECRET,
  contracts,
  VOUCHER_ID,
  DB_VOUCHER_TO_MODIFY,
  SEND_TO_DB,
} = require('./config');
const deployer = new ethers.Wallet(DEPLOYER_SECRET, provider);

(async () => {
  let cashierContractDeployer = new ethers.Contract(
    contracts.CashierContractAddress,
    Cashier.abi,
    deployer
  );

  const txOrder = await cashierContractDeployer.withdraw([VOUCHER_ID]);
  const receipt = await txOrder.wait();

  let events = await findEventByName(
    receipt,
    'LogWithdrawal',
    '_caller',
    '_payee',
    '_payment'
  );

  for (const key in events) {
    events[key]._tokenIdVoucher = DB_VOUCHER_TO_MODIFY;
  }
  console.log('events');
  console.log(events);

  if (!SEND_TO_DB) return;
  await sendPayments(events);
})();

async function findEventByName(txReceipt, eventName, ...eventFields) {
  let eventsArr = [];

  for (const key in txReceipt.events) {
    if (txReceipt.events[key].event == eventName) {
      const event = txReceipt.events[key];

      const resultObj = {
        txHash: txReceipt.transactionHash,
      };

      for (let index = 0; index < eventFields.length; index++) {
        resultObj[eventFields[index]] =
          event.args[eventFields[index]].toString();
      }
      eventsArr.push(resultObj);
    }
  }

  return eventsArr;
}

async function sendPayments(events) {
  try {
    await axios.post(
      `${process.env.API_URL}${endpoints.createPayment}`,
      events
    );
  } catch (error) {
    console.log(error.response.data);
  }
}

/** Example events arr
[{
    txHash:
    '0xe69ccdc64c1a8273b7934636519cc921d3167e0b621ee3237549a82f49014813',
        _caller: '0xE33Cfa2B6ea374E38EFC0Ea08bfd2E3d5101e456',
        _payee: '0x39650Cd0969B1FE9e25E468150EC35E4002Bfdb1',
        _payment: '1000000000000000'
},
{
    txHash:
    '0xe69ccdc64c1a8273b7934636519cc921d3167e0b621ee3237549a82f49014813',
        _caller: '0xE33Cfa2B6ea374E38EFC0Ea08bfd2E3d5101e456',
        _payee: '0x5aF2b312eC207D78C4de4E078270F0d8700C01e2',
        _payment: '11000000000000000'
}]
 */
