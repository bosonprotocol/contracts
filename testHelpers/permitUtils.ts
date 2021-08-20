// import ethers from 'ethers'
import {ethers} from 'hardhat';
import {BigNumber, Contract} from 'ethers';

const {keccak256, defaultAbiCoder, toUtf8Bytes, solidityPack} = ethers.utils;

export const PERMIT_TYPEHASH = keccak256(
  toUtf8Bytes(
    'Permit(' +
      'address owner,' +
      'address spender,' +
      'uint256 value,' +
      'uint256 nonce,' +
      'uint256 deadline)'
  )
);

export const toWei = (value: number | string): BigNumber => {
  const test = value + '0'.repeat(18);
  return ethers.BigNumber.from(test);
};

export async function getApprovalDigest(
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
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
            [
              PERMIT_TYPEHASH,
              owner,
              spender,
              value.toString(),
              nonce.toString(),
              deadline,
            ]
          )
        ),
      ]
    )
  );
}

export function getDomainSeparator(name: string, tokenAddress: string): string {
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
}
