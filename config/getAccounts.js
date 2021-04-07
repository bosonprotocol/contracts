const fs = require('fs');
const privateKeys = JSON.parse(fs.readFileSync('config/accounts.json'))["private_keys"]

function getAccountsWithBalance(secretPropName) {
    return Object.entries(privateKeys)
        .map(entry => ({
            [secretPropName]: `0x${entry[1]}`,
            balance: '0x02b5e3af16b1880000' // 50 ETH
        }
    ))
}

module.exports = {
    getAccountsWithBalance,
};