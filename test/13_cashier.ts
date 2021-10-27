import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';
import {expect} from 'chai';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import {
  BosonRouter,
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
  MockERC721Receiver,
} from '../typechain';

let ERC1155ERC721_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;
let MockERC721Receiver_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';

let users;

describe('CASHIER', () => {
  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721_Factory = await ethers.getContractFactory('ERC1155ERC721');
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

  let contractERC1155ERC721: ERC1155ERC721,
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

  async function deployContracts(
    setBosonRouterAddress = true,
    setCashierAddress = true
  ) {
    const sixtySeconds = 60;

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
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();
    await contractMockERC721Receiver.deployed();

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address,
      true
    );
    await contractERC1155ERC721.setVoucherKernelAddress(
      contractVoucherKernel.address
    );

    await contractERC1155ERC721.setCashierAddress(contractCashier.address);

    if (setBosonRouterAddress) {
      await contractVoucherKernel.setBosonRouterAddress(
        contractBosonRouter.address
      );
    }

    if (setCashierAddress) {
      await contractVoucherKernel.setCashierAddress(contractCashier.address);
    }

    if (setBosonRouterAddress) {
      await contractCashier.setBosonRouterAddress(contractBosonRouter.address);
    }

    await contractCashier.setTokenContractAddress(
      contractERC1155ERC721.address
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

  it('[NEGATIVE] Should revert if boson router is not set', async () => {
    await deployContracts(false);

    await expect(contractCashier.pause()).to.be.revertedWith(
      revertReasons.UNSET_ROUTER
    );
    await expect(contractCashier.unpause()).to.be.revertedWith(
      revertReasons.UNSET_ROUTER
    );
    await expect(
      contractCashier.withdrawDepositsSe(
        constants.ONE,
        constants.ONE,
        users.other1.address
      )
    ).to.be.revertedWith(revertReasons.UNSET_ROUTER);
    await expect(
      contractCashier.addEscrowAmount(users.other1.address)
    ).to.be.revertedWith(revertReasons.UNSET_ROUTER);
    await expect(
      contractCashier.addEscrowTokensAmount(
        contractBSNTokenDeposit.address,
        users.other1.address,
        constants.buyer_deposit
      )
    ).to.be.revertedWith(revertReasons.UNSET_ROUTER);
  });

  describe('With normal deployment', () => {
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

    it('[NEGATIVE] Should revert if onERC721Transfer is called by the attacker', async () => {
      const attackerInstance = contractCashier.connect(users.attacker.signer);

      await expect(
        attackerInstance.onERC721Transfer(
          users.other1.address,
          users.attacker.address,
          constants.ONE
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TOKEN_CONTRACT);
    });

    it('[NEGATIVE] Should revert if onERC1155Transfer is called by the attacker', async () => {
      const attackerInstance = contractCashier.connect(users.attacker.signer);

      await expect(
        attackerInstance.onERC1155Transfer(
          users.other1.address,
          users.attacker.address,
          constants.ONE,
          constants.ONE
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TOKEN_CONTRACT);
    });
  });
});
