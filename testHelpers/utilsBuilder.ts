import {ethers} from 'hardhat';
import Utils from './utils';

import {
  VoucherKernel,
  Cashier,
  BosonRouter,
  MockERC20Permit,
  VoucherSets,
  Vouchers,
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
      VoucherSets: await ethers.getContractFactory('VoucherSets'),
      Vouchers: await ethers.getContractFactory('Vouchers'),
      TokenRegistry: await ethers.getContractFactory('TokenRegistry'),
      MockERC20Permit: await ethers.getContractFactory('MockERC20Permit'),
    };

    return this;
  }

  async buildAsync(
    voucherSets: VoucherSets,
    vouchers: Vouchers,
    voucherKernel: VoucherKernel,
    cashier: Cashier,
    bsnRouter: BosonRouter,
    bsnTokenPrice?: MockERC20Permit,
    bsnTokenDeposit?: MockERC20Permit
  ): Promise<Utils> {
    this.utils.setContracts(
      voucherSets,
      vouchers,
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
    this.utils.createOrderConditional =
      this.utils.requestCreateOrderTKNTKNWithPermitConditional;
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
