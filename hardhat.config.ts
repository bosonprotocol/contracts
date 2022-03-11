import * as dotEnvConfig from 'dotenv'
dotEnvConfig.config();

import "solidity-coverage"
import 'hardhat-contract-sizer'
import "hardhat-gas-reporter"
import "@nomiclabs/hardhat-etherscan"
import "@nomiclabs/hardhat-waffle"
import '@typechain/hardhat'
import 'hardhat-abi-exporter'
import { HardhatUserConfig } from "hardhat/config";

const { task } = require("hardhat/config");
const testMnemonic = 'inhale wood champion certain immense wash pepper enact enrich infant purse maid'
const RINKEBY_URL = process.env.RINKEBY_URL;
const ROPSTEN_URL = process.env.ROPSTEN_URL;
const MAINNET_URL = process.env.MAINNET_URL;
const PROTOCOL_DEPLOYER_PRIVATE_KEY = process.env.PROTOCOL_DEPLOYER_PRIVATE_KEY;
const CC_TOKEN_DEPLOYER_PRIVATE_KEY = process.env.CC_TOKEN_DEPLOYER_PRIVATE_KEY;
const CMC_API_KEY = process.env.CMC_API_KEY;
const ACCOUNTS = [PROTOCOL_DEPLOYER_PRIVATE_KEY, CC_TOKEN_DEPLOYER_PRIVATE_KEY];

const lazyImport = async (module) => {
	return await import(module);
}

task("deploy", "Deploy protocol contracts on a provided network")
	.addOptionalParam("env", "(Optional) Provide additional context on which environment the contracts are deployed to: production, staging or testing", "")
	.setAction( async ({env}) => {
		const { deploy } = await lazyImport('./scripts/deploy')
		await deploy(env);
	})

task("deploy-with-erc1155", "Deploy protocol contracts and a ERC1155NonTransferable contract on a provided network [== v1.0 deployment script]")
	.addOptionalParam("env", "(Optional) Provide additional context on which environment the contracts are deployed to: production, staging or testing", "")
	.setAction( async ({env}) => {
		const { deploy } = await lazyImport('./scripts/deploy-legacy')
		await deploy(env);
	})

task("deploy-erc1155-only", "Deploy a ERC1155NonTransferable contract on a provided network")
	.addOptionalParam("env", "(Optional) Provide additional context on which environment the contracts are deployed to: production, staging or testing", "")
	.setAction( async ({env}) => {
		const { deploy } = await lazyImport('./scripts/deploy-erc1155-non-transferable')
		await deploy(env);
	})

task("deploy-mocks", "Deploy mock conditional token contracts (ERC20, ERC721, ERC1155) on a provided network")
	.addOptionalParam("env", "(Optional) Provide additional context on which environment the contracts are deployed to: production, staging or testing", "")
	.setAction( async ({env}) => {
		const { deploy } = await lazyImport('./scripts/deploy-mocks')
		await deploy(env);
	})

task("contracts-verify", "Verify already deployed contracts. Bear in mind that at least couple of blocks should be mined before execution!")
	.addOptionalParam("env", "(Optional) Provide additional context on which environment the contracts are deployed to: production, staging or testing", "")
	.setAction(async ({env}) => {
		const { verifyContracts } = await lazyImport('./scripts/verify')
		await verifyContracts(env);
	})

task("deploy-gate", "Deploy and verify the Gate contract on a provided network")
.addOptionalParam("env", "(Optional) Provide additional context on which environment the contracts are deployed to: production, staging or testing", "")
.setAction( async ({env}) => {
		const { deploy } = await lazyImport('./scripts/deploy-gate')
		await deploy(env);
	})

task("verify-gate", "Deploy and verify the Gate contract on a provided network")
.addOptionalParam("env", "(Optional) Provide additional context on which environment the contracts are deployed to: production, staging or testing", "")
.setAction( async ({env}) => {
		const { verifyContracts } = await lazyImport('./scripts/verify-gate')
		await verifyContracts(env);
	})

const config: HardhatUserConfig = {
	solidity: {
		version: "0.7.6",
		settings: {
			optimizer: {
				enabled: true,
				runs: 200
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
			url: RINKEBY_URL,
			accounts: ACCOUNTS,
			chainId: 4
		},
		ropsten: {
			url: ROPSTEN_URL,
			accounts: ACCOUNTS,
			chainId: 3
		},
		mainnet: {
			url: MAINNET_URL,
			accounts: ACCOUNTS,
			initialBaseFeePerGas: 0,
			chainId: 1
		},
	},
	etherscan: {
		apiKey: process.env.ETHERSCAN_API_KEY
	},
	mocha: {
		timeout: 120000
	},
	contractSizer: {
		alphaSort: true,
		disambiguatePaths: false,
		runOnCompile: false,
		strict: true
	},
	gasReporter: {
		currency: 'USD',
		coinmarketcap: CMC_API_KEY,
		excludeContracts: ['mocks/'],
		outputFile: 'GasReport.txt'
	}
};

export default config;
