import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract, BigNumber} from 'ethers';
import {assert, expect} from 'chai';
import {ecsign} from 'ethereumjs-util';
import constants from '../testHelpers/constants';
import {advanceTimeSeconds} from '../testHelpers/timemachine';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';
import {toWei, getApprovalDigest} from '../testHelpers/permitUtils';
import {
  BosonRouter,
  ERC1155ERC721,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
} from '../typechain';
const {keccak256, solidityPack} = ethers.utils;

let ERC1155ERC721_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
const eventNames = eventUtils.eventNames;
import fnSignatures from '../testHelpers/functionSignatures';

const BN = ethers.BigNumber.from;

let utils: Utils;
let users;


describe('Cashier and VoucherKernel', () => {
  let promiseId: string, tokenSupplyKey: string; // todo remove string when finished

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

    await setPeriods();

    // calculate expected tokenSupplyID for first voucher
    promiseId = keccak256(
      solidityPack(
        ['address', 'uint256', 'uint256', 'uint256'],
        [
          users.seller.address,
          constants.ZERO,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
        ]
      )
    );

    // calculate expected tokenSupplyID for first voucher
    const tokenIndex = constants.ONE;
    const TYPE_NF_BIT = constants.ONE.shl(255);
    tokenSupplyKey = TYPE_NF_BIT.or(tokenIndex.shl(128)).toString();
   
    
  });

  let contractERC1155ERC721: ERC1155ERC721,
    contractVoucherKernel: VoucherKernel,
    contractCashier: Cashier,
    contractBosonRouter: BosonRouter,
    contractBSNTokenPrice: MockERC20Permit,
    contractBSNTokenDeposit: MockERC20Permit,
    contractTokenRegistry: TokenRegistry;

  let tokenVoucherKey, tokenVoucherKey1;

  const ZERO = BN(0);  // TODO: use constants.zero
  const ONE_VOUCHER = 1; // TODO: use constants.one

  const deadline = toWei(1);

  let timestamp;

  let distributedAmounts = {
    buyerAmount: BN(0),
    sellerAmount: BN(0),
    escrowAmount: BN(0),
  };

  async function setPeriods() {  // TODO use where applicable; why this async?
    const timestamp = await Utils.getCurrTimestamp();

    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;
  }

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

    await contractTokenRegistry.deployed();
    await contractERC1155ERC721.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();

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

  describe('TOKEN SUPPLY CREATION (Voucher batch creation)', () => {
    let remQty = constants.QTY_10 as number | string;
    const vouchersToBuy = 5;

    const paymentMethods = {
      ETHETH: 1,
      ETHTKN: 2,
      TKNETH: 3,
      TKNTKN: 4,
    };

    afterEach(() => { // TODO REMOVE
      remQty = constants.QTY_10;
    });

    describe.only('ETHETH', () => {
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

        // timestamp = await Utils.getCurrTimestamp();
        // constants.PROMISE_VALID_FROM = timestamp;
        // constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

        // setPeriods();

        // tokenSupplyKey = await utils.createOrder(
        //   users.seller,
        //   timestamp,
        //   timestamp + constants.SECONDS_IN_DAY,
        //   constants.seller_deposit,
        //   constants.QTY_10
        // );
      });

      it('All expected events are emitted', async () => {
          expect(await 
          utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_DEPOSITSE1,
            constants.QTY_10,
            true
          )
        ).to.emit(contractBosonRouter, eventNames.LOG_ORDER_CREATED)
        .withArgs(tokenSupplyKey, users.seller.address, constants.QTY_10, paymentMethods.ETHETH)
        .to.emit(contractVoucherKernel, eventNames.LOG_PROMISE_CREATED)
        .withArgs(
          promiseId,
          constants.ONE,
          users.seller.address,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.ZERO
        )
        .to.emit(contractERC1155ERC721, eventNames.TRANSFER_SINGLE)
        .withArgs(
          contractVoucherKernel.address,
          constants.ZERO_ADDRESS,
          users.seller.address,
          tokenSupplyKey,
          constants.QTY_10
        );
      });

      describe('Voucher Kernel state after creation', () => {

      it('Voucher Kernel state is correct', async () => {
        await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_DEPOSITSE1,
          constants.QTY_10,
          true
        )

        const promiseData = await contractVoucherKernel.getPromiseData(
          promiseId
        );
        assert.equal(
          promiseData[constants.PROMISE_DATA_FIELDS.promiseId],
          promiseId,
          'Promise Id incorrect'
        );

        assert.equal(
          promiseData[constants.PROMISE_DATA_FIELDS.nonce].toString(),
          constants.ONE.toString(),
          'Promise data field -> nonce is incorrect'
        );
        assert.equal(
          promiseData[constants.PROMISE_DATA_FIELDS.validFrom].toString(),
          constants.PROMISE_VALID_FROM.toString(),
          'Promise data field -> validFrom is incorrect'
        );

        assert.equal(
          promiseData[constants.PROMISE_DATA_FIELDS.validTo].toString(),
          constants.PROMISE_VALID_TO.toString(),
          'Promise data field -> validTo is incorrect'
        );
        assert.equal(
          promiseData[constants.PROMISE_DATA_FIELDS.idx].toString(),
          constants.ZERO.toString(),
          'Promise data field -> idx is incorrect'
        );

        const promiseSeller = await contractVoucherKernel.getSupplyHolder(
          tokenSupplyKey
        );

        assert.strictEqual(
          promiseSeller,
          users.seller.address,
          'Seller incorrect'
        );

        const promiseOrderData = await contractVoucherKernel.getOrderCosts(
          tokenSupplyKey
        );
        assert.isTrue(
          promiseOrderData[constants.PROMISE_ORDER_FIELDS.price].eq(
            BN(constants.PROMISE_PRICE1)
          ),
          'Promise produt price mismatch'
        );
        assert.isTrue(
          promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositSe].eq(
            BN(constants.PROMISE_DEPOSITSE1)
          ),
          'Promise seller deposit mismatch'
        );
        assert.isTrue(
          promiseOrderData[constants.PROMISE_ORDER_FIELDS.depositBu].eq(
            BN(constants.PROMISE_DEPOSITBU1)
          ),
          'Promise buyer deposit mismatch'
        );

        const tokenNonce = await contractVoucherKernel.getTokenNonce(
          users.seller.address
        );
        assert.isTrue(
          tokenNonce.eq(constants.ONE),
          'Voucher kernel nonce mismatch'
        );

        assert.equal(
          promiseId,
          await contractVoucherKernel.getPromiseIdFromSupplyId(tokenSupplyKey),
          'PromisId mismatch'
        );
      
    });

    it('Should create payment method ETHETH', async () => {
      const tokenSupplyKey = await utils.createOrder(
        users.seller,
        constants.PROMISE_VALID_FROM,
        constants.PROMISE_VALID_TO,
        constants.PROMISE_DEPOSITSE1,
        constants.QTY_10
      );
    
      expect(await contractVoucherKernel.getVoucherPriceToken(
        tokenSupplyKey
      )).to.equal(constants.ZERO_ADDRESS, 'ETHETH Method Price Token Address mismatch');
      

      expect(await contractVoucherKernel.getVoucherDepositToken(
        tokenSupplyKey
      )).to.equal(constants.ZERO_ADDRESS, 'ETHETH Method Deposit Token Address mismatch');
     
    });

    it('Deposit and Price address should be zero', async () => {
      const tokenSupplyKey = await utils.createOrder(
        users.seller,
        constants.PROMISE_VALID_FROM,
        constants.PROMISE_VALID_TO,
        constants.PROMISE_DEPOSITSE1,
        constants.QTY_10
      );

      expect(await contractVoucherKernel.getVoucherPriceToken(
        tokenSupplyKey
      )).to.equal(constants.ZERO_ADDRESS, 'ETHETH Method Price Token Address mismatch');
      

      expect(await contractVoucherKernel.getVoucherDepositToken(
        tokenSupplyKey
      )).to.equal(constants.ZERO_ADDRESS, 'ETHETH Method Deposit Token Address mismatch');
     
    });

  });
    it('ERC1155ERC721 state is correct', async () => {
      await utils.createOrder(
        users.seller,
        constants.PROMISE_VALID_FROM,
        constants.PROMISE_VALID_TO,
        constants.PROMISE_DEPOSITSE1,
        constants.QTY_10,
        true
      )

      const sellerERC1155ERC721Balance = (
        await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
          users.seller.address,
          tokenSupplyKey
        )
      )[0];

      assert.isTrue(
        sellerERC1155ERC721Balance.eq(constants.QTY_10),
        'ERC1155ERC721 seller balance mismatch'
      );
    
  });

      it('ESCROW has correct balance', async () => {        
        
        expect(await ethers.provider.getBalance(contractCashier.address)).to.equal(constants.ZERO, 'Cashier starting balance should be 0');

        await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.PROMISE_DEPOSITSE1,
            constants.QTY_10
          )

        const expectedBalance = BN(constants.PROMISE_DEPOSITSE1).mul(BN(constants.QTY_10));     

        expect(await ethers.provider.getBalance(contractCashier.address)).to.equal(expectedBalance,'Escrow balance is incorrect')
        expect(await contractCashier.getEscrowAmount(users.seller.address)).to.equal(expectedBalance, 'Escrow stored amount is incorrect');
      });

      it('Get correct remaining qty for supply', async () => {
        await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.PROMISE_DEPOSITSE1,
          constants.QTY_10
        )
        
        expect(await contractVoucherKernel.getRemQtyForSupply(
          tokenSupplyKey,
          users.seller.address
        )).to.equal(constants.QTY_10, 'Remaining qty is not correct')

        for (let i = 0; i < vouchersToBuy; i++) {
          await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey);
          expect(await contractVoucherKernel.getRemQtyForSupply(
            tokenSupplyKey,
            users.seller.address
          )).to.equal(constants.QTY_10-i-1, `Remaining qty is not correct [${i}]`)

        }
      });

      it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
        await expect(
          utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_FROM + constants.ONE_MINUTE,
            constants.PROMISE_DEPOSITSE1,
            constants.QTY_10
          )
        ).to.be.revertedWith(revertReasons.INVALID_VALIDITY_TO);
      });

      it.only('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
        await expect(
          utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_FROM + constants.ONE_MINUTE,
            constants.PROMISE_DEPOSITSE1,
            constants.ONE,
            true,
            constants.ABOVE_ETH_LIMIT,
            constants.PROMISE_DEPOSITBU1
          )
        ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        
      });

      it.only('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
        await expect(
          utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_FROM + constants.ONE_MINUTE,
            constants.PROMISE_DEPOSITSE1,
            constants.ONE,
            true,
            constants.PROMISE_PRICE1,
            constants.ABOVE_ETH_LIMIT
          )
        ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        
      });

      it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
        await expect(
          utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_FROM + constants.ONE_MINUTE,
            constants.ABOVE_ETH_LIMIT,
            constants.ONE,
            true,
            constants.PROMISE_PRICE1,
            constants.PROMISE_DEPOSITBU1
          )
        ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', () => {
        before(async () => {
          await deployContracts();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const tokensToMint = BN(constants.seller_deposit).mul(
            BN(constants.QTY_20)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            tokensToMint
          );

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );
        });

        it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.ONE_MINUTE,
              constants.seller_deposit,
              constants.QTY_10
            )
          ).to.be.revertedWith(revertReasons.INVALID_VALIDITY_TO);
        });

        it('Cashier has correct balance in Deposit Contract', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(
            BN(constants.QTY_10)
          );
          const escrowAmount = await contractBSNTokenDeposit.balanceOf(
            contractCashier.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('escrowTokens has correct balance', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(
            BN(constants.QTY_10)
          );
          const escrowTokens = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          );

          assert.isTrue(
            escrowTokens.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Get correct remaining qty for supply', async () => {
          let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            tokenSupplyKey,
            users.seller.address
          );
          assert.equal(
            remainingQtyInContract.toString(),
            remQty.toString(),
            'Remaining qty is not correct'
          );

          for (let i = 0; i < vouchersToBuy; i++) {
            await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey);
            remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
              tokenSupplyKey,
              users.seller.address
            );

            remQty = BN(remQty).sub(1).toString();

            assert.equal(
              remainingQtyInContract.toString(),
              remQty,
              'Remaining qty is not correct'
            );
          }
        });

        it('Should create payment method ETHTKN', async () => {
          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );

          const paymentMethod = await contractVoucherKernel.getVoucherPaymentMethod(
            tokenSupplyKey
          );

          const addressTokenPrice = await contractVoucherKernel.getVoucherPriceToken(
            tokenSupplyKey
          );

          const addressTokenDeposits = await contractVoucherKernel.getVoucherDepositToken(
            tokenSupplyKey
          );

          assert.equal(
            paymentMethod.toString(),
            paymentMethods.ETHTKN.toString(),
            'Payment Method ETHTKN not set correctly'
          );
          assert.equal(
            addressTokenPrice.toString(),
            constants.ZERO_ADDRESS,
            'ETHTKN Method Price Token Address mismatch'
          );
          assert.equal(
            addressTokenDeposits.toString(),
            contractBSNTokenDeposit.address,
            'ETHTKN Method Deposit Token Address mismatch'
          );
        });

        it('[NEGATIVE] Should fail if token deposit contract address is not provided', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderETHTKNWithPermit(
              '',
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.reverted;
        });

        it('[NEGATIVE] Should revert if token deposit contract address is zero address', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderETHTKNWithPermit(
              constants.ZERO_ADDRESS,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
        });

        it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );
          const deadline = toWei(1);

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderETHTKNWithPermit(
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.ABOVE_ETH_LIMIT,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );
          const deadline = toWei(1);

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderETHTKNWithPermit(
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.ABOVE_TOKEN_LIMIT,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );
          const deadline = toWei(1);

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderETHTKNWithPermit(
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.ABOVE_TOKEN_LIMIT,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });
      });

      describe('TKNETH', () => {
        before(async () => {
          await deployContracts();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              ''
            );

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          const tokensToMint = BN(constants.product_price).mul(
            BN(constants.QTY_10)
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMint
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );
        });

        it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.ONE_MINUTE,
              constants.seller_deposit,
              constants.QTY_10
            )
          ).to.be.revertedWith(revertReasons.INVALID_VALIDITY_TO);
        });

        it('ESCROW has correct balance', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(BN(remQty));
          const escrowAmount = await contractCashier.getEscrowAmount(
            users.seller.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Cashier Contract has correct amount of ETH', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(BN(remQty));
          const cashierBalance = await ethers.provider.getBalance(
            contractCashier.address
          );

          assert.isTrue(
            BN(cashierBalance).eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Get correct remaining qty for supply', async () => {
          let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            tokenSupplyKey,
            users.seller.address
          );

          assert.equal(
            remainingQtyInContract.toString(),
            remQty.toString(),
            'Remaining qty is not correct'
          );

          for (let i = 0; i < vouchersToBuy; i++) {
            await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey);
            remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
              tokenSupplyKey,
              users.seller.address
            );

            remQty = BN(remQty).sub(1).toString();

            assert.equal(
              remainingQtyInContract.toString(),
              remQty,
              'Remaining qty is not correct'
            );
          }
        });

        it('Should create payment method TKNETH', async () => {
          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );

          const paymentMethod = await contractVoucherKernel.getVoucherPaymentMethod(
            tokenSupplyKey
          );

          const addressTokenPrice = await contractVoucherKernel.getVoucherPriceToken(
            tokenSupplyKey
          );

          const addressTokenDeposits = await contractVoucherKernel.getVoucherDepositToken(
            tokenSupplyKey
          );

          assert.equal(
            paymentMethod.toString(),
            paymentMethods.TKNETH.toString(),
            'Payment Method TKNETH not set correctly'
          );
          assert.equal(
            addressTokenPrice.toString(),
            contractBSNTokenPrice.address,
            'TKNETH Method Price Token Address mismatch'
          );
          assert.equal(
            addressTokenDeposits.toString(),
            constants.ZERO_ADDRESS,
            'TKNETH Method Deposit Token Address mismatch'
          );
        });

        it('[NEGATIVE] Should fail if price token contract address is not provided', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNETH(
              '',
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {value: txValue.toString()}
            )
          ).to.be.reverted;
        });

        it('[NEGATIVE] Should fail if token price contract is zero address', async () => {
          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNETH(constants.ZERO_ADDRESS, [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.seller_deposit,
              constants.PROMISE_DEPOSITBU1,
              constants.ORDER_QUANTITY1,
            ])
          ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
        });

        it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNETH(
              contractBSNTokenPrice.address,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.ABOVE_TOKEN_LIMIT,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {value: txValue.toString()}
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNETH(
              contractBSNTokenPrice.address,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.ABOVE_ETH_LIMIT,
                constants.ORDER_QUANTITY1,
              ],
              {value: txValue.toString()}
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNETH(
              contractBSNTokenPrice.address,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.ABOVE_ETH_LIMIT,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ],
              {value: txValue.toString()}
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });
      });

      describe('TKNTKN', () => {
        before(async () => {
          await deployContracts();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          const tokensToMint = BN(constants.product_price).mul(
            BN(constants.QTY_20)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            tokensToMint
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_10
          );
        });

        it('[NEGATIVE] Should revert if validTo is set below 5 minutes from now', async () => {
          await expect(
            utils.createOrder(
              users.seller,
              timestamp,
              timestamp + constants.ONE_MINUTE,
              constants.seller_deposit,
              constants.QTY_10
            )
          ).to.be.revertedWith(revertReasons.INVALID_VALIDITY_TO);
        });

        it('Cashier has correct balance in Deposit Contract', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(BN(remQty));
          const escrowAmount = await contractBSNTokenDeposit.balanceOf(
            contractCashier.address
          );

          assert.isTrue(
            escrowAmount.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('escrowTokens has correct balance', async () => {
          const expectedBalance = BN(constants.seller_deposit).mul(
            BN(constants.QTY_10)
          );
          const escrowTokens = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          );

          assert.isTrue(
            escrowTokens.eq(expectedBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Get correct remaining qty for supply', async () => {
          let remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
            tokenSupplyKey,
            users.seller.address
          );

          assert.equal(
            remainingQtyInContract.toString(),
            remQty.toString(),
            'Remaining qty is not correct'
          );

          for (let i = 0; i < vouchersToBuy; i++) {
            await utils.commitToBuy(users.buyer, users.seller, tokenSupplyKey);
            remainingQtyInContract = await contractVoucherKernel.getRemQtyForSupply(
              tokenSupplyKey,
              users.seller.address
            );

            remQty = BN(remQty).sub(1).toString();

            assert.equal(
              remainingQtyInContract.toString(),
              remQty,
              'Remaining qty is not correct'
            );
          }

          it('Create Conditional Commit', async () => {
            expect(
              await utils.createOrderConditional(
                users.seller,
                timestamp,
                timestamp + constants.SECONDS_IN_DAY,
                constants.seller_deposit,
                constants.QTY_10,
                users.seller,
                0
              )
            ).to.emit(
              contractBosonRouter,
              eventNames.LOG_CONDITIONAL_ORDER_CREATED
            );

            // .withArgs(); should calculate token supply id and compare it it
            // console.log(tokenSupplyID)
          });
        });

        it('Should create payment method TKNTKN', async () => {
          tokenSupplyKey = await utils.createOrder(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );

          const paymentMethod = await contractVoucherKernel.getVoucherPaymentMethod(
            tokenSupplyKey
          );

          const addressTokenPrice = await contractVoucherKernel.getVoucherPriceToken(
            tokenSupplyKey
          );

          const addressTokenDeposits = await contractVoucherKernel.getVoucherDepositToken(
            tokenSupplyKey
          );

          assert.equal(
            paymentMethod.toString(),
            paymentMethods.TKNTKN.toString(),
            'Payment Method TKNTKN not set correctly'
          );
          assert.equal(
            addressTokenPrice.toString(),
            contractBSNTokenPrice.address,
            'TKNTKN Method Price Token Address mismatch'
          );
          assert.equal(
            addressTokenDeposits.toString(),
            contractBSNTokenDeposit.address,
            'TKNTKN Method Deposit Token Address mismatch'
          );
        });

        it('[NEGATIVE] Should fail if token price contract address is not provided', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNTKNWithPermit(
              '',
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.reverted;
        });

        it('[NEGATIVE] Should fail if token deposit contract address is not provided', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNTKNWithPermit(
              contractBSNTokenPrice.address,
              '',
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.reverted;
        });

        it('[NEGATIVE] Should revert if token price contract address is zero address', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNTKNWithPermit(
              constants.ZERO_ADDRESS,
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
        });

        it('[NEGATIVE] Should revert if token deposit contract address is zero address', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );
          const deadline = toWei(1);

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractCashier.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNTKNWithPermit(
              contractBSNTokenPrice.address,
              constants.ZERO_ADDRESS,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
        });

        it('[NEGATIVE] Should not create a supply if price is above the limit', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(constants.QTY_1));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNTKNWithPermit(
              contractBSNTokenPrice.address,
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.ABOVE_TOKEN_LIMIT,
                constants.seller_deposit,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositBu is above the limit', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(constants.QTY_1));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNTKNWithPermit(
              contractBSNTokenPrice.address,
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.seller_deposit,
                constants.ABOVE_TOKEN_LIMIT,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });

        it('[NEGATIVE] Should not create a supply if depositSe is above the limit', async () => {
          const txValue = BN(constants.seller_deposit).mul(BN(constants.QTY_1));
          const nonce = await contractBSNTokenDeposit.nonces(
            users.seller.address
          );

          const digest = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.seller.address,
            contractBosonRouter.address,
            txValue,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.seller.privateKey.slice(2), 'hex')
          );

          const sellerInstance = contractBosonRouter.connect(
            users.seller.signer
          );

          await expect(
            sellerInstance.requestCreateOrderTKNTKNWithPermit(
              contractBSNTokenPrice.address,
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              v,
              r,
              s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.ABOVE_TOKEN_LIMIT,
                constants.PROMISE_DEPOSITBU1,
                constants.ORDER_QUANTITY1,
              ]
            )
          ).to.be.revertedWith(revertReasons.ABOVE_LIMIT);
        });
      });
    });
  });

  describe('TOKEN SUPPLY CANCELLATION', () => {
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

      tokenSupplyKey = await utils.createOrder(
        users.seller,
        timestamp,
        timestamp + constants.SECONDS_IN_DAY,
        constants.seller_deposit,
        constants.QTY_10
      );
    });

    it('Should process suppy/voucher set cancellation properly', async () => {
      const sellerBalanceBefore = await users.seller.signer.getBalance(
        'latest'
      );

      const quantityBefore = await contractVoucherKernel.getRemQtyForSupply(
        tokenSupplyKey,
        users.seller.address
      );

      assert.isTrue(quantityBefore.eq(constants.QTY_10));

      const sellerInstance = contractBosonRouter.connect(users.seller.signer);
      const tx = await sellerInstance.requestCancelOrFaultVoucherSet(
        tokenSupplyKey
      );
      const txReceipt = await tx.wait();

      eventUtils.assertEventEmitted(
        txReceipt,
        ERC1155ERC721_Factory,
        eventNames.TRANSFER_SINGLE,
        (ev) => {
          assert.isTrue(ev._operator == contractVoucherKernel.address);
          assert.isTrue(ev._from === users.seller.address);
          assert.isTrue(ev._to === constants.ZERO_ADDRESS);
          assert.isTrue(ev._id == tokenSupplyKey);
          assert.isTrue(ev._value == constants.QTY_10);
        }
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        VoucherKernel_Factory,
        eventNames.LOG_CANCEL_VOUCHER_SET,
        (ev) => {
          assert.isTrue(ev._tokenIdSupply.eq(tokenSupplyKey));
          assert.isTrue(ev._issuer === users.seller.address);
        }
      );

      const sellerDeposit = BN(constants.seller_deposit).mul(
        BN(constants.QTY_10)
      );

      eventUtils.assertEventEmitted(
        txReceipt,
        Cashier_Factory,
        eventNames.LOG_WITHDRAWAL,
        (ev) => {
          assert.equal(ev._payee, users.seller.address, 'Incorrect Payee');
          assert.isTrue(ev._payment.eq(sellerDeposit), 'Payment incorrect');
        }
      );

      const txCost = tx.gasPrice.mul(txReceipt.gasUsed);
      const expectedSellerBalance = sellerBalanceBefore
        .add(sellerDeposit)
        .sub(txCost);
      const sellerBalanceAfter = await users.seller.signer.getBalance('latest');

      assert.isTrue(
        expectedSellerBalance.eq(sellerBalanceAfter),
        'Seller balance incorrect'
      );
    });
  });

  describe('VOUCHER CREATION (Commit to buy)', () => {
    const ORDER_QTY = 5;
    let TOKEN_SUPPLY_ID;

    describe('ETHETH', () => {
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
        constants.PROMISE_VALID_FROM = timestamp;
        constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('Should create order', async () => {
        const txValue = BN(constants.buyer_deposit).add(
          BN(constants.product_price)
        );
        const buyerInstance = contractBosonRouter.connect(users.buyer.signer);
        const txFillOrder = await buyerInstance.requestVoucherETHETH(
          TOKEN_SUPPLY_ID,
          users.seller.address,
          {
            value: txValue,
          }
        );

        const txReceipt = await txFillOrder.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_DELIVERED,
          (ev) => {
            assert.equal(ev._issuer, users.seller.address);
            tokenVoucherKey = ev._tokenIdVoucher;
          }
        );
      });

      it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
        const utilsTknEth = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenPrice,
            contractBSNTokenDeposit
          );

        await expect(
          utilsTknEth.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
        ).to.be.reverted;
      });

      it('Cashier Contract has correct amount of funds', async () => {
        const sellerDeposits = BN(constants.seller_deposit).mul(
          BN(constants.QTY_10)
        );
        const buyerETHSent = BN(constants.product_price).add(
          BN(constants.buyer_deposit)
        );
        const expectedBalance = sellerDeposits.add(buyerETHSent);

        const cashierBalance = await ethers.provider.getBalance(
          contractCashier.address
        );

        assert.isTrue(
          BN(cashierBalance).eq(expectedBalance),
          'Escrow amount is incorrect'
        );
      });

      it('Escrow should be updated', async () => {
        const sellerDeposits = BN(constants.seller_deposit).mul(
          BN(constants.QTY_10)
        );
        const buyerETHSent = BN(constants.product_price).add(
          BN(constants.buyer_deposit)
        );

        const escrowSeller = await contractCashier.getEscrowAmount(
          users.seller.address
        );
        const escrowBuyer = await contractCashier.getEscrowAmount(
          users.buyer.address
        );

        assert.isTrue(
          BN(sellerDeposits).eq(escrowSeller),
          'Escrow amount is incorrect'
        );

        assert.isTrue(
          BN(buyerETHSent).eq(escrowBuyer),
          'Escrow amount is incorrect'
        );
      });

      it('[NEGATIVE] Should not create order with incorrect price', async () => {
        const txValue = BN(constants.buyer_deposit).add(
          BN(constants.incorrect_product_price)
        );

        const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

        await expect(
          buyerInstance.requestVoucherETHETH(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            {
              value: txValue,
            }
          )
        ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
      });

      it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
        const txValue = BN(constants.buyer_incorrect_deposit).add(
          BN(constants.product_price)
        );

        const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

        await expect(
          buyerInstance.requestVoucherETHETH(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            {
              value: txValue,
            }
          )
        ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', async () => {
        before(async () => {
          await deployContracts();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const tokensToMintSeller = BN(constants.seller_deposit).mul(
            BN(ORDER_QTY)
          );
          const tokensToMintBuyer = BN(constants.buyer_deposit).mul(
            BN(ORDER_QTY)
          );

          await contractBSNTokenDeposit.mint(
            users.seller.address,
            tokensToMintSeller
          );
          await contractBSNTokenDeposit.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          );
        });

        it('Should create order', async () => {
          const nonce = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractBosonRouter.address,
            constants.buyer_deposit,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          const txFillOrder = await buyerInstance.requestVoucherETHTKNWithPermit(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            constants.buyer_deposit,
            deadline,
            v,
            r,
            s,
            {value: constants.product_price}
          );

          const txReceipt = await txFillOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              assert.equal(ev._issuer, users.seller.address);
              tokenVoucherKey = ev._tokenIdVoucher;
            }
          );
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          const utilsEthEth = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHETH()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await expect(
            utilsEthEth.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.INCORRECT_PAYMENT_METHOD);
        });

        it('Cashier Contract has correct amount of funds', async () => {
          const expectedETHBalance = BN(constants.product_price);
          const cashierETHBalance = await ethers.provider.getBalance(
            contractCashier.address
          );

          const cashierDepositTokenBalance = await contractBSNTokenDeposit.balanceOf(
            contractCashier.address
          );
          const sellerTokenDeposits = BN(constants.seller_deposit).mul(
            BN(ORDER_QTY)
          );
          const expectedTokenBalance = BN(constants.buyer_deposit).add(
            sellerTokenDeposits
          );

          assert.isTrue(
            BN(cashierETHBalance).eq(expectedETHBalance),
            'Escrow amount is incorrect'
          );
          assert.isTrue(
            expectedTokenBalance.eq(cashierDepositTokenBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Escrows should be updated', async () => {
          const sellerDeposits = BN(constants.seller_deposit).mul(
            BN(ORDER_QTY)
          );
          const buyerETHSent = BN(constants.product_price);
          const buyerTKNSent = BN(constants.buyer_deposit);

          const escrowSellerTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          );
          const escrowBuyerEth = await contractCashier.getEscrowAmount(
            users.buyer.address
          );
          const escrowBuyerTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.buyer.address
          );

          assert.isTrue(
            BN(sellerDeposits).eq(escrowSellerTkn),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerETHSent).eq(escrowBuyerEth),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerTKNSent).eq(escrowBuyerTkn),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          const nonce = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractCashier.address,
            constants.buyer_deposit,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherETHTKNWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              constants.buyer_deposit,
              deadline,
              v,
              r,
              s,
              {
                value: constants.incorrect_product_price,
              }
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_PRICE);
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          const nonce = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractCashier.address,
            constants.buyer_deposit,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherETHTKNWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              constants.buyer_incorrect_deposit,
              deadline,
              v,
              r,
              s,
              {value: constants.product_price}
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_DEPOSIT);
        });
      });

      describe('TKNTKN', () => {
        before(async () => {
          await deployContracts();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const tokensToMintSeller = BN(constants.seller_deposit).mul(
            BN(ORDER_QTY)
          );
          const tokensToMintBuyer = BN(constants.product_price).mul(
            BN(ORDER_QTY)
          );

          await contractBSNTokenDeposit.mint(
            users.seller.address,
            tokensToMintSeller
          );
          await contractBSNTokenDeposit.mint(
            users.buyer.address,
            tokensToMintBuyer
          );
          await contractBSNTokenPrice.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          );
        });

        it('Should create order', async () => {
          const nonce1 = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const tokensToSend = BN(constants.product_price).add(
            BN(constants.buyer_deposit)
          );

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractBosonRouter.address,
            constants.buyer_deposit,
            nonce1,
            deadline
          );

          const VRS_DEPOSIT = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vDeposit = VRS_DEPOSIT.v;
          const rDeposit = VRS_DEPOSIT.r;
          const sDeposit = VRS_DEPOSIT.s;

          const nonce2 = await contractBSNTokenPrice.nonces(
            users.buyer.address
          );

          const digestPrice = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractBosonRouter.address,
            constants.product_price,
            nonce2,
            deadline
          );

          const VRS_PRICE = ecsign(
            Buffer.from(digestPrice.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vPrice = VRS_PRICE.v;
          const rPrice = VRS_PRICE.r;
          const sPrice = VRS_PRICE.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          const txFillOrder = await buyerInstance.requestVoucherTKNTKNWithPermit(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            tokensToSend,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          );

          const txReceipt = await txFillOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              assert.equal(ev._issuer, users.seller.address);
              tokenVoucherKey = ev._tokenIdVoucher;
            }
          );
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          const utilsEthTkn = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await expect(
            utilsEthTkn.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.INCORRECT_PAYMENT_METHOD);
        });

        it('Cashier Contract has correct amount of funds', async () => {
          const cashierPriceTokenBalance = await contractBSNTokenPrice.balanceOf(
            contractCashier.address
          );
          const cashierDepositTokenBalance = await contractBSNTokenDeposit.balanceOf(
            contractCashier.address
          );
          const sellerDeposit = BN(constants.seller_deposit).mul(BN(ORDER_QTY));
          const expectedDepositBalance = BN(constants.buyer_deposit).add(
            sellerDeposit
          );

          assert.isTrue(
            BN(cashierPriceTokenBalance).eq(BN(constants.product_price)),
            'Escrow amount is incorrect'
          );
          assert.isTrue(
            BN(cashierDepositTokenBalance).eq(expectedDepositBalance),
            'Escrow amount is incorrect'
          );
        });

        it('Escrows should be updated', async () => {
          const sellerDeposits = BN(constants.seller_deposit).mul(
            BN(ORDER_QTY)
          );
          const buyerTknPriceSent = BN(constants.product_price);
          const buyerTknDepositSent = BN(constants.buyer_deposit);

          const escrowSellerTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.seller.address
          );
          const escrowBuyerTknPrice = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.buyer.address
          );
          const escrowBuyerTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.buyer.address
          );

          assert.isTrue(
            BN(sellerDeposits).eq(escrowSellerTknDeposit),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerTknPriceSent).eq(escrowBuyerTknPrice),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerTknDepositSent).eq(escrowBuyerTknDeposit),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          const nonce1 = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const tokensToSend = BN(constants.incorrect_product_price).add(
            BN(constants.buyer_deposit)
          );

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractCashier.address,
            constants.buyer_deposit,
            nonce1,
            deadline
          );

          const VRS_DEPOSIT = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vDeposit = VRS_DEPOSIT.v;
          const rDeposit = VRS_DEPOSIT.r;
          const sDeposit = VRS_DEPOSIT.s;

          const nonce2 = await contractBSNTokenPrice.nonces(
            users.buyer.address
          );

          const digestPrice = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractCashier.address,
            constants.product_price,
            nonce2,
            deadline
          );

          const VRS_PRICE = ecsign(
            Buffer.from(digestPrice.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vPrice = VRS_PRICE.v;
          const rPrice = VRS_PRICE.r;
          const sPrice = VRS_PRICE.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherTKNTKNWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              tokensToSend,
              deadline,
              vPrice,
              rPrice,
              sPrice,
              vDeposit,
              rDeposit,
              sDeposit
            )
          ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          const nonce1 = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const tokensToSend = BN(constants.product_price).add(
            BN(constants.buyer_incorrect_deposit)
          );

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenDeposit,
            users.buyer.address,
            contractCashier.address,
            constants.buyer_deposit,
            nonce1,
            deadline
          );

          const VRS_DEPOSIT = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vDeposit = VRS_DEPOSIT.v;
          const rDeposit = VRS_DEPOSIT.r;
          const sDeposit = VRS_DEPOSIT.s;

          const nonce2 = await contractBSNTokenPrice.nonces(
            users.buyer.address
          );

          const digestPrice = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractCashier.address,
            constants.product_price,
            nonce2,
            deadline
          );

          const VRS_PRICE = ecsign(
            Buffer.from(digestPrice.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const vPrice = VRS_PRICE.v;
          const rPrice = VRS_PRICE.r;
          const sPrice = VRS_PRICE.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherTKNTKNWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              tokensToSend,
              deadline,
              vPrice,
              rPrice,
              sPrice,
              vDeposit,
              rDeposit,
              sDeposit
            )
          ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
        });
      });

      describe('TKNTKN Same', () => {
        const tokensToMintSeller = BN(constants.seller_deposit).mul(
          BN(ORDER_QTY)
        );
        const tokensToMintBuyer = BN(constants.product_price).mul(
          BN(ORDER_QTY)
        );

        before(async () => {
          await deployContracts();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKNSame()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await utils.contractBSNTokenSame.mint(
            users.seller.address,
            tokensToMintSeller
          );
          await utils.contractBSNTokenSame.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          );
        });

        it('Should create voucher', async () => {
          const nonce = await utils.contractBSNTokenSame.nonces(
            users.buyer.address
          );
          const tokensToSend = BN(constants.product_price).add(
            BN(constants.buyer_deposit)
          );

          const digestTokens = await getApprovalDigest(
            utils.contractBSNTokenSame,
            users.buyer.address,
            contractBosonRouter.address,
            tokensToSend,
            nonce,
            deadline
          );

          const VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const v = VRS_TOKENS.v;
          const r = VRS_TOKENS.r;
          const s = VRS_TOKENS.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          const txFillOrder = await buyerInstance.requestVoucherTKNTKNSameWithPermit(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            tokensToSend,
            deadline,
            v,
            r,
            s
          );

          const txReceipt = await txFillOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              assert.equal(ev._issuer, users.seller.address);
              tokenVoucherKey1 = ev._tokenIdVoucher;
            }
          );

          assert.isDefined(tokenVoucherKey1.toString());
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          const utilsEthEth = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHETH()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await expect(
            utilsEthEth.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.INCORRECT_PAYMENT_METHOD);
        });

        it('Cashier Contract has correct amount of funds', async () => {
          const cashierTokenBalanceSame = await utils.contractBSNTokenSame.balanceOf(
            contractCashier.address
          );
          const sellerDeposits = BN(constants.seller_deposit).mul(
            BN(ORDER_QTY)
          );
          const buyerTokensSent = BN(constants.product_price).add(
            BN(constants.buyer_deposit)
          );
          const expectedDepositBalance = buyerTokensSent.add(sellerDeposits);

          assert.isTrue(
            BN(cashierTokenBalanceSame).eq(expectedDepositBalance),
            'Cashier amount is incorrect'
          );
        });

        it('Escrows should be updated', async () => {
          const sellerDeposits = BN(constants.seller_deposit).mul(
            BN(ORDER_QTY)
          );
          const buyerTknSent = BN(constants.product_price).add(
            BN(constants.buyer_deposit)
          );

          const escrowSellerTknDeposit = await contractCashier.getEscrowTokensAmount(
            utils.contractBSNTokenSame.address,
            users.seller.address
          );
          const escrowBuyerTkn = await contractCashier.getEscrowTokensAmount(
            utils.contractBSNTokenSame.address,
            users.buyer.address
          );

          assert.isTrue(
            BN(sellerDeposits).eq(escrowSellerTknDeposit),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerTknSent).eq(escrowBuyerTkn),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          const nonce = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const incorrectTokensToSign = BN(
            constants.incorrect_product_price
          ).add(BN(constants.buyer_deposit));
          const digestTokens = await getApprovalDigest(
            utils.contractBSNTokenSame,
            users.buyer.address,
            contractCashier.address,
            incorrectTokensToSign,
            nonce,
            deadline
          );

          const VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const v = VRS_TOKENS.v;
          const r = VRS_TOKENS.r;
          const s = VRS_TOKENS.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherTKNTKNSameWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              incorrectTokensToSign,
              deadline,
              v,
              r,
              s
            )
          ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          const nonce = await contractBSNTokenDeposit.nonces(
            users.buyer.address
          );
          const incorrectTokensToSign = BN(constants.product_price).add(
            BN(constants.buyer_incorrect_deposit)
          );
          const digestTokens = await getApprovalDigest(
            utils.contractBSNTokenSame,
            users.buyer.address,
            contractCashier.address,
            incorrectTokensToSign,
            nonce,
            deadline
          );

          const VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const v = VRS_TOKENS.v;
          const r = VRS_TOKENS.r;
          const s = VRS_TOKENS.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherTKNTKNSameWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              incorrectTokensToSign,
              deadline,
              v,
              r,
              s
            )
          ).to.be.revertedWith(revertReasons.INVALID_FUNDS);
        });

        it('[NEGATIVE] Should revert if Price Token and Deposit Token are diff contracts', async () => {
          //get instance with different Price token and Deposit Token addresses
          const utilsTKNTKN = await UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await contractBSNTokenDeposit.mint(
            users.seller.address,
            tokensToMintSeller
          );
          await contractBSNTokenDeposit.mint(
            users.buyer.address,
            tokensToMintBuyer
          );
          await contractBSNTokenPrice.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          TOKEN_SUPPLY_ID = await utilsTKNTKN.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          );

          const nonce = await utils.contractBSNTokenSame.nonces(
            users.buyer.address
          );
          const tokensToSend = BN(constants.product_price).add(
            BN(constants.buyer_deposit)
          );

          const digestTokens = await getApprovalDigest(
            utils.contractBSNTokenSame,
            users.buyer.address,
            contractBosonRouter.address,
            tokensToSend,
            nonce,
            deadline
          );

          const VRS_TOKENS = ecsign(
            Buffer.from(digestTokens.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const v = VRS_TOKENS.v;
          const r = VRS_TOKENS.r;
          const s = VRS_TOKENS.s;

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherTKNTKNSameWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              tokensToSend,
              deadline,
              v,
              r,
              s
            )
          ).to.be.revertedWith(revertReasons.INVALID_CALLER);
        });
      });

      describe('TKNETH', () => {
        before(async () => {
          await deployContracts();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const tokensToMintBuyer = BN(constants.product_price).mul(
            BN(ORDER_QTY)
          );

          await contractBSNTokenPrice.mint(
            users.buyer.address,
            tokensToMintBuyer
          );

          timestamp = await Utils.getCurrTimestamp();
          constants.PROMISE_VALID_FROM = timestamp;
          constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

          TOKEN_SUPPLY_ID = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            ORDER_QTY
          );
        });

        it('Should create order', async () => {
          const nonce = await contractBSNTokenPrice.nonces(users.buyer.address);

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractBosonRouter.address,
            constants.product_price,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          const txFillOrder = await buyerInstance.requestVoucherTKNETHWithPermit(
            TOKEN_SUPPLY_ID,
            users.seller.address,
            constants.product_price,
            deadline,
            v,
            r,
            s,
            {value: constants.buyer_deposit}
          );

          const txReceipt = await txFillOrder.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_DELIVERED,
            (ev) => {
              assert.equal(ev._issuer, users.seller.address);
              tokenVoucherKey = ev._tokenIdVoucher;
            }
          );

          assert.isDefined(tokenVoucherKey.toString());
        });

        it('[NEGATIVE] Should not create order from a wrong payment type', async () => {
          const utilsEthEth = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHETH()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          await expect(
            utilsEthEth.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
          ).to.be.revertedWith(revertReasons.INCORRECT_PAYMENT_METHOD);
        });

        it('Cashier Contract has correct amount of funds', async () => {
          const cashierDepositETH = await ethers.provider.getBalance(
            contractCashier.address
          );
          const sellerDeposits = BN(constants.seller_deposit).mul(
            BN(ORDER_QTY)
          );
          const expectedDepositBalance = BN(constants.buyer_deposit).add(
            sellerDeposits
          );

          const cashierPriceTokenBalance = await contractBSNTokenPrice.balanceOf(
            contractCashier.address
          );

          assert.isTrue(
            BN(cashierDepositETH).eq(expectedDepositBalance),
            'Cashier amount is incorrect'
          );
          assert.isTrue(
            BN(cashierPriceTokenBalance).eq(BN(constants.product_price)),
            'Cashier amount is incorrect'
          );
        });

        it('Escrow should be updated', async () => {
          const sellerDeposits = BN(constants.seller_deposit).mul(
            BN(ORDER_QTY)
          );

          const buyerTknSent = BN(constants.product_price);
          const buyerEthSent = BN(constants.buyer_deposit);

          const escrowSeller = await contractCashier.getEscrowAmount(
            users.seller.address
          );
          const escrowBuyerEth = await contractCashier.getEscrowAmount(
            users.buyer.address
          );
          const escrowBuyerTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.buyer.address
          );

          assert.isTrue(
            BN(sellerDeposits).eq(escrowSeller),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerEthSent).eq(escrowBuyerEth),
            'Escrow amount is incorrect'
          );

          assert.isTrue(
            BN(buyerTknSent).eq(escrowBuyerTkn),
            'Escrow amount is incorrect'
          );
        });

        it('[NEGATIVE] Should not create order with incorrect deposit', async () => {
          const nonce = await contractBSNTokenPrice.nonces(users.buyer.address);

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractCashier.address,
            constants.product_price,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherTKNETHWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              constants.product_price,
              deadline,
              v,
              r,
              s,
              {
                value: constants.buyer_incorrect_deposit,
              }
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_DEPOSIT);
        });

        it('[NEGATIVE] Should not create order with incorrect price', async () => {
          const nonce = await contractBSNTokenPrice.nonces(users.buyer.address);

          const digestDeposit = await getApprovalDigest(
            contractBSNTokenPrice,
            users.buyer.address,
            contractCashier.address,
            constants.product_price,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          const buyerInstance = contractBosonRouter.connect(users.buyer.signer);

          await expect(
            buyerInstance.requestVoucherTKNETHWithPermit(
              TOKEN_SUPPLY_ID,
              users.seller.address,
              constants.incorrect_product_price,
              deadline,
              v,
              r,
              s,
              {value: constants.buyer_deposit}
            )
          ).to.be.revertedWith(revertReasons.INCORRECT_PRICE);
        });
      });
    });

    describe('Common voucher interactions after expiry', () => {
      const TEN_MINUTES = 10 * constants.ONE_MINUTE;
      const cancelPeriod = constants.ONE_MINUTE;
      const complainPeriod = constants.ONE_MINUTE;

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

        const timestamp = await Utils.getCurrTimestamp();

        constants.PROMISE_VALID_FROM = timestamp;
        constants.PROMISE_VALID_TO = timestamp + TEN_MINUTES;

        TOKEN_SUPPLY_ID = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('[!COMMIT] Buyer should not be able to commit after expiry date has passed', async () => {
        await advanceTimeSeconds(
          constants.PROMISE_VALID_TO + constants.ONE_MINUTE
        );

        await expect(
          utils.commitToBuy(users.buyer, users.seller, TOKEN_SUPPLY_ID)
        ).to.be.revertedWith(revertReasons.OFFER_EXPIRED);
      });

      it('[COMMIT->!CANCEL] Seller should not be able to cancel after complain and expiry periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await advanceTimeSeconds(
          constants.PROMISE_VALID_TO + cancelPeriod + complainPeriod
        );

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->CANCEL->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(complainPeriod + constants.ONE_MINUTE);

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->!REFUND] Buyer should not be able to refund after expiry date has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await advanceTimeSeconds(
          constants.PROMISE_VALID_TO + constants.ONE_MINUTE
        );

        await expect(
          utils.refund(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.VALIDITY_PERIOD_PASSED);
      });

      it('[COMMIT->!REDEEM] Buyer should not be able to redeem after expiry date has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await advanceTimeSeconds(
          constants.PROMISE_VALID_TO + constants.ONE_MINUTE
        );

        await expect(
          utils.redeem(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.VALIDITY_PERIOD_PASSED);
      });

      it('[COMMIT->REDEEM->!COMPLAIN] Buyer should not be able to complain after complain and cancel periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.signer);

        await advanceTimeSeconds(
          complainPeriod + cancelPeriod + constants.ONE_MINUTE
        );

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->REDEEM->!CANCEL] Seller should not be able to cancel after complain and cancel periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.signer);

        await advanceTimeSeconds(
          complainPeriod + cancelPeriod + constants.ONE_MINUTE
        );

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->REDEEM->CANCEL->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );
        await utils.redeem(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer),
          await advanceTimeSeconds(complainPeriod + constants.ONE_MINUTE);

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->REDEEM->COMPLAIN->!CANCEL] Seller should not be able to cancel after cancel period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.redeem(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer),
          await advanceTimeSeconds(cancelPeriod + constants.ONE_MINUTE);

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->REFUND->!CANCEL] Seller should not be able to cancel after cancel & complain periods expire', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.signer);

        await advanceTimeSeconds(
          complainPeriod + cancelPeriod + constants.ONE_MINUTE
        );

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->REFUND->!COMPLAIN] Buyer should not be able to complain after complain and expiry periods have passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.signer);

        await advanceTimeSeconds(
          complainPeriod + cancelPeriod + constants.ONE_MINUTE
        );

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->REFUND->COMPLAIN->!CANCEL] Seller should not be able to cancel after cancel period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.complain(voucherID, users.buyer.signer);

        await advanceTimeSeconds(cancelPeriod + constants.ONE_MINUTE);

        await expect(
          utils.cancel(voucherID, users.seller.signer)
        ).to.be.revertedWith(revertReasons.COF_PERIOD_EXPIRED);
      });

      it('[COMMIT->REFUND->CANCEL->!COMPLAIN] Buyer should not be able to complain after complain period has passed', async () => {
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await utils.refund(voucherID, users.buyer.signer);
        await utils.cancel(voucherID, users.seller.signer);

        await advanceTimeSeconds(complainPeriod + constants.ONE_MINUTE);

        await expect(
          utils.complain(voucherID, users.buyer.signer)
        ).to.be.revertedWith(revertReasons.COMPLAIN_PERIOD_EXPIRED);
      });

      it('[COMMIT->EXPIRY TRIGGERED->CANCEL] Seller should be able to cancel within the cancel period after expiry triggered', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);
        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await advanceTimeSeconds(ONE_WEEK);

        const expiryTx = await contractVoucherKernel.triggerExpiration(
          voucherID
        );
        let txReceipt = await expiryTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_EXPIRATION_TRIGGERED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );

        const cancelTx = await utils.cancel(voucherID, users.seller.signer);
        txReceipt = await cancelTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_FAULT_CANCEL,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );
      });

      it('[COMMIT->EXPIRY TRIGGERED->COMPLAIN] Buyer should be able to complain within the complain period after expiry triggered', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await advanceTimeSeconds(ONE_WEEK);

        const expiryTx = await contractVoucherKernel.triggerExpiration(
          voucherID
        );
        let txReceipt = await expiryTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_EXPIRATION_TRIGGERED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );

        const complainTx = await utils.complain(voucherID, users.buyer.signer);
        txReceipt = await complainTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_COMPLAIN,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );
      });

      it('[COMMIT->EXPIRY TRIGGERED->CANCEL->COMPLAIN] Buyer should be able to complain within the complain period after expiry triggered and seller cancels', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await advanceTimeSeconds(ONE_WEEK);

        const expiryTx = await contractVoucherKernel.triggerExpiration(
          voucherID
        );
        let txReceipt = await expiryTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_EXPIRATION_TRIGGERED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );

        const cancelTx = await utils.cancel(voucherID, users.seller.signer);
        txReceipt = await cancelTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_FAULT_CANCEL,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );

        const complainTx = await utils.complain(voucherID, users.buyer.signer);
        txReceipt = await complainTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_COMPLAIN,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );
      });

      it('[COMMIT->EXPIRY TRIGGERED->COMPLAIN->CANCEL] Seller should be able to cancel within the cancel period after expiry triggered and buyer complains', async () => {
        const ONE_WEEK = 7 * constants.SECONDS_IN_DAY;
        await contractVoucherKernel.setComplainPeriod(ONE_WEEK);
        await contractVoucherKernel.setCancelFaultPeriod(ONE_WEEK);

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.seller,
          TOKEN_SUPPLY_ID
        );

        await advanceTimeSeconds(ONE_WEEK);

        const expiryTx = await contractVoucherKernel.triggerExpiration(
          voucherID
        );
        let txReceipt = await expiryTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_EXPIRATION_TRIGGERED,
          (ev) => {
            assert.equal(ev._triggeredBy, users.deployer.address);
          }
        );

        const complainTx = await utils.complain(voucherID, users.buyer.signer);
        txReceipt = await complainTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_COMPLAIN,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );

        const cancelTx = await utils.cancel(voucherID, users.seller.signer);
        txReceipt = await cancelTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_FAULT_CANCEL,
          (ev) => {
            assert.equal(ev._tokenIdVoucher.toString(), voucherID);
          }
        );
      });
    });
  });

  describe('TOKEN SUPPLY TRANSFER', () => {
    let actualOldOwnerBalanceFromEscrow = BN(0);
    let actualNewOwnerBalanceFromEscrow = BN(0);
    let expectedBalanceInEscrow = BN(0);

    afterEach(() => {
      distributedAmounts = {
        buyerAmount: BN(0),
        sellerAmount: BN(0),
        escrowAmount: BN(0),
      };
    });

    describe('Common transfer', () => {
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

        const timestamp = await Utils.getCurrTimestamp();

        tokenSupplyKey = await utils.createOrder(
          users.other1,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('Should transfer voucher supply', async () => {
        const transferTx = await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_10,
          users.other1.signer
        );

        const txReceipt = await transferTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.isTrue(ev._operator === users.other1.address);
            assert.isTrue(ev._from === users.other1.address);
            assert.isTrue(ev._to === users.other2.address);
            assert.isTrue(ev._id.eq(tokenSupplyKey));
            assert.isTrue(ev._value.eq(constants.QTY_10));
          }
        );
      });

      it('Should transfer voucher supply to self and balance should be the same', async () => {
        const balanceBeforeTransfer = (
          await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
            users.other1.address,
            tokenSupplyKey
          )
        )[0];

        const transferTx = await utils.safeTransfer1155(
          users.other1.address,
          users.other1.address,
          tokenSupplyKey,
          constants.QTY_10,
          users.other1.signer
        );

        const balanceAfterTransfer = (
          await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
            users.other1.address,
            tokenSupplyKey
          )
        )[0];

        assert.isTrue(
          balanceBeforeTransfer.eq(balanceAfterTransfer),
          'Balance mismatch!'
        );

        const txReceipt = await transferTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_SINGLE,
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other1.address);
            assert.equal(ev._id.toString(), tokenSupplyKey);
            assert.equal(ev._value.toString(), constants.QTY_10);
          }
        );
      });

      it('[NEGATIVE] Should revert if owner tries to transfer voucher supply partially', async () => {
        await expect(
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          )
        ).to.be.revertedWith(revertReasons.INVALID_QUANTITY);
      });

      it('[NEGATIVE] Should revert if Attacker tries to transfer voucher supply', async () => {
        await expect(
          utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_10,
            users.attacker.signer
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_1155);
      });

      it('Should transfer batch voucher supply', async () => {
        const transferTx = await utils.safeBatchTransfer1155(
          users.other1.address,
          users.other2.address,
          [tokenSupplyKey],
          [constants.QTY_10],
          users.other1.signer
        );

        const txReceipt = await transferTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_BATCH,
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other2.address);
            assert.equal(
              JSON.stringify(ev._ids),
              JSON.stringify([BN(tokenSupplyKey)])
            );
            assert.equal(
              JSON.stringify(ev._values),
              JSON.stringify([BN(constants.QTY_10)])
            );
          }
        );
      });

      it('Should transfer batch voucher supply to self and balance should be the same', async () => {
        const balanceBeforeTransfer = (
          await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
            users.other1.address,
            tokenSupplyKey
          )
        )[0];

        const transferTx = await utils.safeBatchTransfer1155(
          users.other1.address,
          users.other1.address,
          [tokenSupplyKey],
          [constants.QTY_10],
          users.other1.signer
        );

        const balanceAfterTransfer = (
          await contractERC1155ERC721.functions[fnSignatures.balanceOf1155](
            users.other1.address,
            tokenSupplyKey
          )
        )[0];

        assert.isTrue(
          balanceBeforeTransfer.eq(balanceAfterTransfer),
          'Balance mismatch!'
        );

        const txReceipt = await transferTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER_BATCH,
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other1.address);
            assert.equal(
              JSON.stringify(ev._ids),
              JSON.stringify([BN(tokenSupplyKey)])
            );
            assert.equal(
              JSON.stringify(ev._values),
              JSON.stringify([BN(constants.QTY_10)])
            );
          }
        );
      });

      it('[NEGATIVE] Should revert if owner tries to transfer voucher supply batch partially', async () => {
        await expect(
          utils.safeBatchTransfer1155(
            users.other1.address,
            users.other2.address,
            [tokenSupplyKey],
            [constants.QTY_1],
            users.other1.signer
          )
        ).to.be.revertedWith(revertReasons.INVALID_QUANTITY);
      });

      it('[NEGATIVE] Should revert if Attacker tries to transfer batch voucher supply', async () => {
        await expect(
          utils.safeBatchTransfer1155(
            users.other1.address,
            users.other2.address,
            [tokenSupplyKey],
            [constants.QTY_10],
            users.attacker.signer
          )
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_TRANSFER_BATCH_1155);
      });
    });

    describe('ETHETH', () => {
      beforeEach(async () => {
        await deployContracts();
        await setPeriods();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        tokenSupplyKey = await utils.createOrder(
          users.other1,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_1
        );
      });

      it('Should update escrow amounts after transfer', async () => {
        expectedBalanceInEscrow = BN(constants.seller_deposit).mul(
          BN(constants.QTY_1)
        );

        actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other1.address
        );
        actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(ZERO),
          'New owner balance from escrow does not match'
        );

        await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          users.other1.signer
        ),
          (actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
            users.other1.address
          ));
        actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrow.eq(ZERO),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
          'New owner balance from escrow does not match'
        );
      });

      it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit); // 0.04
        const expectedSellerAmount = BN(constants.seller_deposit).add(
          BN(constants.product_price)
        ); // 0.35
        const expectedEscrowAmount = BN(0); // 0

        await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          users.other1.signer
        );

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.other2,
          tokenSupplyKey
        );

        await utils.redeem(voucherID, users.buyer.signer);

        await advanceTimeSeconds(60);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.buyer.address,
              users.other2.address
            );
          }
        );

        assert.isTrue(
          distributedAmounts.buyerAmount.eq(expectedBuyerAmount),
          'Buyer Amount is not as expected'
        );
        assert.isTrue(
          distributedAmounts.sellerAmount.eq(expectedSellerAmount),
          'Seller Amount is not as expected'
        );
        assert.isTrue(
          distributedAmounts.escrowAmount.eq(expectedEscrowAmount),
          'Escrow Amount is not as expected'
        );
      });

      it('New owner should be able to COF', async () => {
        await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          users.other1.signer
        );

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.other2,
          tokenSupplyKey
        );

        await utils.redeem(voucherID, users.buyer.signer);

        const cofTx = await utils.cancel(voucherID, users.other2.signer);
        const txReceipt = await cofTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          VoucherKernel_Factory,
          eventNames.LOG_VOUCHER_FAULT_CANCEL,
          (ev) => {
            assert.isTrue(ev._tokenIdVoucher.eq(voucherID));
          }
        );
      });

      it('[NEGATIVE] Old owner should not be able to COF', async () => {
        await utils.safeTransfer1155(
          users.other1.address,
          users.other2.address,
          tokenSupplyKey,
          constants.QTY_1,
          users.other1.signer
        );

        const voucherID = await utils.commitToBuy(
          users.buyer,
          users.other2,
          tokenSupplyKey
        );

        await utils.redeem(voucherID, users.buyer.signer);

        await expect(
          utils.cancel(voucherID, users.other1.signer)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', () => {
        let balanceBuyerFromDeposits = BN(0);

        let balanceSellerFromDeposits = BN(0);

        let escrowBalanceFromDeposits = BN(0);

        const cashierPaymentLeft = BN(0);
        let cashierDepositLeft = BN(0);

        beforeEach(async () => {
          await deployContracts();
          await setPeriods();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const timestamp = await Utils.getCurrTimestamp();

          const tokensToMint = BN(constants.seller_deposit).mul(
            BN(constants.QTY_1)
          );

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            constants.buyer_deposit
          );

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.seller_deposit,
            constants.QTY_1
          );
        });

        async function getBalancesDepositToken() {
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.buyer.address
          );
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.other2.address
          );
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.deployer.address
          );
          cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          );
        }

        it('Should update escrow amounts after transfer', async () => {
          expectedBalanceInEscrow = BN(constants.seller_deposit).mul(
            BN(constants.QTY_1)
          );

          actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );
          actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          ),
            (actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            ));
          actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(ZERO),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); //// 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(0);

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          await getBalancesDepositToken();

          const txReceipt = await withdrawTx.wait();
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(ev._payee, users.other2.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedSellerPrice));
            }
          );

          //Deposits
          assert.isTrue(
            balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
            'Buyer did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            balanceSellerFromDeposits.eq(expectedSellerDeposit),
            'Seller did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
            'Escrow did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(BN(0)),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(BN(0)),
            'Cashier Contract is not empty'
          );
        });

        it('New owner should be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.signer);

          await utils.cancel(voucherID, users.other2.signer);
        });

        it('[NEGATIVE] Old owner should not be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.signer);

          await expect(
            utils.cancel(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
        });
      });

      describe('TKNTKN', () => {
        let balanceBuyerFromPayment = BN(0);
        let balanceBuyerFromDeposits = BN(0);

        let balanceSellerFromPayment = BN(0);
        let balanceSellerFromDeposits = BN(0);

        let escrowBalanceFromPayment = BN(0);
        let escrowBalanceFromDeposits = BN(0);

        let cashierPaymentLeft = BN(0);
        let cashierDepositLeft = BN(0);

        beforeEach(async () => {
          await deployContracts();
          await setPeriods();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const supplyQty = 1;
          const tokensToMint = BN(constants.seller_deposit).mul(BN(supplyQty));

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            constants.product_price
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.buyer.address,
            constants.buyer_deposit
          );

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            supplyQty
          );
        });

        async function getBalancesFromPiceTokenAndDepositToken() {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.buyer.address
          );
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.buyer.address
          );

          balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.other2.address
          );
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.other2.address
          );

          escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.deployer.address
          );
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.deployer.address
          );

          cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          );
          cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          );
        }

        it('Should update escrow amounts after transfer', async () => {
          expectedBalanceInEscrow = BN(constants.seller_deposit).mul(
            BN(constants.QTY_1)
          );

          actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );
          actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          ),
            (actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
              contractBSNTokenDeposit.address,
              users.other1.address
            ));
          actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(ZERO),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerPrice = BN(constants.product_price); //// 0.3
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(0);
          const expectedEscrowAmountPrice = BN(0);

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          await utils.withdraw(voucherID, users.deployer.signer);

          await getBalancesFromPiceTokenAndDepositToken();

          //Payments
          assert.isTrue(
            balanceBuyerFromPayment.eq(expectedBuyerPrice),
            'Buyer did not get expected tokens from PriceTokenContract'
          );
          assert.isTrue(
            balanceSellerFromPayment.eq(expectedSellerPrice),
            'Seller did not get expected tokens from PriceTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromPayment.eq(expectedEscrowAmountPrice),
            'Escrow did not get expected tokens from PriceTokenContract'
          );

          //Deposits
          assert.isTrue(
            balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
            'Buyer did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            balanceSellerFromDeposits.eq(expectedSellerDeposit),
            'Seller did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
            'Escrow did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(ZERO),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(ZERO),
            'Cashier Contract is not empty'
          );
        });

        it('New owner should be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.signer);

          const cofTx = await utils.cancel(voucherID, users.other2.signer);
          const txReceipt = await cofTx.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_FAULT_CANCEL,
            (ev) => {
              assert.isTrue(ev._tokenIdVoucher.eq(voucherID));
            }
          );
        });

        it('[NEGATIVE] Old owner should not be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.signer);

          await expect(
            utils.cancel(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
        });
      });

      describe('TKNETH', () => {
        let balanceBuyerFromPayment = BN(0);
        let balanceSellerFromPayment = BN(0);
        let escrowBalanceFromPayment = BN(0);

        let cashierPaymentLeft = BN(0);
        const cashierDepositLeft = BN(0);

        beforeEach(async () => {
          await deployContracts();
          await setPeriods();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              ''
            );

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.buyer.address,
            constants.product_price
          );

          tokenSupplyKey = await utils.createOrder(
            users.other1,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            constants.QTY_1
          );
        });

        async function getBalancesPriceToken() {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.buyer.address
          );
          balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.other2.address
          );
          escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.deployer.address
          );
          cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          );
        }

        it('Should update escrow amounts after transfer', async () => {
          expectedBalanceInEscrow = BN(constants.seller_deposit).mul(
            BN(constants.QTY_1)
          );

          actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
            users.other1.address
          );
          actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          actualOldOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
            users.other1.address
          );
          actualNewOwnerBalanceFromEscrow = await contractCashier.getEscrowAmount(
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrow.eq(ZERO),
            'Old owner balance from escrow does not match'
          );
          assert.isTrue(
            actualNewOwnerBalanceFromEscrow.eq(expectedBalanceInEscrow),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = BN(0);
          const expectedSellerPrice = BN(constants.product_price); // 0.3
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit); // 0.04
          const expectedSellerDeposit = BN(constants.seller_deposit); // 0.05
          const expectedEscrowAmountDeposit = BN(0);

          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );
          await utils.redeem(voucherID, users.buyer.signer);

          await advanceTimeSeconds(60);
          await utils.finalize(voucherID, users.deployer.signer);

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          await getBalancesPriceToken();

          // Payments in TKN
          // Payment should have been sent to seller
          assert.isTrue(
            balanceBuyerFromPayment.eq(expectedBuyerPrice),
            'Buyer did not get expected tokens from PaymentTokenContract'
          );
          assert.isTrue(
            balanceSellerFromPayment.eq(expectedSellerPrice),
            'Seller did not get expected tokens from PaymentTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromPayment.eq(expectedEscrowPrice),
            'Escrow did not get expected tokens from PaymentTokenContract'
          );

          const txReceipt = await withdrawTx.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_payee',
                users.buyer.address,
                users.other2.address
              );
            }
          );

          //Deposits in ETH
          assert.isTrue(
            distributedAmounts.buyerAmount.eq(expectedBuyerDeposit),
            'Buyer Amount is not as expected'
          );
          assert.isTrue(
            distributedAmounts.sellerAmount.eq(expectedSellerDeposit),
            'Seller Amount is not as expected'
          );
          assert.isTrue(
            distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit),
            'Escrow Amount is not as expected'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(BN(0)),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(BN(0)),
            'Cashier Contract is not empty'
          );
        });

        it('New owner should be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.signer);

          const cofTx = await utils.cancel(voucherID, users.other2.signer);
          const txReceipt = await cofTx.wait();

          eventUtils.assertEventEmitted(
            txReceipt,
            VoucherKernel_Factory,
            eventNames.LOG_VOUCHER_FAULT_CANCEL,
            (ev) => {
              assert.isTrue(ev._tokenIdVoucher.eq(voucherID));
            }
          );
        });

        it('[NEGATIVE] Old owner should not be able to COF', async () => {
          await utils.safeTransfer1155(
            users.other1.address,
            users.other2.address,
            tokenSupplyKey,
            constants.QTY_1,
            users.other1.signer
          );

          const voucherID = await utils.commitToBuy(
            users.buyer,
            users.other2,
            tokenSupplyKey
          );

          await utils.redeem(voucherID, users.buyer.signer);

          await expect(
            utils.cancel(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_COF);
        });
      });
    });
  });

  describe('VOUCHER TRANSFER', () => {
    let actualOldOwnerBalanceFromEscrowEth = BN(0);
    let actualOldOwnerBalanceFromEscrowTkn = BN(0);
    let actualNewOwnerBalanceFromEscrowEth = BN(0);
    let actualNewOwnerBalanceFromEscrowTkn = BN(0);

    afterEach(() => {
      distributedAmounts = {
        buyerAmount: BN(0),
        sellerAmount: BN(0),
        escrowAmount: BN(0),
      };

      actualOldOwnerBalanceFromEscrowEth = BN(0);
      actualOldOwnerBalanceFromEscrowTkn = BN(0);
      actualNewOwnerBalanceFromEscrowEth = BN(0);
      actualNewOwnerBalanceFromEscrowTkn = BN(0);
    });

    describe('Common transfer', () => {
      before(async () => {
        await deployContracts();
        await setPeriods();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        tokenSupplyKey = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('Should transfer a voucher', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        const transferTx = await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          users.other1.signer
        );

        const txReceipt = await transferTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other2.address);
            assert.equal(ev._tokenId.toString(), voucherID);
          }
        );
      });

      it('Should transfer voucher to self and balance should be the same', async () => {
        const balanceOf =
          contractERC1155ERC721.functions[fnSignatures.balanceOf721];

        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        const balanceBeforeTransfer = (
          await balanceOf(users.other1.address)
        )[0];

        const transferTx = await utils.safeTransfer721(
          users.other1.address,
          users.other1.address,
          voucherID,
          users.other1.signer
        );

        const balanceAfterTransfer = (await balanceOf(users.other1.address))[0];

        assert.isTrue(
          balanceBeforeTransfer.eq(balanceAfterTransfer),
          'Balance mismatch!'
        );

        const txReceipt = await transferTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          ERC1155ERC721_Factory,
          eventNames.TRANSFER,
          (ev) => {
            assert.equal(ev._from, users.other1.address);
            assert.equal(ev._to, users.other1.address);
            assert.equal(ev._tokenId.toString(), voucherID);
          }
        );
      });
    });

    describe('ETHETH', () => {
      beforeEach(async () => {
        await deployContracts();
        await setPeriods();

        utils = await UtilsBuilder.create()
          .ETHETH()
          .buildAsync(
            contractERC1155ERC721,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter
          );

        tokenSupplyKey = await utils.createOrder(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.seller_deposit,
          constants.QTY_10
        );
      });

      it('Should update escrow amounts after transfer', async () => {
        const expectedBalanceInEscrow = BN(constants.product_price).add(
          BN(constants.buyer_deposit)
        );
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        actualOldOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
          users.other1.address
        );
        actualNewOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrow),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrowEth.eq(ZERO),
          'New owner balance from escrow does not match'
        );

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          users.other1.signer
        );

        actualOldOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
          users.other1.address
        );
        actualNewOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
          users.other2.address
        );

        assert.isTrue(
          actualOldOwnerBalanceFromEscrowEth.eq(ZERO),
          'Old owner balance from escrow does not match'
        );
        assert.isTrue(
          actualNewOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrow),
          'New owner balance from escrow does not match'
        );
      });

      it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
        const expectedBuyerAmount = BN(constants.buyer_deposit)
          .add(BN(constants.product_price))
          .add(BN(constants.seller_deposit).div(BN(2))); // 0.3 + 0.04 + 0.025
        const expectedSellerAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125
        const expectedEscrowAmount = BN(constants.seller_deposit).div(BN(4)); // 0.0125

        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          users.other1.signer
        );

        await utils.refund(voucherID, users.other2.signer);
        await utils.complain(voucherID, users.other2.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        const withdrawTx = await utils.withdraw(
          voucherID,
          users.deployer.signer
        );

        const txReceipt = await withdrawTx.wait();

        eventUtils.assertEventEmitted(
          txReceipt,
          Cashier_Factory,
          eventNames.LOG_AMOUNT_DISTRIBUTION,
          (ev) => {
            utils.calcTotalAmountToRecipients(
              ev,
              distributedAmounts,
              '_to',
              users.other2.address,
              users.seller.address
            );
          }
        );

        assert.isTrue(
          distributedAmounts.buyerAmount.eq(expectedBuyerAmount),
          'Buyer Amount is not as expected'
        );
        assert.isTrue(
          distributedAmounts.sellerAmount.eq(expectedSellerAmount),
          'Seller Amount is not as expected'
        );
        assert.isTrue(
          distributedAmounts.escrowAmount.eq(expectedEscrowAmount),
          'Escrow Amount is not as expected'
        );
      });

      it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        await utils.refund(voucherID, users.other1.signer);
        await utils.complain(voucherID, users.other1.signer);
        await utils.cancel(voucherID, users.seller.signer);
        await utils.finalize(voucherID, users.deployer.signer);

        await utils.withdraw(voucherID, users.deployer.signer);

        await expect(
          utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          )
        ).to.be.revertedWith(revertReasons.FUNDS_RELEASED);
      });

      it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        await utils.safeTransfer721(
          users.other1.address,
          users.other2.address,
          voucherID,
          users.other1.signer
        );

        await expect(
          utils.redeem(voucherID, users.other1.signer)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);

        await expect(
          utils.refund(voucherID, users.other1.signer)
        ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
      });

      it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
        const voucherID = await utils.commitToBuy(
          users.other1,
          users.seller,
          tokenSupplyKey
        );

        await expect(
          utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.attacker.signer
          )
        ).to.be.revertedWith(revertReasons.NOT_OWNER_NOR_APPROVED);
      });
    });

    describe('[WITH PERMIT]', () => {
      describe('ETHTKN', () => {
        let balanceBuyerFromDeposits = BN(0);
        let balanceSellerFromDeposits = BN(0);
        let escrowBalanceFromDeposits = BN(0);

        let cashierPaymentLeft = BN(0);
        let cashierDepositLeft = BN(0);

        async function getBalancesDepositToken() {
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.other2.address
          );
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.seller.address
          );
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.deployer.address
          );
          cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          );
        }

        beforeEach(async () => {
          await deployContracts();
          await setPeriods();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .ETHTKN()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const supplyQty = 1;
          const tokensToMint = BN(constants.seller_deposit).mul(BN(supplyQty));

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            constants.buyer_deposit
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            supplyQty
          );
        });

        afterEach(async () => {
          distributedAmounts = {
            buyerAmount: BN(0),
            sellerAmount: BN(0),
            escrowAmount: BN(0),
          };

          balanceBuyerFromDeposits = BN(0);
          balanceSellerFromDeposits = BN(0);
          escrowBalanceFromDeposits = BN(0);

          cashierPaymentLeft = BN(0);
          cashierDepositLeft = BN(0);

          const isPaused = await contractCashier.paused();
          if (isPaused) {
            await contractCashier.unpause();
          }
        });

        it('Should update escrow amounts after transfer', async () => {
          const expectedBalanceInEscrowEth = BN(constants.product_price);
          const expectedBalanceInEscrowTkn = BN(constants.buyer_deposit);

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          actualOldOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
            users.other1.address
          );

          actualOldOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );

          actualNewOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
            users.other2.address
          );

          actualNewOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrowEth),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTkn.eq(expectedBalanceInEscrowTkn),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowEth.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTkn.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          actualOldOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
            users.other1.address
          );

          actualOldOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );

          actualNewOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
            users.other2.address
          );

          actualNewOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowEth.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTkn.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrowEth),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTkn.eq(expectedBalanceInEscrowTkn),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          await utils.refund(voucherID, users.other2.signer);
          await utils.complain(voucherID, users.other2.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          await getBalancesDepositToken();

          // Payment should have been returned to buyer
          const txReceipt = await withdrawTx.wait();
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              assert.equal(ev._payee, users.other2.address, 'Incorrect Payee');
              assert.isTrue(ev._payment.eq(expectedBuyerPrice));
            }
          );

          //Deposits
          assert.isTrue(
            balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
            'NewVoucherOwner did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            balanceSellerFromDeposits.eq(expectedSellerDeposit),
            'Seller did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
            'Escrow did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(BN(0)),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(BN(0)),
            'Cashier Contract is not empty'
          );
        });

        it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.refund(voucherID, users.other1.signer);
          await utils.complain(voucherID, users.other1.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await utils.withdraw(voucherID, users.deployer.signer);

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.other1.signer
            )
          ).to.be.revertedWith(revertReasons.FUNDS_RELEASED);
        });

        it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          await expect(
            utils.redeem(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);

          await expect(
            utils.refund(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
        });

        it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.attacker.signer
            )
          ).to.be.revertedWith(revertReasons.NOT_OWNER_NOR_APPROVED);
        });
      });

      describe('TKNTKN', () => {
        let balanceBuyerFromPayment = BN(0);
        let balanceBuyerFromDeposits = BN(0);

        let balanceSellerFromPayment = BN(0);
        let balanceSellerFromDeposits = BN(0);

        let escrowBalanceFromPayment = BN(0);
        let escrowBalanceFromDeposits = BN(0);

        let cashierPaymentLeft = BN(0);
        let cashierDepositLeft = BN(0);

        async function getBalancesFromPiceTokenAndDepositToken() {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.other2.address
          );
          balanceBuyerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.other2.address
          );

          balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.seller.address
          );
          balanceSellerFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.seller.address
          );

          escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.deployer.address
          );
          escrowBalanceFromDeposits = await utils.contractBSNTokenDeposit.balanceOf(
            users.deployer.address
          );

          cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          );
          cashierDepositLeft = await utils.contractBSNTokenDeposit.balanceOf(
            utils.contractCashier.address
          );
        }

        beforeEach(async () => {
          await deployContracts();
          await setPeriods();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .TKNTKN()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              contractBSNTokenDeposit
            );

          const supplyQty = 1;
          const tokensToMint = BN(constants.seller_deposit).mul(BN(supplyQty));

          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.seller.address,
            tokensToMint
          );
          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.other1.address,
            constants.product_price
          );
          await utils.mintTokens(
            'contractBSNTokenDeposit',
            users.other1.address,
            constants.buyer_deposit
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            supplyQty
          );
        });

        it('Should update escrow amounts after transfer', async () => {
          const expectedBalanceInEscrowTknPrice = BN(constants.product_price);
          const expectedBalanceInEscrowTknDeposit = BN(constants.buyer_deposit);
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          let actualOldOwnerBalanceFromEscrowTknPrice = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other1.address
          );

          let actualOldOwnerBalanceFromEscrowTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );

          let actualNewOwnerBalanceFromEscrowTknPrice = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other2.address
          );

          let actualNewOwnerBalanceFromEscrowTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTknPrice.eq(
              expectedBalanceInEscrowTknPrice
            ),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTknDeposit.eq(
              expectedBalanceInEscrowTknDeposit
            ),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTknPrice.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTknDeposit.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          ),
            (actualOldOwnerBalanceFromEscrowTknPrice = await contractCashier.getEscrowTokensAmount(
              contractBSNTokenPrice.address,
              users.other1.address
            ));

          actualOldOwnerBalanceFromEscrowTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other1.address
          );

          actualNewOwnerBalanceFromEscrowTknPrice = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other2.address
          );

          actualNewOwnerBalanceFromEscrowTknDeposit = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenDeposit.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTknPrice.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTknDeposit.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTknPrice.eq(
              expectedBalanceInEscrowTknPrice
            ),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTknDeposit.eq(
              expectedBalanceInEscrowTknDeposit
            ),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerPrice = BN(0);
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125
          const expectedEscrowAmountPrice = BN(0);

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          await utils.refund(voucherID, users.other2.signer);
          await utils.complain(voucherID, users.other2.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await utils.withdraw(voucherID, users.deployer.signer);

          await getBalancesFromPiceTokenAndDepositToken();

          //Payments
          assert.isTrue(
            balanceBuyerFromPayment.eq(expectedBuyerPrice),
            'Buyer did not get expected tokens from PriceTokenContract'
          );
          assert.isTrue(
            balanceSellerFromPayment.eq(expectedSellerPrice),
            'Seller did not get expected tokens from PriceTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromPayment.eq(expectedEscrowAmountPrice),
            'Escrow did not get expected tokens from PriceTokenContract'
          );

          //Deposits
          assert.isTrue(
            balanceBuyerFromDeposits.eq(expectedBuyerDeposit),
            'Buyer did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            balanceSellerFromDeposits.eq(expectedSellerDeposit),
            'Seller did not get expected tokens from DepositTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromDeposits.eq(expectedEscrowAmountDeposit),
            'Buyer did not get expected tokens from DepositTokenContract'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(BN(0)),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(BN(0)),
            'Cashier Contract is not empty'
          );
        });

        it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.refund(voucherID, users.other1.signer);
          await utils.complain(voucherID, users.other1.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await utils.withdraw(voucherID, users.deployer.signer);

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.other1.signer
            )
          ).to.be.revertedWith(revertReasons.FUNDS_RELEASED);
        });

        it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          );

          await expect(
            utils.redeem(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);

          await expect(
            utils.refund(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
        });

        it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.attacker.signer
            )
          ).to.be.revertedWith(revertReasons.NOT_OWNER_NOR_APPROVED);
        });
      });

      describe('TKNETH', () => {
        let balanceBuyerFromPayment = BN(0);
        let balanceSellerFromPayment = BN(0);
        let escrowBalanceFromPayment = BN(0);

        let cashierPaymentLeft = BN(0);
        const cashierDepositLeft = BN(0);

        beforeEach(async () => {
          await deployContracts();
          await setPeriods();

          utils = await UtilsBuilder.create()
            .ERC20withPermit()
            .TKNETH()
            .buildAsync(
              contractERC1155ERC721,
              contractVoucherKernel,
              contractCashier,
              contractBosonRouter,
              contractBSNTokenPrice,
              ''
            );

          await utils.mintTokens(
            'contractBSNTokenPrice',
            users.other1.address,
            constants.product_price
          );

          tokenSupplyKey = await utils.createOrder(
            users.seller,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.seller_deposit,
            constants.QTY_1
          );
        });

        async function getBalancesPriceToken() {
          balanceBuyerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.other2.address
          );
          balanceSellerFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.seller.address
          );
          escrowBalanceFromPayment = await utils.contractBSNTokenPrice.balanceOf(
            users.deployer.address
          );
          cashierPaymentLeft = await utils.contractBSNTokenPrice.balanceOf(
            utils.contractCashier.address
          );
        }

        it('Should update escrow amounts after transfer', async () => {
          const expectedBalanceInEscrowEth = BN(constants.buyer_deposit);
          const expectedBalanceInEscrowTkn = BN(constants.product_price);
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          actualOldOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
            users.other1.address
          );

          actualOldOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other1.address
          );

          actualNewOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
            users.other2.address
          );

          actualNewOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrowEth),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTkn.eq(expectedBalanceInEscrowTkn),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowEth.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTkn.eq(ZERO),
            'New owner balance from escrow does not match'
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          ),
            (actualOldOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
              users.other1.address
            ));

          actualOldOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other1.address
          );

          actualNewOwnerBalanceFromEscrowEth = await contractCashier.getEscrowAmount(
            users.other2.address
          );

          actualNewOwnerBalanceFromEscrowTkn = await contractCashier.getEscrowTokensAmount(
            contractBSNTokenPrice.address,
            users.other2.address
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowEth.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualOldOwnerBalanceFromEscrowTkn.eq(ZERO),
            'Old owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowEth.eq(expectedBalanceInEscrowEth),
            'New owner balance from escrow does not match'
          );

          assert.isTrue(
            actualNewOwnerBalanceFromEscrowTkn.eq(expectedBalanceInEscrowTkn),
            'New owner balance from escrow does not match'
          );
        });

        it('Should finalize 1 voucher to ensure payments are sent to the new owner', async () => {
          const expectedBuyerPrice = BN(constants.product_price); // 0.3
          const expectedSellerPrice = BN(0);
          const expectedEscrowPrice = BN(0);
          const expectedBuyerDeposit = BN(constants.buyer_deposit).add(
            BN(constants.seller_deposit).div(BN(2))
          ); // 0.065
          const expectedSellerDeposit = BN(constants.seller_deposit).div(BN(4)); // 0.0125
          const expectedEscrowAmountDeposit = BN(constants.seller_deposit).div(
            BN(4)
          ); // 0.0125

          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          ),
            await utils.refund(voucherID, users.other2.signer);
          await utils.complain(voucherID, users.other2.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          const withdrawTx = await utils.withdraw(
            voucherID,
            users.deployer.signer
          );

          await getBalancesPriceToken();

          // Payments in TKN
          // Payment should have been returned to buyer
          assert.isTrue(
            balanceBuyerFromPayment.eq(expectedBuyerPrice),
            'Buyer did not get expected tokens from PaymentTokenContract'
          );
          assert.isTrue(
            balanceSellerFromPayment.eq(expectedSellerPrice),
            'Seller did not get expected tokens from PaymentTokenContract'
          );
          assert.isTrue(
            escrowBalanceFromPayment.eq(expectedEscrowPrice),
            'Escrow did not get expected tokens from PaymentTokenContract'
          );

          const txReceipt = await withdrawTx.wait();
          //Deposits in ETH
          eventUtils.assertEventEmitted(
            txReceipt,
            Cashier_Factory,
            eventNames.LOG_WITHDRAWAL,
            (ev) => {
              utils.calcTotalAmountToRecipients(
                ev,
                distributedAmounts,
                '_payee',
                users.other2.address,
                users.seller.address
              );
            }
          );

          assert.isTrue(
            distributedAmounts.buyerAmount.eq(expectedBuyerDeposit),
            'Buyer Amount is not as expected'
          );
          assert.isTrue(
            distributedAmounts.sellerAmount.eq(expectedSellerDeposit),
            'Seller Amount is not as expected'
          );
          assert.isTrue(
            distributedAmounts.escrowAmount.eq(expectedEscrowAmountDeposit),
            'Escrow Amount is not as expected'
          );

          //Cashier Should be Empty
          assert.isTrue(
            cashierPaymentLeft.eq(BN(0)),
            'Cashier Contract is not empty'
          );
          assert.isTrue(
            cashierDepositLeft.eq(BN(0)),
            'Cashier Contract is not empty'
          );
        });

        it('[NEGATIVE] Should not transfer a voucher if payments / deposits are released', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.refund(voucherID, users.other1.signer);
          await utils.complain(voucherID, users.other1.signer);
          await utils.cancel(voucherID, users.seller.signer);
          await utils.finalize(voucherID, users.deployer.signer);

          await utils.withdraw(voucherID, users.deployer.signer);

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.other1.signer
            )
          ).to.be.revertedWith(revertReasons.FUNDS_RELEASED);
        });

        it('[NEGATIVE] Old owner should not be able to interact with the voucher', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await utils.safeTransfer721(
            users.other1.address,
            users.other2.address,
            voucherID,
            users.other1.signer
          ),
            await expect(
              utils.redeem(voucherID, users.other1.signer)
            ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);

          await expect(
            utils.refund(voucherID, users.other1.signer)
          ).to.be.revertedWith(revertReasons.UNAUTHORIZED_VOUCHER_OWNER);
        });

        it('[NEGATIVE] Transfer should revert if Attacker tries to execute voucher transfer', async () => {
          const voucherID = await utils.commitToBuy(
            users.other1,
            users.seller,
            tokenSupplyKey
          );

          await expect(
            utils.safeTransfer721(
              users.other1.address,
              users.other2.address,
              voucherID,
              users.attacker.signer
            )
          ).to.be.revertedWith(revertReasons.NOT_OWNER_NOR_APPROVED);
        });
      });
    });
  });
});
