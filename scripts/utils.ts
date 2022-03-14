export const addressesDirPath = __dirname + `/../addresses`;

const availableEnvironments = [
  'testing',
  'staging',
  'production',
  'hardhat',
  '',
];

export function isValidEnv(env: string): boolean {
  return availableEnvironments.some((e) => e == env);
}

export function getAddressesFilePath(
  chainId: number,
  env?: string,
  suffix?: string
): string {
  return `${addressesDirPath}/${chainId}${env ? `-${env.toLowerCase()}` : ''}${
    suffix ? `-${suffix}` : ''
  }.json`;
}

export enum TokenType {
  ERC20 = 0,
  ERC721 = 1,
  ERC1155 = 2,
}

export type GateTokenPair = {
  token: string;
  tokenType: TokenType;
  gate: string;
};
