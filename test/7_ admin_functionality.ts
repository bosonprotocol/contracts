import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

import {assert, expect} from 'chai';
import constants from '../testHelpers/constants';

import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';

let ERC1155ERC721_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let FundLimitsOracle_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
import {eventNames} from '../testHelpers/events';

let users;

describe('Admin functionality', async () => {
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
  });

  let contractERC1155ERC721: Contract,
    contractVoucherKernel: Contract,
    contractCashier: Contract,
    contractBosonRouter: Contract,
    contractFundLimitsOracle: Contract;

  async function deployContracts() {
    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    contractFundLimitsOracle = await FundLimitsOracle_Factory.deploy();

    contractERC1155ERC721 = await ERC1155ERC721_Factory.deploy();
    contractVoucherKernel = await VoucherKernel_Factory.deploy(
      contractERC1155ERC721.address
    );
    contractCashier = await Cashier_Factory.deploy(
      contractVoucherKernel.address
    );
    contractBosonRouter = await BosonRouter_Factory.deploy(
      contractVoucherKernel.address,
      contractFundLimitsOracle.address,
      contractCashier.address
    );

    await contractFundLimitsOracle.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
  }

  describe('Cashier', () => {
    before(async () => {
      await deployContracts();
    });

    it('Owner should be the deployer', async () => {
      const expectedOwner = users.deployer.address;
      const owner = await contractCashier.owner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set BR address', async () => {
      const tx = await contractCashier.setBosonRouterAddress(
        contractBosonRouter.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        Cashier_Factory,
        eventNames.LOG_BR_SET,
        (ev) => {
          assert.equal(
            ev._newBosonRouter,
            contractBosonRouter.address,
            'BR not as expected!'
          );
          assert.equal(
            ev._triggeredBy,
            users.deployer.address,
            'LogBosonRouterSet not triggered by owner!'
          );
        }
      );
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractCashier.connect(users.attacker.signer);
      await expect(
        attackerInstance.setBosonRouterAddress(contractBosonRouter.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if ZERO address is provided', async () => {
      await expect(
        contractCashier.setBosonRouterAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
    });

    it('Owner should be able to set token contract address', async () => {
      const tx = await contractCashier.setTokenContractAddress(
        contractERC1155ERC721.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        Cashier_Factory,
        eventNames.LOG_ERC1155_ERC721_SET,
        (ev) => {
          assert.equal(
            ev._newTokenContract,
            contractERC1155ERC721.address,
            'Token contract not as expected!'
          );
          assert.equal(
            ev._triggeredBy,
            users.deployer.address,
            'LogTokenContractSet not triggered by owner!'
          );
        }
      );
    });

    it('[NEGATIVE][setTokenContractAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractCashier.connect(users.attacker.signer);
      await expect(
        attackerInstance.setTokenContractAddress(contractERC1155ERC721.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setTokenContractAddress] Should revert if ZERO address is provided', async () => {
      await expect(
        contractCashier.setTokenContractAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
    });
  });

  describe('ERC1155721', () => {
    before(async () => {
      await deployContracts();
    });

    it('Owner should be the deployer', async () => {
      const expectedOwner = users.deployer.address;
      const owner = await contractERC1155ERC721.getOwner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set VK address', async () => {
      const tx = await contractERC1155ERC721.setVoucherKernelAddress(
        contractVoucherKernel.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        ERC1155ERC721_Factory,
        eventNames.LOG_VK_SET,
        (ev) => {
          assert.equal(
            ev._newVoucherKernel,
            contractVoucherKernel.address,
            'VK not as expected!'
          );
          assert.equal(
            ev._triggeredBy,
            users.deployer.address,
            'LogVoucherKernelSet not triggered by owner!'
          );
        }
      );
    });

    it('[NEGATIVE][setVoucherKernelAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractERC1155ERC721.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setVoucherKernelAddress(contractVoucherKernel.address)
      ).to.be.revertedWith(revertReasons.NOT_OWNER);
    });

    it('[NEGATIVE][setVoucherKernelAddress] Should revert if ZERO address is provided', async () => {
      await expect(
        contractERC1155ERC721.setVoucherKernelAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
    });

    it('Owner should be able to set Cashier address', async () => {
      const tx = await contractERC1155ERC721.setCashierAddress(
        contractCashier.address
      );

      const txReceipt = await tx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        ERC1155ERC721_Factory,
        eventNames.LOG_CASHIER_SET,
        (ev) => {
          assert.equal(
            ev._newCashier,
            contractCashier.address,
            'Cashier not as expected!'
          );
          assert.equal(
            ev._triggeredBy,
            users.deployer.address,
            'LogCashierSet not triggered by owner!'
          );
        }
      );
    });

    it('[NEGATIVE][setCashierAddress] Attacker should not be able to set Cashier address', async () => {
      const attackerInstance = contractERC1155ERC721.connect(
        users.attacker.signer
      );

      await expect(
        attackerInstance.setCashierAddress(contractCashier.address)
      ).to.be.revertedWith(revertReasons.NOT_OWNER);
    });

    it('[NEGATIVE][setCashierAddress] Owner should not be able to set ZERO Cashier address', async () => {
      await expect(
        contractERC1155ERC721.setCashierAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
    });
  });

  describe('VoucherKernel', () => {
    before(async () => {
      await deployContracts();
    });

    it('Owner should be the deployer', async () => {
      const expectedOwner = users.deployer.address;
      const owner = await contractVoucherKernel.owner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set Cashier address', async () => {
      const tx = await contractVoucherKernel.setCashierAddress(
        contractCashier.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_CASHIER_SET,
        (ev) => {
          assert.equal(
            ev._newCashier,
            contractCashier.address,
            'Cashier not as expected!'
          );
          assert.equal(
            ev._triggeredBy,
            users.deployer.address,
            'LogCashierSet not triggered by owner!'
          );
        }
      );
    });

    it('[NEGATIVE][setCashierAddress] Attacker should not be able to set Cashier address', async () => {
      const attackerInstance = contractVoucherKernel.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setCashierAddress(contractCashier.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setCashierAddress] Owner should not be able to set ZERO Cashier address', async () => {
      await expect(
        contractVoucherKernel.setCashierAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
    });

    it('Owner should be able to set BR address', async () => {
      const tx = await contractVoucherKernel.setBosonRouterAddress(
        contractBosonRouter.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_BR_SET,
        (ev) => {
          assert.equal(
            ev._newBosonRouter,
            contractBosonRouter.address,
            'BR not as expected!'
          );
          assert.equal(
            ev._triggeredBy,
            users.deployer.address,
            'LogBosonRouterSet not triggered by owner!'
          );
        }
      );
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractVoucherKernel.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setBosonRouterAddress(contractBosonRouter.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if ZERO address is provided', async () => {
      await expect(
        contractVoucherKernel.setBosonRouterAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
    });
  });
}); //end of contract
