import {ethers} from 'hardhat';

const {keccak256, RLP} = ethers.utils;
const BN = ethers.BigNumber.from;

export async function calculateDeploymentAddresses(
  deployer: string,
  contractsToDeploy: string[]
): Promise<any> {
  const addresses = {};
  const startingNonce = await ethers.provider.getTransactionCount(deployer);

  for (let i = 0; i < contractsToDeploy.length; i++) {
    const nonce = BN(startingNonce).add(i);
    const nonceHex = nonce.eq(0) ? '0x' : nonce.toHexString();

    const input_arr = [deployer, nonceHex];
    const rlp_encoded = RLP.encode(input_arr);

    const contract_address_long = keccak256(rlp_encoded);

    const contract_address = '0x' + contract_address_long.substring(26); //Trim the first 24 characters.

    addresses[contractsToDeploy[i]] = contract_address;
  }
  return addresses;
}
