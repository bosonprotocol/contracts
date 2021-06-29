const ethers = require('hardhat').ethers;
const {assert, expect} = require('chai');

const constants = require('../testHelpers/constants');
const Users = require('../testHelpers/users');
const Utils = require('../testHelpers/utils');

let ERC1155ERC721;
let VoucherKernel;
let Cashier;
let BosonRouter;
let FundLimitsOracle;

const revertReasons = require('../testHelpers/revertReasons');
const eventUtils = require('../testHelpers/events');
const {eventNames} = require('../testHelpers/events');

let users;

describe('Admin functionality', async () => {
  before(async () => {
    const signers = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel = await ethers.getContractFactory('VoucherKernel');
    Cashier = await ethers.getContractFactory('Cashier');
    BosonRouter = await ethers.getContractFactory('BosonRouter');
    FundLimitsOracle = await ethers.getContractFactory('FundLimitsOracle');
  });

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractFundLimitsOracle;

  async function deployContracts() {
    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    contractFundLimitsOracle = await FundLimitsOracle.deploy();
    contractERC1155ERC721 = await ERC1155ERC721.deploy();
    contractVoucherKernel = await VoucherKernel.deploy(
      contractERC1155ERC721.address
    );
    contractCashier = await Cashier.deploy(contractVoucherKernel.address);
    contractBosonRouter = await BosonRouter.deploy(
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
      let expectedOwner = users.deployer.address;
      let owner = await contractCashier.owner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set BR address', async () => {
      const tx = await contractCashier.setBosonRouterAddress(
        contractBosonRouter.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        contractCashier,
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
        contractCashier,
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
      let expectedOwner = users.deployer.address;
      let owner = await contractERC1155ERC721.getOwner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set VK address', async () => {
      const tx = await contractERC1155ERC721.setVoucherKernelAddress(
        contractVoucherKernel.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        contractERC1155ERC721,
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
        contractERC1155ERC721,
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
      let expectedOwner = users.deployer.address;
      let owner = await contractVoucherKernel.owner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set Cashier address', async () => {
      const tx = await contractVoucherKernel.setCashierAddress(
        contractCashier.address
      );

      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        contractVoucherKernel,
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
        contractVoucherKernel,
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
