import hre from 'hardhat';
import fs from 'fs';
import {isValidEnv, addressesDirPath, getAddressesFilePath} from './utils';
import packageFile from '../package.json';

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
  conditionalToken;
  conditionalTokenType;
  maxTip;
  txOptions;

  constructor() {
    if (this.constructor == DeploymentExecutor) {
      throw new Error("Abstract class - can't be instantiated!");
    }

    this.env;
    this.gate;
    this.conditionalToken = process.env.CONDITIONAL_TOKEN_ADDRESS;
    this.conditionalTokenType = process.env.CONDITIONAL_TOKEN_TYPE;

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
    console.log('$ Setting Gate approval on Boson Router ...');

    const tx = await this.br.setGateApproval(
      this.gate.address,
      true,
      this.txOptions
    );

    const txReceipt = await tx.wait();
    const event = txReceipt.events[0];

    console.log(
      '$ BosonRouter',
      event.event,
      'at:',
      event.args._gateAddress,
      ' = ',
      event.args._approved
    );
  }

  async deployContracts() {
    const signers = await ethers.getSigners();

    console.log('$ Setting Boson Router address');
    const BosonRouter = await ethers.getContractFactory('BosonRouter');
    this.br = BosonRouter.attach(process.env.BOSON_ROUTER_ADDRESS);

    console.log('$ Gate being deployed by account  ', signers[0].address);
    const Gate = await ethers.getContractFactory('Gate');

    this.gate = await Gate.deploy(
      this.br.address,
      this.conditionalToken,
      this.conditionalTokenType,
      this.txOptions
    );
  }

  async logContracts() {
    console.log(
      'Gate Contract Address %s from deployer address %s: ',
      this.gate.address,
      this.gate.deployTransaction.from
    );

    console.log(
      'Boson Router Address Used: ',
      process.env.BOSON_ROUTER_ADDRESS
    );
    console.log(
      'Conditional Token Address Used: ',
      process.env.CONDITIONAL_TOKEN_ADDRESS
    );
    console.log(
      'Conditional Token Type Used: ',
      process.env.CONDITIONAL_TOKEN_TYPE
    );
  }

  async writeContracts() {
    if (!fs.existsSync(addressesDirPath)) {
      fs.mkdirSync(addressesDirPath);
    }

    const chainId = (await hre.ethers.provider.getNetwork()).chainId;

    const gateAddressesFilePath = getAddressesFilePath(
      chainId,
      this.env,
      'gates'
    );

    const gateAddressesFileContent = fs.existsSync(gateAddressesFilePath)
      ? JSON.parse(fs.readFileSync(gateAddressesFilePath, 'utf-8'))
      : {
          chainId: chainId,
          env: this.env || '',
          protocolVersion: packageFile.version,
          gates: [],
        };

    fs.writeFileSync(
      gateAddressesFilePath,
      JSON.stringify(
        {
          ...gateAddressesFileContent,
          gates: [
            ...gateAddressesFileContent.gates,
            {
              token: process.env.CONDITIONAL_TOKEN_ADDRESS,
              tokenType: process.env.CONDITIONAL_TOKEN_TYPE,
              gate: this.gate.address,
            },
          ],
        },
        null,
        2
      ),
      'utf-8'
    );
  }
} //End DeploymentExecutor

/**
 * @class ProdExecutor
 * @extends {DeploymentExecutor}
 */
class ProdExecutor extends DeploymentExecutor {
  constructor() {
    super();
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
    env == 'production' ? new ProdExecutor() : new NonProdExecutor(env);

  await executor.deployContracts();
  executor.logContracts();
  await executor.writeContracts();
  await executor.setDefaults();
}
