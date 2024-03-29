import hre from 'hardhat';
import fs from 'fs';
import {isValidEnv, addressesDirPath, getAddressesFilePath} from './utils';
import prompts from 'prompts';

const ethers = hre.ethers;

class DeploymentExecutor {
  env;
  erc20;
  erc721;
  erc1155;
  erc1155NonTransferable;
  maxTip;
  txOptions;

  constructor() {
    this.env;

    this.erc20;
    this.erc721;
    this.erc1155;
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

  async deployMockTokens() {
    // deploys instance of ERC20, ERC721, ERC1155 and ERC1155NonTransferable

    console.log('$ Deploying mock conditional tokens');
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const mockERC20Token = await MockERC20.deploy(this.txOptions);
    await mockERC20Token.deployed();
    console.log('$ MockeERC20 contract address ', mockERC20Token.address);
    const MockERC721 = await ethers.getContractFactory('MockERC721');
    const mockERC721Token = await MockERC721.deploy(this.txOptions);
    await mockERC721Token.deployed();
    console.log('$ MockERC721 contract address ', mockERC721Token.address);
    const MockERC1155 = await ethers.getContractFactory('MockERC1155');
    const mockERC1155Token = await MockERC1155.deploy(this.txOptions);
    await mockERC1155Token.deployed();
    console.log('$ MockERC1155 contract address ', mockERC1155Token.address);
    const MockERC1155NonTransferable = await ethers.getContractFactory(
      'ERC1155NonTransferable'
    );
    const mockERC1155NonTransferableToken =
      await MockERC1155NonTransferable.deploy(this.txOptions);
    await mockERC1155NonTransferableToken.deployed();
    console.log(
      '$ MockERC1155NonTransferable contract address ',
      mockERC1155NonTransferableToken.address
    );

    this.erc20 = mockERC20Token.address;
    this.erc721 = mockERC721Token.address;
    this.erc1155 = mockERC1155Token.address;
    this.erc1155NonTransferable = mockERC1155NonTransferableToken.address;
  }

  async writeContracts() {
    if (!fs.existsSync(addressesDirPath)) {
      fs.mkdirSync(addressesDirPath);
    }

    const chainId = (await hre.ethers.provider.getNetwork()).chainId;

    const filePath = getAddressesFilePath(chainId, this.env, 'mocks');

    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          chainId: chainId,
          env: this.env || '',
          erc20: this.erc20,
          erc721: this.erc721,
          erc1155: this.erc1155,
          erc1155NonTransferable: this.erc1155NonTransferable,
        },
        null,
        2
      ),
      'utf-8'
    );
    console.log(`Contract addresses written to ${filePath}`);
  }
}

export async function deploy(_env: string): Promise<void> {
  const env = _env.toLowerCase();

  if (!isValidEnv(env)) {
    throw new Error(`Env: ${env} is not recognized!`);
  }

  if (hre.network.name == 'mainnet') {
    console.log('You are trying to deploy mock contracts to mainnet');
    const prompt = async () => {
      const response = await prompts({
        type: 'text',
        name: 'reposnse',
        message: 'Proceed? [y/n]',
      });

      switch (response.reposnse.toLowerCase()) {
        case 'n':
          console.log('Aborting');
          process.exit();
        // eslint-disable-next-line no-fallthrough
        case 'y':
          // just proceed
          await deployMocks();
          break;
        default:
          console.log('Invalid response');
          await prompt();
      }
    };
    await prompt();
  } else {
    await deployMocks();
  }

  async function deployMocks() {
    const executor = new DeploymentExecutor();
    await executor.deployMockTokens();
    await executor.writeContracts();
  }
}
