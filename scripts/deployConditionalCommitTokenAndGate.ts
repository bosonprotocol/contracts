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
  br;
  gate;
  erc1155NonTransferable;

  constructor() {
    if (this.constructor == DeploymentExecutor) {
      throw new Error("Abstract class - can't be instantiated!");
    }

    this.env;
    this.br;
    this.gate;
    this.erc1155NonTransferable;

     
  }

  async setDefaults() {
    console.log('$ Setting initial values ...');


    const tx = await this.gate.setNonTransferableTokenContract(
      this.erc1155NonTransferable.address
    );

    const txReceipt = await tx.wait();
    const event = txReceipt.events[0];
    console.log(
      '$ Gate',
      event.event,
      'at:',
      event.args._nonTransferableTokenContractAddress
    );
 
  }

  async deployContracts() {
    const Gate = await ethers.getContractFactory('Gate');
    const ERC1155NonTransferable = await ethers.getContractFactory(
      'ERC1155NonTransferable'
    );


    this.gate = await Gate.deploy(this.br);
    this.erc1155NonTransferable = await ERC1155NonTransferable.deploy(
      process.env.CONDITIONAL_COMMIT_TOKEN_METADATA_URI
    );

  
    await this.gate.deployed();
    await this.erc1155NonTransferable.deployed();
  }

  logContracts() {
    console.log('Gate Contract Address: ', this.gate.address);
    console.log(
      'ERC1155NonTransferable Contract Address: ',
      this.erc1155NonTransferable.address
    );
  }

  writeContracts() {
    fs.writeFileSync(
      `scripts/conditional-commit-token-and-gate-contracts-${this.env.toLowerCase()}.json`,
      JSON.stringify(
        {
          network: hre.network.name,
          gate: this.gate.address,
          erc1155NonTransferable: this.erc1155NonTransferable.address
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  setBosonRouterAddress() {
    const contracts = JSON.parse(
      fs.readFileSync(`./scripts/contracts-${this.env}.json`, 'utf-8')
    );

    if (contracts.network != hre.network.name) {
      throw new Error(
        'Contracts are not deployed on the same network, that you are trying to reference'
      );
    }

    this.br = contracts.br;
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
  }

  async setDefaults() {
    await super.setDefaults();
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
  }
}

export async function deploy(_env: string): Promise<void> {
  const env = _env.toLowerCase();
  if (!isValidEnv(env)) {
    throw new Error(`Env: ${env} is not recognized!`);
  }

  const executor =
    env == 'prod' ? new ProdExecutor() : new NonProdExecutor(env);

  executor.setBosonRouterAddress();
  await executor.deployContracts();
  await executor.setDefaults();

  executor.logContracts();
  executor.writeContracts();
}
