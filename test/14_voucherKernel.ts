import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';
import {expect} from 'chai';
import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';
import {
  BosonRouter,
  VoucherSets,
  Vouchers,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
  MockERC721Receiver,
} from '../typechain';
const {keccak256, solidityPack} = ethers.utils;

let VoucherSets_Factory: ContractFactory;
let Vouchers_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;
let MockERC721Receiver_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';

import {waffle} from 'hardhat';
import ERC721receiver from '../artifacts/contracts/mocks/MockERC721Receiver.sol/MockERC721Receiver.json';
const {deployMockContract} = waffle;

let utils: Utils;
let users;

describe('VOUCHER KERNEL', () => {
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
    MockERC721Receiver_Factory = await ethers.getContractFactory(
      'MockERC721Receiver'
    );

    await setPeriods();
  });

  let contractVoucherSets: VoucherSets,
    contractVouchers: Vouchers,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractBSNTokenPrice: MockERC20Permit,
    contractBSNTokenDeposit: MockERC20Permit,
    contractTokenRegistry: TokenRegistry,
    contractMockERC721Receiver: MockERC721Receiver;

  async function setPeriods() {
    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;
  }

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

    contractBSNTokenDeposit = (await MockERC20Permit_Factory.deploy(
      'BosonTokenDeposit',
      'BDEP'
    )) as Contract & MockERC20Permit;

    contractMockERC721Receiver =
      (await MockERC721Receiver_Factory.deploy()) as Contract &
        MockERC721Receiver;

    await contractTokenRegistry.deployed();
    await contractVoucherSets.deployed();
    await contractVouchers.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();
    await contractMockERC721Receiver.deployed();

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

    await contractTokenRegistry.setTokenLimit(
      contractBSNTokenPrice.address,
      constants.TOKEN_LIMIT
    );
    await contractTokenRegistry.setTokenLimit(
      contractBSNTokenDeposit.address,
      constants.TOKEN_LIMIT
    );
    await contractTokenRegistry.setETHLimit(constants.ETHER_LIMIT);

    //Set Boson Token as it's own wrapper so that the same interface can be called in the code
    await contractTokenRegistry.setTokenWrapperAddress(
      contractBSNTokenPrice.address,
      contractBSNTokenPrice.address
    );

    await contractTokenRegistry.setTokenWrapperAddress(
      contractBSNTokenDeposit.address,
      contractBSNTokenDeposit.address
    );
  }

  describe('With normal deployment', () => {
    function promiseKeyForVoucherKernel(contractAddress, seller, sellerNonce) {
      return keccak256(
        solidityPack(
          ['address', 'uint256', 'uint256', 'uint256', 'address'],
          [
            seller.address,
            sellerNonce,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            contractAddress,
          ]
        )
      );
    }

    beforeEach(async () => {
      await deployContracts();
    });

    it('[NEGATIVE] Should revert if attacker tries to call method that should be called only from bosonRouter', async () => {
      const attackerInstance = contractVoucherKernel.connect(
        users.attacker.signer
      );

      await expect(attackerInstance.pause()).to.be.revertedWith(
        revertReasons.ONLY_FROM_ROUTER
      );
      await expect(attackerInstance.unpause()).to.be.revertedWith(
        revertReasons.ONLY_FROM_ROUTER
      );
      await expect(
        attackerInstance.createTokenSupplyId(
          users.other1.address,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        )
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
      await expect(
        attackerInstance.createPaymentMethod(
          constants.ONE,
          1,
          constants.ZERO_ADDRESS,
          constants.ZERO_ADDRESS
        )
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
      await expect(
        attackerInstance.fillOrder(
          constants.ONE,
          users.seller.address,
          users.buyer.address,
          1
        )
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
      await expect(
        attackerInstance.redeem(constants.ONE, users.buyer.address)
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
      await expect(
        attackerInstance.refund(constants.ONE, users.buyer.address)
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
      await expect(
        attackerInstance.complain(constants.ONE, users.buyer.address)
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
      await expect(
        attackerInstance.cancelOrFault(constants.ONE, users.seller.address)
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER); // should be uncommented after https://github.com/bosonprotocol/contracts/issues/195
      await expect(
        attackerInstance.cancelOrFaultVoucherSet(
          constants.ONE,
          users.seller.address
        )
      ).to.be.revertedWith(revertReasons.ONLY_FROM_ROUTER);
    });

    it('[NEGATIVE] Should revert if attacker tries to call method that should be called only from cashier', async () => {
      const attackerInstance = contractVoucherKernel.connect(
        users.attacker.signer
      );

      await expect(
        attackerInstance.setPaymentReleased(constants.ONE)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_CASHIER);
      await expect(
        attackerInstance.setDepositsReleased(constants.ONE)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_CASHIER);
      await expect(
        attackerInstance.setSupplyHolderOnTransfer(
          constants.ONE,
          users.seller.address
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_CASHIER);
    });

    it('Should return correct promise keys', async () => {
      await setPeriods();
      utils = await UtilsBuilder.create()
        .ETHETH()
        .buildAsync(
          contractVoucherSets,
          contractVouchers,
          contractVoucherKernel,
          contractCashier,
          contractBosonRouter
        );

      // create few orders
      for (let i = 0; i < 5; i++) {
        await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        );
      }

      // test that promise keys as expected
      for (let i = 0; i < 5; i++) {
        expect(await contractVoucherKernel.getPromiseKey(i)).to.equal(
          promiseKeyForVoucherKernel(
            contractVoucherKernel.address,
            users.seller,
            i
          ),
          `Promise key ${i} mismatch`
        );
      }
    });

    it('Should return correct promise id from voucher ID', async () => {
      await setPeriods();
      utils = await UtilsBuilder.create()
        .ETHETH()
        .buildAsync(
          contractVoucherSets,
          contractVouchers,
          contractVoucherKernel,
          contractCashier,
          contractBosonRouter
        );

      const tokenSupplyKey = await utils.createOrder(
        users.seller,
        constants.PROMISE_VALID_FROM,
        constants.PROMISE_VALID_TO,
        constants.PROMISE_PRICE1,
        constants.PROMISE_DEPOSITSE1,
        constants.PROMISE_DEPOSITBU1,
        constants.QTY_10
      );

      // create few orders
      for (let i = 0; i < 5; i++) {
        const tokenVoucherId = await utils.commitToBuy(
          users.buyer,
          users.seller,
          tokenSupplyKey,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITBU1
        );

        expect(
          await contractVoucherKernel.getPromiseIdFromVoucherId(tokenVoucherId)
        ).to.equal(
          promiseKeyForVoucherKernel(
            contractVoucherKernel.address,
            users.seller,
            0
          ),
          `Promise key ${i} mismatch`
        );
      }
    });

    it('[NEGATIVE] Should revert for wrong token voucher id', async () => {
      await expect(
        contractVoucherKernel.getPromiseIdFromVoucherId(constants.ZERO)
      ).to.be.revertedWith(revertReasons.UNSPECIFIED_ID);
    });

    it('Should return correct type id', async () => {
      await setPeriods();
      utils = await UtilsBuilder.create()
        .ETHETH()
        .buildAsync(
          contractVoucherSets,
          contractVouchers,
          contractVoucherKernel,
          contractCashier,
          contractBosonRouter
        );

      expect(await contractVoucherKernel.getTypeId()).to.equal(
        0,
        'Wrong type id'
      );

      for (let i = 0; i < 5; i++) {
        await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        );
        expect(await contractVoucherKernel.getTypeId()).to.equal(
          i + 1,
          `Wrong type id ${i + 1}`
        );
      }
    });

    it('Should return correct boson router address', async () => {
      expect(await contractVoucherKernel.getBosonRouterAddress()).to.equal(
        contractBosonRouter.address,
        'Wrong boson router address'
      );
    });

    it('Should return correct cashier address', async () => {
      expect(await contractVoucherKernel.getCashierAddress()).to.equal(
        contractCashier.address,
        'Wrong boson router address'
      );
    });

    it('[NEGATIVE] Should revert if fillOrder is called with wrong token Id Supply', async () => {
      // spoof boson router address
      await contractBosonRouter.pause();
      await contractVoucherKernel.setBosonRouterAddress(users.deployer.address);
      await contractVoucherKernel.unpause();

      await expect(
        contractVoucherKernel.fillOrder(
          constants.ZERO,
          users.seller.address,
          users.buyer.address,
          0
        )
      ).to.be.revertedWith(revertReasons.UNSPECIFIED_ID);
    });

    it('[NEGATIVE] Should revert if triggerExpiration voucher id is zero', async () => {
      await expect(
        contractVoucherKernel.triggerExpiration(constants.ZERO)
      ).to.be.revertedWith(revertReasons.UNSPECIFIED_ID);
    });

    it('[NEGATIVE] Should revert if triggerFinalizeVoucher voucher id is zero', async () => {
      await expect(
        contractVoucherKernel.triggerFinalizeVoucher(constants.ZERO)
      ).to.be.revertedWith(revertReasons.UNSPECIFIED_ID);
    });

    describe('Spoof boson router', () => {
      let tokenSupplyId;
      beforeEach(async () => {
        await setPeriods();
        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        tokenSupplyId = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        );

        // spoof boson router address
        await contractBosonRouter.pause();
        await contractVoucherKernel.setBosonRouterAddress(
          users.deployer.address
        );
        await contractVoucherKernel.unpause();
      });

      it('[NEGATIVE] Should revert if fillOrder is called with wrong holder', async () => {
        await expect(
          contractVoucherKernel.fillOrder(
            tokenSupplyId,
            users.seller.address,
            constants.ZERO_ADDRESS,
            constants.ZERO
          )
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
      });

      it('[NEGATIVE] Should revert if fillOrder is called with holder contract that does not support ERC721', async () => {
        const nonERC721SupportingContract = contractCashier;
        await expect(
          contractVoucherKernel.fillOrder(
            tokenSupplyId,
            users.seller.address,
            nonERC721SupportingContract.address,
            1
          )
        ).to.be.revertedWith(revertReasons.UNSUPPORTED_ERC721_RECEIVED);
      });

      it('[NEGATIVE] Should revert if fillOrder is called with holder contract that does not implement onERC721Received', async () => {
        const mockERC721Receiver = await deployMockContract(
          users.deployer.signer,
          ERC721receiver.abi
        ); //deploys mock

        await mockERC721Receiver.mock.onERC721Received.returns('0x00000000');

        await expect(
          contractVoucherKernel.fillOrder(
            tokenSupplyId,
            users.seller.address,
            mockERC721Receiver.address,
            1
          )
        ).to.be.revertedWith(revertReasons.UNSUPPORTED_ERC721_RECEIVED);
      });

      it('[NEGATIVE] Should revert with same revert reason as any arbitrary revert reason of the holder contract', async () => {
        const mockERC721Receiver = await deployMockContract(
          users.deployer.signer,
          ERC721receiver.abi
        ); //deploys mock

        const arbitraryRevertReason = 'arbitrary revert reason';

        await mockERC721Receiver.mock.onERC721Received.revertsWithReason(
          arbitraryRevertReason
        );

        await expect(
          contractVoucherKernel.fillOrder(
            tokenSupplyId,
            users.seller.address,
            mockERC721Receiver.address,
            1
          )
        ).to.be.revertedWith(arbitraryRevertReason);
      });

      it('Should be possible to call fillOrder with holder contract that can receive ERC721', async () => {
        await expect(
          contractVoucherKernel.fillOrder(
            tokenSupplyId,
            users.seller.address,
            contractMockERC721Receiver.address,
            constants.ZERO
          )
        ).to.not.be.reverted;
      });
    });

    describe('Spoof cashier', () => {
      beforeEach(async () => {
        await setPeriods();
        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.QTY_10
        );

        // spoof boson router address
        await contractBosonRouter.pause();
        await contractVoucherKernel.setCashierAddress(users.deployer.address);
        await contractBosonRouter.unpause();
      });

      it('[NEGATIVE] Should revert if setPaymentReleased voucher id is zero', async () => {
        await expect(
          contractVoucherKernel.setPaymentReleased(constants.ZERO)
        ).to.be.revertedWith(revertReasons.UNSPECIFIED_ID);
      });

      it('[NEGATIVE] Should revert if setDepositReleased voucher id is zero', async () => {
        await expect(
          contractVoucherKernel.setDepositsReleased(constants.ZERO)
        ).to.be.revertedWith(revertReasons.UNSPECIFIED_ID);
      });
    });

    it('[NEGATIVE][createTokenSupplyId] Should revert if quantity is zero', async () => {
      await deployContracts();

      // spoof boson router address
      await contractBosonRouter.pause();
      await contractVoucherKernel.setBosonRouterAddress(users.deployer.address);
      await contractVoucherKernel.unpause();

      await expect(
        contractVoucherKernel.createTokenSupplyId(
          users.other1.address,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_PRICE1,
          constants.PROMISE_DEPOSITSE1,
          constants.PROMISE_DEPOSITBU1,
          constants.ZERO
        )
      ).to.be.revertedWith(revertReasons.INVALID_QUANTITY_LONG);
    });

    describe('createTokenSupplyId', async () => {
      beforeEach(async () => {
        await deployContracts();

        // spoof boson router address
        await contractBosonRouter.pause();
        await contractVoucherKernel.setBosonRouterAddress(
          users.deployer.address
        );
        await contractVoucherKernel.unpause();
      });

      it('[createTokenSupplyId] Should not revert if validFrom is 5 minutes or more than ValidTo', async () => {
        const timestamp = await Utils.getCurrTimestamp();
        const validFrom = timestamp + constants.SECONDS_IN_DAY;

        // Difference of at least 5 minutes between valid from and valid to
        const validTo1 =
          timestamp + constants.SECONDS_IN_DAY + 5 * constants.ONE_MINUTE;
        await expect(
          contractVoucherKernel.createTokenSupplyId(
            users.other1.address,
            validFrom,
            validTo1,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_10
          )
        ).to.not.be.reverted;

        const validTo2 =
          timestamp + constants.SECONDS_IN_DAY + 6 * constants.ONE_MINUTE;
        await expect(
          contractVoucherKernel.createTokenSupplyId(
            users.other1.address,
            validFrom,
            validTo2,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_10
          )
        ).to.not.be.reverted;
      });

      it('[NEGATIVE][createTokenSupplyId] Should revert if validFrom is less than 5 minutes than validTo', async () => {
        const timestamp = await Utils.getCurrTimestamp();
        const validFrom = timestamp + constants.SECONDS_IN_DAY;

        // Difference of less than 5 minutes between valid from and valid to
        const validTo =
          timestamp + constants.SECONDS_IN_DAY + 4 * constants.ONE_MINUTE;
        await expect(
          contractVoucherKernel.createTokenSupplyId(
            users.other1.address,
            validFrom,
            validTo,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITSE1,
            constants.PROMISE_DEPOSITBU1,
            constants.QTY_10
          )
        ).to.be.revertedWith(
          revertReasons.VALID_FROM_MUST_BE_AT_LEAST_5_MINUTES_LESS_THAN_VALID_TO
        );
      });
    });
  });
});
