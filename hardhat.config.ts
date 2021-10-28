import * as dotEnvConfig from 'dotenv'
dotEnvConfig.config();

import "solidity-coverage"
import 'hardhat-contract-sizer'
import "@nomiclabs/hardhat-etherscan"
import "@nomiclabs/hardhat-waffle"
import '@typechain/hardhat'
import 'hardhat-abi-exporter'
import { HardhatUserConfig } from "hardhat/config";

const { task } = require("hardhat/config");
const testMnemonic = 'inhale wood champion certain immense wash pepper enact enrich infant purse maid'
const INFURA_KEY = process.env.INFURA_API_KEY;
const PROTOCOL_DEPLOYER_PRIVATE_KEY = process.env.PROTOCOL_DEPLOYER_PRIVATE_KEY;
const CC_TOKEN_DEPLOYER_PRIVATE_KEY = process.env.CC_TOKEN_DEPLOYER_PRIVATE_KEY;
const ACCOUNTS =
  PROTOCOL_DEPLOYER_PRIVATE_KEY && CC_TOKEN_DEPLOYER_PRIVATE_KEY
    ? [PROTOCOL_DEPLOYER_PRIVATE_KEY, CC_TOKEN_DEPLOYER_PRIVATE_KEY]
    : [];

const lazyImport = async (module) => {
	return await import(module);
}

task("deploy", "Deploy contracts on a provided network")
	.addOptionalParam("env", "Which environment is going to be used for contract deployment. Choose between prod, demo, dev or empty for local deployment", "hardhat")
	.setAction( async ({env}) => {
		const { deploy } = await lazyImport('./scripts/deploy')
		await deploy(env);
	})

task("contracts-verify", "Verify already deployed contracts. Bear in mind that at least couple of blocks should be mined before execution!")
	.addOptionalParam("env", "Which environment is going to be used for contract deployment. Choose between prod, demo & dev", "dev")
	.setAction(async ({env}) => {
		const { verifyContracts } = await lazyImport('./scripts/verify')
		await verifyContracts(env);
	})

const config: HardhatUserConfig = {
	solidity: {
		version: "0.7.6",
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
		rinkeby: {
			url: `https://rinkeby.infura.io/v3/${INFURA_KEY}`,
			accounts: ACCOUNTS
		},
		ropsten: {
			url: `https://ropsten.infura.io/v3/${INFURA_KEY}`,
			accounts: ACCOUNTS
		},
	},
	etherscan: {
		apiKey: process.env.ETHERSCAN_API_KEY
	},
	mocha: {
		timeout: 120000
	}
};

export default config;
