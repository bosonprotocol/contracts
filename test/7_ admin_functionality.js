const {assert} = require('chai');
const truffleAssert = require('truffle-assertions');

const constants = require('../testHelpers/constants');
const Users = require('../testHelpers/users');
const Utils = require('../testHelpers/utils');

const ERC1155ERC721 = artifacts.require('ERC1155ERC721');
const VoucherKernel = artifacts.require('VoucherKernel');
const Cashier = artifacts.require('Cashier');
const BosonRouter = artifacts.require('BosonRouter');
const FundLimitsOracle = artifacts.require('FundLimitsOracle');

contract('Admin functionality', async (addresses) => {
  const users = new Users(addresses);

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractFundLimitsOracle;

  async function deployContracts() {
    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    contractFundLimitsOracle = await FundLimitsOracle.new();
    contractERC1155ERC721 = await ERC1155ERC721.new();
    contractVoucherKernel = await VoucherKernel.new(
      contractERC1155ERC721.address
    );
    contractCashier = await Cashier.new(contractVoucherKernel.address);
    contractBosonRouter = await BosonRouter.new(
      contractVoucherKernel.address,
      contractFundLimitsOracle.address,
      contractCashier.address
    );
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

      truffleAssert.eventEmitted(tx, 'LogBosonRouterSet', (ev) => {
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

        return true;
      });
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if executed by attacker', async () => {
      await truffleAssert.reverts(
        contractCashier.setBosonRouterAddress(contractBosonRouter.address, {
          from: users.attacker.address,
        }),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if ZERO address is provided', async () => {
      await truffleAssert.reverts(
        contractCashier.setBosonRouterAddress(constants.ZERO_ADDRESS),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('Owner should be able to set token contract address', async () => {
      const tx = await contractCashier.setTokenContractAddress(
        contractERC1155ERC721.address
      );

      truffleAssert.eventEmitted(tx, 'LogTokenContractSet', (ev) => {
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

        return true;
      });
    });

    it('[NEGATIVE][setTokenContractAddress] Should revert if executed by attacker', async () => {
      await truffleAssert.reverts(
        contractCashier.setTokenContractAddress(contractERC1155ERC721.address, {
          from: users.attacker.address,
        }),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('[NEGATIVE][setTokenContractAddress] Should revert if ZERO address is provided', async () => {
      await truffleAssert.reverts(
        contractCashier.setTokenContractAddress(constants.ZERO_ADDRESS),
        truffleAssert.ErrorType.REVERT
      );
    });
  });

  describe('ERC1155721', () => {
    before(async () => {
      await deployContracts();
    });

    it('Owner should be the deployer', async () => {
      let expectedOwner = users.deployer.address;
      let owner = await contractERC1155ERC721.owner();

      assert.equal(owner, expectedOwner, 'Owner is not as expected');
    });

    it('Owner should be able to set VK address', async () => {
      const tx = await contractERC1155ERC721.setVoucherKernelAddress(
        contractVoucherKernel.address
      );

      truffleAssert.eventEmitted(tx, 'LogVoucherKernelSet', (ev) => {
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

        return true;
      });
    });

    it('[NEGATIVE][setVoucherKernelAddress] Should revert if executed by attacker', async () => {
      await truffleAssert.reverts(
        contractERC1155ERC721.setVoucherKernelAddress(
          contractVoucherKernel.address,
          {from: users.attacker.address}
        ),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('[NEGATIVE][setVoucherKernelAddress] Should revert if ZERO address is provided', async () => {
      await truffleAssert.reverts(
        contractERC1155ERC721.setVoucherKernelAddress(constants.ZERO_ADDRESS),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('Owner should be able to set Cashier address', async () => {
      const tx = await contractERC1155ERC721.setCashierAddress(
        contractCashier.address
      );

      truffleAssert.eventEmitted(tx, 'LogCashierSet', (ev) => {
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

        return true;
      });
    });

    it('[NEGATIVE][setCashierAddress] Attacker should not be able to set Cashier address', async () => {
      await truffleAssert.reverts(
        contractERC1155ERC721.setCashierAddress(contractCashier.address, {
          from: users.attacker.address,
        }),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('[NEGATIVE][setCashierAddress] Owner should not be able to set ZERO Cashier address', async () => {
      await truffleAssert.reverts(
        contractERC1155ERC721.setCashierAddress(constants.ZERO_ADDRESS),
        truffleAssert.ErrorType.REVERT
      );
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

      truffleAssert.eventEmitted(tx, 'LogCashierSet', (ev) => {
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

        return true;
      });
    });

    it('[NEGATIVE][setCashierAddress] Attacker should not be able to set Cashier address', async () => {
      await truffleAssert.reverts(
        contractVoucherKernel.setCashierAddress(contractCashier.address, {
          from: users.attacker.address,
        }),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('[NEGATIVE][setCashierAddress] Owner should not be able to set ZERO Cashier address', async () => {
      await truffleAssert.reverts(
        contractVoucherKernel.setCashierAddress(constants.ZERO_ADDRESS),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('Owner should be able to set BR address', async () => {
      const tx = await contractVoucherKernel.setBosonRouterAddress(
        contractBosonRouter.address
      );

      truffleAssert.eventEmitted(tx, 'LogBosonRouterSet', (ev) => {
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

        return true;
      });
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if executed by attacker', async () => {
      await truffleAssert.reverts(
        contractVoucherKernel.setBosonRouterAddress(
          contractBosonRouter.address,
          {from: users.attacker.address}
        ),
        truffleAssert.ErrorType.REVERT
      );
    });

    it('[NEGATIVE][setBosonRouterAddress] Should revert if ZERO address is provided', async () => {
      await truffleAssert.reverts(
        contractVoucherKernel.setBosonRouterAddress(constants.ZERO_ADDRESS),
        truffleAssert.ErrorType.REVERT
      );
    });
  });
}); //end of contract
