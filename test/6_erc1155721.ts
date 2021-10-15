import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';
import {assert, expect} from 'chai';

import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';
const BN = ethers.BigNumber.from;

import {
  BosonRouter,
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
  MockERC721Receiver,
  MockERC1155Receiver,
} from '../typechain';

let ERC1155ERC721_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;
let MockERC721Receiver_Factory: ContractFactory;
let MockERC1155Receiver_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
const eventNames = eventUtils.eventNames;
import fnSignatures from '../testHelpers/functionSignatures';

let utils: Utils;

let TOKEN_SUPPLY_ID;
let users;

describe('ERC1155ERC721', () => {
  beforeEach(async () => {
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
    MockERC1155Receiver_Factory = await ethers.getContractFactory(
      'MockERC1155Receiver'
    );
  });

  let contractERC1155ERC721: ERC1155ERC721,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractBSNTokenPrice: MockERC20Permit,
    contractBSNTokenDeposit: MockERC20Permit,
    contractTokenRegistry: TokenRegistry,
    contractMockERC721Receiver: MockERC721Receiver,
    contractMockERC1155Receiver: MockERC1155Receiver;

  let timestamp: number;

  async function deployContracts() {
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

    contractMockERC721Receiver = (await MockERC721Receiver_Factory.deploy()) as Contract &
      MockERC721Receiver;

    contractMockERC1155Receiver = (await MockERC1155Receiver_Factory.deploy()) as Contract &
      MockERC1155Receiver;

    await contractTokenRegistry.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();
    await contractMockERC721Receiver.deployed();
    await contractMockERC1155Receiver.deployed();

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address,
      true
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

  async function prepareUtils() {
    utils = await UtilsBuilder.create()
      .ETHETH()
      .buildAsync(
        contractERC1155ERC721,
        contractVoucherKernel,
        contractCashier,
        contractBosonRouter
      );

    timestamp = await Utils.getCurrTimestamp();
    return utils;
  }

  describe('Multi-token contract', function () {
    describe('Common', () => {
      beforeEach(async () => {
        await deployContracts();
        utils = await prepareUtils();
      });

      it('[name] Should have correct name on deploy', async () => {
        const expectedName = 'Boson Smart Voucher';
        const actual = await contractERC1155ERC721.name();

        assert.equal(actual, expectedName, 'name not set correctly!');
      });

      it('[symbol] Should have correct symbol on deploy', async () => {
        const expectedSymbol = 'BSV';

        const actual = await contractERC1155ERC721.symbol();

        assert.equal(actual, expectedSymbol, 'symbol not set correctly!');
      });

      it('[setApprovalForAll] Should emit ApprovalForAll', async () => {
        const tx = await contractERC1155ERC721.setApprovalForAll(
          contractVoucherKernel.address,
          true
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.APPROVAL_FOR_ALL,
          (ev) => {
            assert.equal(
              ev._owner,
              users.deployer.address,
              'ev._owner not expected!'
            );
            assert.equal(
              ev._operator,
              contractVoucherKernel.address,
              'ev._operator not expected!'
            );
            assert.equal(ev._approved, true, 'ev._value not expected!');
          }
        );
      });

      it('[NEGATIVE][setApprovalForAll] Should revert if tries to set self as an operator', async () => {
        await expect(
          contractERC1155ERC721.setApprovalForAll(users.deployer.address, true)
        ).to.be.revertedWith(revertReasons.REDUNDANT_CALL);
      });

      it('[setVoucherKernelAddress] Should set setVoucherKernelAddress to valid address', async () => {
        const expectedVoucherKernelAddress = users.other1.address;
        const tx = await contractERC1155ERC721.setVoucherKernelAddress(
          expectedVoucherKernelAddress
        );

        const txReceipt = await tx.wait();
        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.LOG_VK_SET,
          (ev) => {
            assert.equal(
              ev._newVoucherKernel,
              users.other1.address,
              'ev._newVoucherKernel not as expected!'
            );
            assert.equal(
              ev._triggeredBy,
              users.deployer.address,
              'ev._triggeredBy not as expected!'
            );
          }
        );

        const voucherKernelAddress = await contractERC1155ERC721.getVoucherKernelAddress();
        assert.equal(voucherKernelAddress, expectedVoucherKernelAddress);
      });

      it('[NEGATIVE][setVoucherKernelAddress] Should revert for zero address', async () => {
        await expect(
          contractERC1155ERC721.setVoucherKernelAddress(constants.ZERO_ADDRESS)
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
      });

      it('[setCashierAddress] Should set setCashierAddress to valid address', async () => {
        const expectedCashierAddress = contractCashier.address;
        const tx = await contractERC1155ERC721.setCashierAddress(
          expectedCashierAddress
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
              'ev._newCashier not as expected!'
            );
            assert.equal(
              ev._triggeredBy,
              users.deployer.address,
              'ev._triggeredBy not as expected!'
            );
          }
        );

        const cashierAddress = await contractERC1155ERC721.getCashierAddress();
        assert.equal(cashierAddress, expectedCashierAddress);
      });

      it('[NEGATIVE][setCashierAddress] Should revert for zero address', async () => {
        await expect(
          contractERC1155ERC721.setVoucherKernelAddress(constants.ZERO_ADDRESS)
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
      });

      it('[isApprovedForAll] Should return the approval status of an operator for a given account', async () => {
        const expectedApprovalStatus = true;
        await contractERC1155ERC721.setApprovalForAll(
          contractVoucherKernel.address,
          expectedApprovalStatus
        );

        assert.isTrue(
          await contractERC1155ERC721.isApprovedForAll(
            users.deployer.address,
            contractVoucherKernel.address
          )
        );
      });

      describe('[supportsInterface]', () => {
        it('Should return True for supported _interfaceId', async () => {
          const supportedInterfaceIds = [
            '0x01ffc9a7',
            '0xd9b67a26',
            '0x80ac58cd',
            '0x5b5e139f',
            '0x0e89341c',
          ];

          const randomInterfaceId =
            supportedInterfaceIds[
              Math.floor(Math.random() * supportedInterfaceIds.length)
            ];

          assert.isTrue(
            await contractERC1155ERC721.supportsInterface(randomInterfaceId)
          );
        });

        it('Should return False for un-supported _interfaceId', async () => {
          const unSupportedInterfaceId = '0x150b7a02';

          assert.isFalse(
            await contractERC1155ERC721.supportsInterface(
              unSupportedInterfaceId
            )
          );
        });
      });
    });

    describe('ERC1155', () => {
      beforeEach(async () => {
        await deployContracts();
        utils = await prepareUtils();

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_10
        );
      });

      it('[balanceOf] Get the balance of tokens of an account', async () => {
        const expectedCount = constants.QTY_10;
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        await contractERC1155ERC721.functions[fnSignatures.mint1155](
          users.deployer.address,
          TOKEN_SUPPLY_ID,
          expectedCount,
          ethers.utils.formatBytes32String('0x0')
        );

        const balance = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf1155
        ](users.deployer.address, TOKEN_SUPPLY_ID);

        assert.equal(balance.toString(), expectedCount.toString());
      });

      it('[safeTransfer1155] Should be able to safely transfer to EOA', async () => {
        const transferTx = await utils.safeTransfer1155(
          users.seller.address,
          users.other1.address,
          TOKEN_SUPPLY_ID,
          constants.QTY_10,
          users.seller.signer
        );

        const txReceipt = await transferTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            ev;
            assert.equal(ev._from, users.seller.address);
            assert.equal(ev._to, users.other1.address);
            assert.equal(ev._id.toString(), TOKEN_SUPPLY_ID);
            assert.equal(ev._value.toString(), constants.QTY_10);
          }
        );

        const expectedBalance = constants.QTY_10;
        const balanceOfOwner = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf1155
        ](users.other1.address, TOKEN_SUPPLY_ID);

        assert.equal(balanceOfOwner.toString(), expectedBalance.toString());
      });

      it('[safeTransfer1155] Should be able to safely transfer to contracts that support ERC1155', async () => {
        const erc1155supportingContract = contractMockERC1155Receiver;

        const transferTx = await utils.safeTransfer1155(
          users.seller.address,
          erc1155supportingContract.address,
          TOKEN_SUPPLY_ID,
          constants.QTY_10,
          users.seller.signer
        );

        const txReceipt = await transferTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            ev;
            assert.equal(ev._from, users.seller.address);
            assert.equal(ev._to, erc1155supportingContract.address);
            assert.equal(ev._id.toString(), TOKEN_SUPPLY_ID);
            assert.equal(ev._value.toString(), constants.QTY_10);
          }
        );

        const expectedBalance = constants.QTY_10;
        const balanceOfOwner = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf1155
        ](erc1155supportingContract.address, TOKEN_SUPPLY_ID);

        assert.equal(balanceOfOwner.toString(), expectedBalance.toString());
      });

      it('[NEGATIVE][safeTransfer1155] Attacker should not be able to transfer', async () => {
        await expect(
          utils.safeTransfer1155(
            users.seller.address,
            users.other1.address,
            TOKEN_SUPPLY_ID,
            constants.QTY_10,
            users.attacker.signer
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_1155);
      });

      it('[NEGATIVE][safeTransfer1155] Seller should not transfer to ZERO address', async () => {
        await expect(
          utils.safeTransfer1155(
            users.seller.address,
            constants.ZERO_ADDRESS,
            TOKEN_SUPPLY_ID,
            constants.QTY_10,
            users.seller.signer
          )
        ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
      });

      it('[NEGATIVE][safeTransfer1155] it should not be transferred to a contract that cannot receive it', async () => {
        await expect(
          utils.safeTransfer1155(
            users.seller.address,
            contractCashier.address,
            TOKEN_SUPPLY_ID,
            constants.QTY_10,
            users.seller.signer
          )
        ).to.be.revertedWith(revertReasons.FN_SELECTOR_NOT_RECOGNIZED);
      });

      it('[NEGATIVE][safeBatchTransfer1155] Should not be able to transfer batch to ZERO address', async () => {
        await expect(
          utils.safeBatchTransfer1155(
            users.seller.address,
            constants.ZERO_ADDRESS,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            users.seller.signer
          )
        ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
      });

      it('[NEGATIVE][safeBatchTransfer1155] Should revert if array lengths mismatch', async () => {
        await expect(
          utils.safeBatchTransfer1155(
            users.seller.address,
            users.other1.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10, 2],
            users.seller.signer
          )
        ).to.be.revertedWith(revertReasons.MISMATCHED_ARRAY_LENGTHS);
      });

      it('[NEGATIVE][safeBatchTransfer1155] Seller should not transfer batch to contract address', async () => {
        await expect(
          utils.safeBatchTransfer1155(
            users.seller.address,
            contractCashier.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            users.seller.signer
          )
        ).to.be.revertedWith(revertReasons.FN_SELECTOR_NOT_RECOGNIZED);
      });

      it('[NEGATIVE][safeBatchTransfer1155] Should revert if attacker tries to transfer batch', async () => {
        await expect(
          utils.safeBatchTransfer1155(
            users.seller.address,
            users.other1.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            users.attacker.signer
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_BATCH_1155);
      });

      it('[balanceOfBatch] Should return balance of account-token pairs', async () => {
        const balance = await contractERC1155ERC721.balanceOfBatch(
          [users.seller.address],
          [TOKEN_SUPPLY_ID]
        );

        assert.equal(balance[0].toString(), constants.QTY_10.toString());
      });

      it('[NEGATIVE][balanceOfBatch] Should revert if balanceOfBatch has been provided with mismatched lengths', async () => {
        await expect(
          contractERC1155ERC721.balanceOfBatch(
            [users.seller.address],
            [TOKEN_SUPPLY_ID, 2]
          )
        ).to.be.revertedWith(revertReasons.MISMATCHED_ARRAY_LENGTHS);
      });

      it('[mint] Should mint a desired token', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        const tokenIdForMint = 123;
        const tx = await contractERC1155ERC721.functions[fnSignatures.mint1155](
          users.other1.address,
          tokenIdForMint,
          constants.QTY_10,
          ethers.utils.formatBytes32String('0x0')
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.equal(
              ev._from,
              constants.ZERO_ADDRESS,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              users.other1.address,
              'ev._to not as expected!'
            );
            assert.equal(ev._id, tokenIdForMint, 'ev._id not as expected!');
            assert.equal(
              ev._value,
              constants.QTY_10,
              'ev._value not as expected!'
            );
          }
        );

        const expectedBalance = constants.QTY_10;
        const balanceOfOwner = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf1155
        ](users.other1.address, tokenIdForMint);

        assert.equal(balanceOfOwner.toString(), expectedBalance.toString());
      });

      it('[mint] Should mint a desired token to ERC1155 supporting contract', async () => {
        const erc1155supportingContract = contractMockERC1155Receiver;
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        const tokenIdForMint = 123;
        const tx = await contractERC1155ERC721.functions[fnSignatures.mint1155](
          erc1155supportingContract.address,
          tokenIdForMint,
          constants.QTY_10,
          ethers.utils.formatBytes32String('0x0')
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.equal(
              ev._from,
              constants.ZERO_ADDRESS,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              erc1155supportingContract.address,
              'ev._to not as expected!'
            );
            assert.equal(ev._id, tokenIdForMint, 'ev._id not as expected!');
            assert.equal(
              ev._value,
              constants.QTY_10,
              'ev._value not as expected!'
            );
          }
        );

        const expectedBalance = constants.QTY_10;
        const balanceOfOwner = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf1155
        ](erc1155supportingContract.address, tokenIdForMint);

        assert.equal(balanceOfOwner.toString(), expectedBalance.toString());
      });

      it('[NEGATIVE][mint] must fail: unauthorized minting ERC-1155', async () => {
        await expect(
          contractERC1155ERC721.functions[fnSignatures.mint1155](
            users.attacker.address,
            666,
            constants.QTY_10,
            ethers.utils.formatBytes32String('0x0')
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VK);
      });

      it('[NEGATIVE][mint] Should revert when to is a zero address', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        await expect(
          contractERC1155ERC721.functions[fnSignatures.mint1155](
            constants.ZERO_ADDRESS,
            123,
            constants.QTY_10,
            ethers.utils.formatBytes32String('0x0')
          )
        ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
      });

      it('[burn] Should burn an amount of tokens with the given ID', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        const tokenIdToBurn = TOKEN_SUPPLY_ID;
        const tx = await contractERC1155ERC721.functions[fnSignatures.burn1155](
          users.seller.address,
          tokenIdToBurn,
          constants.QTY_10
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.equal(
              ev._from,
              users.seller.address,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              constants.ZERO_ADDRESS,
              'ev._to not as expected!'
            );
            assert.equal(ev._id, tokenIdToBurn, 'ev._id not as expected!');
            assert.equal(
              ev._value,
              constants.QTY_10,
              'ev._value not as expected!'
            );
          }
        );

        const expectedBalance = 0;
        const balanceOfOwner = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf721
        ](users.seller.address);

        assert.equal(balanceOfOwner.toString(), expectedBalance.toString());
      });

      it('[NEGATIVE][burn] Should revert when _account is a zero address', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        await expect(
          contractERC1155ERC721.functions[fnSignatures.burn1155](
            constants.ZERO_ADDRESS,
            TOKEN_SUPPLY_ID,
            constants.QTY_10
          )
        ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
      });

      it('[mintBatch] Should do batch minting of tokens', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        const tokenIds = [BN(123), BN(456), BN(789)];
        const quantities = [
          BN(constants.QTY_10),
          BN(constants.QTY_15),
          BN(constants.QTY_20),
        ];
        const tx = await contractERC1155ERC721.mintBatch(
          users.seller.address,
          tokenIds,
          quantities,
          ethers.utils.formatBytes32String('0x0')
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_BATCH,
          (ev) => {
            assert.equal(
              ev._from,
              constants.ZERO_ADDRESS,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              users.seller.address,
              'ev._to not as expected!'
            );
            assert.equal(
              ev._ids.toString(),
              tokenIds.toString(),
              'ev._ids not as expected!'
            );
            assert.equal(
              JSON.stringify(ev._values),
              JSON.stringify(quantities),
              'ev._values not as expected!'
            );
          }
        );

        const balanceOfToken1 = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf1155
        ](users.seller.address, tokenIds[0]);

        const balanceOfToken2 = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf1155
        ](users.seller.address, tokenIds[1]);

        const balanceOfToken3 = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf1155
        ](users.seller.address, tokenIds[2]);

        assert.equal(balanceOfToken1.toString(), quantities[0].toString());
        assert.equal(balanceOfToken2.toString(), quantities[1].toString());
        assert.equal(balanceOfToken3.toString(), quantities[2].toString());
      });

      it('[mintBatch] Should do batch minting of tokens to ERC1155 supporting contract', async () => {
        const erc1155supportingContract = contractMockERC1155Receiver;
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        const tokenIds = [BN(123)];
        const quantities = [BN(constants.QTY_10)];
        const tx = await contractERC1155ERC721.mintBatch(
          erc1155supportingContract.address,
          tokenIds,
          quantities,
          ethers.utils.formatBytes32String('0x0')
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_BATCH,
          (ev) => {
            assert.equal(
              ev._from,
              constants.ZERO_ADDRESS,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              erc1155supportingContract.address,
              'ev._to not as expected!'
            );
            assert.equal(
              ev._ids.toString(),
              tokenIds.toString(),
              'ev._ids not as expected!'
            );
            assert.equal(
              JSON.stringify(ev._values),
              JSON.stringify(quantities),
              'ev._values not as expected!'
            );
          }
        );

        const balanceOfToken1 = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf1155
        ](erc1155supportingContract.address, tokenIds[0]);

        assert.equal(balanceOfToken1.toString(), quantities[0].toString());
      });

      it('[NEGATIVE][mintBatch] Should revert when _account is a zero address', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        await expect(
          contractERC1155ERC721.mintBatch(
            constants.ZERO_ADDRESS,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            ethers.utils.formatBytes32String('0x0')
          )
        ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
      });

      it('[NEGATIVE][mintBatch] Should revert if array lengths mismatch', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        await expect(
          contractERC1155ERC721.mintBatch(
            users.seller.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10, constants.QTY_1],
            ethers.utils.formatBytes32String('0x0')
          )
        ).to.be.revertedWith(revertReasons.MISMATCHED_ARRAY_LENGTHS);
      });

      it('[burnBatch] Should do batch minting of tokens', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        const tokenIds = TOKEN_SUPPLY_ID;
        const tx = await contractERC1155ERC721.burnBatch(
          users.seller.address,
          [tokenIds],
          [constants.QTY_10]
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_BATCH,
          (ev) => {
            assert.equal(
              ev._to,
              constants.ZERO_ADDRESS,
              'ev._to not as expected!'
            );
            assert.equal(
              ev._from,
              users.seller.address,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._ids.toString(),
              tokenIds.toString(),
              'ev._ids not as expected!'
            );
            assert.equal(
              ev._values.toString(),
              constants.QTY_10.toString(),
              'ev._values not as expected!'
            );
          }
        );
      });

      it('[NEGATIVE][burnBatch] Should revert when _account is a zero address', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        await expect(
          contractERC1155ERC721.burnBatch(
            constants.ZERO_ADDRESS,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10]
          )
        ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
      });

      it('[NEGATIVE][burnBatch] Should revert if array lengths mismatch', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        await expect(
          contractERC1155ERC721.burnBatch(
            users.seller.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10, constants.QTY_1]
          )
        ).to.be.revertedWith(revertReasons.MISMATCHED_ARRAY_LENGTHS);
      });
    });

    describe('ERC721', () => {
      beforeEach(async () => {
        await deployContracts();
        utils = await prepareUtils();

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_10
        );
      });

      it('[approve] Owner should approve transfer of erc721', async () => {
        const token721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        const owner721Instance = contractERC1155ERC721.connect(
          users.buyer.signer
        );
        const tx = await owner721Instance.approve(
          users.other1.address,
          token721
        );
        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.APPROVAL,
          (ev) => {
            assert.equal(
              ev._owner,
              users.buyer.address,
              'Owner not as expected!'
            );
            assert.equal(
              ev._approved,
              users.other1.address,
              'Approved not as expected!'
            );
            assert.equal(
              ev._tokenId.toString(),
              token721.toString(),
              'tokenId not as expected!'
            );
          }
        );

        const approvedAddress = await contractERC1155ERC721.getApproved(
          token721
        );
        assert.equal(approvedAddress, users.other1.address);
      });

      it('[NEGATIVE][approve] Attacker should not approve transfer of erc721 that does not possess', async () => {
        const token721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        const attackerInstance = contractERC1155ERC721.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance.approve(users.other1.address, token721)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_APPROVAL);
      });

      it('[NEGATIVE][approve] Should revert if buyer tries to approve to self', async () => {
        const token721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await expect(
          contractERC1155ERC721.approve(users.buyer.address, token721)
        ).to.be.revertedWith(revertReasons.REDUNDANT_CALL);
      });

      it('[ownerOf] should return the token owner address for valid token', async () => {
        const expectedOwner = users.buyer.address;
        const tokenIdsForMint = 123;

        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        await contractERC1155ERC721.functions[fnSignatures.mint721](
          expectedOwner,
          tokenIdsForMint
        );

        const tokenOwner = await contractERC1155ERC721.ownerOf(tokenIdsForMint);

        assert.equal(tokenOwner, expectedOwner);
      });

      it('[NEGATIVE][ownerOf] should revert if incorrect id provided', async () => {
        const sellerInstance = contractERC1155ERC721.connect(
          users.seller.signer
        );
        await expect(sellerInstance.ownerOf(1)).to.be.revertedWith(
          revertReasons.UNDEFINED_OWNER
        );
      });

      describe('[balanceOf] should count all NFTs assigned to an owner', async () => {
        it('[balanceOf] returns 4 when 4 NFTs are assigned to owner', async () => {
          await contractERC1155ERC721.setVoucherKernelAddress(
            users.deployer.address
          );

          const tokenIdsForMint = [10, 20, 30, 40];

          for (const idForMint of tokenIdsForMint) {
            await contractERC1155ERC721.functions[fnSignatures.mint721](
              users.other1.address,
              idForMint
            );
          }

          const expectedCount = tokenIdsForMint.length;
          const balanceOfOwner = await contractERC1155ERC721.functions[
            fnSignatures.balanceOf721
          ](users.other1.address);

          assert.equal(balanceOfOwner.toString(), expectedCount.toString());
        });

        it('[balanceOf] returns 0 when no NFTs are assigned to owner', async () => {
          const expectedCount = 0;

          const balanceOfBuyer = await contractERC1155ERC721.functions[
            fnSignatures.balanceOf721
          ](users.buyer.address);

          assert.equal(balanceOfBuyer.toString(), expectedCount.toString());
        });
      });

      it('[NEGATIVE][balanceOf] should revert if ZERO address is provided', async () => {
        const balanceOf =
          contractERC1155ERC721.functions[fnSignatures.balanceOf721];

        await expect(balanceOf(constants.ZERO_ADDRESS)).to.be.revertedWith(
          revertReasons.UNSPECIFIED_ADDRESS
        );
      });

      it('[safeTransfer721WithNoData] Should safely transfer the ownership of a given token ID to another address', async () => {
        const oldOwner = users.buyer;
        const expectedNewOwner = users.other2;

        const erc721 = await utils.commitToBuy(
          oldOwner,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        const tx = await utils.safeTransfer721WithNoData(
          oldOwner.address,
          expectedNewOwner.address,
          erc721,
          users.buyer.signer
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(
              ev._from,
              oldOwner.address,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              users.other2.address,
              'ev._to not as expected!'
            );
            assert.equal(
              ev._tokenId.toString(),
              erc721.toString(),
              'ev._tokenId not as expected!'
            );
          }
        );

        const newTokenOwner = await contractERC1155ERC721.ownerOf(erc721);

        assert.equal(newTokenOwner, expectedNewOwner.address);
      });

      it('[safeTransfer721] Should safely transfer the ownership of a given token ID to another address', async () => {
        const oldOwner = users.buyer;
        const expectedNewOwner = users.other2;

        const erc721 = await utils.commitToBuy(
          oldOwner,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        const tx = await utils.safeTransfer721(
          oldOwner.address,
          expectedNewOwner.address,
          erc721,
          users.buyer.signer
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(
              ev._from,
              oldOwner.address,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              users.other2.address,
              'ev._to not as expected!'
            );
            assert.equal(
              ev._tokenId.toString(),
              erc721.toString(),
              'ev._tokenId not as expected!'
            );
          }
        );

        const newTokenOwner = await contractERC1155ERC721.ownerOf(erc721);

        assert.equal(newTokenOwner, expectedNewOwner.address);
      });

      it('[safeTransfer721] Should safely transfer the ownership of a given token ID to ERC721 supporting contract', async () => {
        const oldOwner = users.buyer;
        const expectedNewOwnerAddress = contractMockERC721Receiver.address;

        const erc721 = await utils.commitToBuy(
          oldOwner,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        const tx = await utils.safeTransfer721(
          oldOwner.address,
          expectedNewOwnerAddress,
          erc721,
          users.buyer.signer
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(
              ev._from,
              oldOwner.address,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              expectedNewOwnerAddress,
              'ev._to not as expected!'
            );
            assert.equal(
              ev._tokenId.toString(),
              erc721.toString(),
              'ev._tokenId not as expected!'
            );
          }
        );

        const newTokenOwner = await contractERC1155ERC721.ownerOf(erc721);

        assert.equal(newTokenOwner, expectedNewOwnerAddress);
      });

      it('[NEGATIVE][safeTransfer721] Should not be able to transfer to contract address', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await expect(
          utils.safeTransfer721(
            users.buyer.address,
            contractCashier.address,
            erc721,
            users.buyer.signer
          )
        ).to.be.revertedWith(revertReasons.FN_SELECTOR_NOT_RECOGNIZED);
      });

      it('[NEGATIVE][safeTransfer721] Attacker should not be able to transfer erc721', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await expect(
          utils.safeTransfer721(
            users.buyer.address,
            users.other1.address,
            erc721,
            users.attacker.signer
          )
        ).to.be.revertedWith(revertReasons.NOT_OWNER_NOR_APPROVED);
      });

      it('[NEGATIVE][safeTransfer721] Should not be able to transfer erc721 to ZERO address', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await expect(
          utils.safeTransfer721(
            users.buyer.address,
            constants.ZERO_ADDRESS,
            erc721,
            users.buyer.signer
          )
        ).to.be.revertedWith(revertReasons.UNSPECIFIED_ADDRESS);
      });

      it('[NEGATIVE][safeTransfer721] Should not be able to transfer erc721 if address from is not authorized', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await expect(
          utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            erc721,
            users.buyer.signer
          )
        ).to.be.revertedWith(
          revertReasons.TRANSFER_721_ADDRESS_FROM_NOT_AUTHORIZED
        );
      });

      it('[transferFrom] Should be able to transfer ownership of ERC721 to another address', async () => {
        const oldOwner = users.buyer;
        const expectedNewOwner = users.other2;

        const erc721 = await utils.commitToBuy(
          oldOwner,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        const tx = await utils.transfer721(
          oldOwner.address,
          expectedNewOwner.address,
          erc721,
          users.buyer.signer
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(
              ev._from,
              oldOwner.address,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              users.other2.address,
              'ev._to not as expected!'
            );
            assert.equal(
              ev._tokenId.toString(),
              erc721.toString(),
              'ev._tokenId not as expected!'
            );
          }
        );

        const newTokenOwner = await contractERC1155ERC721.ownerOf(erc721);

        assert.equal(newTokenOwner, expectedNewOwner.address);
      });

      it('[NEGATIVE][transferFrom] Should not be able to transfer erc721 if address from is not authorized', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await expect(
          utils.transfer721(
            users.other1.address,
            users.other2.address,
            erc721,
            users.buyer.signer
          )
        ).to.be.revertedWith(
          revertReasons.TRANSFER_721_ADDRESS_FROM_NOT_AUTHORIZED
        );
      });

      it('[getApproved] Should return zero address if no address set', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        const tokenIdForMint = 123;
        await contractERC1155ERC721.functions[fnSignatures.mint721](
          users.deployer.address,
          tokenIdForMint
        );

        const approvedAddress = await contractERC1155ERC721.getApproved(
          tokenIdForMint
        );
        assert.equal(approvedAddress, constants.ZERO_ADDRESS);
      });

      it('[getApproved] Should return the approved address for a token ID', async () => {
        const expectedApprovedAddress = users.other1.address;

        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        const tokenIdForMint = 123;
        await contractERC1155ERC721.functions[fnSignatures.mint721](
          users.deployer.address,
          tokenIdForMint
        );

        await contractERC1155ERC721.approve(
          expectedApprovedAddress,
          tokenIdForMint
        );
        const approvedAddress = await contractERC1155ERC721.getApproved(
          tokenIdForMint
        );
        assert.equal(approvedAddress, expectedApprovedAddress);
      });

      it('[mint] Should mint a token', async () => {
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        const tokenIdForMint = 123;
        const tx = await contractERC1155ERC721.functions[fnSignatures.mint721](
          users.other1.address,
          tokenIdForMint
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(
              ev._from,
              constants.ZERO_ADDRESS,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              users.other1.address,
              'ev._to not as expected!'
            );
            assert.equal(
              ev._tokenId,
              tokenIdForMint,
              'ev._tokenId not as expected!'
            );
          }
        );

        const expectedBalance = 1;
        const balanceOfBuyer = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf721
        ](users.other1.address);

        assert.equal(balanceOfBuyer.toString(), expectedBalance.toString());
      });

      it('[mint] Should be able to mint a token to a contract that supports it', async () => {
        const supportingContractAddress = contractMockERC721Receiver.address;
        await contractERC1155ERC721.setVoucherKernelAddress(
          users.deployer.address
        );

        const tokenIdForMint = 123;
        const tx = await contractERC1155ERC721.functions[fnSignatures.mint721](
          supportingContractAddress,
          tokenIdForMint
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(
              ev._from,
              constants.ZERO_ADDRESS,
              'ev._from not as expected!'
            );
            assert.equal(
              ev._to,
              supportingContractAddress,
              'ev._to not as expected!'
            );
            assert.equal(
              ev._tokenId,
              tokenIdForMint,
              'ev._tokenId not as expected!'
            );
          }
        );

        const expectedBalance = 1;
        const balanceOfBuyer = await contractERC1155ERC721.functions[
          fnSignatures.balanceOf721
        ](supportingContractAddress);

        assert.equal(balanceOfBuyer.toString(), expectedBalance.toString());
      });

      it('[NEGATIVE][mint] must fail: unauthorized minting ERC-721', async () => {
        await expect(
          contractERC1155ERC721.functions[fnSignatures.mint721](
            users.attacker.address,
            666
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VK);
      });
    });

    describe('Metadata', () => {
      let erc721;
      const metadataBase = 'https://localhost:3000/';
      const metadata1155Route = 'voucher-sets/';
      const metadata721Route = 'vouchers/';

      beforeEach(async () => {
        await deployContracts();
        utils = await prepareUtils();

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_10
        );

        erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        await contractERC1155ERC721._setMetadataBase(metadataBase);
        await contractERC1155ERC721._set1155Route(metadata1155Route);
        await contractERC1155ERC721._set721Route(metadata721Route);
      });

      it('[uri] Should return correct url for erc1155', async () => {
        const url = await contractERC1155ERC721.uri(TOKEN_SUPPLY_ID);
        assert.equal(url, metadataBase + metadata1155Route + TOKEN_SUPPLY_ID);
      });

      it('[tokenURI] Should return correct url for erc721', async () => {
        const url = await contractERC1155ERC721.tokenURI(erc721);

        assert.equal(url, metadataBase + metadata721Route + erc721);
      });

      it('[NEGATIVE][tokenURI] Should revert if incorrect id is provided', async () => {
        await expect(
          contractERC1155ERC721.tokenURI(constants.ZERO_ADDRESS)
        ).to.be.revertedWith(revertReasons.INVALID_ID);
      });

      it('[NEGATIVE][_setMetadataBase] Should revert if attacker tries to set metadataBase', async () => {
        const attackerInstance = contractERC1155ERC721.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance._setMetadataBase(metadataBase)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
      });

      it('[NEGATIVE][_set1155Route] Should revert if attacker tries to set metadata1155Route', async () => {
        const attackerInstance = contractERC1155ERC721.connect(
          users.attacker.signer
        );
        await expect(
          attackerInstance._set1155Route(metadata1155Route)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
      });

      it('[NEGATIVE][_set721Route] Should revert if attacker tries to set metadata721Route', async () => {
        const attackerInstance = contractERC1155ERC721.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance._set721Route(metadata721Route)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
      });
    });
  });
});
