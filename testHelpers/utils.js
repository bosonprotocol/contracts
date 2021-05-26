const ethers = require('hardhat').ethers;
const constants = require('./constants');
const BN = require('bn.js');
const truffleAssert = require('truffle-assertions');

const {ecsign} = require('ethereumjs-util');

const {toWei, getApprovalDigest} = require('../testHelpers/permitUtils');
class Utils {
  constructor() {
    this.createOrder = '';
    this.commitToBuy = '';
    this.deadline = toWei(1);
  }

  setContracts(
    erc1155721,
    voucherKernel,
    cashier,
    bsnRouter,
    bsnTokenPrice,
    bsnTokenDeposit
  ) {
    this.contractERC1155ERC721 = erc1155721;
    this.contractVoucherKernel = voucherKernel;
    this.contractCashier = cashier;
    this.contractBSNRouter = bsnRouter;
    this.contractBSNTokenPrice = bsnTokenPrice;
    this.contractBSNTokenDeposit = bsnTokenDeposit;
    this.contractBSNTokenSame = bsnTokenPrice;
  }

  async requestCreateOrderETHETH(
    seller,
    from,
    to,
    sellerDeposit,
    qty,
    returnTx = false
  ) {
    const txValue = new BN(sellerDeposit).mul(new BN(qty));

    let txOrder = await this.contractBSNRouter.requestCreateOrderETHETH(
      [
        from,
        to,
        constants.product_price,
        sellerDeposit,
        constants.buyer_deposit,
        qty,
      ],
      {
        from: seller.address,
        value: txValue,
      }
    );

    return returnTx ? txOrder : txOrder.logs[0].args._tokenIdSupply.toString();
  }

  async requestCreateOrderETHTKNSameWithPermit(
    seller,
    from,
    to,
    sellerDeposit,
    qty
  ) {
    const txValue = new BN(sellerDeposit).mul(new BN(qty));

    const nonce = await this.contractBSNTokenSame.nonces(seller.address);

    const digest = await getApprovalDigest(
      this.contractBSNTokenSame,
      seller.address,
      this.contractBSNRouter.address,
      txValue,
      nonce,
      this.deadline
    );

    const {v, r, s} = ecsign(
      Buffer.from(digest.slice(2), 'hex'),
      Buffer.from(seller.privateKey.slice(2), 'hex')
    );

    let txOrder = await this.contractBSNRouter.requestCreateOrderTKNTKNWithPermit(
      this.contractBSNTokenSame.address,
      this.contractBSNTokenSame.address,
      txValue,
      this.deadline,
      v,
      r,
      s,
      [
        from,
        to,
        constants.product_price,
        sellerDeposit,
        constants.buyer_deposit,
        qty,
      ],
      {
        from: seller.address,
      }
    );

    return txOrder.logs[0].args._tokenIdSupply.toString();
  }

  async requestCreateOrderTKNTKNWithPermit(
    seller,
    from,
    to,
    sellerDeposit,
    qty
  ) {
    const txValue = new BN(sellerDeposit).mul(new BN(qty));

    const nonce = await this.contractBSNTokenDeposit.nonces(seller.address);

    const digest = await getApprovalDigest(
      this.contractBSNTokenDeposit,
      seller.address,
      this.contractBSNRouter.address,
      txValue,
      nonce,
      this.deadline
    );

    const {v, r, s} = ecsign(
      Buffer.from(digest.slice(2), 'hex'),
      Buffer.from(seller.privateKey.slice(2), 'hex')
    );

    let txOrder = await this.contractBSNRouter.requestCreateOrderTKNTKNWithPermit(
      this.contractBSNTokenPrice.address,
      this.contractBSNTokenDeposit.address,
      txValue,
      this.deadline,
      v,
      r,
      s,
      [
        from,
        to,
        constants.product_price,
        sellerDeposit,
        constants.buyer_deposit,
        qty,
      ],
      {
        from: seller.address,
      }
    );

    return txOrder.logs[0].args._tokenIdSupply.toString();
  }

  async requestCreateOrderETHTKNWithPermit(
    seller,
    from,
    to,
    sellerDeposit,
    qty,
    returnTx = false
  ) {
    const txValue = new BN(sellerDeposit).mul(new BN(qty));
    const nonce = await this.contractBSNTokenDeposit.nonces(seller.address);

    const digest = await getApprovalDigest(
      this.contractBSNTokenDeposit,
      seller.address,
      this.contractBSNRouter.address,
      txValue,
      nonce,
      this.deadline
    );

    const {v, r, s} = ecsign(
      Buffer.from(digest.slice(2), 'hex'),
      Buffer.from(seller.privateKey.slice(2), 'hex')
    );

    let txOrder = await this.contractBSNRouter.requestCreateOrderETHTKNWithPermit(
      this.contractBSNTokenDeposit.address,
      txValue,
      this.deadline,
      v,
      r,
      s,
      [
        from,
        to,
        constants.product_price,
        sellerDeposit,
        constants.buyer_deposit,
        qty,
      ],
      {
        from: seller.address,
      }
    );

    return returnTx ? txOrder : txOrder.logs[0].args._tokenIdSupply.toString();
  }

  async requestCreateOrderTKNETH(seller, from, to, sellerDeposit, qty) {
    const txValue = new BN(sellerDeposit).mul(new BN(qty));

    let txOrder = await this.contractBSNRouter.requestCreateOrderTKNETH(
      this.contractBSNTokenPrice.address,
      [
        from,
        to,
        constants.product_price,
        sellerDeposit,
        constants.buyer_deposit,
        qty,
      ],
      {
        from: seller.address,
        value: txValue,
      }
    );

    return txOrder.logs[0].args._tokenIdSupply.toString();
  }

  async commitToBuyTKNTKNWithPermit(buyer, seller, tokenSupplyId) {
    const txValue = new BN(constants.buyer_deposit).add(
      new BN(constants.product_price)
    );
    const nonce1 = await this.contractBSNTokenDeposit.nonces(buyer.address);

    const digestDeposit = await getApprovalDigest(
      this.contractBSNTokenDeposit,
      buyer.address,
      this.contractBSNRouter.address,
      constants.buyer_deposit,
      nonce1,
      this.deadline
    );

    let VRS_DEPOSIT = ecsign(
      Buffer.from(digestDeposit.slice(2), 'hex'),
      Buffer.from(buyer.privateKey.slice(2), 'hex')
    );

    let vDeposit = VRS_DEPOSIT.v;
    let rDeposit = VRS_DEPOSIT.r;
    let sDeposit = VRS_DEPOSIT.s;

    const nonce2 = await this.contractBSNTokenPrice.nonces(buyer.address);

    const digestPrice = await getApprovalDigest(
      this.contractBSNTokenPrice,
      buyer.address,
      this.contractBSNRouter.address,
      constants.product_price,
      nonce2,
      this.deadline
    );

    let VRS_PRICE = ecsign(
      Buffer.from(digestPrice.slice(2), 'hex'),
      Buffer.from(buyer.privateKey.slice(2), 'hex')
    );

    let vPrice = VRS_PRICE.v;
    let rPrice = VRS_PRICE.r;
    let sPrice = VRS_PRICE.s;

    let CommitTx = await this.contractBSNRouter.requestVoucherTKNTKNWithPermit(
      tokenSupplyId,
      seller.address,
      txValue,
      this.deadline,
      vPrice,
      rPrice,
      sPrice,
      vDeposit,
      rDeposit,
      sDeposit,
      {from: buyer.address}
    );

    let nestedValue = (
      await truffleAssert.createTransactionResult(
        this.contractVoucherKernel,
        CommitTx.tx
      )
    ).logs;

    let filtered = nestedValue.filter(
      (e) => e.event === 'LogVoucherDelivered'
    )[0];

    return filtered.returnValues['_tokenIdVoucher'];
  }

  async commitToBuyTKNTKNSameWithPermit(buyer, seller, tokenSupplyId) {
    const txValue = new BN(constants.buyer_deposit).add(
      new BN(constants.product_price)
    );
    const nonce = await this.contractBSNTokenSame.nonces(buyer.address);

    const digestTxValue = await getApprovalDigest(
      this.contractBSNTokenSame,
      buyer.address,
      this.contractBSNRouter.address,
      txValue,
      nonce,
      this.deadline
    );

    let VRS_TX_VALUE = ecsign(
      Buffer.from(digestTxValue.slice(2), 'hex'),
      Buffer.from(buyer.privateKey.slice(2), 'hex')
    );

    let v = VRS_TX_VALUE.v;
    let r = VRS_TX_VALUE.r;
    let s = VRS_TX_VALUE.s;

    let CommitTx = await this.contractBSNRouter.requestVoucherTKNTKNSameWithPermit(
      tokenSupplyId,
      seller.address,
      txValue,
      this.deadline,
      v,
      r,
      s,
      {from: buyer.address}
    );

    let nestedValue = (
      await truffleAssert.createTransactionResult(
        this.contractVoucherKernel,
        CommitTx.tx
      )
    ).logs;

    let filtered = nestedValue.filter(
      (e) => e.event === 'LogVoucherDelivered'
    )[0];

    return filtered.returnValues['_tokenIdVoucher'];
  }

  async commitToBuyETHTKNWithPermit(buyer, seller, tokenSupplyId) {
    const nonce1 = await this.contractBSNTokenDeposit.nonces(buyer.address);

    const digestDeposit = await getApprovalDigest(
      this.contractBSNTokenDeposit,
      buyer.address,
      this.contractBSNRouter.address,
      constants.buyer_deposit,
      nonce1,
      this.deadline
    );

    let {v, r, s} = ecsign(
      Buffer.from(digestDeposit.slice(2), 'hex'),
      Buffer.from(buyer.privateKey.slice(2), 'hex')
    );

    let txOrder = await this.contractBSNRouter.requestVoucherETHTKNWithPermit(
      tokenSupplyId,
      seller.address,
      constants.buyer_deposit,
      this.deadline,
      v,
      r,
      s,
      {from: buyer.address, value: constants.product_price.toString()}
    );

    let nestedValue = (
      await truffleAssert.createTransactionResult(
        this.contractVoucherKernel,
        txOrder.tx
      )
    ).logs;

    let filtered = nestedValue.filter(
      (e) => e.event === 'LogVoucherDelivered'
    )[0];

    return filtered.returnValues['_tokenIdVoucher'];
  }

  async commitToBuyETHETH(buyer, seller, tokenSupplyId, returnTx = false) {
    const txValue = new BN(constants.buyer_deposit).add(
      new BN(constants.product_price)
    );

    let CommitTx = await this.contractBSNRouter.requestVoucherETHETH(
      tokenSupplyId,
      seller.address,
      {
        from: buyer.address,
        value: txValue.toString(),
      }
    );

    let nestedValue = (
      await truffleAssert.createTransactionResult(
        this.contractVoucherKernel,
        CommitTx.tx
      )
    ).logs;

    let filtered = nestedValue.filter(
      (e) => e.event === 'LogVoucherDelivered'
    )[0];

    return returnTx ? CommitTx : filtered.returnValues['_tokenIdVoucher'];
  }

  async commitToBuyTKNETHWithPermit(buyer, seller, tokenSupplyId) {
    const nonce1 = await this.contractBSNTokenPrice.nonces(buyer.address);

    const digestDeposit = await getApprovalDigest(
      this.contractBSNTokenPrice,
      buyer.address,
      this.contractBSNRouter.address,
      constants.product_price,
      nonce1,
      this.deadline
    );

    let {v, r, s} = ecsign(
      Buffer.from(digestDeposit.slice(2), 'hex'),
      Buffer.from(buyer.privateKey.slice(2), 'hex')
    );

    let txOrder = await this.contractBSNRouter.requestVoucherTKNETHWithPermit(
      tokenSupplyId,
      seller.address,
      constants.product_price,
      this.deadline,
      v,
      r,
      s,
      {from: buyer.address, value: constants.buyer_deposit}
    );

    let nestedValue = (
      await truffleAssert.createTransactionResult(
        this.contractVoucherKernel,
        txOrder.tx
      )
    ).logs;

    let filtered = nestedValue.filter(
      (e) => e.event === 'LogVoucherDelivered'
    )[0];

    return filtered.returnValues['_tokenIdVoucher'];
  }

  async refund(voucherID, buyer) {
    await this.contractBSNRouter.refund(voucherID, {from: buyer});
  }

  async redeem(voucherID, buyer) {
    await this.contractBSNRouter.redeem(voucherID, {from: buyer});
  }

  async complain(voucherID, buyer) {
    await this.contractBSNRouter.complain(voucherID, {from: buyer});
  }

  async cancel(voucherID, seller) {
    await this.contractBSNRouter.cancelOrFault(voucherID, {from: seller});
  }

  async finalize(voucherID, deployer) {
    await this.contractVoucherKernel.triggerFinalizeVoucher(voucherID, {
      from: deployer,
    });
  }

  async withdraw(voucherID, deployer) {
    const tx = await this.contractCashier.withdraw(voucherID, {from: deployer});

    console.log('GAS USED: ', tx.receipt.gasUsed);

    return tx;
  }

  async pause(deployer) {
    await this.contractBSNRouter.pause({from: deployer});
  }

  async safeTransfer721(oldVoucherOwner, newVoucherOwner, voucherID, from) {
    const arbitraryBytes = web3.utils.fromAscii('0x0').padEnd(66, '0');

    const methodSignature =
      'safeTransferFrom(' + 'address,' + 'address,' + 'uint256,' + 'bytes)';
    const method = this.contractERC1155ERC721.methods[methodSignature];

    return await method(
      oldVoucherOwner,
      newVoucherOwner,
      voucherID,
      arbitraryBytes,
      from
    );
  }

  async safeTransfer1155(oldSupplyOwner, newSupplyOwner, supplyID, qty, from) {
    const arbitraryBytes = web3.utils.fromAscii('0x0').padEnd(66, '0');

    const methodSignature =
      'safeTransferFrom(' +
      'address,' +
      'address,' +
      'uint256,' +
      'uint256,' +
      'bytes)';
    const method = this.contractERC1155ERC721.methods[methodSignature];

    return await method(
      oldSupplyOwner,
      newSupplyOwner,
      supplyID,
      qty,
      arbitraryBytes,
      from
    );
  }

  async safeBatchTransfer1155(
    oldSupplyOwner,
    newSupplyOwner,
    supplyIDs,
    values,
    from
  ) {
    const arbitraryBytes = web3.utils.fromAscii('0x0').padEnd(66, '0');

    const methodSignature =
      'safeBatchTransferFrom(' +
      'address,' +
      'address,' +
      'uint256[],' +
      'uint256[],' +
      'bytes)';
    const method = this.contractERC1155ERC721.methods[methodSignature];

    return await method(
      oldSupplyOwner,
      newSupplyOwner,
      supplyIDs,
      values,
      arbitraryBytes,
      from
    );
  }

  calcTotalAmountToRecipients(
    event,
    distributionAmounts,
    recipient,
    buyer,
    seller
  ) {
    if (event[recipient] === buyer) {
      distributionAmounts.buyerAmount = new BN(
        distributionAmounts.buyerAmount.toString()
      ).add(new BN(event._payment.toString()));
    } else if (event[recipient] === seller) {
      distributionAmounts.sellerAmount = new BN(
        distributionAmounts.sellerAmount.toString()
      ).add(new BN(event._payment.toString()));
    } else {
      distributionAmounts.escrowAmount = new BN(
        distributionAmounts.escrowAmount.toString()
      ).add(new BN(event._payment.toString()));
    }
  }

  async mintTokens(tokenContract, to, value) {
    await this[tokenContract].mint(to, value);
  }

  static async getCurrTimestamp() {
    let blockNumber = await ethers.provider.getBlockNumber();
    let block = await ethers.provider.getBlock(blockNumber);

    return block.timestamp;
  }
}

module.exports = Utils;
