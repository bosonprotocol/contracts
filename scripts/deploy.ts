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
  }

  async deployContracts() {
    const ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
    const VoucherKernel = await ethers.getContractFactory('VoucherKernel');
    const Cashier = await ethers.getContractFactory('Cashier');
    const BosonRouter = await ethers.getContractFactory('BosonRouter');
    const TokenRegistry = await ethers.getContractFactory('TokenRegistry');

    this.tokenRegistry = await TokenRegistry.deploy();
    this.erc1155erc721 = await ERC1155ERC721.deploy();
    this.voucherKernel = await VoucherKernel.deploy(this.erc1155erc721.address);
    this.cashier = await Cashier.deploy(this.voucherKernel.address);
    this.br = await BosonRouter.deploy(
      this.voucherKernel.address,
      this.tokenRegistry.address,
      this.cashier.address
    );

    await this.tokenRegistry.deployed();
    await this.erc1155erc721.deployed();
    await this.voucherKernel.deployed();
    await this.cashier.deployed();
    await this.br.deployed();
  }

  logContracts() {
    console.log(
      '\nToken Registry Contract Address: ',
      this.tokenRegistry.address
    );
    console.log('ERC1155ERC721 Contract Address: ', this.erc1155erc721.address);
    console.log('VoucherKernel Contract Address: ', this.voucherKernel.address);
    console.log('Cashier Contract Address: ', this.cashier.address);
    console.log('Boson Router Contract Address: ', this.br.address);
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
