const {getAccountsWithBalance} = require('./config/getAccounts')

module.exports = {
    port: 8555,
    testCommand: 'mocha --timeout 5000',
    measureStatementCoverage: false,
    providerOptions: { accounts: getAccountsWithBalance('secretKey') }
};
