import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';
import {assert, expect} from 'chai';

import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';
const BN = ethers.BigNumber.from;

import {waffle} from 'hardhat';
import ERC1155receiver from '../artifacts/contracts/mocks/MockERC1155Receiver.sol/MockERC1155Receiver.json';
const {deployMockContract} = waffle;

import {
  BosonRouter,
  VoucherSets,
  Vouchers,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
  MockERC721Receiver,
  MockERC1155Receiver,
} from '../typechain';

let VoucherSets_Factory: ContractFactory;
let Vouchers_Factory: ContractFactory;
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

describe('Voucher Sets', () => {
  beforeEach(async () => {
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
    MockERC1155Receiver_Factory = await ethers.getContractFactory(
      'MockERC1155Receiver'
    );
  });

  let contractVoucherSets: VoucherSets,
    contractVouchers: Vouchers,
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

    contractMockERC1155Receiver =
      (await MockERC1155Receiver_Factory.deploy()) as Contract &
        MockERC1155Receiver;

    await contractTokenRegistry.deployed();
    await contractVoucherSets.deployed();
    await contractVouchers.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();
    await contractMockERC721Receiver.deployed();
    await contractMockERC1155Receiver.deployed();

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

  async function prepareUtils() {
    utils = await UtilsBuilder.create()
      .ETHETH()
      .buildAsync(
        contractVoucherSets,
        contractVouchers,
        contractVoucherKernel,
        contractCashier,
        contractBosonRouter
      );

    timestamp = await Utils.getCurrTimestamp();
    return utils;
  }

  describe('Voucher Sets contract', function () {
    describe('General', () => {
      beforeEach(async () => {
        await deployContracts();
        utils = await prepareUtils();
      });

      it('[setVoucherKernelAddress] Should set setVoucherKernelAddress to valid address', async () => {
        const expectedVoucherKernelAddress = users.other1.address;
        await contractVoucherSets.pause();
        const tx = await contractVoucherSets.setVoucherKernelAddress(
          expectedVoucherKernelAddress
        );

        const txReceipt = await tx.wait();
        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
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

        const voucherKernelAddress =
          await contractVoucherSets.getVoucherKernelAddress();
        assert.equal(voucherKernelAddress, expectedVoucherKernelAddress);
      });

      it('[NEGATIVE][setVoucherKernelAddress] Should revert for zero address', async () => {
        await expect(
          contractVoucherSets.setVoucherKernelAddress(constants.ZERO_ADDRESS)
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
      });

      it('[NEGATIVE][deploy Voucher Sets] Should revert if ZERO address is provided at deployment for Cashier address', async () => {
        await expect(
          VoucherSets_Factory.deploy(
            'https://token-cdn-domain/{id}.json',
            constants.ZERO_ADDRESS,
            contractVoucherKernel.address
          )
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
      });

      it('[NEGATIVE][deploy Voucher Sets] Should revert if ZERO address is provided at deployment for Voucher Kernel address', async () => {
        await expect(
          VoucherSets_Factory.deploy(
            'https://token-cdn-domain/{id}.json',
            contractCashier.address,
            constants.ZERO_ADDRESS
          )
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
      });

      describe('[supportsInterface]', () => {
        it('Should return True for supported _interfaceId', async () => {
          const supportedInterfaceIds = [
            '0x01ffc9a7',
            '0xd9b67a26',
            '0x0e89341c',
          ];

          const randomInterfaceId =
            supportedInterfaceIds[
              Math.floor(Math.random() * supportedInterfaceIds.length)
            ];

          assert.isTrue(
            await contractVoucherSets.supportsInterface(randomInterfaceId)
          );
        });

        it('Should return False for un-supported _interfaceId', async () => {
          const unSupportedInterfaceId = '0x150b7a02';

          assert.isFalse(
            await contractVoucherSets.supportsInterface(unSupportedInterfaceId)
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

      it('[setApprovalForAll] Should emit ApprovalForAll', async () => {
        const tx = await contractVoucherSets.setApprovalForAll(
          contractVoucherKernel.address,
          true
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.APPROVAL_FOR_ALL,
          (ev) => {
            assert.equal(
              ev.account,
              users.deployer.address,
              'ev.account not expected!'
            );
            assert.equal(
              ev.operator,
              contractVoucherKernel.address,
              'ev.operator not expected!'
            );
            assert.equal(ev.approved, true, 'ev.approved not expected!');
          }
        );
      });

      it('[NEGATIVE][setApprovalForAll] Should revert if tries to set self as an operator', async () => {
        await expect(
          contractVoucherSets.setApprovalForAll(users.deployer.address, true)
        ).to.be.revertedWith(revertReasons.REDUNDANT_CALL);
      });

      it('[isApprovedForAll] Should return the approval status of an operator for a given account', async () => {
        const expectedApprovalStatus = true;
        await contractVoucherSets.setApprovalForAll(
          contractVoucherKernel.address,
          expectedApprovalStatus
        );

        assert.isTrue(
          await contractVoucherSets.isApprovedForAll(
            users.deployer.address,
            contractVoucherKernel.address
          )
        );
      });

      it('[balanceOf] Get the balance of tokens of an account', async () => {
        const expectedCount = constants.QTY_10;

        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        contractVoucherSets.unpause();

        await contractVoucherSets.functions[fnSignatures.mint1155](
          users.deployer.address,
          TOKEN_SUPPLY_ID,
          expectedCount,
          ethers.utils.formatBytes32String('0x0')
        );

        const balance = await contractVoucherSets.functions[
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
          VoucherSets_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            ev;
            assert.equal(ev.operator, users.seller.address);
            assert.equal(ev.from, users.seller.address);
            assert.equal(ev.to, users.other1.address);
            assert.equal(ev.id.toString(), TOKEN_SUPPLY_ID);
            assert.equal(ev.value.toString(), constants.QTY_10);
          }
        );

        const expectedBalance = constants.QTY_10;
        const balanceOfOwner = await contractVoucherSets.functions[
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
          VoucherSets_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            ev;
            assert.equal(ev.operator, users.seller.address);
            assert.equal(ev.from, users.seller.address);
            assert.equal(ev.to, erc1155supportingContract.address);
            assert.equal(ev.id.toString(), TOKEN_SUPPLY_ID);
            assert.equal(ev.value.toString(), constants.QTY_10);
          }
        );

        const expectedBalance = constants.QTY_10;
        const balanceOfOwner = await contractVoucherSets.functions[
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
        ).to.be.revertedWith(revertReasons.TRANSFER_ZERO_ADDRESS_1155);
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
        ).to.be.revertedWith(revertReasons.NON_ERC1155RECEIVER);
      });

      it('[NEGATIVE][safeTransfer1155] it should revert if sent to contract that rejects them', async () => {
        const mockERC1155Receiver = await deployMockContract(
          users.deployer.signer,
          ERC1155receiver.abi
        ); //deploys mock

        await mockERC1155Receiver.mock.onERC1155Received.returns('0x00000000');

        await expect(
          utils.safeTransfer1155(
            users.seller.address,
            mockERC1155Receiver.address,
            TOKEN_SUPPLY_ID,
            constants.QTY_10,
            users.seller.signer
          )
        ).to.be.revertedWith(revertReasons.ERC1155_REJECT);
      });

      it('[NEGATIVE][safeTransfer1155] it should revert if sent to contract that reverts with arbitrary revert reason', async () => {
        const mockERC1155Receiver = await deployMockContract(
          users.deployer.signer,
          ERC1155receiver.abi
        ); //deploys mock

        const arbitraryRevertReason = 'arbitrary revert reason';

        await mockERC1155Receiver.mock.onERC1155Received.revertsWithReason(
          arbitraryRevertReason
        );

        await expect(
          utils.safeTransfer1155(
            users.seller.address,
            mockERC1155Receiver.address,
            TOKEN_SUPPLY_ID,
            constants.QTY_10,
            users.seller.signer
          )
        ).to.be.revertedWith(arbitraryRevertReason);
      });

      it('[safeBatchTransfer1155] Should be able to safely batch transfer to EOA', async () => {
        const tokenIds = [BN(123), BN(456), BN(789)];
        const quantities = [
          BN(constants.QTY_10),
          BN(constants.QTY_15),
          BN(constants.QTY_20),
        ];

        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        await contractVoucherSets.mintBatch(
          users.deployer.address,
          tokenIds,
          quantities,
          ethers.utils.formatBytes32String('0x0')
        );

        const tx = await utils.safeBatchTransfer1155(
          users.deployer.address,
          users.other1.address,
          tokenIds,
          quantities,
          users.deployer.signer
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.TRANSFER_BATCH,
          (ev) => {
            assert.equal(
              ev.operator,
              users.deployer.address,
              'ev.operaror not as expected!'
            );
            assert.equal(
              ev.from,
              users.deployer.address,
              'ev.from not as expected!'
            );
            assert.equal(ev.to, users.other1.address, 'ev.to not as expected!');
            assert.equal(
              ev.ids.toString(),
              tokenIds.toString(),
              'ev.ids not as expected!'
            );
            assert.equal(
              JSON.stringify(ev[ev.length - 1]), //for some reason, "values" is not available in the event objec by that name
              JSON.stringify(quantities),
              'ev.values not as expected!'
            );
          }
        );

        const balanceOfToken1 = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](users.other1.address, tokenIds[0]);

        const balanceOfToken2 = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](users.other1.address, tokenIds[1]);

        const balanceOfToken3 = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](users.other1.address, tokenIds[2]);

        assert.equal(balanceOfToken1.toString(), quantities[0].toString());
        assert.equal(balanceOfToken2.toString(), quantities[1].toString());
        assert.equal(balanceOfToken3.toString(), quantities[2].toString());
      });

      it('[safeBatchTransfer1155] Should be able to safely batch transfer to contracts that support ERC1155', async () => {
        const erc1155supportingContract = contractMockERC1155Receiver;
        const tokenIds = [BN(123), BN(456), BN(789)];
        const quantities = [
          BN(constants.QTY_10),
          BN(constants.QTY_15),
          BN(constants.QTY_20),
        ];

        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        await contractVoucherSets.mintBatch(
          users.deployer.address,
          tokenIds,
          quantities,
          ethers.utils.formatBytes32String('0x0')
        );

        const tx = await utils.safeBatchTransfer1155(
          users.deployer.address,
          erc1155supportingContract.address,
          tokenIds,
          quantities,
          users.deployer.signer
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.TRANSFER_BATCH,
          (ev) => {
            assert.equal(
              ev.operator,
              users.deployer.address,
              'ev.operator not as expected!'
            );
            assert.equal(
              ev.from,
              users.deployer.address,
              'ev.from not as expected!'
            );
            assert.equal(
              ev.to,
              erc1155supportingContract.address,
              'ev.to not as expected!'
            );
            assert.equal(
              ev.ids.toString(),
              tokenIds.toString(),
              'ev._ds not as expected!'
            );
            assert.equal(
              JSON.stringify(ev[ev.length - 1]), //for some reason, "values" is not available in the event objec by that name
              JSON.stringify(quantities),
              'ev.values not as expected!'
            );
          }
        );

        const balanceOfToken1 = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](erc1155supportingContract.address, tokenIds[0]);

        const balanceOfToken2 = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](erc1155supportingContract.address, tokenIds[1]);

        const balanceOfToken3 = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](erc1155supportingContract.address, tokenIds[2]);

        assert.equal(balanceOfToken1.toString(), quantities[0].toString());
        assert.equal(balanceOfToken2.toString(), quantities[1].toString());
        assert.equal(balanceOfToken3.toString(), quantities[2].toString());
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
        ).to.be.revertedWith(revertReasons.TRANSFER_ZERO_ADDRESS_1155);
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
        ).to.be.revertedWith(revertReasons.MISMATCHED_ARRAY_LENGTHS_1155);
      });

      it('[NEGATIVE][safeBatchTransfer1155] Seller should not transfer batch to contract address that cannot receive it', async () => {
        await expect(
          utils.safeBatchTransfer1155(
            users.seller.address,
            contractCashier.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            users.seller.signer
          )
        ).to.be.revertedWith(revertReasons.NON_ERC1155RECEIVER);
      });

      it('[NEGATIVE][safeTransfer1155] it should revert if sent to contract that rejects them', async () => {
        const mockERC1155Receiver = await deployMockContract(
          users.deployer.signer,
          ERC1155receiver.abi
        ); //deploys mock

        await mockERC1155Receiver.mock.onERC1155BatchReceived.returns(
          '0x00000000'
        );

        await expect(
          utils.safeBatchTransfer1155(
            users.seller.address,
            mockERC1155Receiver.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            users.seller.signer
          )
        ).to.be.revertedWith(revertReasons.ERC1155_REJECT);
      });

      it('[NEGATIVE][safeTransfer1155] it should revert if sent to contract that reverts with arbitrary revert reason', async () => {
        const mockERC1155Receiver = await deployMockContract(
          users.deployer.signer,
          ERC1155receiver.abi
        ); //deploys mock

        const arbitraryRevertReason = 'arbitrary revert reason';

        await mockERC1155Receiver.mock.onERC1155BatchReceived.revertsWithReason(
          arbitraryRevertReason
        );

        await expect(
          utils.safeBatchTransfer1155(
            users.seller.address,
            mockERC1155Receiver.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            users.seller.signer
          )
        ).to.be.revertedWith(arbitraryRevertReason);
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
        const balance = await contractVoucherSets.balanceOfBatch(
          [users.seller.address],
          [TOKEN_SUPPLY_ID]
        );

        assert.equal(balance[0].toString(), constants.QTY_10.toString());
      });

      it('[NEGATIVE][balanceOfBatch] Should revert if balanceOfBatch has been provided with mismatched lengths', async () => {
        await expect(
          contractVoucherSets.balanceOfBatch(
            [users.seller.address],
            [TOKEN_SUPPLY_ID, 2]
          )
        ).to.be.revertedWith(
          revertReasons.BALANCE_BATCH_MISMATCHED_ARRAY_LENGTHS_1155
        );
      });

      it('[mint] Should mint a desired token', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        const tokenIdForMint = 123;
        const tx = await contractVoucherSets.functions[fnSignatures.mint1155](
          users.other1.address,
          tokenIdForMint,
          constants.QTY_10,
          ethers.utils.formatBytes32String('0x0')
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.equal(
              ev.operator,
              users.deployer.address,
              'ev.operator not as expected!'
            );
            assert.equal(
              ev.from,
              constants.ZERO_ADDRESS,
              'ev.from not as expected!'
            );
            assert.equal(ev.to, users.other1.address, 'ev.to not as expected!');
            assert.equal(ev.id, tokenIdForMint, 'ev.id not as expected!');
            assert.equal(
              ev.value,
              constants.QTY_10,
              'ev.value not as expected!'
            );
          }
        );

        const expectedBalance = constants.QTY_10;
        const balanceOfOwner = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](users.other1.address, tokenIdForMint);

        assert.equal(balanceOfOwner.toString(), expectedBalance.toString());
      });

      it('[mint] Should mint a desired token to ERC1155 supporting contract', async () => {
        const erc1155supportingContract = contractMockERC1155Receiver;

        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        const tokenIdForMint = 123;
        const tx = await contractVoucherSets.functions[fnSignatures.mint1155](
          erc1155supportingContract.address,
          tokenIdForMint,
          constants.QTY_10,
          ethers.utils.formatBytes32String('0x0')
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.equal(
              ev.operator,
              users.deployer.address,
              'ev.operator not as expected!'
            );
            assert.equal(
              ev.from,
              constants.ZERO_ADDRESS,
              'ev.from not as expected!'
            );
            assert.equal(
              ev.to,
              erc1155supportingContract.address,
              'ev.to not as expected!'
            );
            assert.equal(ev.id, tokenIdForMint, 'ev.id not as expected!');
            assert.equal(
              ev.value,
              constants.QTY_10,
              'ev.value not as expected!'
            );
          }
        );

        const expectedBalance = constants.QTY_10;
        const balanceOfOwner = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](erc1155supportingContract.address, tokenIdForMint);

        assert.equal(balanceOfOwner.toString(), expectedBalance.toString());
      });

      it('[NEGATIVE][mint] Should revert when to is a contract that cannot receive it', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        await expect(
          contractVoucherSets.functions[fnSignatures.mint1155](
            contractCashier.address,
            666,
            constants.QTY_10,
            ethers.utils.formatBytes32String('0x0')
          )
        ).to.be.revertedWith(revertReasons.NON_ERC1155RECEIVER);
      });

      it('[NEGATIVE][mint] must fail: unauthorized minting ERC-1155', async () => {
        await expect(
          contractVoucherSets.functions[fnSignatures.mint1155](
            users.attacker.address,
            666,
            constants.QTY_10,
            ethers.utils.formatBytes32String('0x0')
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VK);
      });

      it('[NEGATIVE][mint] Should revert when to is a zero address', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        await expect(
          contractVoucherSets.functions[fnSignatures.mint1155](
            constants.ZERO_ADDRESS,
            123,
            constants.QTY_10,
            ethers.utils.formatBytes32String('0x0')
          )
        ).to.be.revertedWith(revertReasons.MINT_ZERO_ADDRESS_1155);
      });

      it('[burn] Should burn an amount of tokens with the given ID', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        const tokenIdToBurn = TOKEN_SUPPLY_ID;
        const tx = await contractVoucherSets.functions[fnSignatures.burn1155](
          users.seller.address,
          tokenIdToBurn,
          constants.QTY_10
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.equal(
              ev.operator,
              users.deployer.address,
              'ev.operator not as expected!'
            );
            assert.equal(
              ev.from,
              users.seller.address,
              'ev.from not as expected!'
            );
            assert.equal(
              ev.to,
              constants.ZERO_ADDRESS,
              'ev.to not as expected!'
            );
            assert.equal(ev.id, tokenIdToBurn, 'ev.id not as expected!');
            assert.equal(
              ev.value,
              constants.QTY_10,
              'ev.value not as expected!'
            );
          }
        );

        const expectedBalance = 0;
        const balanceOfOwner = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](users.seller.address, tokenIdToBurn);

        assert.equal(balanceOfOwner.toString(), expectedBalance.toString());
      });

      it('[NEGATIVE][burn] Should revert when _account is a zero address', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        await expect(
          contractVoucherSets.functions[fnSignatures.burn1155](
            constants.ZERO_ADDRESS,
            TOKEN_SUPPLY_ID,
            constants.QTY_10
          )
        ).to.be.revertedWith(revertReasons.BURN_ZERO_ADDRESS_1155);
      });

      it('[mintBatch] Should do batch minting of tokens', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        const tokenIds = [BN(123), BN(456), BN(789)];
        const quantities = [
          BN(constants.QTY_10),
          BN(constants.QTY_15),
          BN(constants.QTY_20),
        ];
        const tx = await contractVoucherSets.mintBatch(
          users.seller.address,
          tokenIds,
          quantities,
          ethers.utils.formatBytes32String('0x0')
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.TRANSFER_BATCH,
          (ev) => {
            assert.equal(
              ev.operator,
              users.deployer.address,
              'ev.operator not as expected!'
            );
            assert.equal(
              ev.from,
              constants.ZERO_ADDRESS,
              'ev.from not as expected!'
            );
            assert.equal(ev.to, users.seller.address, 'ev.to not as expected!');
            assert.equal(
              ev.ids.toString(),
              tokenIds.toString(),
              'ev.ids not as expected!'
            );
            assert.equal(
              JSON.stringify(ev[ev.length - 1]), //for some reason, "values" is not available in the event objec by that name
              JSON.stringify(quantities),
              'ev.values not as expected!'
            );
          }
        );

        const balanceOfToken1 = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](users.seller.address, tokenIds[0]);

        const balanceOfToken2 = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](users.seller.address, tokenIds[1]);

        const balanceOfToken3 = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](users.seller.address, tokenIds[2]);

        assert.equal(balanceOfToken1.toString(), quantities[0].toString());
        assert.equal(balanceOfToken2.toString(), quantities[1].toString());
        assert.equal(balanceOfToken3.toString(), quantities[2].toString());
      });

      it('[mintBatch] Should do batch minting of tokens to ERC1155 supporting contract', async () => {
        const erc1155supportingContract = contractMockERC1155Receiver;

        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        const tokenIds = [BN(123)];
        const quantities = [BN(constants.QTY_10)];
        const tx = await contractVoucherSets.mintBatch(
          erc1155supportingContract.address,
          tokenIds,
          quantities,
          ethers.utils.formatBytes32String('0x0')
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.TRANSFER_BATCH,
          (ev) => {
            assert.equal(
              ev.operator,
              users.deployer.address,
              'ev.operator not as expected!'
            );
            assert.equal(
              ev.from,
              constants.ZERO_ADDRESS,
              'ev.from not as expected!'
            );
            assert.equal(
              ev.to,
              erc1155supportingContract.address,
              'ev.to not as expected!'
            );
            assert.equal(
              ev.ids.toString(),
              tokenIds.toString(),
              'ev.ids not as expected!'
            );
            assert.equal(
              JSON.stringify(ev[ev.length - 1]), //for some reason, "values" is not available in the event objec by that name
              JSON.stringify(quantities),
              'ev.values not as expected!'
            );
          }
        );

        const balanceOfToken1 = await contractVoucherSets.functions[
          fnSignatures.balanceOf1155
        ](erc1155supportingContract.address, tokenIds[0]);

        assert.equal(balanceOfToken1.toString(), quantities[0].toString());
      });

      it('[NEGATIVE][mintBatch] Should revert when to is a contract that cannot receive it', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        await expect(
          contractVoucherSets.mintBatch(
            contractCashier.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            ethers.utils.formatBytes32String('0x0')
          )
        ).to.be.revertedWith(revertReasons.NON_ERC1155RECEIVER);
      });

      it('[NEGATIVE][mintBatch] Should revert when _account is a zero address', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        await expect(
          contractVoucherSets.mintBatch(
            constants.ZERO_ADDRESS,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            ethers.utils.formatBytes32String('0x0')
          )
        ).to.be.revertedWith(revertReasons.MINT_ZERO_ADDRESS_1155);
      });

      it('[NEGATIVE][mintBatch] Should revert if array lengths mismatch', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        await expect(
          contractVoucherSets.mintBatch(
            users.seller.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10, constants.QTY_1],
            ethers.utils.formatBytes32String('0x0')
          )
        ).to.be.revertedWith(revertReasons.MISMATCHED_ARRAY_LENGTHS_1155);
      });

      it('[burnBatch] Should do batch minting of tokens', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        const tokenIds = TOKEN_SUPPLY_ID;
        const tx = await contractVoucherSets.burnBatch(
          users.seller.address,
          [tokenIds],
          [constants.QTY_10]
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherSets_Factory,
          eventNames.TRANSFER_BATCH,
          (ev) => {
            assert.equal(
              ev.operator,
              users.deployer.address,
              'ev.operator not as expected!'
            );
            assert.equal(
              ev.to,
              constants.ZERO_ADDRESS,
              'ev.to not as expected!'
            );
            assert.equal(
              ev.from,
              users.seller.address,
              'ev.from not as expected!'
            );
            assert.equal(
              ev.ids.toString(),
              tokenIds.toString(),
              'ev.ids not as expected!'
            );
            assert.equal(
              ev[ev.length - 1].toString(),
              constants.QTY_10.toString(),
              'ev.values not as expected!'
            );
          }
        );
      });

      it('[NEGATIVE][burnBatch] Should revert when _account is a zero address', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        await expect(
          contractVoucherSets.burnBatch(
            constants.ZERO_ADDRESS,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10]
          )
        ).to.be.revertedWith(revertReasons.BURN_ZERO_ADDRESS_1155);
      });

      it('[NEGATIVE][burnBatch] Should revert if array lengths mismatch', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVoucherSets.pause();
        await contractVoucherSets.setVoucherKernelAddress(
          users.deployer.address
        );
        await contractVoucherSets.unpause();

        await expect(
          contractVoucherSets.burnBatch(
            users.seller.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10, constants.QTY_1]
          )
        ).to.be.revertedWith(revertReasons.MISMATCHED_ARRAY_LENGTHS_1155);
      });
    });

    describe('Metadata', () => {
      const metadataUri = ' https://token-cdn-domain-new/{id}.json';

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

        await contractVoucherSets.setUri(metadataUri);
      });

      it('[uri] Should return correct url for voucher set', async () => {
        const url = await contractVoucherSets.uri(TOKEN_SUPPLY_ID);
        assert.equal(url, metadataUri);
      });

      it('[NEGATIVE][setUri] Should revert if attacker tries to set uri', async () => {
        const attackerInstance = contractVoucherSets.connect(
          users.attacker.signer
        );

        await expect(attackerInstance.setUri(metadataUri)).to.be.revertedWith(
          revertReasons.UNAUTHORIZED_OWNER
        );
      });
    });

    describe('Contract Metadata', () => {
      const newMetadataUri =
        'https://metadata-url.com/vouchersets/contract.json';

      beforeEach(async () => {
        await deployContracts();
      });

      it('[NEGATIVE][setContractUri] Should revert if attacker tries to set contract URI', async () => {
        const attackerInstance = contractVoucherSets.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance.setContractUri(newMetadataUri)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
      });

      it('[NEGATIVE][setContractUri] Should revert if contract URI is empty', async () => {
        await expect(contractVoucherSets.setContractUri('')).to.be.revertedWith(
          revertReasons.INVALID_VALUE
        );
      });

      it('[setContractUri] should be able to set contract URI', async () => {
        const tx = await contractVoucherSets.setContractUri(newMetadataUri);

        const txReceipt = await tx.wait();
        eventUtils.assertEventEmitted(
          txReceipt,
          Vouchers_Factory,
          eventNames.LOG_CONTRACT_URI_SET,
          (ev) => {
            assert.equal(
              ev._contractUri,
              newMetadataUri,
              'ev._contractUri not as expected!'
            );
            assert.equal(
              ev._triggeredBy,
              users.deployer.address,
              'ev._triggeredBy not as expected!'
            );
          }
        );

        const contractURI = await contractVoucherSets.contractURI();
        assert.equal(contractURI, newMetadataUri);
      });
    });
  });
});
