import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

import {expect} from 'chai';
import constants from '../testHelpers/constants';

import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';

let utils: Utils;

const BN = ethers.BigNumber.from;

import {
  ERC1155NonTransferable,
  Gate,
  BosonRouter,
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  FundLimitsOracle,
  MockERC20Permit,
  MockGate,
} from '../typechain';

let ERC1155NonTransferable_Factory: ContractFactory;
let Gate_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let ERC1155ERC721_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let FundLimitsOracle_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;
let MockGate_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
import {eventNames} from '../testHelpers/events';

let users;

describe('Gate contract', async () => {
  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    ERC1155NonTransferable_Factory = await ethers.getContractFactory(
      'ERC1155NonTransferable'
    );

    Gate_Factory = await ethers.getContractFactory('Gate');

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
    MockGate_Factory = await ethers.getContractFactory('MockGate');
  });

  let contractERC1155NonTransferable: ERC1155NonTransferable,
    contractGate: Gate,
    contractERC1155ERC721: ERC1155ERC721,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractFundLimitsOracle: FundLimitsOracle,
    contractBSNTokenPrice: MockERC20Permit,
    contractBSNTokenDeposit: MockERC20Permit,
    contractMockGate: MockGate;

  async function deployContracts() {
    // const timestamp = await Utils.getCurrTimestamp();

    // constants.PROMISE_VALID_FROM = timestamp;
    // constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    contractERC1155NonTransferable = (await ERC1155NonTransferable_Factory.deploy(
      '/non/transferable/uri'
    )) as Contract & ERC1155NonTransferable;
    contractGate = (await Gate_Factory.deploy()) as Contract & Gate;
    contractMockGate = (await MockGate_Factory.deploy()) as Contract & MockGate;

    await contractERC1155NonTransferable.deployed();
    await contractGate.deployed();
    await contractMockGate.deployed();
  }

  async function deployBosonRouterContracts() {
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

    await contractFundLimitsOracle.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();

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
  }

  async function registerVoucherSetIdFromBosonProtocol(
    gate,
    conditionalOrderNftTokenID
  ) {
    const nftTokenID = BN('2');

    await contractERC1155NonTransferable.mint(
      users.buyer.address,
      nftTokenID,
      constants.ONE,
      constants.ZERO_BYTES
    );

    await gate.setNonTransferableTokenContract(
      contractERC1155NonTransferable.address
    );
    await gate.setBosonRouterAddress(contractBosonRouter.address);

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

    const timestamp = await Utils.getCurrTimestamp();
    // timestamp
    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    const tokensToMint = BN(constants.product_price).mul(BN(constants.QTY_20));

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

    const txOrder = await utils.createOrderConditional(
      users.seller,
      timestamp,
      timestamp + constants.SECONDS_IN_DAY,
      constants.seller_deposit,
      constants.QTY_10,
      gate,
      conditionalOrderNftTokenID
    );

    const txReceipt = await txOrder.wait();

    let eventArgs;

    eventUtils.assertEventEmitted(
      txReceipt,
      BosonRouter_Factory,
      eventNames.LOG_ORDER_CREATED,
      (e) => (eventArgs = e)
    );

    const tokenId = eventArgs._tokenIdSupply;
    return {tokenId, nftTokenID};
  }

  describe('Basic operations', () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it('Owner should be able set ERC1155 contract address', async () => {
      expect(
        await contractGate.setNonTransferableTokenContract(
          contractERC1155NonTransferable.address
        )
      )
        .to.emit(contractGate, eventNames.LOG_NON_TRANSFERABLE_CONTRACT)
        .withArgs(contractERC1155NonTransferable.address);
    });

    it('Owner should be able set boson router address', async () => {
      await deployBosonRouterContracts();

      expect(
        await contractGate.setBosonRouterAddress(contractBosonRouter.address)
      )
        .to.emit(contractGate, eventNames.LOG_BOSON_ROUTER_SET)
        .withArgs(contractBosonRouter.address);
    });

    it('Owner should be able to register voucher set id', async () => {
      const voucherSetId = BN('12345');
      const nftTokenID = BN('2');
      expect(await contractGate.registerVoucherSetID(voucherSetId, nftTokenID))
        .to.emit(contractGate, eventNames.LOG_VOUCHER_SET_REGISTERED)
        .withArgs(voucherSetId, nftTokenID);
    });

    it('Boson protocol should be able to register voucher set id', async () => {
      await deployBosonRouterContracts();
      const conditionalOrderNftTokenID = BN('2');
      const {tokenId, nftTokenID} = await registerVoucherSetIdFromBosonProtocol(
        contractMockGate,
        conditionalOrderNftTokenID
      );

      await expect(
        contractMockGate
          .connect(users.attacker.signer)
          .registerVoucherSetID(tokenId, nftTokenID)
      ).to.be.revertedWith('UNAUTHORIZED_BR');
    });

    it('Boson router should be able to deactivate voucher set id', async () => {
      await deployBosonRouterContracts();

      const {tokenId, nftTokenID} = await registerVoucherSetIdFromBosonProtocol(
        contractGate,
        0
      );

      await contractGate.registerVoucherSetID(tokenId, nftTokenID);

      expect(await contractGate.check(users.buyer.address, tokenId)).to.be.true;

      await utils.commitToBuy(users.buyer, users.seller, tokenId);

      expect(await contractGate.check(users.buyer.address, tokenId)).to.be
        .false;
    });

    it('check function works correctly', async () => {
      const voucherSetId = BN('12345');
      const nftTokenID = BN('2');

      await contractGate.registerVoucherSetID(voucherSetId, nftTokenID);

      await contractGate.setNonTransferableTokenContract(
        contractERC1155NonTransferable.address
      );

      expect(await contractGate.check(users.other1.address, voucherSetId)).to.be
        .false;

      await contractERC1155NonTransferable.mint(
        users.other1.address,
        nftTokenID,
        constants.ONE,
        constants.ZERO_BYTES
      );

      expect(await contractGate.check(users.other1.address, voucherSetId)).to.be
        .true;
      expect(await contractGate.check(users.other2.address, voucherSetId)).to.be
        .false;

      // user without token
      // user with token, non deactivated
      // user with token, deactivated
    });

    it('Owner should be able to pause', async () => {
      expect(await contractGate.pause())
        .to.emit(contractGate, eventNames.PAUSED)
        .withArgs(users.deployer.address);

      expect(await contractGate.paused()).to.be.true;
    });

    it('Owner should be able to unpause', async () => {
      await contractGate.pause();

      expect(await contractGate.unpause())
        .to.emit(contractGate, eventNames.UNPAUSED)
        .withArgs(users.deployer.address);

      expect(await contractGate.paused()).to.be.false;
    });

    it('During the pause, register and deactivate does not work', async () => {
      const voucherSetId = BN('12345');
      const nftTokenID = BN('2');
      await contractGate.pause();

      await expect(
        contractGate
          .connect(users.attacker.signer)
          .registerVoucherSetID(voucherSetId, nftTokenID)
      ).to.be.revertedWith(revertReasons.PAUSED);

      await expect(
        contractGate.deactivate(users.attacker.address, voucherSetId)
      ).to.be.revertedWith(revertReasons.PAUSED);
    });

    it('[NEGATIVE][setNonTransferableTokenContract] Should revert if executed by attacker', async () => {
      await expect(
        contractGate
          .connect(users.attacker.signer)
          .setNonTransferableTokenContract(
            contractERC1155NonTransferable.address
          )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if executed by attacker', async () => {
      await deployBosonRouterContracts();

      await expect(
        contractGate
          .connect(users.attacker.signer)
          .setBosonRouterAddress(contractBosonRouter.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][registerVoucherSetID] Should revert if executed by attacker', async () => {
      const voucherSetId = BN('12345');
      const nftTokenID = BN('2');
      await expect(
        contractGate
          .connect(users.attacker.signer)
          .registerVoucherSetID(voucherSetId, nftTokenID)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][registerVoucherSetID] Should revert if nftTokenID id is zero', async () => {
      const voucherSetId = BN('12345');
      const nftTokenID = 0;
      await expect(
        contractGate.registerVoucherSetID(voucherSetId, nftTokenID)
      ).to.be.revertedWith(revertReasons.TOKEN_ID_0_NOT_ALLOWED);
    });

    it('[NEGATIVE][registerVoucherSetID] Should revert if voucherSetId id is zero', async () => {
      const voucherSetId = 0;
      const nftTokenID = BN('2');
      await expect(
        contractGate.registerVoucherSetID(voucherSetId, nftTokenID)
      ).to.be.revertedWith(revertReasons.INVALID_TOKEN_SUPPLY);
    });

    it('[NEGATIVE][check] Should return false if voucherSetId is not registered', async () => {
      const voucherSetId = BN('12345');
      const nftTokenID = BN('2');

      await contractGate.setNonTransferableTokenContract(
        contractERC1155NonTransferable.address
      );

      await contractERC1155NonTransferable.mint(
        users.other1.address,
        nftTokenID,
        constants.ONE,
        constants.ZERO_BYTES
      );

      expect(await contractGate.check(users.other1.address, voucherSetId)).to.be
        .false;
    });

    it('[NEGATIVE][pause] Should revert if executed by attacker', async () => {
      await expect(
        contractGate.connect(users.attacker.signer).pause()
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][unpause] Should revert if executed by attacker', async () => {
      await contractGate.pause();

      await expect(
        contractERC1155NonTransferable.connect(users.attacker.signer).unpause()
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });
  });
});
