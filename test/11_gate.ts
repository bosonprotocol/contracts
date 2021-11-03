import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

import {expect} from 'chai';

import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
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
  VoucherSets,
  Vouchers,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
} from '../typechain';

let ERC1155NonTransferable_Factory: ContractFactory;
let Gate_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let VoucherSets_Factory: ContractFactory;
let Vouchers_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;

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

    VoucherSets_Factory = await ethers.getContractFactory('VoucherSets');
    Vouchers_Factory = await ethers.getContractFactory('Vouchers');
    VoucherKernel_Factory = await ethers.getContractFactory('VoucherKernel');
    Cashier_Factory = await ethers.getContractFactory('Cashier');
    BosonRouter_Factory = await ethers.getContractFactory('BosonRouter');
    TokenRegistry_Factory = await ethers.getContractFactory('TokenRegistry');
    MockERC20Permit_Factory = await ethers.getContractFactory(
      'MockERC20Permit'
    );
  });

  let contractERC1155NonTransferable: ERC1155NonTransferable,
    contractGate: Gate,
    contractVoucherSets: VoucherSets,
    contractVouchers: Vouchers,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractTokenRegistry: TokenRegistry,
    contractBSNTokenPrice: MockERC20Permit,
    contractBSNTokenDeposit: MockERC20Permit;

  async function deployContracts() {
    contractERC1155NonTransferable =
      (await ERC1155NonTransferable_Factory.deploy(
        'https://token-cdn-domain/{id}.json'
      )) as Contract & ERC1155NonTransferable;
    const routerAddress =
      (contractBosonRouter && contractBosonRouter.address) ||
      users.other1.address; // if router is not initalized use mock address
    contractGate = (await Gate_Factory.deploy(
      routerAddress,
      contractERC1155NonTransferable.address
    )) as Contract & Gate;

    await contractERC1155NonTransferable.deployed();
    await contractGate.deployed();
  }

  async function deployBosonRouterContracts() {
    const sixtySeconds = 60;

    const contractAddresses = await calculateDeploymentAddresses(
      users.deployer.address,
      [
        'TokenRegistry',
        'VoucherSets',
        'Vouchers',
        'VoucherKernel',
        'Cashier',
        'BosonRouter',
      ]
    );

    contractTokenRegistry = (await TokenRegistry_Factory.deploy()) as Contract &
      TokenRegistry;
    contractVoucherSets = (await VoucherSets_Factory.deploy(
      'https://token-cdn-domain/{id}.json',
      contractAddresses.Cashier,
      contractAddresses.VoucherKernel
    )) as Contract & VoucherSets;
    contractVouchers = (await Vouchers_Factory.deploy(
      'https://token-cdn-domain/orders/metadata/',
      'Boson Smart Voucher',
      'BSV',
      contractAddresses.Cashier,
      contractAddresses.VoucherKernel
    )) as Contract & Vouchers;
    contractVoucherKernel = (await VoucherKernel_Factory.deploy(
      contractAddresses.BosonRouter,
      contractAddresses.Cashier,
      contractAddresses.VoucherSets,
      contractAddresses.Vouchers
    )) as Contract & VoucherKernel;
    contractCashier = (await Cashier_Factory.deploy(
      contractAddresses.BosonRouter,
      contractAddresses.VoucherKernel,
      contractAddresses.VoucherSets,
      contractAddresses.Vouchers
    )) as Contract & Cashier;
    contractBosonRouter = (await BosonRouter_Factory.deploy(
      contractAddresses.VoucherKernel,
      contractAddresses.TokenRegistry,
      contractAddresses.Cashier
    )) as Contract & BosonRouter;

    contractBSNTokenPrice = (await MockERC20Permit_Factory.deploy(
      'BosonTokenPrice',
      'BPRC'
    )) as Contract & MockERC20Permit;

    contractBSNTokenDeposit = (await MockERC20Permit_Factory.deploy(
      'BosonTokenDeposit',
      'BDEP'
    )) as Contract & MockERC20Permit;

    await contractTokenRegistry.deployed();
    await contractVoucherSets.deployed();
    await contractVouchers.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();

    await contractVouchers.setApprovalForAll(
      contractVoucherKernel.address,
      true
    );

    await contractVoucherKernel.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds);

    await contractTokenRegistry.setTokenLimit(
      contractBSNTokenPrice.address,
      constants.TOKEN_LIMIT
    );
    await contractTokenRegistry.setTokenLimit(
      contractBSNTokenDeposit.address,
      constants.TOKEN_LIMIT
    );
    await contractTokenRegistry.setETHLimit(constants.ETHER_LIMIT);

    //Map $BOSON token to itself so that the token address can be called by casting to the wrapper interface in the Boson Router
    await contractTokenRegistry.setTokenWrapperAddress(
      contractBSNTokenPrice.address,
      contractBSNTokenPrice.address
    );

    await contractTokenRegistry.setTokenWrapperAddress(
      contractBSNTokenDeposit.address,
      contractBSNTokenDeposit.address
    );
  }

  async function registerVoucherSetIdFromBosonProtocol(
    gate,
    conditionalOrderNftTokenID
  ) {
    await contractERC1155NonTransferable.mint(
      users.buyer.address,
      constants.NFT_TOKEN_ID,
      constants.ONE,
      constants.ZERO_BYTES
    );

    await gate.pause();
    await gate.setNonTransferableTokenContract(
      contractERC1155NonTransferable.address
    );
    await gate.setBosonRouterAddress(contractBosonRouter.address);
    await gate.unpause();

    utils = await UtilsBuilder.create()
      .ERC20withPermit()
      .TKNTKN()
      .buildAsync(
        contractVoucherSets,
        contractVouchers,
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
      constants.product_price,
      constants.seller_deposit,
      constants.buyer_deposit,
      constants.QTY_10,
      gate,
      conditionalOrderNftTokenID,
      true
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
    return {tokenId, nftTokenID: constants.NFT_TOKEN_ID};
  }

  describe('Basic operations', () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it('Owner should be able set ERC1155 contract address', async () => {
      await contractGate.pause();
      expect(
        await contractGate.setNonTransferableTokenContract(
          contractERC1155NonTransferable.address
        )
      )
        .to.emit(contractGate, eventNames.LOG_NON_TRANSFERABLE_CONTRACT)
        .withArgs(
          contractERC1155NonTransferable.address,
          users.deployer.address
        );
    });

    it('One should be able get ERC1155 contract address', async () => {
      expect(await contractGate.getNonTransferableTokenContract()).to.equal(
        contractERC1155NonTransferable.address
      );
    });

    it('Owner should be able to register voucher set id', async () => {
      expect(
        await contractGate.registerVoucherSetId(
          constants.VOUCHER_SET_ID,
          constants.NFT_TOKEN_ID
        )
      )
        .to.emit(contractGate, eventNames.LOG_VOUCHER_SET_REGISTERED)
        .withArgs(constants.VOUCHER_SET_ID, constants.NFT_TOKEN_ID);
    });

    it('One should be able to look up on which NFT depends voucher set', async () => {
      await contractGate.registerVoucherSetId(
        constants.VOUCHER_SET_ID,
        constants.NFT_TOKEN_ID
      );
      expect(
        await contractGate.getNftTokenId(constants.VOUCHER_SET_ID)
      ).to.equal(constants.NFT_TOKEN_ID);
    });

    it('check function works correctly', async () => {
      await contractGate.registerVoucherSetId(
        constants.VOUCHER_SET_ID,
        constants.NFT_TOKEN_ID
      );

      expect(
        await contractGate.check(users.other1.address, constants.VOUCHER_SET_ID)
      ).to.be.false;

      await contractERC1155NonTransferable.mint(
        users.other1.address,
        constants.NFT_TOKEN_ID,
        constants.ONE,
        constants.ZERO_BYTES
      );

      expect(
        await contractGate.check(users.other1.address, constants.VOUCHER_SET_ID)
      ).to.be.true;
      expect(
        await contractGate.check(users.other2.address, constants.VOUCHER_SET_ID)
      ).to.be.false;
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
      await contractGate.pause();

      await expect(
        contractGate
          .connect(users.attacker.signer)
          .registerVoucherSetId(
            constants.VOUCHER_SET_ID,
            constants.NFT_TOKEN_ID
          )
      ).to.be.revertedWith(revertReasons.PAUSED);

      await expect(
        contractGate.deactivate(users.other1.address, constants.VOUCHER_SET_ID)
      ).to.be.revertedWith(revertReasons.PAUSED);
    });

    it('[NEGATIVE] ERC1155 cannot be set if gate contract is not paused', async () => {
      await expect(
        contractGate.setNonTransferableTokenContract(
          contractERC1155NonTransferable.address
        )
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setNonTransferableTokenContract] Should revert if supplied wrong boson router address', async () => {
      await expect(
        contractGate.setNonTransferableTokenContract(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
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

    it('[NEGATIVE][registerVoucherSetId] Should revert if executed by attacker', async () => {
      await expect(
        contractGate
          .connect(users.attacker.signer)
          .registerVoucherSetId(
            constants.VOUCHER_SET_ID,
            constants.NFT_TOKEN_ID
          )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER_OR_ROUTER);
    });

    it('[NEGATIVE][registerVoucherSetId] Should revert if nftTokenID id is zero', async () => {
      const nftTokenID = 0;
      await expect(
        contractGate.registerVoucherSetId(constants.VOUCHER_SET_ID, nftTokenID)
      ).to.be.revertedWith(revertReasons.TOKEN_ID_0_NOT_ALLOWED);
    });

    it('[NEGATIVE][registerVoucherSetId] Should revert if constants.VOUCHER_SET_ID id is zero', async () => {
      const voucherSetId = 0;

      await expect(
        contractGate.registerVoucherSetId(voucherSetId, constants.NFT_TOKEN_ID)
      ).to.be.revertedWith(revertReasons.INVALID_TOKEN_SUPPLY);
    });

    it('[NEGATIVE][check] Should return false if constants.VOUCHER_SET_ID is not registered', async () => {
      await contractERC1155NonTransferable.mint(
        users.other1.address,
        constants.NFT_TOKEN_ID,
        constants.ONE,
        constants.ZERO_BYTES
      );

      expect(
        await contractGate.check(users.other1.address, constants.VOUCHER_SET_ID)
      ).to.be.false;
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
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER_OR_SELF);
    });
  });

  describe('Boson router operations', () => {
    beforeEach(async () => {
      await deployBosonRouterContracts();
      await deployContracts();
      await contractBosonRouter.setGateApproval(contractGate.address, true);
    });

    describe('Setting a boson router address', () => {
      it('Owner should be able set boson router address', async () => {
        await contractGate.pause();
        expect(
          await contractGate.setBosonRouterAddress(contractBosonRouter.address)
        )
          .to.emit(contractGate, eventNames.LOG_BOSON_ROUTER_SET)
          .withArgs(contractBosonRouter.address, users.deployer.address);
      });

      it('[NEGATIVE] Boson router address cannot be set when not paused', async () => {
        await expect(
          contractGate.setBosonRouterAddress(contractBosonRouter.address)
        ).to.be.revertedWith(revertReasons.NOT_PAUSED);
      });

      it('[NEGATIVE][deploy Gate] Should revert if ZERO address is provided at deployment for Boson Router address', async () => {
        await expect(
          Gate_Factory.deploy(
            constants.ZERO_ADDRESS,
            contractERC1155NonTransferable.address
          )
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
      });

      it('[NEGATIVE][deploy Gate] Should revert if ZERO address is provided at deployment for ERC1155NonTransferable address', async () => {
        await expect(
          Gate_Factory.deploy(
            contractBosonRouter.address,
            constants.ZERO_ADDRESS
          )
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
      });
      it('[NEGATIVE][setBosonRouterAddress] Should revert if supplied wrong boson router address', async () => {
        await expect(
          contractGate.setBosonRouterAddress(constants.ZERO_ADDRESS)
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
      });

      it('[NEGATIVE][setBosonRouterAddress] Should revert if executed by attacker', async () => {
        await expect(
          contractGate
            .connect(users.attacker.signer)
            .setBosonRouterAddress(contractBosonRouter.address)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
      });
    });

    describe('Setting gate approval status', () => {
      it('Owner should be able to approve a gate', async () => {
        await expect(
          contractBosonRouter.setGateApproval(users.other1.address, true)
        )
          .to.emit(contractBosonRouter, eventNames.LOG_GATE_APPROVAL_CHANGED)
          .withArgs(users.other1.address, true);
      });

      it('Owner should be able to un-approve a gate', async () => {
        await contractBosonRouter.setGateApproval(users.other1.address, true);

        await expect(
          contractBosonRouter.setGateApproval(users.other1.address, false)
        )
          .to.emit(contractBosonRouter, eventNames.LOG_GATE_APPROVAL_CHANGED)
          .withArgs(users.other1.address, false);
      });

      it('[NEGATIVE] gate approval should revert if not called by owner', async () => {
        await expect(
          contractBosonRouter
            .connect(users.attacker.signer)
            .setGateApproval(users.other1.address, true)
        ).to.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
      });

      it('[NEGATIVE] gate approval should revert if owner sends zero address', async () => {
        await expect(
          contractBosonRouter.setGateApproval(constants.ZERO_ADDRESS, true)
        ).to.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
      });

      it('[NEGATIVE] gate approval should revert if no change is represented', async () => {
        await contractBosonRouter.setGateApproval(users.other1.address, true);

        await expect(
          contractBosonRouter.setGateApproval(users.other1.address, true)
        ).to.revertedWith(revertReasons.NO_CHANGE);
      });
    });

    describe('Voucher set registered by Boson protocol', () => {
      it('Boson router should be able to deactivate voucher set id', async () => {
        const {tokenId, nftTokenID} =
          await registerVoucherSetIdFromBosonProtocol(contractGate, 0);

        await contractGate.registerVoucherSetId(tokenId, nftTokenID);

        expect(await contractGate.check(users.buyer.address, tokenId)).to.be
          .true;

        await utils.commitToBuy(
          users.buyer,
          users.seller,
          tokenId,
          constants.product_price,
          constants.buyer_deposit
        );

        expect(await contractGate.check(users.buyer.address, tokenId)).to.be
          .false;
      });

      it('[NEGATIVE] Should revert if attacker tries to deactivate voucher set id', async () => {
        const {tokenId, nftTokenID} =
          await registerVoucherSetIdFromBosonProtocol(contractGate, 0);

        await contractGate.registerVoucherSetId(tokenId, nftTokenID);

        await expect(
          contractGate.deactivate(users.buyer.address, tokenId)
        ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
      });
    });
  });
});
