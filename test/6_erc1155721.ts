import { ethers } from "hardhat";
import { Signer, ContractFactory, Contract } from "ethers";

import {assert, expect} from 'chai'

import constants from '../testHelpers/constants'

import Users from '../testHelpers/users'
import Utils from'../testHelpers/utils'
import UtilsBuilder from '../testHelpers/utilsBuilder'


let ERC1155ERC721: ContractFactory;
let VoucherKernel: ContractFactory;
let Cashier: ContractFactory;
let BosonRouter: ContractFactory;
let MockERC20Permit: ContractFactory;
let FundLimitsOracle: ContractFactory;

import revertReasons from '../testHelpers/revertReasons'
import * as  eventUtils from '../testHelpers/events';
const eventNames = eventUtils.eventNames;
import fnSignatures from '../testHelpers/functionSignatures';

let utils: Utils;

let TOKEN_SUPPLY_ID;
let users;

describe('ERC1155ERC721', () => {
  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
    VoucherKernel = await ethers.getContractFactory('VoucherKernel');
    Cashier = await ethers.getContractFactory('Cashier');
    BosonRouter = await ethers.getContractFactory('BosonRouter');
    FundLimitsOracle = await ethers.getContractFactory('FundLimitsOracle');
    MockERC20Permit = await ethers.getContractFactory('MockERC20Permit');
  });

  let contractERC1155ERC721: Contract,
    contractVoucherKernel: Contract,
    contractCashier: Contract,
    contractBosonRouter: Contract,
    contractBSNTokenPrice: Contract,
    contractBSNTokenDeposit: Contract,
    contractFundLimitsOracle: Contract;

  let timestamp;

  async function deployContracts() {
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

    contractBSNTokenDeposit = await MockERC20Permit.deploy(
      'BosonTokenDeposit',
      'BDEP'
    );

    await contractFundLimitsOracle.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();

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

    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenPrice.address,
      constants.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setTokenLimit(
      contractBSNTokenDeposit.address,
      constants.TOKEN_LIMIT
    );
    await contractFundLimitsOracle.setETHLimit(constants.ETHER_LIMIT);
  }

  describe('Multi-token contract', function () {
    describe('Common', () => {
      before(async () => {
        await deployContracts();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        timestamp = await Utils.getCurrTimestamp();
      });

      it('Should have correct name on deploy', async () => {
        const expectedName = 'Boson Smart Voucher';
        const actual = await contractERC1155ERC721.name();

        assert.equal(actual, expectedName, 'name not set correctly!');
      });

      it('Should have correct symbol on deploy', async () => {
        const expectedSymbol = 'BSV';

        const actual = await contractERC1155ERC721.symbol();

        assert.equal(actual, expectedSymbol, 'symbol not set correctly!');
      });

      it('[NEGATIVE][setApprovalForAll] Should revert if tries to set self as an operator', async () => {
        await expect(
          contractERC1155ERC721.setApprovalForAll(
            users.deployer.address,
            'true'
          )
        ).to.be.revertedWith(revertReasons.REDUNDANT_CALL);
      });

      it('[setApprovalForAll] Should emit ApprovalForAll', async () => {
        const tx = await contractERC1155ERC721.setApprovalForAll(
          contractVoucherKernel.address,
          'true'
        );

        const txReceipt = await tx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          contractERC1155ERC721,
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

      it('Should emit TransferSingle event', async () => {
        const txFillOrder = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10,
          true
        );

        eventUtils.assertEventEmitted(
          txFillOrder,
          contractERC1155ERC721,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.equal(
              ev._operator,
              contractVoucherKernel.address,
              '_operator not expected!'
            );
            assert.equal(
              ev._from,
              constants.ZERO_ADDRESS,
              '_from not expected!'
            );
            assert.equal(ev._to, users.seller.address, '_to not expected!');
            assert.equal(
              ev._value.toString(),
              constants.QTY_10,
              '_value not expected!'
            );
            TOKEN_SUPPLY_ID = ev._id.toString();
          }
        );
      });

      it('Should emit TransferSingle (burn 1155) && Transfer(mint 721)', async () => {
        const commitTx = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          true
        );

        eventUtils.assertEventEmitted(
          commitTx,
          contractERC1155ERC721,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.equal(
              ev._operator,
              contractVoucherKernel.address,
              '_operator not expected!'
            );
            assert.equal(ev._from, users.seller.address, '_from not expected!');
            assert.equal(ev._to, constants.ZERO_ADDRESS, '_to not expected!');
            assert.equal(
              ev._value.toString(),
              constants.QTY_1,
              '_value not expected!'
            );
            return true;
          }
        );

        eventUtils.assertEventEmitted(
          commitTx,
          contractERC1155ERC721,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(
              ev._from,
              constants.ZERO_ADDRESS,
              '_from not expected!'
            );
            assert.equal(ev._to, users.buyer.address, '_to not expected!');
            return true;
          }
        );
      });

      it('Owner should approve transfer of erc721', async () => {
        const token721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
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
          contractERC1155ERC721,
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
      });

      it('[NEGATIVE] Attacker should not approve transfer of erc721 that does not possess', async () => {
        const token721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        const attackerInstance = contractERC1155ERC721.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance.approve(users.other1.address, token721)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_APPROVAL);
      });

      it('[NEGATIVE] Should revert if buyer tries to approve to self', async () => {
        const token721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        const attackerInstance = contractERC1155ERC721.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance.approve(users.buyer.address, token721)
        ).to.be.revertedWith(revertReasons.REDUNDANT_CALL);
      });
    });

    describe('Negative 1155 Transfers', () => {
      beforeEach(async () => {
        await deployContracts();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        timestamp = await Utils.getCurrTimestamp();

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('Attacker should not be able to transfer', async () => {
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

      it('Seller should not transfer to ZERO address', async () => {
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

      it('Seller should not transfer to contract address', async () => {
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

      it('Should not be able to transfer batch to ZERO address', async () => {
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

      it('Should revert if array lengths mismatch', async () => {
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

      it('Seller should not transfer batch to contract address', async () => {
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

      it('Should revert if attacker tries to transfer batch', async () => {
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

      it('Should revert if balanceOfBatch has been provided with mismatched lengths', async () => {
        await expect(
          contractERC1155ERC721.balanceOfBatch(
            [users.seller.address],
            [TOKEN_SUPPLY_ID, 2]
          )
        ).to.be.revertedWith(revertReasons.MISMATCHED_ARRAY_LENGTHS);
      });
    });

    describe('Negative 721 Transfers', () => {
      beforeEach(async () => {
        await deployContracts();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        timestamp = await Utils.getCurrTimestamp();

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('[ownerOf] should revert if incorrectId id provided', async () => {
        const sellerInstance = contractERC1155ERC721.connect(
          users.seller.signer
        );
        await expect(sellerInstance.ownerOf(1)).to.be.revertedWith(
          revertReasons.UNDEFINED_OWNER
        );
      });

      it('[balanceOf] should revert if ZERO address is provided', async () => {
        const balanceOf =
          contractERC1155ERC721.functions[fnSignatures.balanceOf721];

        await expect(balanceOf(constants.ZERO_ADDRESS)).to.be.revertedWith(
          revertReasons.UNSPECIFIED_ADDRESS
        );
      });

      it('Should not be able to transfer to contract address', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
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

      it('Attacker should not be able to transfer erc721', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
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

      it('Should not be able to transfer erc721 to ZERO address', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
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

      it('Should not be able to transfer erc721 if address from is not authorized', async () => {
        const erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
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
    });

    describe('Metadata', () => {
      let erc721;
      const metadataBase = 'https://localhost:3000/';
      const metadata1155Route = 'voucher-sets/';
      const metadata721Route = 'vouchers/';

      before(async () => {
        await deployContracts();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        timestamp = await Utils.getCurrTimestamp();

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10
        );

        erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await contractERC1155ERC721._setMetadataBase(metadataBase);
        await contractERC1155ERC721._set1155Route(metadata1155Route);
        await contractERC1155ERC721._set721Route(metadata721Route);
      });

      it('Should return correct url for erc1155', async () => {
        const url = await contractERC1155ERC721.uri(TOKEN_SUPPLY_ID);
        assert.equal(url, metadataBase + metadata1155Route + TOKEN_SUPPLY_ID);
      });

      it('Should return correct url for erc721', async () => {
        const url = await contractERC1155ERC721.tokenURI(erc721);

        assert.equal(url, metadataBase + metadata721Route + erc721);
      });

      it('[NEGATIVE][tokenURI] Should revert if incorrect id is provided', async () => {
        await expect(
          contractERC1155ERC721.tokenURI(constants.ZERO_ADDRESS)
        ).to.be.revertedWith(revertReasons.INVALID_ID);
      });

      it('[NEGATIVE] Should revert if attacker tries to set metadataBase', async () => {
        const attackerInstance = contractERC1155ERC721.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance._setMetadataBase(metadataBase)
        ).to.be.revertedWith(revertReasons.NOT_OWNER);
      });

      it('[NEGATIVE] Should revert if attacker tries to set metadata1155Route', async () => {
        const attackerInstance = contractERC1155ERC721.connect(
          users.attacker.signer
        );
        await expect(
          attackerInstance._set1155Route(metadata1155Route)
        ).to.be.revertedWith(revertReasons.NOT_OWNER);
      });

      it('[NEGATIVE] Should revert if attacker tries to set metadata721Route', async () => {
        const attackerInstance = contractERC1155ERC721.connect(
          users.attacker.signer
        );

        await expect(
          attackerInstance._set721Route(metadata721Route)
        ).to.be.revertedWith(revertReasons.NOT_OWNER);
      });
    });
  });
});
