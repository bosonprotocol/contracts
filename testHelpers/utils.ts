import {ethers} from 'hardhat';
import {ecsign} from 'ethereumjs-util';
import {BigNumber, Contract, ContractTransaction, Signer} from 'ethers';
import {Account, DistributionAmounts, DistributionEvent} from './types';

import * as events from './events';
import fnSignatures from './functionSignatures';
import {toWei, getApprovalDigest} from '../testHelpers/permitUtils';

const BN = ethers.BigNumber.from;

import {
  ERC1155ERC721__factory,
  VoucherKernel__factory,
  Cashier__factory,
  BosonRouter__factory,
  TokenRegistry__factory,
  MockERC20Permit__factory,
} from '../typechain';

import {
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  BosonRouter,
  MockERC20Permit,
} from '../typechain';

class Utils {
  createOrder: (
    seller,
    from,
    to,
    promisePrice,
    sellerDeposit,
    buyerDeposit,
    qty,
    returnTx?
  ) => any;
  createOrderConditional: (
    seller,
    from,
    to,
    promisePrice,
    sellerDeposit,
    buyerDeposit,
    qty,
    gateContract,
    nftTokenID,
    returnTx?
  ) => any;
  commitToBuy: (
    buyer,
    seller,
    tokenSupplyId,
    promisePrice,
    buyerDeposit,
    returnTx?
  ) => any;
  factories?: {
    ERC1155ERC721: ERC1155ERC721__factory | any;
    VoucherKernel: VoucherKernel__factory | any;
    Cashier: Cashier__factory | any;
    BosonRouter: BosonRouter__factory | any;
    TokenRegistry: TokenRegistry__factory | any;
    MockERC20Permit: MockERC20Permit__factory | any;
  };
  deadline: any;
  contractERC1155ERC721?: ERC1155ERC721;
  contractVoucherKernel?: VoucherKernel;
  contractCashier?: Cashier;
  contractBSNRouter?: BosonRouter;
  contractBSNTokenPrice?: MockERC20Permit;
  contractBSNTokenDeposit?: MockERC20Permit;
  contractBSNTokenSame?: MockERC20Permit;

  constructor() {
    this.deadline = toWei(1);
  }

  setContracts(
    erc1155721: ERC1155ERC721,
    voucherKernel: VoucherKernel,
    cashier: Cashier,
    bsnRouter: BosonRouter,
    bsnTokenPrice?: MockERC20Permit,
    bsnTokenDeposit?: MockERC20Permit
  ): void {
    this.contractERC1155ERC721 = erc1155721;
    this.contractVoucherKernel = voucherKernel;
    this.contractCashier = cashier;
    this.contractBSNRouter = bsnRouter;
    this.contractBSNTokenPrice = bsnTokenPrice;
    this.contractBSNTokenDeposit = bsnTokenDeposit;
    this.contractBSNTokenSame = bsnTokenPrice;
  }

  async requestCreateOrderETHETH(
    seller: Account,
    from: number,
    to: number,
    promisePrice: number | string | BigNumber,
    sellerDeposit: number | string,
    buyerDeposit: number | string,
    qty: number | string,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const txValue = BN(sellerDeposit).mul(BN(qty));

    const sellerInstance = this.contractBSNRouter.connect(
      seller.signer
    ) as BosonRouter;
    const txOrder = await sellerInstance.requestCreateOrderETHETH(
      [from, to, promisePrice, sellerDeposit, buyerDeposit, qty],
      {
        value: txValue,
      }
    );

    if (returnTx) return txOrder;

    // only needed when needed to get _tokenIdSupply. Not really checking anything.
    const txReceipt = await txOrder.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.BosonRouter,
      events.eventNames.LOG_ORDER_CREATED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdSupply.toString();
  }

  async requestCreateOrderETHTKNSameWithPermit(
    seller: Account,
    from: number,
    to: number,
    promisePrice: number | string | BigNumber,
    sellerDeposit: number | string,
    buyerDeposit: number | string,
    qty: number | string,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const txValue = BN(sellerDeposit).mul(BN(qty));

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

    const sellerInstance = this.contractBSNRouter.connect(
      seller.signer
    ) as BosonRouter;

    const txOrder = await sellerInstance.requestCreateOrderTKNTKNWithPermit(
      this.contractBSNTokenSame.address,
      this.contractBSNTokenSame.address,
      txValue,
      this.deadline,
      v,
      r,
      s,
      [from, to, promisePrice, sellerDeposit, buyerDeposit, qty],
      {
        from: seller.address,
      }
    );

    if (returnTx) return txOrder;

    // only needed when needed to get _tokenIdSupply. Not really checking anything.
    const txReceipt = await txOrder.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.BosonRouter,
      events.eventNames.LOG_ORDER_CREATED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdSupply.toString();
  }

  async requestCreateOrderTKNTKNWithPermit(
    seller: Account,
    from: number,
    to: number,
    promisePrice: number | string | BigNumber,
    sellerDeposit: number | string,
    buyerDeposit: number | string,
    qty: number | string,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const txValue = BN(sellerDeposit).mul(BN(qty));

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

    const sellerInstance = this.contractBSNRouter.connect(
      seller.signer
    ) as BosonRouter;
    const txOrder = await sellerInstance.requestCreateOrderTKNTKNWithPermit(
      this.contractBSNTokenPrice.address,
      this.contractBSNTokenDeposit.address,
      txValue,
      this.deadline,
      v,
      r,
      s,
      [from, to, promisePrice, sellerDeposit, buyerDeposit, qty],
      {
        from: seller.address,
      }
    );

    if (returnTx) return txOrder;

    // only needed when needed to get _tokenIdSupply. Not really checking anything.
    const txReceipt = await txOrder.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.BosonRouter,
      events.eventNames.LOG_ORDER_CREATED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdSupply.toString();
  }

  async requestCreateOrderTKNTKNWithPermitConditional(
    seller: Account,
    from: number,
    to: number,
    promisePrice: number | string | BigNumber,
    sellerDeposit: number | string,
    buyerDeposit: number | string,
    qty: number | string,
    gateContract: Account,
    nftTokenId: number | string | null,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const txValue = BN(sellerDeposit).mul(BN(qty));

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

    const sellerInstance = this.contractBSNRouter.connect(
      seller.signer
    ) as BosonRouter;
    const txOrder = await sellerInstance.requestCreateOrderTKNTKNWithPermitConditional(
      this.contractBSNTokenPrice.address,
      this.contractBSNTokenDeposit.address,
      txValue,
      this.deadline,
      v,
      r,
      s,
      [from, to, promisePrice, sellerDeposit, buyerDeposit, qty],
      gateContract.address,
      nftTokenId || '0',
      {
        from: seller.address,
      }
    );

    if (returnTx) return txOrder;

    const txReceipt = await txOrder.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.BosonRouter,
      events.eventNames.LOG_ORDER_CREATED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdSupply.toString();
  }

  async requestCreateOrderETHTKNWithPermit(
    seller: Account,
    from: number,
    to: number,
    promisePrice: number | string | BigNumber,
    sellerDeposit: number | string,
    buyerDeposit: number | string,
    qty: number | string,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const txValue = BN(sellerDeposit).mul(BN(qty));
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

    const sellerInstance = this.contractBSNRouter.connect(
      seller.signer
    ) as BosonRouter;
    const txOrder = await sellerInstance.requestCreateOrderETHTKNWithPermit(
      this.contractBSNTokenDeposit.address,
      txValue,
      this.deadline,
      v,
      r,
      s,
      [from, to, promisePrice, sellerDeposit, buyerDeposit, qty],
      {
        from: seller.address,
      }
    );

    if (returnTx) return txOrder;

    // only needed when needed to get _tokenIdSupply. Not really checking anything.
    const txReceipt = await txOrder.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.BosonRouter,
      events.eventNames.LOG_ORDER_CREATED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdSupply.toString();
  }

  async requestCreateOrderTKNETH(
    seller: Account,
    from: number,
    to: number,
    promisePrice: number | string | BigNumber,
    sellerDeposit: number | string,
    buyerDeposit: number | string,
    qty: number | string,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const txValue = BN(sellerDeposit).mul(BN(qty));

    const sellerInstance = this.contractBSNRouter.connect(
      seller.signer
    ) as BosonRouter;
    const txOrder = await sellerInstance.requestCreateOrderTKNETH(
      this.contractBSNTokenPrice.address,
      [from, to, promisePrice, sellerDeposit, buyerDeposit, qty],
      {
        value: txValue,
      }
    );

    if (returnTx) return txOrder;

    // only needed when needed to get _tokenIdSupply. Not really checking anything.
    const txReceipt = await txOrder.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.BosonRouter,
      events.eventNames.LOG_ORDER_CREATED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdSupply.toString();
  }

  async commitToBuyTKNTKNWithPermit(
    buyer: Account,
    seller: Account,
    tokenSupplyId: string,
    promisePrice: number | string | BigNumber,
    buyerDeposit: number | string,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const txValue = BN(buyerDeposit).add(BN(promisePrice));
    const nonce1 = await this.contractBSNTokenDeposit.nonces(buyer.address);

    const digestDeposit = await getApprovalDigest(
      this.contractBSNTokenDeposit,
      buyer.address,
      this.contractBSNRouter.address,
      buyerDeposit,
      nonce1,
      this.deadline
    );

    const VRS_DEPOSIT = ecsign(
      Buffer.from(digestDeposit.slice(2), 'hex'),
      Buffer.from(buyer.privateKey.slice(2), 'hex')
    );

    const vDeposit = VRS_DEPOSIT.v;
    const rDeposit = VRS_DEPOSIT.r;
    const sDeposit = VRS_DEPOSIT.s;

    const nonce2 = await this.contractBSNTokenPrice.nonces(buyer.address);

    const digestPrice = await getApprovalDigest(
      this.contractBSNTokenPrice,
      buyer.address,
      this.contractBSNRouter.address,
      promisePrice,
      nonce2,
      this.deadline
    );

    const VRS_PRICE = ecsign(
      Buffer.from(digestPrice.slice(2), 'hex'),
      Buffer.from(buyer.privateKey.slice(2), 'hex')
    );

    const vPrice = VRS_PRICE.v;
    const rPrice = VRS_PRICE.r;
    const sPrice = VRS_PRICE.s;

    const buyerInstance = this.contractBSNRouter.connect(
      buyer.signer
    ) as BosonRouter;
    const commitTx = await buyerInstance.requestVoucherTKNTKNWithPermit(
      tokenSupplyId,
      seller.address,
      txValue,
      this.deadline,
      vPrice,
      rPrice,
      sPrice,
      vDeposit,
      rDeposit,
      sDeposit
    );

    if (returnTx) return commitTx;

    // only needed when needed to get _tokenIdSupply. Not really checking anything.
    const txReceipt = await commitTx.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.VoucherKernel,
      events.eventNames.LOG_VOUCHER_DELIVERED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdVoucher;
  }

  async commitToBuyTKNTKNSameWithPermit(
    buyer: Account,
    seller: Account,
    tokenSupplyId: string,
    promisePrice: number | string | BigNumber,
    buyerDeposit: number | string,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const txValue = BN(buyerDeposit).add(BN(promisePrice));
    const nonce = await this.contractBSNTokenSame.nonces(buyer.address);

    const digestTxValue = await getApprovalDigest(
      this.contractBSNTokenSame,
      buyer.address,
      this.contractBSNRouter.address,
      txValue,
      nonce,
      this.deadline
    );

    const VRS_TX_VALUE = ecsign(
      Buffer.from(digestTxValue.slice(2), 'hex'),
      Buffer.from(buyer.privateKey.slice(2), 'hex')
    );

    const v = VRS_TX_VALUE.v;
    const r = VRS_TX_VALUE.r;
    const s = VRS_TX_VALUE.s;

    const buyerInstance = this.contractBSNRouter.connect(
      buyer.signer
    ) as BosonRouter;
    const commitTx = await buyerInstance.requestVoucherTKNTKNSameWithPermit(
      tokenSupplyId,
      seller.address,
      txValue,
      this.deadline,
      v,
      r,
      s
    );

    if (returnTx) return commitTx;

    // only needed when needed to get _tokenIdSupply. Not really checking anything.
    const txReceipt = await commitTx.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.VoucherKernel,
      events.eventNames.LOG_VOUCHER_DELIVERED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdVoucher;
  }

  async commitToBuyETHTKNWithPermit(
    buyer: Account,
    seller: Account,
    tokenSupplyId: string,
    promisePrice: number | string | BigNumber,
    buyerDeposit: number | string,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const nonce1 = await this.contractBSNTokenDeposit.nonces(buyer.address);

    const digestDeposit = await getApprovalDigest(
      this.contractBSNTokenDeposit,
      buyer.address,
      this.contractBSNRouter.address,
      buyerDeposit,
      nonce1,
      this.deadline
    );

    const {v, r, s} = ecsign(
      Buffer.from(digestDeposit.slice(2), 'hex'),
      Buffer.from(buyer.privateKey.slice(2), 'hex')
    );

    const buyerInstance = this.contractBSNRouter.connect(
      buyer.signer
    ) as BosonRouter;
    const commitTx = await buyerInstance.requestVoucherETHTKNWithPermit(
      tokenSupplyId,
      seller.address,
      buyerDeposit,
      this.deadline,
      v,
      r,
      s,
      {value: promisePrice.toString()}
    );

    if (returnTx) return commitTx;

    // only needed when needed to get _tokenIdSupply. Not really checking anything.
    const txReceipt = await commitTx.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.VoucherKernel,
      events.eventNames.LOG_VOUCHER_DELIVERED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdVoucher;
  }

  async commitToBuyETHETH(
    buyer: Account,
    seller: Account,
    tokenSupplyId: string,
    promisePrice: number | string | BigNumber,
    buyerDeposit: number | string,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const txValue = BN(buyerDeposit).add(BN(promisePrice)); // TODO MAKE PARAMETERS

    const buyerInstance = this.contractBSNRouter.connect(
      buyer.signer
    ) as BosonRouter;
    const commitTx = await buyerInstance.requestVoucherETHETH(
      tokenSupplyId,
      seller.address,
      {
        value: txValue.toString(),
      }
    );

    if (returnTx) return commitTx;

    // only needed when needed to get _tokenIdSupply. Not really checking anything.
    const txReceipt = await commitTx.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.VoucherKernel,
      events.eventNames.LOG_VOUCHER_DELIVERED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdVoucher;
  }

  async commitToBuyTKNETHWithPermit(
    buyer: Account,
    seller: Account,
    tokenSupplyId: string,
    promisePrice: number | string | BigNumber,
    buyerDeposit: number | string,
    returnTx = false
  ): Promise<ContractTransaction | string> {
    const nonce1 = await this.contractBSNTokenPrice.nonces(buyer.address);

    const digestDeposit = await getApprovalDigest(
      this.contractBSNTokenPrice,
      buyer.address,
      this.contractBSNRouter.address,
      promisePrice,
      nonce1,
      this.deadline
    );

    const {v, r, s} = ecsign(
      Buffer.from(digestDeposit.slice(2), 'hex'),
      Buffer.from(buyer.privateKey.slice(2), 'hex')
    );

    const buyerInstance = this.contractBSNRouter.connect(
      buyer.signer
    ) as BosonRouter;
    const commitTx = await buyerInstance.requestVoucherTKNETHWithPermit(
      tokenSupplyId,
      seller.address,
      promisePrice,
      this.deadline,
      v,
      r,
      s,
      {value: buyerDeposit}
    );

    if (returnTx) return commitTx;

    // only needed when needed to get _tokenIdSupply. Not really checking anything.
    const txReceipt = await commitTx.wait();
    let eventArgs;

    events.assertEventEmitted(
      txReceipt,
      this.factories.VoucherKernel,
      events.eventNames.LOG_VOUCHER_DELIVERED,
      (e) => (eventArgs = e)
    );

    return eventArgs._tokenIdVoucher;
  }

  async refund(voucherID: string, buyer: Signer): Promise<ContractTransaction> {
    const buyerInstance = this.contractBSNRouter.connect(buyer) as BosonRouter;
    return await buyerInstance.refund(voucherID);
  }

  async redeem(voucherID: string, buyer: Signer): Promise<ContractTransaction> {
    const buyerInstance = this.contractBSNRouter.connect(buyer) as BosonRouter;
    return await buyerInstance.redeem(voucherID);
  }

  async complain(
    voucherID: string,
    buyer: Signer
  ): Promise<ContractTransaction> {
    const buyerInstance = this.contractBSNRouter.connect(buyer) as BosonRouter;
    return await buyerInstance.complain(voucherID);
  }

  async cancel(
    voucherID: string,
    seller: Signer
  ): Promise<ContractTransaction> {
    const sellerInstance = this.contractBSNRouter.connect(
      seller
    ) as BosonRouter;
    return await sellerInstance.cancelOrFault(voucherID);
  }

  async finalize(
    voucherID: string,
    deployer: Signer
  ): Promise<ContractTransaction> {
    const deployerInstance = this.contractVoucherKernel.connect(
      deployer
    ) as VoucherKernel;
    return await deployerInstance.triggerFinalizeVoucher(voucherID);
  }

  async withdraw(
    voucherID: string,
    deployer: Signer
  ): Promise<ContractTransaction> {
    const deployerInstance = this.contractCashier.connect(deployer) as Cashier;
    const tx = await deployerInstance.withdraw(voucherID);

    return tx;
  }

  async pause(deployer: Signer): Promise<void> {
    const deployerInstance = this.contractVoucherKernel.connect(
      deployer
    ) as VoucherKernel;
    await deployerInstance.pause();
  }

  async safeTransfer721(
    oldVoucherOwner: string,
    newVoucherOwner: string,
    voucherID: string,
    signer: Signer
  ): Promise<ContractTransaction> {
    const arbitraryBytes = ethers.utils.formatBytes32String('0x0');
    const fromInstance = this.contractERC1155ERC721.connect(
      signer
    ) as ERC1155ERC721;

    const method = fromInstance.functions[fnSignatures.safeTransfer721];

    return await method(
      oldVoucherOwner,
      newVoucherOwner,
      voucherID,
      arbitraryBytes
    );
  }

  async safeTransfer1155(
    oldSupplyOwner: string,
    newSupplyOwner: string,
    supplyID: string,
    qty: string | number,
    signer: Signer
  ): Promise<ContractTransaction> {
    const arbitraryBytes = ethers.utils.formatBytes32String('0x0');
    const fromInstance = this.contractERC1155ERC721.connect(
      signer
    ) as ERC1155ERC721;

    const method = fromInstance.functions[fnSignatures.safeTransfer1155];

    return await method(
      oldSupplyOwner,
      newSupplyOwner,
      supplyID,
      qty,
      arbitraryBytes
    );
  }

  async safeBatchTransfer1155(
    oldSupplyOwner: string,
    newSupplyOwner: string,
    supplyIDs: Array<string | number>,
    values: Array<string | number>,
    signer: Signer
  ): Promise<ContractTransaction> {
    const arbitraryBytes = ethers.utils.formatBytes32String('0x0');
    const fromInstance = this.contractERC1155ERC721.connect(
      signer
    ) as ERC1155ERC721;

    const method = fromInstance.functions[fnSignatures.safeBatchTransfer1155];

    return await method(
      oldSupplyOwner,
      newSupplyOwner,
      supplyIDs,
      values,
      arbitraryBytes
    );
  }

  calcTotalAmountToRecipients(
    event: DistributionEvent,
    distributionAmounts: DistributionAmounts,
    recipient: string,
    buyer: string,
    seller: string
  ): void {
    if (event[recipient] === buyer) {
      distributionAmounts.buyerAmount = BN(
        distributionAmounts.buyerAmount.toString()
      ).add(BN(event._payment.toString()));
    } else if (event[recipient] === seller) {
      distributionAmounts.sellerAmount = BN(
        distributionAmounts.sellerAmount.toString()
      ).add(BN(event._payment.toString()));
    } else {
      distributionAmounts.escrowAmount = BN(
        distributionAmounts.escrowAmount.toString()
      ).add(BN(event._payment.toString()));
    }
  }

  async mintTokens(
    tokenContract: Contract | any,
    to: string,
    value: string | BigNumber
  ): Promise<void> {
    await this[tokenContract].mint(to, value);
  }

  static async getCurrTimestamp(): Promise<number> {
    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);

    return block.timestamp;
  }
}

export default Utils;
