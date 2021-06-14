// import fs from 'fs';
// const privateKeys = JSON.parse(fs.readFileSync('config/accounts.json', 'utf8'))[
//   'private_keys'
// ];

// export default function getAccountsWithBalance(secretPropName) : Array<any> {
//   return Object.entries(privateKeys).map((entry) => ({
//     [secretPropName]: `0x${entry[1]}`,
//     balance: '0x02b5e3af16b1880000', // 50 ETH
//   }));
// }
