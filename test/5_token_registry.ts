import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';
import {assert, expect} from 'chai';
import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';

import {
  BosonRouter,
  VoucherSets,
  Vouchers,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
} from '../typechain';

let VoucherSets_Factory: ContractFactory;
let Vouchers_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;

const eventNames = eventUtils.eventNames;

let users;

describe('TokenRegistry', () => {
  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

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

  let contractVoucherSets: VoucherSets,
    contractVouchers: Vouchers,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractBSNTokenPrice: MockERC20Permit,
    contractTokenRegistry: TokenRegistry;

  let expectedLimit;

  const FIVE_ETHERS = (5 * 10 ** 18).toString();
  const FIVE_TOKENS = (5 * 10 ** 16).toString();

  async function deployContracts() {
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

    await contractTokenRegistry.deployed();
    await contractVoucherSets.deployed();
    await contractVouchers.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();

    await contractVoucherSets.setApprovalForAll(
      contractVoucherKernel.address,
      true
    );
    await contractVouchers.setApprovalForAll(
      contractVoucherKernel.address,
      true
    );

    await contractVoucherKernel.setComplainPeriod(sixtySeconds);
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds);
  }

  describe('TokenRegistry get and set limits', () => {
    before(async () => {
      await deployContracts();
    });

    describe('TokenRegistry deploy', () => {
      it('should emit LogETHLimitChanged event when deployed', async () => {
        const expectedInitialEthLimit = ethers.utils.parseEther('1').toString();

        expect(contractTokenRegistry.deployTransaction)
          .to.emit(contractTokenRegistry, eventNames.LOG_ETH_LIMIT_CHANGED)
          .withArgs(expectedInitialEthLimit, users.deployer.address);
      });
    });

    describe('ETH', () => {
      it('Should have set ETH Limit initially to 1 ETH', async () => {
        const ONE_ETH = (10 ** 18).toString();

        const ethLimit = await contractTokenRegistry.getETHLimit();

        assert.equal(
          ethLimit.toString(),
          ONE_ETH,
          'ETH Limit not set properly'
        );
      });

      it('Owner should change ETH Limit', async () => {
        await contractTokenRegistry.setETHLimit(FIVE_ETHERS);

        expectedLimit = await contractTokenRegistry.getETHLimit();

        assert.equal(
          expectedLimit.toString(),
          FIVE_ETHERS,
          'ETH Limit not correctly set'
        );
      });

      it('Should emit LogETHLimitChanged', async () => {
        const setLimitTx = await contractTokenRegistry.setETHLimit(FIVE_ETHERS);

        const receipt = await setLimitTx.wait();

        eventUtils.assertEventEmitted(
          receipt,
          TokenRegistry_Factory,
          eventNames.LOG_ETH_LIMIT_CHANGED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );
      });

      it('[NEGATIVE] Should revert if attacker tries to change ETH Limit', async () => {
        const attackerInstance = contractTokenRegistry.connect(
          users.attacker.signer
        );
        await expect(
          attackerInstance.setETHLimit(FIVE_ETHERS)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
      });
    });

    describe('Token', () => {
      it('Owner should set Token Limit', async () => {
        await contractTokenRegistry.setTokenLimit(
          contractBSNTokenPrice.address,
          FIVE_TOKENS
        );

        expectedLimit = await contractTokenRegistry.getTokenLimit(
          contractBSNTokenPrice.address
        );

        assert.equal(
          expectedLimit.toString(),
          FIVE_TOKENS,
          'ETH Limit not correctly set'
        );
      });

      it('Should emit LogTokenLimitChanged', async () => {
        const setLimitTx = await contractTokenRegistry.setTokenLimit(
          contractBSNTokenPrice.address,
          FIVE_TOKENS
        );

        const txReceipt = await setLimitTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          TokenRegistry_Factory,
          eventNames.LOG_TOKEN_LIMIT_CHANGED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );
      });

      it(
        '[NEGATIVE] Should revert if attacker tries to change ' + 'Token Limit',
        async () => {
          const attackerInstance = contractTokenRegistry.connect(
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

      it('[NEGATIVE] Should revert is setting token limit for zero address', async () => {
        await expect(
          contractTokenRegistry.setTokenLimit(
            constants.ZERO_ADDRESS,
            FIVE_TOKENS
          )
        ).to.be.revertedWith(revertReasons.INVALID_TOKEN_ADDRESS);
      });
    });
  });

  describe('TokenRegistry get and set token wrapper addresses', () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it('Should allow owner to set a new token wrapper for a token', async () => {
      const deployerInstance = contractTokenRegistry.connect(
        users.deployer.signer
      );

      const setWrapperTx = await deployerInstance.setTokenWrapperAddress(
        users.other1.address,
        users.other2.address
      );

      const txReceipt = await setWrapperTx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        TokenRegistry_Factory,
        eventNames.LOG_TOKEN_WRAPPER_CHANGED,
        (ev) => {
          assert.equal(ev._newWrapperAddress, users.other2.address);
          assert.equal(ev._triggeredBy, users.deployer.address);
        }
      );

      //check contract state
      const newWrapperAddress = await deployerInstance.getTokenWrapperAddress(
        users.other1.address
      ); //get the token wrapper for other1
      assert.equal(newWrapperAddress, users.other2.address);
    });

    it('[NEGATIVE] Should revert if attacker tries to change token wrapper', async () => {
      const attackerInstance = contractTokenRegistry.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.setTokenWrapperAddress(
          users.other1.address,
          users.other2.address
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('Should get the correct wrapper token address for a given token address', async () => {
      const deployerInstance = contractTokenRegistry.connect(
        users.deployer.signer
      );

      await deployerInstance.setTokenWrapperAddress(
        users.other1.address,
        users.other2.address
      );

      //check contract state
      const newWrapperAddress = await deployerInstance.getTokenWrapperAddress(
        users.other1.address
      ); //get the token wrapper for other1
      assert.equal(newWrapperAddress, users.other2.address);
    });

    it('Should return the zero address for a token that is not mapped to a wrapper', async () => {
      const newWrapperAddress =
        await contractTokenRegistry.getTokenWrapperAddress(
          users.other1.address
        ); //get the token wrapper for other1

      assert.equal(newWrapperAddress, constants.ZERO_ADDRESS);
    });

    it('[NEGATIVE]Should revert if trying to set token wrapper for zero address', async () => {
      const deployerInstance = contractTokenRegistry.connect(
        users.deployer.signer
      );

      await expect(
        deployerInstance.setTokenWrapperAddress(
          constants.ZERO_ADDRESS,
          users.other1.address
        )
      ).to.be.revertedWith(revertReasons.INVALID_TOKEN_ADDRESS);
    });
  });
});
