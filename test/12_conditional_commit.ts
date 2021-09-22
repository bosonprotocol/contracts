import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract, Wallet} from 'ethers';
import {expect} from 'chai';
import {ecsign} from 'ethereumjs-util';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';
import {toWei, getApprovalDigest} from '../testHelpers/permitUtils';
import {
  BosonRouter,
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  FundLimitsOracle,
  MockERC20Permit,
  ERC1155NonTransferable,
  Gate,
} from '../typechain';
import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
import {Account} from '../testHelpers/types';

let utils: Utils;

const BN = ethers.BigNumber.from;

let ERC1155ERC721_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let FundLimitsOracle_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;
let ERC1155NonTransferable_Factory: ContractFactory;
let Gate_Factory: ContractFactory;

const eventNames = eventUtils.eventNames;
let users;

describe('Create Voucher sets and commit to vouchers with token wrapper', () => {
  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721_Factory = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel_Factory = await ethers.getContractFactory('VoucherKernel');
    Cashier_Factory = await ethers.getContractFactory('Cashier');
    BosonRouter_Factory = await ethers.getContractFactory('BosonRouter');
    FundLimitsOracle_Factory = await ethers.getContractFactory(
      'FundLimitsOracle'
    );
    MockERC20Permit_Factory = await ethers.getContractFactory(
      'MockERC20Permit'
    );
    ERC1155NonTransferable_Factory = await ethers.getContractFactory(
      'ERC1155NonTransferable'
    );
    Gate_Factory = await ethers.getContractFactory('Gate');
    FundLimitsOracle_Factory = await ethers.getContractFactory(
      'FundLimitsOracle'
    );
    MockERC20Permit_Factory = await ethers.getContractFactory(
      'MockERC20Permit'
    );
  });

  let contractERC1155ERC721: ERC1155ERC721,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractBSNTokenPrice: MockERC20Permit,
    contractBSNTokenDeposit: MockERC20Permit,
    contractFundLimitsOracle: FundLimitsOracle,
    contractERC1155NonTransferable: ERC1155NonTransferable,
    contractGate: Gate;

  const deadline = toWei(1);
  let timestamp;

  async function deployContracts() {
    const sixtySeconds = 60;

    contractFundLimitsOracle = (await FundLimitsOracle_Factory.deploy()) as Contract &
      FundLimitsOracle;
    contractERC1155ERC721 = (await ERC1155ERC721_Factory.deploy()) as Contract &
      ERC1155ERC721;
    contractVoucherKernel = (await VoucherKernel_Factory.deploy(
      contractERC1155ERC721.address
    )) as Contract & VoucherKernel;
    contractCashier = (await Cashier_Factory.deploy(
      contractVoucherKernel.address
    )) as Contract & Cashier;

    contractBosonRouter = (await BosonRouter_Factory.deploy(
      contractVoucherKernel.address,
      contractFundLimitsOracle.address,
      contractCashier.address
    )) as Contract & BosonRouter;

    contractBSNTokenPrice = (await MockERC20Permit_Factory.deploy(
      'BosonTokenPrice',
      'BPRC'
    )) as Contract & MockERC20Permit;

    contractBSNTokenDeposit = (await MockERC20Permit_Factory.deploy(
      'BosonTokenDeposit',
      'BDEP'
    )) as Contract & MockERC20Permit;
    contractERC1155NonTransferable = (await ERC1155NonTransferable_Factory.deploy(
      '/non/transferable/uri'
    )) as Contract & ERC1155NonTransferable;
    contractGate = (await Gate_Factory.deploy()) as Contract & Gate;

    await contractFundLimitsOracle.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();
    await contractERC1155NonTransferable.deployed();
    await contractGate.deployed();

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address,
      true
    );
    await contractERC1155ERC721.setVoucherKernelAddress(
      contractVoucherKernel.address
    );

    await contractERC1155ERC721.setCashierAddress(contractCashier.address);

    await contractVoucherKernel.setBosonRouterAddress(
      contractBosonRouter.address
    );
    await contractVoucherKernel.setCashierAddress(contractCashier.address);

    await contractCashier.setBosonRouterAddress(contractBosonRouter.address);
    await contractCashier.setTokenContractAddress(
      contractERC1155ERC721.address
    );

    await contractVoucherKernel.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds);

    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenPrice.address,
      constants.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenDeposit.address,
      constants.TOKEN_LIMIT
    );

    await contractFundLimitsOracle.setETHLimit(constants.ETHER_LIMIT);

    await contractGate.setNonTransferableTokenContract(
      contractERC1155NonTransferable.address
    );
    await contractGate.setBosonRouterAddress(contractBosonRouter.address);
  }

  describe('TOKEN SUPPLY CREATION WITH TOKEN WRAPPER (Create Voucher Set)', () => {
    let timestamp;
    describe('TKNTKN', () => {
      beforeEach(async () => {
        await deployContracts();

        timestamp = await Utils.getCurrTimestamp();
        // timestamp
        constants.PROMISE_VALID_FROM = timestamp;
        constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

        const tokensToMint = BN(constants.product_price).mul(
          BN(constants.QTY_20)
        );

        utils = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNTKN()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenPrice,
            contractBSNTokenDeposit
          );

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.seller.address,
          tokensToMint
        );
        await utils.mintTokens(
          'contractBSNTokenPrice',
          users.buyer.address,
          tokensToMint
        );
        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.buyer.address,
          tokensToMint
        );

        await contractERC1155NonTransferable.mint(
          users.buyer.address,
          constants.NFT_TOKEN_ID,
          constants.ONE,
          constants.ZERO_BYTES
        );
      });

      async function generateInputs(
        account: Account,
        deposit: number | string,
        qty: number | string
      ) {
        const txValue = BN(deposit).mul(BN(qty));

        const nonce = await contractBSNTokenDeposit.nonces(account.address);

        const digest = await getApprovalDigest(
          contractBSNTokenDeposit,
          account.address,
          contractBosonRouter.address,
          txValue,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(account.privateKey.slice(2), 'hex')
        );

        return {txValue, v, r, s};
      }

      it('Should be able to create Voucher with gate address', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.seller,
          constants.seller_deposit,
          constants.QTY_10
        );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderTKNTKNWithPermitConditional(
              // const txOrder = await sellerInstance.requestCreateOrderTKNTKNWithPermitConditional(
              contractBSNTokenPrice.address,
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.product_price,
                constants.seller_deposit,
                constants.buyer_deposit,
                constants.QTY_10,
              ],
              contractGate.address,
              '0'
            )
        ).to.emit(
          contractBosonRouter,
          eventNames.LOG_CONDITIONAL_ORDER_CREATED
        );
      });

      it('[NEGATIVE]Supplying invalid gate address should revert', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.seller,
          constants.seller_deposit,
          constants.QTY_10
        );

        await expect(
          contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderTKNTKNWithPermitConditional(
              // const txOrder = await sellerInstance.requestCreateOrderTKNTKNWithPermitConditional(
              contractBSNTokenPrice.address,
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.product_price,
                constants.seller_deposit,
                constants.buyer_deposit,
                constants.QTY_10,
              ],
              constants.ZERO_ADDRESS,
              '0'
            )
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
      });
    });
  });

  describe('VOUCHER CREATION (Commit to buy)', () => {
    let tokenSupplyKey;

    describe('TKNTKN', () => {
      beforeEach(async () => {
        await deployContracts();

        timestamp = await Utils.getCurrTimestamp();
        constants.PROMISE_VALID_FROM = timestamp;
        constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

        const tokensToMint = BN(constants.product_price).mul(
          BN(constants.QTY_20)
        );

        utils = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNTKN()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenPrice,
            contractBSNTokenDeposit
          );

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.seller.address,
          tokensToMint
        );
        await utils.mintTokens(
          'contractBSNTokenPrice',
          users.buyer.address,
          tokensToMint
        );
        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.buyer.address,
          tokensToMint
        );

        await contractERC1155NonTransferable.mint(
          users.buyer.address,
          constants.NFT_TOKEN_ID,
          constants.ONE,
          constants.ZERO_BYTES
        );

        const txOrder = await utils.createOrderConditional(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10,
          contractGate,
          0
        );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        tokenSupplyKey = eventArgs._tokenIdSupply;

        await contractGate.registerVoucherSetID(
          tokenSupplyKey,
          constants.NFT_TOKEN_ID
        );
      });

      async function generateInputs(
        account: Account,
        deposit: number | string,
        product_price: number | string
      ) {
        const txValue = BN(deposit).add(BN(product_price));
        const DEPOSIT = await generateDepositInputs(account, deposit);
        const PRICE = await generatePriceInputs(account, product_price);
        return {txValue, DEPOSIT, PRICE};
      }

      async function generateDepositInputs(
        account: Account,
        deposit: number | string
      ) {
        const nonce = await contractBSNTokenDeposit.nonces(account.address);

        const digest = await getApprovalDigest(
          contractBSNTokenDeposit,
          account.address,
          contractBosonRouter.address,
          deposit,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(account.privateKey.slice(2), 'hex')
        );

        return {v, r, s};
      }

      async function generatePriceInputs(
        account: Account,
        product_price: number | string
      ) {
        const nonce = await contractBSNTokenDeposit.nonces(account.address);

        const digest = await getApprovalDigest(
          contractBSNTokenPrice,
          account.address,
          contractBosonRouter.address,
          product_price,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(account.privateKey.slice(2), 'hex')
        );

        return {v, r, s};
      }

      it('Should be able to request voucher', async () => {
        const {txValue, DEPOSIT, PRICE} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );
        const vDeposit = DEPOSIT.v;
        const rDeposit = DEPOSIT.r;
        const sDeposit = DEPOSIT.s;
        const vPrice = PRICE.v;
        const rPrice = PRICE.r;
        const sPrice = PRICE.s;

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;
        expect(
          buyerInstance.requestVoucherTKNTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          )
        )
          .to.emit(contractGate, eventNames.LOG_USER_VOUCHER_REVOKED)
          .withArgs(users.buyer.address, tokenSupplyKey);
      });

      it('[NEGATIVE] Should not be able to request voucher twice', async () => {
        await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey);

        const {txValue, DEPOSIT, PRICE} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );
        const vDeposit = DEPOSIT.v;
        const rDeposit = DEPOSIT.r;
        const sDeposit = DEPOSIT.s;
        const vPrice = PRICE.v;
        const rPrice = PRICE.r;
        const sPrice = PRICE.s;

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should not be able to request voucher without NFT token', async () => {
        const {txValue, DEPOSIT, PRICE} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const vDeposit = DEPOSIT.v;
        const rDeposit = DEPOSIT.r;
        const sDeposit = DEPOSIT.s;
        const vPrice = PRICE.v;
        const rPrice = PRICE.r;
        const sPrice = PRICE.s;

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should revert if specified gate contract does not exist', async () => {
        const txOrder = await utils.createOrderConditional(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10,
          contractBSNTokenDeposit,
          0
        );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        const tokenSupplyKey = eventArgs._tokenIdSupply;

        const {txValue, DEPOSIT, PRICE} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const vDeposit = DEPOSIT.v;
        const rDeposit = DEPOSIT.r;
        const sDeposit = DEPOSIT.s;
        const vPrice = PRICE.v;
        const rPrice = PRICE.r;
        const sPrice = PRICE.s;

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          )
        ).to.be.reverted;
      });

      it('[NEGATIVE] Should revert if mapping between voucherset and nfttoken not exist', async () => {
        const txOrder = await utils.createOrderConditional(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10,
          contractGate,
          0
        );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        const tokenSupplyKey = eventArgs._tokenIdSupply;

        const {txValue, DEPOSIT, PRICE} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const vDeposit = DEPOSIT.v;
        const rDeposit = DEPOSIT.r;
        const sDeposit = DEPOSIT.s;
        const vPrice = PRICE.v;
        const rPrice = PRICE.r;
        const sPrice = PRICE.s;

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });
    }); // end TKNTKN

    describe('TKNTKN same', () => {
      beforeEach(async () => {
        await deployContracts();

        timestamp = await Utils.getCurrTimestamp();
        constants.PROMISE_VALID_FROM = timestamp;
        constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

        const tokensToMint = BN(constants.product_price).mul(
          BN(constants.QTY_20)
        );

        utils = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNTKN()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenDeposit,
            contractBSNTokenDeposit
          );

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.seller.address,
          tokensToMint
        );
        // await utils.mintTokens(
        //   'contractBSNTokenPrice',
        //   users.buyer.address,
        //   tokensToMint
        // );
        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.buyer.address,
          tokensToMint
        );

        await contractERC1155NonTransferable.mint(
          users.buyer.address,
          constants.NFT_TOKEN_ID,
          constants.ONE,
          constants.ZERO_BYTES
        );

        const txOrder = await utils.createOrderConditional(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10,
          contractGate,
          0
        );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        tokenSupplyKey = eventArgs._tokenIdSupply;

        await contractGate.registerVoucherSetID(
          tokenSupplyKey,
          constants.NFT_TOKEN_ID
        );
      });

      // async function generateInputs(
      //   account: Account,
      //   deposit: number | string,
      //   product_price: number | string
      // ) {
      //   const txValue = BN(deposit).add(BN(product_price));
      //   const DEPOSIT = await generateDepositInputs(account, deposit);
      //   const PRICE = await generatePriceInputs(account, product_price);
      //   return {txValue, DEPOSIT, PRICE};
      // }

      async function generateInputs(
        account: Account,
        deposit: number | string,
        product_price: number | string
      ) {
        const nonce = await contractBSNTokenDeposit.nonces(account.address);
        const txValue = BN(deposit).add(BN(product_price));

        const digest = await getApprovalDigest(
          contractBSNTokenDeposit,
          account.address,
          contractBosonRouter.address,
          txValue,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(account.privateKey.slice(2), 'hex')
        );
        // return {txValue, DEPOSIT, PRICE};
        return {txValue, v, r, s};
      }

      async function generatePriceInputs(
        account: Account,
        product_price: number | string
      ) {
        const nonce = await contractBSNTokenDeposit.nonces(account.address);

        const digest = await getApprovalDigest(
          contractBSNTokenPrice,
          account.address,
          contractBosonRouter.address,
          product_price,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(account.privateKey.slice(2), 'hex')
        );

        return {v, r, s};
      }

      it('Should be able to request voucher', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );
        // const vDeposit = DEPOSIT.v;
        // const rDeposit = DEPOSIT.r;
        // const sDeposit = DEPOSIT.s;
        // const vPrice = PRICE.v;
        // const rPrice = PRICE.r;
        // const sPrice = PRICE.s;

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;
        expect(
          buyerInstance.requestVoucherTKNTKNSameWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            v,
            r,
            s
          )
        )
          .to.emit(contractGate, eventNames.LOG_USER_VOUCHER_REVOKED)
          .withArgs(users.buyer.address, tokenSupplyKey);
      });

      it('[NEGATIVE] Should not be able to request voucher twice', async () => {
        let {txValue, v, r, s} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;

        await buyerInstance.requestVoucherTKNTKNSameWithPermit(
          tokenSupplyKey,
          users.seller.address,
          txValue,
          deadline,
          v,
          r,
          s
        );

        ({txValue, v, r, s} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        ));

        await expect(
          buyerInstance.requestVoucherTKNTKNSameWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            v,
            r,
            s
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should not be able to request voucher without NFT token', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNSameWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            v,
            r,
            s
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should revert if specified gate contract does not exist', async () => {
        const txOrder = await utils.createOrderConditional(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10,
          contractBSNTokenDeposit,
          0
        );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        const tokenSupplyKey = eventArgs._tokenIdSupply;

        const {txValue, v, r, s} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNSameWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            v,
            r,
            s
          )
        ).to.be.reverted;
      });

      it('[NEGATIVE] Should revert if mapping between voucherset and nfttoken not exist', async () => {
        const txOrder = await utils.createOrderConditional(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10,
          contractGate,
          0
        );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        const tokenSupplyKey = eventArgs._tokenIdSupply;

        const {txValue, v, r, s} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNSameWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            v,
            r,
            s
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });
    }); // end TKNTKN
  });
});
