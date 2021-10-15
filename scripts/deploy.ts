//AssetRegistry not used in demo-app
//const AssetRegistry = artifacts.require("AssetRegistry");

import hre from 'hardhat';
import fs from 'fs';
import {isValidEnv} from './env-validator';
const ethers = hre.ethers;

/**
 * Abstract Class DeploymentExecutor.
 *
 * @class DeploymentExecutor
 */
class DeploymentExecutor {
  env;
  tokenRegistry;
  erc1155erc721;
  voucherKernel;
  cashier;
  br;
  boson_token;
  TOKEN_LIMIT;
  daiTokenWrapper;
  dai_token;
  gate;
  erc1155NonTransferable;

  constructor() {
    if (this.constructor == DeploymentExecutor) {
      throw new Error("Abstract class - can't be instantiated!");
    }

    this.env;

    this.tokenRegistry;
    this.erc1155erc721;
    this.voucherKernel;
    this.cashier;
    this.br;

    this.boson_token;
    this.TOKEN_LIMIT;

    this.boson_token = process.env.BOSON_TOKEN;
    this.TOKEN_LIMIT = (1 * 10 ** 18).toString();
    this.daiTokenWrapper;
    this.dai_token = process.env.DAI_TOKEN;
    this.gate;
    this.erc1155NonTransferable;
  }

  async setDefaults() {
    let tx, txReceipt, event;

    console.log('$ Setting initial values ...');

    tx = await this.erc1155erc721.setApprovalForAll(
      this.voucherKernel.address,
      'true'
    );
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '\n$ ERC1155ERC721: ',
      event.event,
      'approved VoucherKernel:',
      event.args._approved
    );

    tx = await this.erc1155erc721.setVoucherKernelAddress(
      this.voucherKernel.address
    );
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '$ ERC1155ERC721: ',
      event.event,
      'at:',
      event.args._newVoucherKernel
    );

    tx = await this.erc1155erc721.setCashierAddress(this.cashier.address);
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '$ ERC1155ERC721: ',
      event.event,
      'at:',
      event.args._newCashier
    );

    tx = await this.voucherKernel.setBosonRouterAddress(this.br.address);
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '\n$ VoucherKernel',
      event.event,
      'at:',
      event.args._newBosonRouter
    );

    tx = await this.voucherKernel.setCashierAddress(this.cashier.address);
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log('$ VoucherKernel', event.event, 'at:', event.args._newCashier);

    tx = await this.cashier.setBosonRouterAddress(this.br.address);
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log('\n$ Cashier', event.event, 'at:', event.args._newBosonRouter);

    tx = await this.cashier.setTokenContractAddress(this.erc1155erc721.address);
    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log('$ Cashier', event.event, 'at:', event.args._newTokenContract);

    tx = await this.tokenRegistry.setTokenWrapperAddress(
      this.dai_token,
      this.daiTokenWrapper.address
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
      this.boson_token
    );

    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '$ TokenRegistry',
      event.event,
      'at:',
      event.args._newWrapperAddress
    );

    tx = await this.gate.setNonTransferableTokenContract(
      this.erc1155NonTransferable.address
    );

    txReceipt = await tx.wait();
    event = txReceipt.events[0];
    console.log(
      '$ Gate',
      event.event,
      'at:',
      event.args._nonTransferableTokenContractAddress
    );

    await this.erc1155erc721._setMetadataBase(process.env.METADATA_BASE);

    console.log('$ MetadataBase', 'set to :', process.env.METADATA_BASE);
    await this.erc1155erc721._set1155Route(process.env.ERC1155_ROUTE);

    console.log('$ ERC1155Route ', 'set to :', process.env.ERC1155_ROUTE);

    await this.erc1155erc721._set721Route(process.env.ERC721_ROUTE);

    console.log('$ ERC721Route ', 'set to :', process.env.ERC721_ROUTE);

    console.log(
      '$ ERC1155NonTransferable URI ',
      'set to :',
      await this.erc1155NonTransferable.uri(1)
    );

  }

  async deployContracts() {

    const [, ccTokenDeployer] = await ethers.getSigners();

    const ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
    const VoucherKernel = await ethers.getContractFactory('VoucherKernel');
    const Cashier = await ethers.getContractFactory('Cashier');
    const BosonRouter = await ethers.getContractFactory('BosonRouter');
    const TokenRegistry = await ethers.getContractFactory('TokenRegistry');
    const DAITokenWrapper = await ethers.getContractFactory('DAITokenWrapper');
    const Gate = await ethers.getContractFactory('Gate');
    const ERC1155NonTransferable = await ethers.getContractFactory(
      'ERC1155NonTransferable'
    );


    //ERC1155NonTransferrable is a Conditional Commit token and should be deployed from a separate address
    const ERC1155NonTransferableAsOtherSigner = ERC1155NonTransferable.connect(ccTokenDeployer);

    this.tokenRegistry = await TokenRegistry.deploy();
    this.erc1155erc721 = await ERC1155ERC721.deploy();
    this.voucherKernel = await VoucherKernel.deploy(this.erc1155erc721.address);
    this.cashier = await Cashier.deploy(this.voucherKernel.address);
    this.br = await BosonRouter.deploy(
      this.voucherKernel.address,
      this.tokenRegistry.address,
      this.cashier.address
    );
    this.daiTokenWrapper = await DAITokenWrapper.deploy(this.dai_token);
    this.gate = await Gate.deploy(this.br.address);

    //ERC1155NonTransferrable is a Conditional Commit token and should be deployed from a separate address
    this.erc1155NonTransferable = await ERC1155NonTransferableAsOtherSigner.deploy(
      process.env.CONDITIONAL_COMMIT_TOKEN_METADATA_URI
    );

 
    await this.tokenRegistry.deployed();
    await this.erc1155erc721.deployed();
    await this.voucherKernel.deployed();
    await this.cashier.deployed();
    await this.br.deployed();
    await this.daiTokenWrapper.deployed();
    await this.gate.deployed();
    await this.erc1155NonTransferable.deployed();

  }

  logContracts() {
    console.log(
      '\nToken Registry Contract Address  %s from deployer address %s: ',
      this.tokenRegistry.address, this.tokenRegistry.deployTransaction.from
    );
    console.log('ERC1155ERC721 Contract Address  %s from deployer address %s: ', this.erc1155erc721.address, this.erc1155erc721.deployTransaction.from);
    console.log('VoucherKernel Contract Address  %s from deployer address %s: ', this.voucherKernel.address, this.voucherKernel.deployTransaction.from);
    console.log('Cashier Contract Address  %s from deployer address %s: ', this.cashier.address, this.cashier.deployTransaction.from);
    console.log('Boson Router Contract Address  %s from deployer address %s: ', this.br.address, this.br.deployTransaction.from);
    console.log(
      'DAI Token Wrapper Contract Address  %s from deployer address %s: ',
      this.daiTokenWrapper.address, this.daiTokenWrapper.deployTransaction.from
    );

    console.log('Gate Contract Address %s from deployer address %s: ', this.gate.address, this.gate.deployTransaction.from);
    console.log(
      'ERC1155NonTransferable Contract Address: %s from deployer address %s',
      this.erc1155NonTransferable.address, this.erc1155NonTransferable.deployTransaction.from
    );

    console.log('DAI Token Address Used: ', this.dai_token);
    console.log('Boson Token Address Used: ', this.boson_token);
  }

  writeContracts() {
    fs.writeFileSync(
      `scripts/contracts-${this.env.toLowerCase()}.json`,
      JSON.stringify(
        {
          network: hre.network.name,
          tokenRegistry: this.tokenRegistry.address,
          erc1155erc721: this.erc1155erc721.address,
          voucherKernel: this.voucherKernel.address,
          cashier: this.cashier.address,
          br: this.br.address,
          daiTokenWrapper: this.daiTokenWrapper.address,
          gate: this.gate.address,
          erc1155NonTransferable: this.erc1155NonTransferable.address,
          daiTokenUsed: this.dai_token,
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
    this.env = 'prod';
    this.boson_token = process.env.BOSON_TOKEN;
  }

  async setDefaults() {
    await super.setDefaults();
    await this.tokenRegistry.setTokenLimit(this.boson_token, this.TOKEN_LIMIT);
    await this.tokenRegistry.setTokenLimit(this.dai_token, this.TOKEN_LIMIT);
  }
}

/**
 * @class NonProdExecutor
 * @extends {DeploymentExecutor}
 */
class NonProdExecutor extends DeploymentExecutor {
  SIXTY_SECONDS: number;

  constructor(env) {
    super();
    this.env = env;
    this.SIXTY_SECONDS = 60;
  }

  async setDefaults() {
    await super.setDefaults();
    await this.voucherKernel.setComplainPeriod(2 * this.SIXTY_SECONDS);
    await this.voucherKernel.setCancelFaultPeriod(2 * this.SIXTY_SECONDS);
    await this.tokenRegistry.setTokenLimit(this.boson_token, this.TOKEN_LIMIT);
    await this.tokenRegistry.setTokenLimit(this.dai_token, this.TOKEN_LIMIT);
  }
}

export async function deploy(_env: string): Promise<void> {
  const env = _env.toLowerCase();
  if (!isValidEnv(env)) {
    throw new Error(`Env: ${env} is not recognized!`);
  }

  const executor =
    env == 'prod' ? new ProdExecutor() : new NonProdExecutor(env);

  await executor.deployContracts();
  await executor.setDefaults();

  executor.logContracts();
  executor.writeContracts();
}
