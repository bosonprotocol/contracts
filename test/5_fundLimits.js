const {assert} = require('chai');
const truffleAssert = require('truffle-assertions');

const constants = require('../testHelpers/constants');
const Users = require('../testHelpers/users');
const Utils = require('../testHelpers/utils');

const ERC1155ERC721 = artifacts.require('ERC1155ERC721');
const VoucherKernel = artifacts.require('VoucherKernel');
const Cashier = artifacts.require('Cashier');
const BosonRouter = artifacts.require('BosonRouter');
const MockERC20Permit = artifacts.require('MockERC20Permit');
const FundLimitsOracle = artifacts.require('FundLimitsOracle');

contract('FundLimitsOracle', async (addresses) => {
  const users = new Users(addresses);

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractBSNTokenPrice,
    contractFundLimitsOracle;
  let expectedLimit;

  const FIVE_ETHERS = (5 * 10 ** 18).toString();
  const FIVE_TOKENS = (5 * 10 ** 16).toString();

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

    contractBSNTokenPrice = await MockERC20Permit.new(
      'BosonTokenPrice',
      'BPRC'
    );

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address,
      'true'
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
  }

  describe('FundLimitsOracle interaction', () => {
    before(async () => {
      await deployContracts();
    });

    describe('ETH', () => {
      it('Should have set ETH Limit initially to 1 ETH', async () => {
        const ONE_ETH = (10 ** 18).toString();

        const ethLimit = await contractFundLimitsOracle.getETHLimit();

        assert.equal(
          ethLimit.toString(),
          ONE_ETH,
          'ETH Limit not set properly'
        );
      });

      it('Owner should change ETH Limit', async () => {
        await contractFundLimitsOracle.setETHLimit(FIVE_ETHERS);

        expectedLimit = await contractFundLimitsOracle.getETHLimit();

        assert.equal(
          expectedLimit.toString(),
          FIVE_ETHERS,
          'ETH Limit not correctly set'
        );
      });

      it('Should emit LogETHLimitChanged', async () => {
        const setLimitTx = await contractFundLimitsOracle.setETHLimit(
          FIVE_ETHERS
        );

        truffleAssert.eventEmitted(
          setLimitTx,
          'LogETHLimitChanged',
          (ev) => {
            return ev._triggeredBy === users.deployer.address;
          },
          'LogETHLimitChanged was not emitted'
        );
      });

      it('[NEGATIVE] Should revert if attacker tries to change ETH Limit', async () => {
        await truffleAssert.reverts(
          contractFundLimitsOracle.setETHLimit(FIVE_ETHERS, {
            from: users.attacker.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('Token', () => {
      it('Owner should set Token Limit', async () => {
        await contractFundLimitsOracle.setTokenLimit(
          contractBSNTokenPrice.address,
          FIVE_TOKENS
        );

        expectedLimit = await contractFundLimitsOracle.getTokenLimit(
          contractBSNTokenPrice.address
        );

        assert.equal(
          expectedLimit.toString(),
          FIVE_TOKENS,
          'ETH Limit not correctly set'
        );
      });

      it('Should emit LogTokenLimitChanged', async () => {
        const setLimitTx = await contractFundLimitsOracle.setTokenLimit(
          contractBSNTokenPrice.address,
          FIVE_TOKENS
        );

        truffleAssert.eventEmitted(
          setLimitTx,
          'LogTokenLimitChanged',
          (ev) => {
            return ev._triggeredBy === users.deployer.address;
          },
          'LogETHLimitChanged was not emitted'
        );
      });

      it(
        '[NEGATIVE] Should revert if attacker tries to change ' + 'Token Limit',
        async () => {
          await truffleAssert.reverts(
            contractFundLimitsOracle.setTokenLimit(
              contractBSNTokenPrice.address,
              FIVE_TOKENS,
              {
                from: users.attacker.address,
              }
            ),
            truffleAssert.ErrorType.REVERT
          );
        }
      );
    });
  });
});
