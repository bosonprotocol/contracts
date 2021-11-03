import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';
import {assert, expect} from 'chai';
import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';
import {waffle} from 'hardhat';
import ERC721receiver from '../artifacts/contracts/mocks/MockERC721Receiver.sol/MockERC721Receiver.json';
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

describe('Vouchers', () => {
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

  describe('Vouchers contract', function () {
    describe('General', () => {
      beforeEach(async () => {
        await deployContracts();
        utils = await prepareUtils();
      });

      it('[setVoucherKernelAddress] Should set setVoucherKernelAddress to valid address', async () => {
        const expectedVoucherKernelAddress = users.other1.address;
        await contractVouchers.pause();
        const tx = await contractVouchers.setVoucherKernelAddress(
          expectedVoucherKernelAddress
        );

        const txReceipt = await tx.wait();
        eventUtils.assertEventEmitted(
          txReceipt,
          Vouchers_Factory,
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
          await contractVouchers.getVoucherKernelAddress();
        assert.equal(voucherKernelAddress, expectedVoucherKernelAddress);
      });

      it('[NEGATIVE][setVoucherKernelAddress] Should revert for zero address', async () => {
        await expect(
          contractVouchers.setVoucherKernelAddress(constants.ZERO_ADDRESS)
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
      });

      it('[NEGATIVE][deploy Vouchers] Should revert if ZERO address is provided at deployment for Cashier address', async () => {
        await expect(
          Vouchers_Factory.deploy(
            'https://token-cdn-domain/orders/metadata/',
            'Boson Smart Voucher',
            'BSV',
            constants.ZERO_ADDRESS,
            contractVoucherKernel.address
          )
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
      });

      it('[NEGATIVE][deploy Vouchers] Should revert if ZERO address is provided at deployment for Voucher Kernel address', async () => {
        await expect(
          Vouchers_Factory.deploy(
            'https://token-cdn-domain/orders/metadata/',
            'Boson Smart Voucher',
            'BSV',
            contractCashier.address,
            constants.ZERO_ADDRESS
          )
        ).to.be.revertedWith(revertReasons.ZERO_ADDRESS);
      });

      describe('[supportsInterface]', () => {
        it('Should return True for supported _interfaceId', async () => {
          const supportedInterfaceIds = [
            '0x01ffc9a7',
            '0x80ac58cd',
            '0x5b5e139f',
          ];

          const randomInterfaceId =
            supportedInterfaceIds[
              Math.floor(Math.random() * supportedInterfaceIds.length)
            ];

          assert.isTrue(
            await contractVouchers.supportsInterface(randomInterfaceId)
          );
        });

        it('Should return False for un-supported _interfaceId', async () => {
          const unSupportedInterfaceId = '0x150b7a02';

          assert.isFalse(
            await contractVouchers.supportsInterface(unSupportedInterfaceId)
          );
        });
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

      it('[setApprovalForAll] Should emit ApprovalForAll', async () => {
        const tx = await contractVouchers.setApprovalForAll(
          contractVoucherKernel.address,
          true
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Vouchers_Factory,
          eventNames.APPROVAL_FOR_ALL,
          (ev) => {
            assert.equal(
              ev.owner,
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
          contractVouchers.setApprovalForAll(users.deployer.address, true)
        ).to.be.revertedWith(revertReasons.APPROVE_TO_CALLER_721);
      });

      it('[isApprovedForAll] Should return the approval status of an operator for a given account', async () => {
        const expectedApprovalStatus = true;
        await contractVouchers.setApprovalForAll(
          contractVoucherKernel.address,
          expectedApprovalStatus
        );

        assert.isTrue(
          await contractVouchers.isApprovedForAll(
            users.deployer.address,
            contractVoucherKernel.address
          )
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

        const owner721Instance = contractVouchers.connect(users.buyer.signer);
        const tx = await owner721Instance.approve(
          users.other1.address,
          token721
        );
        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Vouchers_Factory,
          eventNames.APPROVAL,
          (ev) => {
            assert.equal(
              ev.owner,
              users.buyer.address,
              'Owner not as expected!'
            );
            assert.equal(
              ev.approved,
              users.other1.address,
              'Approved not as expected!'
            );
            assert.equal(
              ev.tokenId.toString(),
              token721.toString(),
              'tokenId not as expected!'
            );
          }
        );

        const approvedAddress = await contractVouchers.getApproved(token721);
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

        const attackerInstance = contractVouchers.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance.approve(users.other1.address, token721)
        ).to.be.revertedWith(revertReasons.UNATHORIZED_APPROVE_721);
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
          contractVouchers.approve(users.buyer.address, token721)
        ).to.be.revertedWith(revertReasons.APPROVAL_TO_CURRENT_OWNER_721);
      });

      it('[ownerOf] should return the token owner address for valid token', async () => {
        const expectedOwner = users.buyer.address;
        const tokenIdsForMint = 123;

        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVouchers.pause();
        await contractVouchers.setVoucherKernelAddress(users.deployer.address);
        await contractVouchers.unpause();

        await contractVouchers.functions[fnSignatures.mint721](
          expectedOwner,
          tokenIdsForMint
        );

        const tokenOwner = await contractVouchers.ownerOf(tokenIdsForMint);

        assert.equal(tokenOwner, expectedOwner);
      });

      it('[NEGATIVE][ownerOf] should revert if incorrect id provided', async () => {
        const sellerInstance = contractVouchers.connect(users.seller.signer);
        await expect(sellerInstance.ownerOf(1)).to.be.revertedWith(
          revertReasons.OWNER_QUERY_NONEXISTENT_ID_721
        );
      });

      describe('[balanceOf] should count all NFTs assigned to an owner', async () => {
        it('[balanceOf] returns 4 when 4 NFTs are assigned to owner', async () => {
          // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
          await contractVouchers.pause();
          await contractVouchers.setVoucherKernelAddress(
            users.deployer.address
          );
          await contractVouchers.unpause();

          const tokenIdsForMint = [10, 20, 30, 40];

          for (const idForMint of tokenIdsForMint) {
            await contractVouchers.functions[fnSignatures.mint721](
              users.other1.address,
              idForMint
            );
          }

          const expectedCount = tokenIdsForMint.length;
          const balanceOfOwner = await contractVouchers.functions[
            fnSignatures.balanceOf721
          ](users.other1.address);

          assert.equal(balanceOfOwner.toString(), expectedCount.toString());
        });

        it('[balanceOf] returns 0 when no NFTs are assigned to owner', async () => {
          const expectedCount = 0;

          const balanceOfBuyer = await contractVouchers.functions[
            fnSignatures.balanceOf721
          ](users.buyer.address);

          assert.equal(balanceOfBuyer.toString(), expectedCount.toString());
        });
      });

      it('[NEGATIVE][balanceOf] should revert if ZERO address is provided', async () => {
        const balanceOf = contractVouchers.functions[fnSignatures.balanceOf721];

        await expect(balanceOf(constants.ZERO_ADDRESS)).to.be.revertedWith(
          revertReasons.BALANCE_OF_ZERO_ADDRESS_721
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
          Vouchers_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(ev.from, oldOwner.address, 'ev.from not as expected!');
            assert.equal(ev.to, users.other2.address, 'ev.to not as expected!');
            assert.equal(
              ev.tokenId.toString(),
              erc721.toString(),
              'ev.tokenId not as expected!'
            );
          }
        );

        const newTokenOwner = await contractVouchers.ownerOf(erc721);

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
          Vouchers_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(ev.from, oldOwner.address, 'ev.from not as expected!');
            assert.equal(ev.to, users.other2.address, 'ev.to not as expected!');
            assert.equal(
              ev.tokenId.toString(),
              erc721.toString(),
              'ev_tokenId not as expected!'
            );
          }
        );

        const newTokenOwner = await contractVouchers.ownerOf(erc721);

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
          Vouchers_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(ev.from, oldOwner.address, 'ev.from not as expected!');
            assert.equal(
              ev.to,
              expectedNewOwnerAddress,
              'ev.to not as expected!'
            );
            assert.equal(
              ev.tokenId.toString(),
              erc721.toString(),
              'ev.tokenId not as expected!'
            );
          }
        );

        const newTokenOwner = await contractVouchers.ownerOf(erc721);

        assert.equal(newTokenOwner, expectedNewOwnerAddress);
      });

      it('[NEGATIVE][safeTransfer721] Should not be able to transfer to contract address that does not implement onERC721Received', async () => {
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
        ).to.be.revertedWith(revertReasons.NON_ERC721RECEIVER);
      });

      it('[NEGATIVE][safeTransfer721] Should not be able to transfer to contract address that does not support ERC721 for some other reason', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        const mockERC721Receiver = await deployMockContract(
          users.deployer.signer,
          ERC721receiver.abi
        ); //deploys mock

        await mockERC721Receiver.mock.onERC721Received.returns(0xd9b67a26); //0xd9b67a26 = ERC-1155 interface

        await expect(
          utils.safeTransfer721(
            users.buyer.address,
            mockERC721Receiver.address,
            erc721,
            users.buyer.signer
          )
        ).to.be.revertedWith(revertReasons.NON_ERC721RECEIVER);
      });

      it('[NEGATIVE][safeTransfer721] it should revert if sent to contract that reverts with arbitrary revert reason', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          constants.product_price,
          constants.buyer_deposit
        );

        const mockERC721Receiver = await deployMockContract(
          users.deployer.signer,
          ERC721receiver.abi
        ); //deploys mock

        const arbitraryRevertReason = 'arbitrary revert reason';

        await mockERC721Receiver.mock.onERC721Received.revertsWithReason(
          arbitraryRevertReason
        );

        await expect(
          utils.safeTransfer721(
            users.buyer.address,
            mockERC721Receiver.address,
            erc721,
            users.buyer.signer
          )
        ).to.be.revertedWith(arbitraryRevertReason);
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
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_721);
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
        ).to.be.revertedWith(revertReasons.TRANSFER_ZERO_ADDRESS_721);
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
          Vouchers_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(ev.from, oldOwner.address, 'ev.from not as expected!');
            assert.equal(ev.to, users.other2.address, 'ev.to not as expected!');
            assert.equal(
              ev.tokenId.toString(),
              erc721.toString(),
              'ev.tokenId not as expected!'
            );
          }
        );

        const newTokenOwner = await contractVouchers.ownerOf(erc721);

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
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVouchers.pause();
        await contractVouchers.setVoucherKernelAddress(users.deployer.address);
        await contractVouchers.unpause();

        const tokenIdForMint = 123;
        await contractVouchers.functions[fnSignatures.mint721](
          users.deployer.address,
          tokenIdForMint
        );

        const approvedAddress = await contractVouchers.getApproved(
          tokenIdForMint
        );
        assert.equal(approvedAddress, constants.ZERO_ADDRESS);
      });

      it('[getApproved] Should return the approved address for a token ID', async () => {
        const expectedApprovedAddress = users.other1.address;

        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVouchers.pause();
        await contractVouchers.setVoucherKernelAddress(users.deployer.address);
        await contractVouchers.unpause();

        const tokenIdForMint = 123;
        await contractVouchers.functions[fnSignatures.mint721](
          users.deployer.address,
          tokenIdForMint
        );

        await contractVouchers.approve(expectedApprovedAddress, tokenIdForMint);
        const approvedAddress = await contractVouchers.getApproved(
          tokenIdForMint
        );
        assert.equal(approvedAddress, expectedApprovedAddress);
      });

      it('[NEGATIVE][getApproved] Should revert if token does not exist', async () => {
        await expect(
          contractVouchers.getApproved(constants.ONE)
        ).to.be.revertedWith(revertReasons.NONEXISTENT_TOKEN);
      });

      it('[mint] Should mint a token', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVouchers.pause();
        await contractVouchers.setVoucherKernelAddress(users.deployer.address);
        await contractVouchers.unpause();

        const tokenIdForMint = 123;
        const tx = await contractVouchers.functions[fnSignatures.mint721](
          users.other1.address,
          tokenIdForMint
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Vouchers_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(
              ev.from,
              constants.ZERO_ADDRESS,
              'ev.from not as expected!'
            );
            assert.equal(ev.to, users.other1.address, 'ev.to not as expected!');
            assert.equal(
              ev.tokenId,
              tokenIdForMint,
              'ev.tokenId not as expected!'
            );
          }
        );

        const expectedBalance = 1;
        const balanceOfBuyer = await contractVouchers.functions[
          fnSignatures.balanceOf721
        ](users.other1.address);

        assert.equal(balanceOfBuyer.toString(), expectedBalance.toString());
      });

      it('[mint] Should be able to mint a token to a contract that supports it', async () => {
        const supportingContractAddress = contractMockERC721Receiver.address;

        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVouchers.pause();
        await contractVouchers.setVoucherKernelAddress(users.deployer.address);
        await contractVouchers.unpause();

        const tokenIdForMint = 123;
        const tx = await contractVouchers.functions[fnSignatures.mint721](
          supportingContractAddress,
          tokenIdForMint
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Vouchers_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(
              ev.from,
              constants.ZERO_ADDRESS,
              'ev.from not as expected!'
            );
            assert.equal(
              ev.to,
              supportingContractAddress,
              'ev.to not as expected!'
            );
            assert.equal(
              ev.tokenId,
              tokenIdForMint,
              'ev.tokenId not as expected!'
            );
          }
        );

        const expectedBalance = 1;
        const balanceOfBuyer = await contractVouchers.functions[
          fnSignatures.balanceOf721
        ](supportingContractAddress);

        assert.equal(balanceOfBuyer.toString(), expectedBalance.toString());
      });

      it('[NEGATIVE][mint] it should not be able to mint a token to a receiver whose onERC721Received function eturns the wrong value', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVouchers.pause();
        await contractVouchers.setVoucherKernelAddress(users.deployer.address);
        await contractVouchers.unpause();

        const tokenIdForMint = 123;

        const mockERC721Receiver = await deployMockContract(
          users.deployer.signer,
          ERC721receiver.abi
        ); //deploys mock

        await mockERC721Receiver.mock.onERC721Received.returns(0xd9b67a26); //0xd9b67a26 = ERC-1155 interface

        await expect(
          contractVouchers.functions[fnSignatures.mint721](
            mockERC721Receiver.address,
            tokenIdForMint
          )
        ).to.be.revertedWith(revertReasons.NON_ERC721RECEIVER);
      });

      it('[NEGATIVE][mint] it should not be able to mint a token to a receiver that cannot receive it because it does not have onERC721Received function', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVouchers.pause();
        await contractVouchers.setVoucherKernelAddress(users.deployer.address);
        await contractVouchers.unpause();

        const tokenIdForMint = 123;
        await expect(
          contractVouchers.functions[fnSignatures.mint721](
            contractCashier.address,
            tokenIdForMint
          )
        ).to.be.revertedWith(revertReasons.NON_ERC721RECEIVER);
      });

      it('[NEGATIVE][mint] must fail: unauthorized minting ERC-721', async () => {
        await expect(
          contractVouchers.functions[fnSignatures.mint721](
            users.attacker.address,
            666
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VK);
      });

      it('[NEGATIVE][mint] Should revert when to is a zero address', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVouchers.pause();
        await contractVouchers.setVoucherKernelAddress(users.deployer.address);
        await contractVouchers.unpause();

        await expect(
          contractVouchers.functions[fnSignatures.mint721](
            constants.ZERO_ADDRESS,
            666
          )
        ).to.be.revertedWith(revertReasons.MINT_ZERO_ADDRESS_721);
      });

      it('[NEGATIVE][mint] Should not be able to mint same token twice', async () => {
        // spoofing the VoucherKernel address here because the function is being called directly instead of via the VoucherKernel contract
        await contractVouchers.pause();
        await contractVouchers.setVoucherKernelAddress(users.deployer.address);
        await contractVouchers.unpause();

        const tokenIdForMint = 123;
        await contractVouchers.functions[fnSignatures.mint721](
          users.other1.address,
          tokenIdForMint
        );

        await expect(
          contractVouchers.functions[fnSignatures.mint721](
            users.other1.address,
            tokenIdForMint
          )
        ).to.be.revertedWith(revertReasons.TOKEN_ALREADY_MINTED);
      });
    });

    describe('Metadata', () => {
      let erc721;
      const metadataUri = ' https://token-cdn-domain-new/orders/metadata/new/';

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

        await contractVouchers.setTokenURI(metadataUri);
      });

      it('[tokenURI] Should return correct url for erc721', async () => {
        const url = await contractVouchers.tokenURI(erc721);

        assert.equal(url, metadataUri + erc721);
      });

      it('[NEGATIVE][tokenURI] Should revert if incorrect id is provided', async () => {
        await expect(
          contractVouchers.tokenURI(constants.ZERO_ADDRESS)
        ).to.be.revertedWith(revertReasons.INVALID_ID);
      });

      it('[NEGATIVE][_setMetadataBase] Should revert if attacker tries to set uri', async () => {
        const attackerInstance = contractVouchers.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance.setTokenURI(metadataUri)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
      });

      it('[name] Should have correct name on deploy', async () => {
        const expectedName = 'Boson Smart Voucher';
        const actual = await contractVouchers.name();

        assert.equal(actual, expectedName, 'name not set correctly!');
      });

      it('[symbol] Should have correct symbol on deploy', async () => {
        const expectedSymbol = 'BSV';

        const actual = await contractVouchers.symbol();

        assert.equal(actual, expectedSymbol, 'symbol not set correctly!');
      });
    });

    describe('Contract Metadata', () => {
      const newMetadataUri = 'https://metadata-url.com/my-metadata';

      beforeEach(async () => {
        await deployContracts();
      });

      it('[NEGATIVE][setContractUri] Should revert if attacker tries to set contract URI', async () => {
        const attackerInstance = contractVouchers.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance.setContractUri(newMetadataUri)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
      });

      it('[NEGATIVE][setContractUri] Should revert if contract URI is empty', async () => {
        await expect(contractVouchers.setContractUri('')).to.be.revertedWith(
          revertReasons.INVALID_VALUE
        );
      });

      it('[setContractUri] should be able to set contract URI', async () => {
        const tx = await contractVouchers.setContractUri(newMetadataUri);

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

        const contractURI = await contractVouchers.contractURI();
        assert.equal(contractURI, newMetadataUri);
      });
    });
  });
});
