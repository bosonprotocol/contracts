const ethers = require('hardhat').ethers;

const {assert, expect} = require('chai');

const constants = require('../testHelpers/constants');
const Users = require('../testHelpers/users');
const Utils = require('../testHelpers/utils');

let ERC1155ERC721;
let VoucherKernel;
let Cashier;
let BosonRouter;
let MockERC20Permit;
let FundLimitsOracle;

const revertReasons = require('../testHelpers/revertReasons');
const eventUtils = require('../testHelpers/events');
const {eventNames} = require('../testHelpers/events');

let users;

describe('FundLimitsOracle', () => {
  before(async () => {
    const signers = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel = await ethers.getContractFactory('VoucherKernel');
    Cashier = await ethers.getContractFactory('Cashier');
    BosonRouter = await ethers.getContractFactory('BosonRouter');
    FundLimitsOracle = await ethers.getContractFactory('FundLimitsOracle');
    MockERC20Permit = await ethers.getContractFactory('MockERC20Permit');
  });

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

    const sixtySeconds = 60;

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

    contractBSNTokenPrice = await MockERC20Permit.deploy(
      'BosonTokenPrice',
      'BPRC'
    );

    await contractFundLimitsOracle.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();

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

    await contractVoucherKernel.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds);
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

        const receipt = await setLimitTx.wait();

        eventUtils.assertEventEmitted(
          receipt,
          contractFundLimitsOracle,
          eventNames.LOG_ETH_LIMIT_CHANGED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );
      });

      it('[NEGATIVE] Should revert if attacker tries to change ETH Limit', async () => {
        const attackerInstance = contractFundLimitsOracle.connect(
          users.attacker.signer
        );
        await expect(
          attackerInstance.setETHLimit(FIVE_ETHERS)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
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

        const txReceipt = await setLimitTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          contractFundLimitsOracle,
          eventNames.LOG_TOKEN_LIMIT_CHANGED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );
      });

      it(
        '[NEGATIVE] Should revert if attacker tries to change ' + 'Token Limit',
        async () => {
          const attackerInstance = contractFundLimitsOracle.connect(
            users.attacker.signer
          );
          await expect(
            attackerInstance.setTokenLimit(
              contractBSNTokenPrice.address,
              FIVE_TOKENS
            )
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
        }
      );
    });
  });
});
