const fs = require('fs');

const privateKeys =
  JSON.parse(fs.readFileSync('config/accounts.json'))["private_keys"]
const accounts = Object.entries(privateKeys)
  .map(entry => ({
      secretKey: `0x${entry[1]}`,
      balance: '0x01158e460913d00000'
  }))

module.exports = {
    port: 8555,
    testCommand: 'mocha --timeout 5000',
    measureStatementCoverage: false,
    providerOptions: { accounts }
};
