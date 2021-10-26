import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

import {assert, expect} from 'chai';
import constants from '../testHelpers/constants';

import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';

import {
  BosonRouter,
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  TokenRegistry,
} from '../typechain';

let ERC1155ERC721_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;

let ERC1155ERC721_Factory2: ContractFactory;
let VoucherKernel_Factory2: ContractFactory;
let Cashier_Factory2: ContractFactory;
let BosonRouter_Factory2: ContractFactory;
let TokenRegistry_Factory2: ContractFactory;

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
    TokenRegistry_Factory = await ethers.getContractFactory('TokenRegistry');
  });

  let contractERC1155ERC721: ERC1155ERC721,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractTokenRegistry: TokenRegistry;

  let contractERC1155ERC721_2: ERC1155ERC721,
    contractVoucherKernel_2: VoucherKernel,
    contractCashier_2: Cashier,
    contractBosonRouter_2: BosonRouter,
    contractTokenRegistry_2: TokenRegistry;

  async function deployContracts() {
    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    contractTokenRegistry = (await TokenRegistry_Factory.deploy()) as Contract &
      TokenRegistry;
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
      contractTokenRegistry.address,
      contractCashier.address
    )) as Contract & BosonRouter;

    await contractTokenRegistry.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
  }

  async function deployContracts2() {
    ERC1155ERC721_Factory2 = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel_Factory2 = await ethers.getContractFactory('VoucherKernel');
    Cashier_Factory2 = await ethers.getContractFactory('Cashier');
    BosonRouter_Factory2 = await ethers.getContractFactory('BosonRouter');
    TokenRegistry_Factory2 = await ethers.getContractFactory('TokenRegistry');

    const sixtySeconds = 60;

    contractTokenRegistry_2 = (await TokenRegistry_Factory2.deploy()) as Contract &
      TokenRegistry;
    contractERC1155ERC721_2 = (await ERC1155ERC721_Factory2.deploy()) as Contract &
      ERC1155ERC721;
    contractVoucherKernel_2 = (await VoucherKernel_Factory2.deploy(
      contractERC1155ERC721_2.address
    )) as Contract & VoucherKernel;
    contractCashier_2 = (await Cashier_Factory2.deploy(
      contractVoucherKernel_2.address
    )) as Contract & Cashier;
    contractBosonRouter_2 = (await BosonRouter_Factory2.deploy(
      contractVoucherKernel_2.address,
      contractTokenRegistry_2.address,
      contractCashier_2.address
    )) as Contract & BosonRouter;

    await contractTokenRegistry_2.deployed();
    await contractERC1155ERC721_2.deployed();
    await contractVoucherKernel_2.deployed();
    await contractCashier_2.deployed();
    await contractBosonRouter_2.deployed();

    await contractERC1155ERC721_2.setApprovalForAll(
      contractVoucherKernel_2.address,
      true
    );
    await contractERC1155ERC721_2.setVoucherKernelAddress(
      contractVoucherKernel_2.address
    );

    await contractERC1155ERC721_2.setCashierAddress(contractCashier_2.address);

    await contractVoucherKernel_2.setBosonRouterAddress(
      contractBosonRouter_2.address
    );
    await contractVoucherKernel_2.setCashierAddress(contractCashier_2.address);

    await contractCashier_2.setBosonRouterAddress(
      contractBosonRouter_2.address
    );
    await contractCashier_2.setTokenContractAddress(
      contractERC1155ERC721_2.address
    );

    await contractVoucherKernel_2.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel_2.setCancelFaultPeriod(sixtySeconds);
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

    it('[NEGATIVE][setBosonRouterAddress] Should revert if ZERO address is provided at deployment', async () => {
      await expect(
        Cashier_Factory.deploy(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });
  });

  describe('ERC1155721', () => {
    before(async () => {
      await deployContracts();
    });

    it('Owner should be the deployer', async () => {
      const expectedOwner = users.deployer.address;
      const owner = await contractERC1155ERC721.owner();

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
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
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
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
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

    it('[NEGATIVE][setBosonRouterAddress] Should revert if ZERO address is provided at deployment', async () => {
      await expect(
        VoucherKernel_Factory.deploy(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });
  });

  describe('BosonRouter', function () {
    beforeEach('Deploy and create instancess of the contracts', async () => {
      await deployContracts();
      await deployContracts2();
    });

    it('[setVoucherKernelAddress] Should be able to set a new Voucher Kernel address', async () => {
      const expectedNewVoucherKernelAddress = contractVoucherKernel_2.address;
      const tx = await contractBosonRouter.setVoucherKernelAddress(
        expectedNewVoucherKernelAddress
      );

      const txReceipt = await tx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter_Factory,
        eventNames.LOG_VOUCHER_KERNEL_SET,
        (ev) => {
          assert.equal(ev._newVoucherKernel, expectedNewVoucherKernelAddress);
          assert.equal(ev._triggeredBy, users.deployer.address);
        }
      );

      expect(await contractBosonRouter.getVoucherKernelAddress()).to.equal(
        expectedNewVoucherKernelAddress,
        'Not expected Voucher kernel address'
      );
    });

    it('[NEGATIVE][setVoucherKernelAddress] should revert if called by an attacker', async () => {
      await expect(
        contractBosonRouter.setVoucherKernelAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[NEGATIVE][setVoucherKernelAddress] should revert when address is a zero address', async () => {
      const attackerInstance = contractBosonRouter.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setVoucherKernelAddress(
          contractVoucherKernel_2.address
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[setTokenRegistryAddress] Should be able to set a new Token Registry address', async () => {
      const expectedNewTokenRegistryAddress = contractTokenRegistry_2.address;
      const tx = await contractBosonRouter.setTokenRegistryAddress(
        expectedNewTokenRegistryAddress
      );

      const txReceipt = await tx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter_Factory,
        eventNames.LOG_TOKEN_REGISTRY_SET,
        (ev) => {
          assert.equal(ev._newTokenRegistry, expectedNewTokenRegistryAddress);
          assert.equal(ev._triggeredBy, users.deployer.address);
        }
      );

      expect(await contractBosonRouter.getTokenRegistryAddress()).to.equal(
        expectedNewTokenRegistryAddress,
        'Not expected Token Registry address'
      );
    });

    it('[NEGATIVE][setTokenRegistryAddress] should revert if called by an attacker', async () => {
      const attackerInstance = contractBosonRouter.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setTokenRegistryAddress(
          contractTokenRegistry_2.address
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setTokenRegistryAddress] should revert when address is a zero address', async () => {
      await expect(
        contractBosonRouter.setTokenRegistryAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[setCashierAddress] Should be able to set a new Cashier address', async () => {
      const expectedNewCashierAddress = contractCashier_2.address;
      const tx = await contractBosonRouter.setCashierAddress(
        expectedNewCashierAddress
      );

      const txReceipt = await tx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter_Factory,
        eventNames.LOG_CASHIER_SET,
        (ev) => {
          assert.equal(ev._newCashier, expectedNewCashierAddress);
          assert.equal(ev._triggeredBy, users.deployer.address);
        }
      );

      expect(await contractBosonRouter.getCashierAddress()).to.equal(
        expectedNewCashierAddress,
        'Not expected Cashier address'
      );
    });

    it('[NEGATIVE][setCashierAddress] should revert if called by an attacker', async () => {
      const attackerInstance = contractBosonRouter.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setCashierAddress(contractCashier_2.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setCashierAddress] should revert when address is a zero address', async () => {
      await expect(
        contractBosonRouter.setCashierAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });
  });
}); //end of contract
