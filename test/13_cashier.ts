import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';
import {expect} from 'chai';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import {Cashier, MockERC20Permit} from '../typechain';

let Cashier_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';

let users;

describe('CASHIER', () => {
  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    Cashier_Factory = await ethers.getContractFactory('Cashier');
    MockERC20Permit_Factory = await ethers.getContractFactory(
      'MockERC20Permit'
    );
  });

  let contractCashier: Cashier, contractBSNTokenDeposit: MockERC20Permit;

  async function deployContracts() {
    contractCashier = (await Cashier_Factory.deploy(
      users.other2.address, // just setting some address, we don't need actual functionalities functionalites
      users.other2.address, // just setting some address, we don't need actual functionalities functionalites
      users.other2.address, // just setting some address, we don't need actual functionalities functionalites
      users.other2.address // just setting some address, we don't need actual functionalities functionalites
    )) as Contract & Cashier;

    contractBSNTokenDeposit = (await MockERC20Permit_Factory.deploy(
      'BosonTokenDeposit',
      'BDEP'
    )) as Contract & MockERC20Permit;

    await contractCashier.deployed();
  }

  beforeEach(async () => {
    await deployContracts();
  });

  it('[NEGATIVE] Should revert if attacker tries to call method that should be called only from bosonRouter', async () => {
    const attackerInstance = contractCashier.connect(users.attacker.signer);

    await expect(attackerInstance.pause()).to.be.revertedWith(
      revertReasons.ONLY_FROM_ROUTER
    );
    await expect(attackerInstance.unpause()).to.be.revertedWith(
      revertReasons.ONLY_FROM_ROUTER
    );
    await expect(
      attackerInstance.withdrawDepositsSe(
        constants.ONE,
        constants.ONE,
        users.other1.address
      )
    ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
    await expect(
      attackerInstance.addEscrowAmount(users.other1.address)
    ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
    await expect(
      attackerInstance.addEscrowTokensAmount(
        contractBSNTokenDeposit.address,
        users.other1.address,
        constants.buyer_deposit
      )
    ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
  });

  it('[NEGATIVE] Should revert if onVoucherTransfer is called by the attacker', async () => {
    const attackerInstance = contractCashier.connect(users.attacker.signer);

    await expect(
      attackerInstance.onVoucherTransfer(
        users.other1.address,
        users.attacker.address,
        constants.ONE
      )
    ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TOKEN_CONTRACT);
  });

  it('[NEGATIVE] Should revert if onVoucherSetTransfer is called by the attacker', async () => {
    const attackerInstance = contractCashier.connect(users.attacker.signer);

    await expect(
      attackerInstance.onVoucherSetTransfer(
        users.other1.address,
        users.attacker.address,
        constants.ONE,
        constants.ONE
      )
    ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TOKEN_CONTRACT);
  });
});
