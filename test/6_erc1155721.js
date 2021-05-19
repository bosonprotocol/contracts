const {assert} = require('chai');
const truffleAssert = require('truffle-assertions');

const constants = require('../testHelpers/constants');
const Users = require('../testHelpers/users');
const UtilsBuilder = require('../testHelpers/utilsBuilder');
const Utils = require('../testHelpers/utils');

const ERC1155ERC721 = artifacts.require('ERC1155ERC721');
const VoucherKernel = artifacts.require('VoucherKernel');
const Cashier = artifacts.require('Cashier');
const BosonRouter = artifacts.require('BosonRouter');
const MockERC20Permit = artifacts.require('MockERC20Permit');
const FundLimitsOracle = artifacts.require('FundLimitsOracle');

let utils;

let TOKEN_SUPPLY_ID;

contract('ERC1155ERC721', async (addresses) => {
  const users = new Users(addresses);

  let contractERC1155ERC721,
    contractVoucherKernel,
    contractCashier,
    contractBosonRouter,
    contractBSNTokenPrice,
    contractBSNTokenDeposit,
    contractFundLimitsOracle;

  let timestamp;

  async function deployContracts() {
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
    contractBSNTokenDeposit = await MockERC20Permit.new(
      'BosonTokenDeposit',
      'BDEP'
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

    await contractVoucherKernel.setComplainPeriod(60); //60 seconds
    await contractVoucherKernel.setCancelFaultPeriod(60); //60 seconds

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
    describe('Common', async () => {
      before(async () => {
        await deployContracts();

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
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
        await truffleAssert.reverts(
          contractERC1155ERC721.setApprovalForAll(
            users.deployer.address,
            'true'
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[setApprovalForAll] Should emit ApprovalForAll', async () => {
        const tx = await contractERC1155ERC721.setApprovalForAll(
          contractVoucherKernel.address,
          'true'
        );

        truffleAssert.eventEmitted(tx, 'ApprovalForAll', (ev) => {
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
          return true;
        });
      });

      it('Should emit TransferSingle event', async () => {
        let txFillOrder = await utils.createOrder(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10,
          true
        );

        let internalTx = await truffleAssert.createTransactionResult(
          contractERC1155ERC721,
          txFillOrder.tx
        );

        truffleAssert.eventEmitted(internalTx, 'TransferSingle', (ev) => {
          assert.equal(
            ev._operator,
            contractVoucherKernel.address,
            '_operator not expected!'
          );
          assert.equal(ev._from, constants.ZERO_ADDRESS, '_from not expected!');
          assert.equal(ev._to, users.seller.address, '_to not expected!');
          assert.equal(
            ev._value.toString(),
            constants.QTY_10,
            '_value not expected!'
          );
          TOKEN_SUPPLY_ID = ev._id.toString();
          return true;
        });
      });

      it('Should emit TransferSingle (burn 1155) && Transfer(mint 721)', async () => {
        let commitTx = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID,
          true
        );

        let internalTx = await truffleAssert.createTransactionResult(
          contractERC1155ERC721,
          commitTx.tx
        );

        truffleAssert.eventEmitted(internalTx, 'TransferSingle', (ev) => {
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
        });

        truffleAssert.eventEmitted(internalTx, 'Transfer', (ev) => {
          assert.equal(ev._from, constants.ZERO_ADDRESS, '_from not expected!');
          assert.equal(ev._to, users.buyer.address, '_to not expected!');
          return true;
        });
      });

      it('Owner should approve transfer of erc721', async () => {
        const token721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        const tx = await contractERC1155ERC721.approve(
          users.other1.address,
          token721,
          {from: users.buyer.address}
        );

        truffleAssert.eventEmitted(tx, 'Approval', (ev) => {
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

          return true;
        });
      });

      it('[NEGATIVE] Attacker should not approve transfer of erc721 that does not possess', async () => {
        const token721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await truffleAssert.reverts(
          contractERC1155ERC721.approve(users.other1.address, token721, {
            from: users.attacker.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Should revert if buyer tries to approve to self', async () => {
        const token721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await truffleAssert.reverts(
          contractERC1155ERC721.approve(users.buyer.address, token721, {
            from: users.buyer.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('Negative 1155 Transfers', async () => {
      beforeEach(async () => {
        await deployContracts();

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
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
        await truffleAssert.reverts(
          utils.safeTransfer1155(
            users.seller.address,
            users.other1.address,
            TOKEN_SUPPLY_ID,
            constants.QTY_10,
            {from: users.attacker.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Seller should not transfer to ZERO address', async () => {
        await truffleAssert.reverts(
          utils.safeTransfer1155(
            users.seller.address,
            constants.ZERO_ADDRESS,
            TOKEN_SUPPLY_ID,
            constants.QTY_10,
            {from: users.seller.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Seller should not transfer to contract address', async () => {
        await truffleAssert.reverts(
          utils.safeTransfer1155(
            users.seller.address,
            contractCashier.address,
            TOKEN_SUPPLY_ID,
            constants.QTY_10,
            {from: users.seller.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Should not be able to transfer batch to ZERO address', async () => {
        await truffleAssert.reverts(
          utils.safeBatchTransfer1155(
            users.seller.address,
            constants.ZERO_ADDRESS,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            {from: users.seller.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Should revert if array lengths mismatch', async () => {
        await truffleAssert.reverts(
          utils.safeBatchTransfer1155(
            users.seller.address,
            users.other1.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10, 2],
            {from: users.seller.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Seller should not transfer batch to contract address', async () => {
        await truffleAssert.reverts(
          utils.safeBatchTransfer1155(
            users.seller.address,
            contractCashier.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            {from: users.seller.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Should revert if attacker tries to transfer batch', async () => {
        await truffleAssert.reverts(
          utils.safeBatchTransfer1155(
            users.seller.address,
            users.other1.address,
            [TOKEN_SUPPLY_ID],
            [constants.QTY_10],
            {from: users.attacker.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Should revert if balanceOfBatch has been provided with mismatched lengths', async () => {
        await truffleAssert.reverts(
          contractERC1155ERC721.balanceOfBatch(
            [users.seller.address],
            [TOKEN_SUPPLY_ID, 2]
          ),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('Negative 721 Transfers', async () => {
      beforeEach(async () => {
        await deployContracts();

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
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
        await truffleAssert.reverts(
          contractERC1155ERC721.ownerOf(1, {from: users.seller.address}),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[balanceOf] should revert if ZERO address is provided', async () => {
        const methodSignature = 'balanceOf(' + 'address)';
        const balanceOf = contractERC1155ERC721.methods[methodSignature];

        await truffleAssert.reverts(
          balanceOf(constants.ZERO_ADDRESS),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Should not be able to transfer to contract address', async () => {
        let erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await truffleAssert.reverts(
          utils.safeTransfer721(
            users.buyer.address,
            contractCashier.address,
            erc721,
            {
              from: users.buyer.address,
            }
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Attacker should not be able to transfer erc721', async () => {
        let erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await truffleAssert.reverts(
          utils.safeTransfer721(
            users.buyer.address,
            users.other1.address,
            erc721,
            {
              from: users.attacker.address,
            }
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Should not be able to transfer erc721 to ZERO address', async () => {
        let erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await truffleAssert.reverts(
          utils.safeTransfer721(
            users.buyer.address,
            constants.ZERO_ADDRESS,
            erc721,
            {
              from: users.buyer.address,
            }
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Should not be able to transfer erc721 if address from is not authorized', async () => {
        let erc721 = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await truffleAssert.reverts(
          utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            erc721,
            {
              from: users.buyer.address,
            }
          ),
          truffleAssert.ErrorType.REVERT
        );
      });
    });

    describe('Metadata', async () => {
      let erc721;
      const metadataBase = 'https://localhost:3000/';
      const metadata1155Route = 'voucher-sets/';
      const metadata721Route = 'vouchers/';

      before(async () => {
        await deployContracts();

        utils = UtilsBuilder.create()
          .ETHETH()
          .build(
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
        let url = await contractERC1155ERC721.uri(TOKEN_SUPPLY_ID);
        assert.equal(url, metadataBase + metadata1155Route + TOKEN_SUPPLY_ID);
      });

      it('Should return correct url for erc721', async () => {
        let url = await contractERC1155ERC721.tokenURI(erc721);

        assert.equal(url, metadataBase + metadata721Route + erc721);
      });

      it('[NEGATIVE][tokenURI] Should revert if incorrect id is provided', async () => {
        await truffleAssert.reverts(
          contractERC1155ERC721.tokenURI(constants.ZERO_ADDRESS),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Should revert if attacker tries to set metadataBase', async () => {
        await truffleAssert.reverts(
          contractERC1155ERC721._setMetadataBase(metadataBase, {
            from: users.attacker.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Should revert if attacker tries to set metadata1155Route', async () => {
        await truffleAssert.reverts(
          contractERC1155ERC721._set1155Route(metadata1155Route, {
            from: users.attacker.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('[NEGATIVE] Should revert if attacker tries to set metadata721Route', async () => {
        await truffleAssert.reverts(
          contractERC1155ERC721._set721Route(metadata721Route, {
            from: users.attacker.address,
          }),
          truffleAssert.ErrorType.REVERT
        );
      });
    });
  });
});
