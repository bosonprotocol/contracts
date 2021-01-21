// @ts-nocheck
const Utils = require('./utils');

class UtilsBuilder {
  constructor() {
    this.utils = new Utils();
  }

  static create() {
    return new UtilsBuilder();
  }

  ETHETH() {
    this.utils.createOrder = this.utils.requestCreateOrderETHETH;
    this.utils.commitToBuy = this.utils.commitToBuyETHETH;

    return this;
  }

  ERC20withPermit() {
    this.ETHTKN = this.ETHTKNWithPermit;
    this.TKNTKN = this.TKNTKNWithPermit;
    this.TKNETH = this.TKNETHWithPermit;
    this.TKNTKNSame = this.TKNTKNSameWithPermit;

    return this;
  }

  build(
    erc1155721,
    voucherKernel,
    cashier,
    bsnRouter,
    bsnTokenPrice,
    bsnTokenDeposit
  ) {
    this.utils.setContracts(
      erc1155721,
      voucherKernel,
      cashier,
      bsnRouter,
      bsnTokenPrice,
      bsnTokenDeposit
    );

    return this.utils;
  }

  ETHTKNWithPermit() {
    this.utils.createOrder = this.utils.requestCreateOrderETHTKNWithPermit;
    this.utils.commitToBuy = this.utils.commitToBuyETHTKNWithPermit;

    return this;
  }

  TKNTKNWithPermit() {
    this.utils.createOrder = this.utils.requestCreateOrderTKNTKNWithPermit;
    this.utils.commitToBuy = this.utils.commitToBuyTKNTKNWithPermit;

    return this;
  }

  TKNTKNSameWithPermit() {
    this.utils.createOrder = this.utils.requestCreateOrderETHTKNSameWithPermit;
    this.utils.commitToBuy = this.utils.commitToBuyTKNTKNSameWithPermit;

    return this;
  }

  TKNETHWithPermit() {
    this.utils.createOrder = this.utils.requestCreateOrderTKNETH;
    this.utils.commitToBuy = this.utils.commitToBuyTKNETHWithPermit;

    return this;
  }
}

module.exports = UtilsBuilder;
