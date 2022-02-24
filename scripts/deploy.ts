//AssetRegistry not used in demo-app
//const AssetRegistry = artifacts.require("AssetRegistry");

import hre from 'hardhat';
import fs from 'fs';
import {isValidEnv, addressesDirPath, getAddressesFilePath} from './utils';
import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
import constants from '../testHelpers/constants';
import packageFile from '../package.json';

const {TOKEN_TYPE} = constants;
const ethers = hre.ethers;

/**
 * Abstract Class DeploymentExecutor.
 *
 * @class DeploymentExecutor
 */
class DeploymentExecutor {
  env;
  tokenRegistry;
  voucherSets;
  vouchers;
  voucherKernel;
  cashier;
  br;
  eth_limit;
  boson_token;
  boson_token_limit;
  daiTokenWrapper;
  dai_token;
  dai_token_limit;
  erc1155NonTransferable;
  complainPeriod;
  cancelFaultPeriod;
  maxTip;
  txOptions;

  constructor() {
    if (this.constructor == DeploymentExecutor) {
      throw new Error("Abstract class - can't be instantiated!");
    }

    this.env;

    this.tokenRegistry;
    this.voucherSets;
    this.vouchers;
    this.voucherKernel;
    this.cashier;
    this.br;

    this.eth_limit = process.env.ETH_LIMIT;
    this.boson_token = process.env.BOSON_TOKEN;
    this.boson_token_limit = process.env.BOSON_TOKEN_LIMIT;
    this.daiTokenWrapper;
    this.dai_token = process.env.DAI_TOKEN;
    this.dai_token_limit = process.env.DAI_TOKEN_LIMIT;
    this.erc1155NonTransferable;

    this.complainPeriod = process.env.COMPLAIN_PERIOD;
    this.cancelFaultPeriod = process.env.CANCEL_FAULT_PERIOD;

    this.maxTip = ethers.utils.parseUnits(
      process.env.MAX_TIP ? String(process.env.MAX_TIP) : '1',
      'gwei'
    );

    this.txOptions = {
      maxPriorityFeePerGas: this.maxTip,
      gasLimit: 4500000, // our current max contract is around 4.2m gas
    };
  }

  async setDefaults() {
    let tx, txReceipt, event;

    console.log('$ Setting initial values ...');

    tx = await this.voucherSets.setApprovalForAll(
      this.voucherKernel.address,
      'true',
      this.txOptions
    );
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '\n$ VoucherSets: ',
      event.event,
      'approved VoucherKernel:',
      event.args.approved
    );

    tx = await this.voucherSets.setContractUri(
      process.env.VOUCHERSETS_CONTRACT_URI,
      this.txOptions
    );
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '\n$ VoucherSets: ',
      event.event,
      'has set a ContractUri:',
      event.args._contractUri
    );

    tx = await this.vouchers.setApprovalForAll(
      this.voucherKernel.address,
      'true',
      this.txOptions
    );
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '\n$ Vouchers: ',
      event.event,
      'approved VoucherKernel:',
      event.args.approved
    );

    tx = await this.vouchers.setContractUri(
      process.env.VOUCHERS_CONTRACT_URI,
      this.txOptions
    );
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '\n$ Vouchers: ',
      event.event,
      'has set a ContractUri:',
      event.args._contractUri
    );

    tx = await this.tokenRegistry.setTokenWrapperAddress(
      this.dai_token,
      this.daiTokenWrapper.address,
      this.txOptions
    );

    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '$ TokenRegistry',
      event.event,
      'at:',
      event.args._newWrapperAddress
    );

    tx = await this.tokenRegistry.setTokenWrapperAddress(
      this.boson_token,
      this.boson_token,
      this.txOptions
    );

    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '$ TokenRegistry',
      event.event,
      'at:',
      event.args._newWrapperAddress
    );

    console.log(
      '$ ERC1155NonTransferable URI ',
      'set to :',
      await this.erc1155NonTransferable.uri(1)
    );
  }

  async deployContracts() {
    const signers = await ethers.getSigners();
    let [, ccTokenDeployer] = signers;
    const [primaryDeployer] = signers;

    if (
      process.env.PROTOCOL_DEPLOYER_PRIVATE_KEY ==
      process.env.CC_TOKEN_DEPLOYER_PRIVATE_KEY
    ) {
      ccTokenDeployer = primaryDeployer;
    }

    const contractList = [
      'tokenRegistry',
      'voucherSets',
      'vouchers',
      'voucherKernel',
      'cashier',
      'br',
      'daiTokenWrapper',
    ];

    const ccContractAddresses = await calculateDeploymentAddresses(
      ccTokenDeployer.address,
      ['erc1155NonTransferable']
    );

    const VoucherSets = await ethers.getContractFactory('VoucherSets');
    const Vouchers = await ethers.getContractFactory('Vouchers');
    const VoucherKernel = await ethers.getContractFactory('VoucherKernel');
    const Cashier = await ethers.getContractFactory('Cashier');
    const BosonRouter = await ethers.getContractFactory('BosonRouter');
    const TokenRegistry = await ethers.getContractFactory('TokenRegistry');
    const DAITokenWrapper = await ethers.getContractFactory('DAITokenWrapper');
    const ERC1155NonTransferable = await ethers.getContractFactory(
      'ERC1155NonTransferable'
    );

    //ERC1155NonTransferrable is a Conditional Commit token and should be deployed from a separate address
    const ERC1155NonTransferableAsOtherSigner =
      ERC1155NonTransferable.connect(ccTokenDeployer);

    //ERC1155NonTransferrable is a Conditional Commit token and should be deployed from a separate address
    this.erc1155NonTransferable =
      await ERC1155NonTransferableAsOtherSigner.deploy(
        process.env.CONDITIONAL_COMMIT_TOKEN_METADATA_URI,
        this.txOptions
      );

    await this.erc1155NonTransferable.deployed();

    const contractAddresses = await calculateDeploymentAddresses(
      primaryDeployer.address,
      contractList
    );

    this.tokenRegistry = await TokenRegistry.deploy(this.txOptions);
    this.voucherSets = await VoucherSets.deploy(
      process.env.VOUCHERSETS_METADATA_URI,
      contractAddresses.cashier,
      contractAddresses.voucherKernel,
      this.txOptions
    );
    this.vouchers = await Vouchers.deploy(
      process.env.VOUCHERS_METADATA_URI,
      'Boson Smart Voucher',
      'BSV',
      contractAddresses.cashier,
      contractAddresses.voucherKernel,
      this.txOptions
    );
    this.voucherKernel = await VoucherKernel.deploy(
      contractAddresses.br,
      contractAddresses.cashier,
      contractAddresses.voucherSets,
      contractAddresses.vouchers,
      this.txOptions
    );
    this.cashier = await Cashier.deploy(
      contractAddresses.br,
      contractAddresses.voucherKernel,
      contractAddresses.voucherSets,
      contractAddresses.vouchers,
      this.txOptions
    );
    this.br = await BosonRouter.deploy(
      contractAddresses.voucherKernel,
      contractAddresses.tokenRegistry,
      contractAddresses.cashier,
      this.txOptions
    );
    this.daiTokenWrapper = await DAITokenWrapper.deploy(
      this.dai_token,
      this.txOptions
    );
   
    await this.tokenRegistry.deployed();
    await this.voucherSets.deployed();
    await this.vouchers.deployed();
    await this.voucherKernel.deployed();
    await this.cashier.deployed();
    await this.br.deployed();
    await this.daiTokenWrapper.deployed();

    // check that expected and actual addresses match
    for (const contract of contractList) {
      if (
        this[contract].address.toLowerCase() !==
        contractAddresses[contract].toLowerCase()
      ) {
        console.log(
          `${contract} address mismatch. Expected ${contractAddresses[contract]}, actual ${this[contract].address}`
        );
      }
    }

    if (
      this.erc1155NonTransferable.address.toLowerCase() !==
      ccContractAddresses.erc1155NonTransferable.toLowerCase()
    ) {
      console.log(
        `erc1155NonTransferable address mismatch. Expected ${ccContractAddresses.erc1155NonTransferable}, actual ${this.erc1155NonTransferable.address}`
      );
    }
  }

  async deployMockToken() {
    //only deploy the mock for local environment using default deployer address
    if (hre.network.name == 'hardhat' || hre.network.name == 'localhost') {
      console.log('$ Deploying mock Boson Token');

      const MockBosonToken = await ethers.getContractFactory('MockERC20Permit');
      const mockBosonToken = await MockBosonToken.deploy(
        'Mock Boson Token',
        'BOSON'
      );

      await mockBosonToken.deployed();
      this.boson_token = mockBosonToken.address;
    } else {
      console.log('$ Not local deployment. NOT deploying mock Boson Token');
    }
  }

  logContracts() {
    console.log(
      '\nToken Registry Contract Address  %s from deployer address %s: ',
      this.tokenRegistry.address,
      this.tokenRegistry.deployTransaction.from
    );
    console.log(
      'VoucherSets Contract Address  %s from deployer address %s: ',
      this.voucherSets.address,
      this.voucherSets.deployTransaction.from
    );
    console.log(
      'Vouchers Contract Address  %s from deployer address %s: ',
      this.vouchers.address,
      this.vouchers.deployTransaction.from
    );
    console.log(
      'VoucherKernel Contract Address  %s from deployer address %s: ',
      this.voucherKernel.address,
      this.voucherKernel.deployTransaction.from
    );
    console.log(
      'Cashier Contract Address  %s from deployer address %s: ',
      this.cashier.address,
      this.cashier.deployTransaction.from
    );
    console.log(
      'Boson Router Contract Address  %s from deployer address %s: ',
      this.br.address,
      this.br.deployTransaction.from
    );
    console.log(
      'DAI Token Wrapper Contract Address  %s from deployer address %s: ',
      this.daiTokenWrapper.address,
      this.daiTokenWrapper.deployTransaction.from
    );

    console.log(
      'ERC1155NonTransferable Contract Address: %s from deployer address %s',
      this.erc1155NonTransferable.address,
      this.erc1155NonTransferable.deployTransaction.from
    );

    console.log('DAI Token Address Used: ', this.dai_token);
    console.log('Boson Token Address Used: ', this.boson_token);
  }

  writeContracts() {
    if (!fs.existsSync(addressesDirPath)) {
      fs.mkdirSync(addressesDirPath);
    }

    fs.writeFileSync(
      getAddressesFilePath(hre.network.config.chainId, this.env),
      JSON.stringify(
        {
          chainId: hre.network.config.chainId,
          env: this.env || '',
          protocolVersion: packageFile.version,
          tokenRegistry: this.tokenRegistry.address,
          voucherSets: this.voucherSets.address,
          vouchers: this.vouchers.address,
          voucherKernel: this.voucherKernel.address,
          cashier: this.cashier.address,
          bosonRouter: this.br.address,
          daiTokenWrapper: this.daiTokenWrapper.address,
          erc1155NonTransferable: this.erc1155NonTransferable.address,
          daiToken: this.dai_token,
          bosonToken: this.boson_token,
        },
        null,
        2
      ),
      'utf-8'
    );
  }
}

/**
 * @class ProdExecutor
 * @extends {DeploymentExecutor}
 */
class ProdExecutor extends DeploymentExecutor {
  constructor() {
    super();
    this.boson_token = process.env.BOSON_TOKEN;
  }

  async setDefaults() {
    await super.setDefaults();

    await this.tokenRegistry.setETHLimit(this.eth_limit, this.txOptions);
    console.log(`Set ETH limit: ${this.eth_limit}`);
    await this.tokenRegistry.setTokenLimit(
      this.boson_token,
      this.boson_token_limit,
      this.txOptions
    );
    console.log(`Set Boson token limit: ${this.boson_token_limit}`);
    await this.tokenRegistry.setTokenLimit(
      this.dai_token,
      this.dai_token_limit,
      this.txOptions
    );
    console.log(`Set Dai token limit: ${this.dai_token_limit}`);
  }
}

/**
 * @class NonProdExecutor
 * @extends {DeploymentExecutor}
 */
class NonProdExecutor extends DeploymentExecutor {
  constructor(env) {
    super();
    this.env = env;
  }

  async setDefaults() {
    await super.setDefaults();
    await this.voucherKernel.setComplainPeriod(
      this.complainPeriod,
      this.txOptions
    );
    await this.voucherKernel.setCancelFaultPeriod(
      this.cancelFaultPeriod,
      this.txOptions
    );
    await this.tokenRegistry.setETHLimit(this.eth_limit, this.txOptions);
    await this.tokenRegistry.setTokenLimit(
      this.boson_token,
      this.boson_token_limit,
      this.txOptions
    );
    await this.tokenRegistry.setTokenLimit(
      this.dai_token,
      this.dai_token_limit,
      this.txOptions
    );
  }
}

export async function deploy(_env: string): Promise<void> {
  const env = _env.toLowerCase();

  if (!isValidEnv(env)) {
    throw new Error(`Env: ${env} is not recognized!`);
  }

  const executor =
    env == 'production' ? new ProdExecutor() : new NonProdExecutor(env);

  await executor.deployContracts();
  await executor.deployMockToken(); //only deploys mock locally

  executor.logContracts();
  executor.writeContracts();

  await executor.setDefaults();
}
