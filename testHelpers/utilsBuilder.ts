import {ethers} from 'hardhat';
import Utils from './utils';

import {
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  BosonRouter,
  MockERC20Permit,
} from '../typechain';

class UtilsBuilder {
  utils: Utils;
  ETHTKN;
  TKNTKN;
  TKNETH;
  TKNTKNSame;

  constructor() {
    this.utils = new Utils();
  }

  static create(): UtilsBuilder {
    return new UtilsBuilder();
  }

  ETHETH(): UtilsBuilder {
    this.utils.createOrder = this.utils.requestCreateOrderETHETH;
    this.utils.commitToBuy = this.utils.commitToBuyETHETH;

    return this;
  }

  ERC20withPermit(): UtilsBuilder {
    this.ETHTKN = this.ETHTKNWithPermit;
    this.TKNTKN = this.TKNTKNWithPermit;
    this.TKNETH = this.TKNETHWithPermit;
    this.TKNTKNSame = this.TKNTKNSameWithPermit;

    return this;
  }

  async setFactories(): Promise<UtilsBuilder> {
    this.utils.factories = {
      VoucherKernel: await ethers.getContractFactory('VoucherKernel'),
      Cashier: await ethers.getContractFactory('Cashier'),
      BosonRouter: await ethers.getContractFactory('BosonRouter'),
      ERC1155ERC721: await ethers.getContractFactory('ERC1155ERC721'),
      FundLimitsOracle: await ethers.getContractFactory('FundLimitsOracle'),
      MockERC20Permit: await ethers.getContractFactory('MockERC20Permit'),
    };

    return this;
  }

  async buildAsync(
    erc1155721: ERC1155ERC721,
    voucherKernel: VoucherKernel,
    cashier: Cashier,
    bsnRouter: BosonRouter,
    bsnTokenPrice?: MockERC20Permit,
    bsnTokenDeposit?: MockERC20Permit
  ): Promise<Utils> {
    this.utils.setContracts(
      erc1155721,
      voucherKernel,
      cashier,
      bsnRouter,
      bsnTokenPrice,
      bsnTokenDeposit
    );

    await this.setFactories();

    return this.utils;
  }

  ETHTKNWithPermit(): UtilsBuilder {
    this.utils.createOrder = this.utils.requestCreateOrderETHTKNWithPermit;
    this.utils.commitToBuy = this.utils.commitToBuyETHTKNWithPermit;

    return this;
  }

  TKNTKNWithPermit(): UtilsBuilder {
    this.utils.createOrder = this.utils.requestCreateOrderTKNTKNWithPermit;
    this.utils.commitToBuy = this.utils.commitToBuyTKNTKNWithPermit;

    return this;
  }

  TKNTKNSameWithPermit(): UtilsBuilder {
    this.utils.createOrder = this.utils.requestCreateOrderETHTKNSameWithPermit;
    this.utils.commitToBuy = this.utils.commitToBuyTKNTKNSameWithPermit;

    return this;
  }

  TKNETHWithPermit(): UtilsBuilder {
    this.utils.createOrder = this.utils.requestCreateOrderTKNETH;
    this.utils.commitToBuy = this.utils.commitToBuyTKNETHWithPermit;

    return this;
  }
}

export default UtilsBuilder;
