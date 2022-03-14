import hre from 'hardhat';
import fs from 'fs';
import {isValidEnv, addressesDirPath, getAddressesFilePath} from './utils';
import packageFile from '../package.json';

const ethers = hre.ethers;

/**
 * Class DeploymentExecutor.
 *
 * @class DeploymentExecutor
 */
class DeploymentExecutor {
  env;
  erc1155NonTransferable;
  maxTip;
  txOptions;

  constructor(env: string) {
    this.env = env;
    this.erc1155NonTransferable;

    this.maxTip = ethers.utils.parseUnits(
      process.env.MAX_TIP ? String(process.env.MAX_TIP) : '1',
      'gwei'
    );

    this.txOptions = {
      maxPriorityFeePerGas: this.maxTip,
      gasLimit: 4500000, // our current max contract is around 4.2m gas
    };
  }

  async deployContracts() {
    const signers = await ethers.getSigners();
    let ccTokenDeployer;

    if (
      process.env.PROTOCOL_DEPLOYER_PRIVATE_KEY ==
      process.env.CC_TOKEN_DEPLOYER_PRIVATE_KEY
    ) {
      [ccTokenDeployer] = signers;
    } else {
      [, ccTokenDeployer] = signers;
    }

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

    console.log(
      '$ ERC1155NonTransferable URI ',
      'set to :',
      await this.erc1155NonTransferable.uri(1)
    );
  }

  logContracts() {
    console.log(
      'ERC1155NonTransferable Contract Address: %s from deployer address %s',
      this.erc1155NonTransferable.address,
      this.erc1155NonTransferable.deployTransaction.from
    );
  }

  async writeContracts() {
    if (!fs.existsSync(addressesDirPath)) {
      fs.mkdirSync(addressesDirPath);
    }

    const chainId = (await hre.ethers.provider.getNetwork()).chainId;

    fs.writeFileSync(
      getAddressesFilePath(chainId, this.env, 'erc1155nt'),
      JSON.stringify(
        {
          chainId: chainId,
          env: this.env || '',
          protocolVersion: packageFile.version,
          erc1155NonTransferable: this.erc1155NonTransferable.address,
        },
        null,
        2
      ),
      'utf-8'
    );
  }
}

export async function deploy(_env: string): Promise<void> {
  const env = _env.toLowerCase();

  if (!isValidEnv(env)) {
    throw new Error(`Env: ${env} is not recognized!`);
  }

  const executor = new DeploymentExecutor(env);

  await executor.deployContracts();

  executor.logContracts();
  await executor.writeContracts();
}
