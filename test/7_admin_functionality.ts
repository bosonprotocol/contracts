import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

import {assert, expect} from 'chai';

import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';

import {
  BosonRouter,
  VoucherSets,
  Vouchers,
  VoucherKernel,
  Cashier,
  TokenRegistry,
} from '../typechain';

let VoucherSets_Factory: ContractFactory;
let Vouchers_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
import {eventNames} from '../testHelpers/events';

let users;

describe('Admin functionality', async () => {
  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    VoucherSets_Factory = await ethers.getContractFactory('VoucherSets');
    Vouchers_Factory = await ethers.getContractFactory('Vouchers');
    VoucherKernel_Factory = await ethers.getContractFactory('VoucherKernel');
    Cashier_Factory = await ethers.getContractFactory('Cashier');
    BosonRouter_Factory = await ethers.getContractFactory('BosonRouter');
    TokenRegistry_Factory = await ethers.getContractFactory('TokenRegistry');
  });

  let contractVoucherSets: VoucherSets,
    contractVouchers: Vouchers,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractTokenRegistry: TokenRegistry;

  let contractVoucherSets_2: VoucherSets,
    contractVouchers_2: Vouchers,
    contractVoucherKernel_2: VoucherKernel,
    contractCashier_2: Cashier,
    contractTokenRegistry_2: TokenRegistry;

  async function deployContracts() {
    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

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

    await contractTokenRegistry.deployed();
    await contractVoucherSets.deployed();
    await contractVouchers.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
  }

  async function deployContracts2() {
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

    contractTokenRegistry_2 =
      (await TokenRegistry_Factory.deploy()) as Contract & TokenRegistry;
    contractVoucherSets_2 = (await VoucherSets_Factory.deploy(
      'https://token-cdn-domain/{id}.json',
      contractAddresses.Cashier,
      contractAddresses.VoucherKernel
    )) as Contract & VoucherSets;
    contractVouchers_2 = (await Vouchers_Factory.deploy(
      'https://token-cdn-domain/orders/metadata/',
      'Boson Smart Voucher',
      'BSV',
      contractAddresses.Cashier,
      contractAddresses.VoucherKernel
    )) as Contract & Vouchers;
    contractVoucherKernel_2 = (await VoucherKernel_Factory.deploy(
      contractAddresses.BosonRouter,
      contractAddresses.Cashier,
      contractAddresses.VoucherSets,
      contractAddresses.Vouchers
    )) as Contract & VoucherKernel;
    contractCashier_2 = (await Cashier_Factory.deploy(
      contractAddresses.BosonRouter,
      contractAddresses.VoucherKernel,
      contractAddresses.VoucherSets,
      contractAddresses.Vouchers
    )) as Contract & Cashier;

    // contractTokenRegistry_2 =
    //   (await TokenRegistry_Factory.deploy()) as Contract & TokenRegistry;
    // contractVoucherSets_2 = (await VoucherSets_Factory.deploy(
    //   'https://token-cdn-domain/{id}.json'
    // )) as Contract & VoucherSets;
    // contractVouchers_2 = (await Vouchers_Factory.deploy(
    //   'https://token-cdn-domain/orders/metadata/',
    //   'Boson Smart Voucher',
    //   'BSV'
    // )) as Contract & Vouchers;
    // contractVoucherKernel_2 = (await VoucherKernel_Factory.deploy(
    //   contractVoucherSets_2.address,
    //   contractVouchers_2.address
    // )) as Contract & VoucherKernel;
    // contractCashier_2 = (await Cashier_Factory.deploy(
    //   contractVoucherKernel_2.address
    // )) as Contract & Cashier;

    await contractTokenRegistry_2.deployed();
    await contractVoucherSets_2.deployed();
    await contractVouchers_2.deployed();
    await contractVoucherKernel_2.deployed();
    await contractCashier_2.deployed();
  }

  describe('Cashier', () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it('Owner should be the deployer', async () => {
      const expectedOwner = users.deployer.address;
      const owner = await contractCashier.owner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set BR address', async () => {
      await contractBosonRouter.pause();
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

    it('[NEGATIVE] BR address cannot be set if not paused', async () => {
      await expect(
        contractCashier.setBosonRouterAddress(contractBosonRouter.address)
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractCashier.connect(users.attacker.signer);
      await expect(
        attackerInstance.setBosonRouterAddress(contractBosonRouter.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if ZERO address is provided', async () => {
      await contractBosonRouter.pause();
      await expect(
        contractCashier.setBosonRouterAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('Owner should be able to set voucherSet token contract address', async () => {
      await contractBosonRouter.pause();
      const tx = await contractCashier.setVoucherSetTokenAddress(
        contractVoucherSets.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        Cashier_Factory,
        eventNames.LOG_VOUCHER_SET_TOKEN_SET,
        (ev) => {
          assert.equal(
            ev._newTokenContract,
            contractVoucherSets.address,
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

    it('[NEGATIVE] voucherSet token contract address cannot be set when not paused', async () => {
      await expect(
        contractCashier.setVoucherSetTokenAddress(contractVoucherSets.address)
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setVoucherSetTokenAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractCashier.connect(users.attacker.signer);
      await expect(
        attackerInstance.setVoucherSetTokenAddress(contractVoucherSets.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setVoucherSetTokenAddress] Should revert if ZERO address is provided', async () => {
      await expect(
        contractCashier.setVoucherSetTokenAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('Owner should be able to set voucher token contract address', async () => {
      await contractBosonRouter.pause();
      const tx = await contractCashier.setVoucherTokenAddress(
        contractVouchers.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        Cashier_Factory,
        eventNames.LOG_VOUCHER_TOKEN_SET,
        (ev) => {
          assert.equal(
            ev._newTokenContract,
            contractVouchers.address,
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

    it('[NEGATIVE] voucher token contract address cannot be set if not paused', async () => {
      await expect(
        contractCashier.setVoucherTokenAddress(contractVouchers.address)
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setVoucherTokenAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractCashier.connect(users.attacker.signer);
      await expect(
        attackerInstance.setVoucherTokenAddress(contractVouchers.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setVoucherTokenAddress] Should revert if ZERO address is provided', async () => {
      await expect(
        contractCashier.setVoucherTokenAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[NEGATIVE][deploy Cashier] Should revert if ZERO address is provided at deployment for BosonRouter address', async () => {
      await expect(
        Cashier_Factory.deploy(
          constants.ZERO_ADDRESS,
          contractVoucherKernel.address,
          contractVoucherSets.address,
          contractVouchers.address
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[NEGATIVE][deploy Cashier] Should revert if ZERO address is provided at deployment for VoucherKernel address', async () => {
      await expect(
        Cashier_Factory.deploy(
          contractBosonRouter.address,
          constants.ZERO_ADDRESS,
          contractVoucherSets.address,
          contractVouchers.address
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[NEGATIVE][deploy Cashier] Should revert if ZERO address is provided at deployment for VoucherSets address', async () => {
      await expect(
        Cashier_Factory.deploy(
          contractBosonRouter.address,
          contractVoucherKernel.address,
          constants.ZERO_ADDRESS,
          contractVouchers.address
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[NEGATIVE][deploy Cashier] Should revert if ZERO address is provided at deployment for Vouchers address', async () => {
      await expect(
        Cashier_Factory.deploy(
          contractBosonRouter.address,
          contractVoucherKernel.address,
          contractVoucherSets.address,
          constants.ZERO_ADDRESS
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    describe('[setVoucherKernelAddress]', function () {
      beforeEach(
        'Deploy and create another instance of the contracts',
        async () => {
          await deployContracts2();
        }
      );

      it('[setVoucherKernelAddress] Should be able to set a new Voucher Kernel address', async () => {
        await contractBosonRouter.pause();
        const expectedNewVoucherKernelAddress = contractVoucherKernel_2.address;
        const tx = await contractCashier.setVoucherKernelAddress(
          expectedNewVoucherKernelAddress
        );

        const txReceipt = await tx.wait();
        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_VK_SET,
          (ev) => {
            assert.equal(ev._newVoucherKernel, expectedNewVoucherKernelAddress);
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );

        expect(await contractCashier.getVoucherKernelAddress()).to.equal(
          expectedNewVoucherKernelAddress,
          'Not expected Voucher kernel address'
        );
      });

      it('[NEGATIVE] Voucher Kernel address cannot be se if not paused', async () => {
        await expect(
          contractCashier.setVoucherKernelAddress(
            contractVoucherKernel_2.address
          )
        ).to.be.revertedWith(revertReasons.NOT_PAUSED);
      });

      it('[NEGATIVE][setVoucherKernelAddress] should revert when address is a zero address', async () => {
        await expect(
          contractCashier.setVoucherKernelAddress(constants.ZERO_ADDRESS)
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
      });

      it('[NEGATIVE][setVoucherKernelAddress] should revert if called by an attacker', async () => {
        const attackerInstance = contractCashier.connect(users.attacker.signer);
        await expect(
          attackerInstance.setVoucherKernelAddress(
            contractVoucherKernel_2.address
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
      });
    });
  });

  describe('VoucherSets', () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it('Owner should be the deployer', async () => {
      const expectedOwner = users.deployer.address;
      const owner = await contractVoucherSets.owner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set VK address', async () => {
      await contractVoucherSets.pause();
      const tx = await contractVoucherSets.setVoucherKernelAddress(
        contractVoucherKernel.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherSets_Factory,
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

    it('[NEGATIVE] VK address cannot be set if not paused', async () => {
      await expect(
        contractVoucherSets.setVoucherKernelAddress(
          contractVoucherKernel.address
        )
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setVoucherKernelAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractVoucherSets.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setVoucherKernelAddress(contractVoucherKernel.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setVoucherKernelAddress] Should revert if ZERO address is provided', async () => {
      await expect(
        contractVoucherSets.setVoucherKernelAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
    });

    it('Owner should be able to set Cashier address', async () => {
      await contractVoucherSets.pause();
      const tx = await contractVoucherSets.setCashierAddress(
        contractCashier.address
      );

      const txReceipt = await tx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherSets_Factory,
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

    it('[NEGATIVE] Cashier address cannot be set if not paused', async () => {
      await expect(
        contractVoucherSets.setCashierAddress(contractCashier.address)
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setCashierAddress] Attacker should not be able to set Cashier address', async () => {
      const attackerInstance = contractVoucherSets.connect(
        users.attacker.signer
      );

      await expect(
        attackerInstance.setCashierAddress(contractCashier.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setCashierAddress] Owner should not be able to set ZERO Cashier address', async () => {
      await contractBosonRouter.pause();
      await expect(
        contractVoucherSets.setCashierAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
    });
  });

  describe('Vouchers', () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it('Owner should be the deployer', async () => {
      const expectedOwner = users.deployer.address;
      const owner = await contractVouchers.owner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set VK address', async () => {
      await contractVouchers.pause();
      const tx = await contractVouchers.setVoucherKernelAddress(
        contractVoucherKernel.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        Vouchers_Factory,
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

    it('[NEGATIVE] VK address cannot be set if not paused', async () => {
      await expect(
        contractVouchers.setVoucherKernelAddress(contractVoucherKernel.address)
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setVoucherKernelAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractVouchers.connect(users.attacker.signer);
      await expect(
        attackerInstance.setVoucherKernelAddress(contractVoucherKernel.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setVoucherKernelAddress] Should revert if ZERO address is provided', async () => {
      await expect(
        contractVouchers.setVoucherKernelAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
    });

    it('Owner should be able to set Cashier address', async () => {
      await contractVouchers.pause();
      const tx = await contractVouchers.setCashierAddress(
        contractCashier.address
      );

      const txReceipt = await tx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        Vouchers_Factory,
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

    it('[NEGATIVE] Cashier address cannot be set when not paused', async () => {
      await expect(
        contractVouchers.setCashierAddress(contractCashier.address)
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setCashierAddress] Attacker should not be able to set Cashier address', async () => {
      const attackerInstance = contractVouchers.connect(users.attacker.signer);

      await expect(
        attackerInstance.setCashierAddress(contractCashier.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setCashierAddress] Owner should not be able to set ZERO Cashier address', async () => {
      await expect(
        contractVouchers.setCashierAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
    });
  });

  describe('VoucherKernel', () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it('Owner should be the deployer', async () => {
      const expectedOwner = users.deployer.address;
      const owner = await contractVoucherKernel.owner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set Cashier address', async () => {
      await contractBosonRouter.pause();
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

    it('[NEGATIVE] Cashier address cannot be set when not paused', async () => {
      await expect(
        contractVoucherKernel.setCashierAddress(contractCashier.address)
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
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
      await contractBosonRouter.pause();
      await expect(
        contractVoucherKernel.setCashierAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('Owner should be able to set BR address', async () => {
      await contractBosonRouter.pause();
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

    it('[NEGATIVE] BR address cannot be set if not paused', async () => {
      await expect(
        contractVoucherKernel.setBosonRouterAddress(contractBosonRouter.address)
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
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
      await contractBosonRouter.pause();
      await expect(
        contractVoucherKernel.setBosonRouterAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('Owner should be able to set voucherSet token contract address', async () => {
      await contractBosonRouter.pause();
      const tx = await contractVoucherKernel.setVoucherSetTokenAddress(
        contractVoucherSets.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_SET_TOKEN_SET,
        (ev) => {
          assert.equal(
            ev._newTokenContract,
            contractVoucherSets.address,
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

    it('[NEGATIVE] voucherSet token contract address cannot be set when not paused', async () => {
      await expect(
        contractVoucherKernel.setVoucherSetTokenAddress(
          contractVoucherSets.address
        )
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setVoucherSetTokenAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractVoucherKernel.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setVoucherSetTokenAddress(contractVoucherSets.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setVoucherSetTokenAddress] Should revert if ZERO address is provided', async () => {
      await expect(
        contractVoucherKernel.setVoucherSetTokenAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('Owner should be able to set voucher token contract address', async () => {
      await contractBosonRouter.pause();
      const tx = await contractVoucherKernel.setVoucherTokenAddress(
        contractVouchers.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_VOUCHER_TOKEN_SET,
        (ev) => {
          assert.equal(
            ev._newTokenContract,
            contractVouchers.address,
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

    it('[NEGATIVE] voucher token contract address cannot be set if not paused', async () => {
      await expect(
        contractVoucherKernel.setVoucherTokenAddress(contractVouchers.address)
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setVoucherTokenAddress] Should revert if executed by attacker', async () => {
      const attackerInstance = contractVoucherKernel.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setVoucherTokenAddress(contractVouchers.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setVoucherTokenAddress] Should revert if ZERO address is provided', async () => {
      await expect(
        contractVoucherKernel.setVoucherTokenAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[NEGATIVE][deploy VoucherKernel] Should revert if ZERO address is provided at deployment for BosonRouter', async () => {
      await expect(
        VoucherKernel_Factory.deploy(
          constants.ZERO_ADDRESS,
          contractCashier.address,
          contractVoucherSets.address,
          contractVouchers.address
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[NEGATIVE][deploy VoucherKernel] Should revert if ZERO address is provided at deployment for Cashier', async () => {
      await expect(
        VoucherKernel_Factory.deploy(
          contractBosonRouter.address,
          constants.ZERO_ADDRESS,
          contractVoucherSets.address,
          contractVouchers.address
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[NEGATIVE][deploy VoucherKernel] Should revert if ZERO address is provided at deployment for VoucherSets', async () => {
      await expect(
        VoucherKernel_Factory.deploy(
          contractBosonRouter.address,
          contractCashier.address,
          constants.ZERO_ADDRESS,
          contractVouchers.address
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[NEGATIVE][deploy VoucherKernel] Should revert if ZERO address is provided at deployment for Vouchers', async () => {
      await expect(
        VoucherKernel_Factory.deploy(
          contractBosonRouter.address,
          contractCashier.address,
          contractVoucherSets.address,
          constants.ZERO_ADDRESS
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });
  });

  describe('BosonRouter', function () {
    beforeEach('Deploy and create instancess of the contracts', async () => {
      await deployContracts();
      await deployContracts2();
    });

    it('[setVoucherKernelAddress] Should be able to set a new Voucher Kernel address', async () => {
      await contractBosonRouter.pause();
      const expectedNewVoucherKernelAddress = contractVoucherKernel_2.address;
      const tx = await contractBosonRouter.setVoucherKernelAddress(
        expectedNewVoucherKernelAddress
      );

      const txReceipt = await tx.wait();
      eventUtils.assertEventEmitted(
        txReceipt,
        BosonRouter_Factory,
        eventNames.LOG_VK_SET,
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

    it('[NEGATIVE] Voucher Kernel address cannot be set if not paused', async () => {
      await expect(
        contractBosonRouter.setVoucherKernelAddress(
          contractVoucherKernel_2.address
        )
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
    });

    it('[NEGATIVE][setVoucherKernelAddress] should revert if called by an attacker', async () => {
      const attackerInstance = contractBosonRouter.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setVoucherKernelAddress(
          contractVoucherKernel_2.address
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][setVoucherKernelAddress] should revert when address is a zero address', async () => {
      await expect(
        contractBosonRouter.setVoucherKernelAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('[setTokenRegistryAddress] Should be able to set a new Token Registry address', async () => {
      await contractBosonRouter.pause();
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

    it('[NEGATIVE] Token Registry address cannot be set when not paused', async () => {
      await expect(
        contractBosonRouter.setTokenRegistryAddress(
          contractTokenRegistry_2.address
        )
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
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
      await contractBosonRouter.pause();
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

    it('[NEGATIVE] Cashier address cannot set if not paused', async () => {
      await expect(
        contractBosonRouter.setCashierAddress(contractCashier_2.address)
      ).to.be.revertedWith(revertReasons.NOT_PAUSED);
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
