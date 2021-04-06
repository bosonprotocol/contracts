require("@nomiclabs/hardhat-truffle5"); // todo do not use truffle plugin for tests
require("solidity-coverage");
require('hardhat-contract-sizer');
require('dotenv').config();
const {getAccounts, getAccountsWithBalance} = require('./config/getAccounts') //todo getAccounts might not be required

const INFURA_KEY = process.env.INFURA_API_KEY;
const DEPLOYER_PRIVATE_KEY = process.env.PK;

module.exports = {
	solidity: {
		version: "0.7.1",
		settings: {
			optimizer: {
				enabled: true,
				runs: 10
			}
		}
	},
	defaultNetwork: "hardhat",
	networks: {
		hardhat: {
			accounts: getAccountsWithBalance('privateKey'),
			chainId: 1
		},
		test: {
			url: `http://${process.env.HOST}:${process.env.PORT}`,
		},
		rinkeby: {
			url: `https://rinkeby.infura.io/v3/${INFURA_KEY}`,
			accounts: [
				DEPLOYER_PRIVATE_KEY,
			]
		},
	},
	mocha: {
		timeout: 120000
	}
};

