// import ethers from 'ethers'
import {ethers} from 'hardhat';
import {BigNumber, Contract} from 'ethers';

const {keccak256, defaultAbiCoder, toUtf8Bytes, solidityPack} = ethers.utils;

export const PERMIT_TYPEHASH = keccak256(
  toUtf8Bytes(
    'Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)'
  )
);

export const toWei = (value: number | string): BigNumber => {
  const test = value + '0'.repeat(18);
  return ethers.BigNumber.from(test);
};

export async function getApprovalDigestDAI(
  token: Contract | any,
  owner: string,
  spender: string,
  value: string | number | BigNumber,
  nonce: string | number | BigNumber,
  deadline: string | number | BigNumber
): Promise<any> {
  const name = await token.name();
  const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address);

  return keccak256(
    solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        DOMAIN_SEPARATOR,
        keccak256(
          defaultAbiCoder.encode(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'bool '],
            [PERMIT_TYPEHASH, owner, spender, nonce.toString(), deadline, true]
          )
        ),
      ]
    )
  );
}

export function getDomainSeparator(name: string, tokenAddress: string): string {
  //Hardcoding he DOMAIN_SEPARATOR hash to the one for the DAI token on Rinkeby.
  //Retrieved from Etherscan. It doesn't seem possible to generat the correct
  //DOMAIN_SEPARATOR for a hardhat forked Rinkeby env. This is may be related to chainId.
  //Chain

  /*
  return keccak256(
    defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        keccak256(
          toUtf8Bytes(
            'EIP712Domain(' +
              'string name,' +
              'string version,' +
              'uint256 chainId,' +
              'address verifyingContract)'
          )
        ),
        keccak256(toUtf8Bytes(name)),
        keccak256(toUtf8Bytes('1')),
        1,
        tokenAddress,
      ]
    )
  );
  
*/

  //This is the DOMAIN_SEPARATOR hash of the DAI token on Rinkeby
  return '0x47d45448983c2e0e8e44c1742c08102651ce6a7c04b99128a81d918f2b204f74';
}
