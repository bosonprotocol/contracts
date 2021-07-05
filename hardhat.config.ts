import * as dotEnvConfig from 'dotenv'
dotEnvConfig.config();

import "solidity-coverage"
import 'hardhat-contract-sizer'
import "@nomiclabs/hardhat-etherscan"
import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-waffle"
import '@typechain/hardhat'

const { task } = require("hardhat/config");
const testMnemonic = 'inhale wood champion certain immense wash pepper enact enrich infant purse maid'

// const INFURA_KEY = process.env.INFURA_API_KEY;
// const DEPLOYER_PRIVATE_KEY = process.env.PK;

const lazyImport = async (module) => {
	return await import(module);
}

task("deploy", "Deploy contracts on a provided network")
	.setAction( async () => {
		const deploymentScript = await lazyImport('./scripts/deploy')
		await deploymentScript.default();
	})

task("contracts-verify", "Verify already deployed contracts. Bear in mind that at least couple of blocks should be mined before execution!")
	.setAction(async () => {
		const verifyScript = await lazyImport('./scripts/verify')
		await verifyScript.default();
	})

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
			accounts: {mnemonic: testMnemonic, count: 10},
			chainId: 1
		},
		// rinkeby: {
		// 	url: `https://rinkeby.infura.io/v3/${INFURA_KEY}`,
		// 	accounts: [
		// 		DEPLOYER_PRIVATE_KEY,
		// 	]
		// },
	},
	etherscan: {
		apiKey: process.env.ETHERSCAN_API_KEY
	},
	mocha: {
		timeout: 120000
	}
};

