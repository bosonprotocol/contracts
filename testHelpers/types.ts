import {Signer, BigNumber} from 'ethers';

export type Account = {
  address: string;
  privateKey: string;
  signer: Signer;
};

export type DistributionAmounts = {
  buyerAmount: BigNumber;
  sellerAmount: BigNumber;
  escrowAmount: BigNumber;
};

export type DistributionEvent = {
  to?: string;
  payee?: string;
  _payment: string | BigNumber;
  type: number;
};
