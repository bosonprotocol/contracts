import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract, BigNumber} from 'ethers';
import {assert, expect} from 'chai';
import {ecsign} from 'ethereumjs-util';
import {calculateDeploymentAddresses} from '../testHelpers/contractAddress';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';
import {toWei, getApprovalDigest} from '../testHelpers/permitUtils';
import {
  BosonRouter,
  VoucherSets,
  Vouchers,
  VoucherKernel,
  Cashier,
  TokenRegistry,
  MockERC20Permit,
  ERC1155NonTransferable,
  Gate,
} from '../typechain';
import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
import {Account} from '../testHelpers/types';
import fnSignatures from '../testHelpers/functionSignatures';

const {keccak256, solidityPack} = ethers.utils;

let utils: Utils;

const BN = ethers.BigNumber.from;

let VoucherSets_Factory: ContractFactory;
let Vouchers_Factory: ContractFactory;
let VoucherKernel_Factory: ContractFactory;
let Cashier_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;
let TokenRegistry_Factory: ContractFactory;
let MockERC20Permit_Factory: ContractFactory;
let ERC1155NonTransferable_Factory: ContractFactory;
let Gate_Factory: ContractFactory;

const eventNames = eventUtils.eventNames;
let users;

describe('Create Voucher sets and commit to vouchers with token conditional commit', () => {
  function calculateTokenSupplyKey(tokenIndex: BigNumber) {
    const TYPE_NF_BIT = constants.ONE.shl(255);
    return TYPE_NF_BIT.or(tokenIndex.shl(128));
  }

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
    ERC1155NonTransferable_Factory = await ethers.getContractFactory(
      'ERC1155NonTransferable'
    );
    Gate_Factory = await ethers.getContractFactory('Gate');
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
    contractBSNTokenDeposit: MockERC20Permit,
    contractTokenRegistry: TokenRegistry,
    contractERC1155NonTransferable: ERC1155NonTransferable,
    contractGate: Gate;

  const deadline = toWei(1);

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
        'BSNTokenPrice',
        'BSNTokenDeposit',
        'ERC1155NonTransferable',
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
    contractERC1155NonTransferable =
      (await ERC1155NonTransferable_Factory.deploy(
        'https://token-cdn-domain/{id}.json'
      )) as Contract & ERC1155NonTransferable;
    contractGate = (await Gate_Factory.deploy(
      contractAddresses.BosonRouter,
      contractAddresses.ERC1155NonTransferable
    )) as Contract & Gate;

    await contractTokenRegistry.deployed();
    await contractVoucherSets.deployed();
    await contractVouchers.deployed();
    await contractVoucherKernel.deployed();
    await contractCashier.deployed();
    await contractBosonRouter.deployed();
    await contractBSNTokenPrice.deployed();
    await contractBSNTokenDeposit.deployed();
    await contractERC1155NonTransferable.deployed();
    await contractGate.deployed();

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

    //Map $BOSON token to itself so that the token address can be called by casting to the wrapper interface in the Boson Router
    await contractTokenRegistry.setTokenWrapperAddress(
      contractBSNTokenPrice.address,
      contractBSNTokenPrice.address
    );

    await contractTokenRegistry.setTokenWrapperAddress(
      contractBSNTokenDeposit.address,
      contractBSNTokenDeposit.address
    );

    await contractBosonRouter.setGateApproval(contractGate.address, true);
  }

  let timestamp, tokenSupplyKey: BigNumber, promiseId: string;

  async function preparePromiseKey() {
    timestamp = await Utils.getCurrTimestamp();
    constants.PROMISE_VALID_FROM = timestamp;
    constants.PROMISE_VALID_TO = timestamp + 2 * constants.SECONDS_IN_DAY;

    tokenSupplyKey = calculateTokenSupplyKey(constants.ONE);
    promiseId = keccak256(
      solidityPack(
        ['address', 'uint256', 'uint256', 'uint256', 'address'],
        [
          users.seller.address,
          constants.ZERO,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          contractVoucherKernel.address,
        ]
      )
    );
  }

  describe('TOKEN SUPPLY CREATION WITH TOKEN CONDITIONAL COMMIT (Create Voucher Set)', () => {
    const paymentMethods = {
      ETHETH: 0,
      ETHTKN: 1,
      TKNETH: 2,
      TKNTKN: 3,
    };

    async function generateInputs(
      account: Account,
      deposit: number | string,
      qty: number | string
    ) {
      const txValue = BN(deposit).mul(BN(qty));

      const nonce = await contractBSNTokenDeposit.nonces(account.address);

      const digest = await getApprovalDigest(
        contractBSNTokenDeposit,
        account.address,
        contractBosonRouter.address,
        txValue,
        nonce,
        deadline
      );

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(account.privateKey.slice(2), 'hex')
      );

      return {txValue, v, r, s};
    }

    describe('ETHETH', () => {
      beforeEach(async () => {
        await deployContracts();
        await preparePromiseKey();
      });

      it('Should be able to create Voucher with gate address', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );
        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderETHETHConditional(
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              contractGate.address,
              constants.EMPTY_NFT_TOKEN_ID,
              {value: txValue}
            )
        )
          .to.emit(
            contractBosonRouter,
            eventNames.LOG_CONDITIONAL_ORDER_CREATED
          )
          .withArgs(tokenSupplyKey, contractGate.address)
          .to.emit(contractBosonRouter, eventNames.LOG_ORDER_CREATED)
          .withArgs(
            tokenSupplyKey,
            users.seller.address,
            constants.QTY_10,
            paymentMethods.ETHETH
          )
          .to.emit(contractVoucherKernel, eventNames.LOG_PROMISE_CREATED)
          .withArgs(
            promiseId,
            constants.ONE,
            users.seller.address,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.ZERO
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            constants.ZERO_ADDRESS,
            users.seller.address,
            tokenSupplyKey,
            constants.QTY_10
          );

        //Check VocherKernel State
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

        // Check VoucherSets state
        const sellerVoucherSetsBalance = (
          await contractVoucherSets.functions[fnSignatures.balanceOf1155](
            users.seller.address,
            tokenSupplyKey
          )
        )[0];

        assert.isTrue(
          sellerVoucherSetsBalance.eq(constants.QTY_10),
          'VoucherSets seller balance mismatch'
        );
      });

      describe('Flow with automatic gate.registerVoucherSetId', () => {
        it('Should be able to create Voucher with gate address and non empty nft token id', async () => {
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );
          expect(
            await contractBosonRouter
              .connect(users.seller.signer)
              .requestCreateOrderETHETHConditional(
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.PROMISE_DEPOSITSE1,
                  constants.PROMISE_DEPOSITBU1,
                  constants.QTY_10,
                ],
                contractGate.address,
                constants.NFT_TOKEN_ID,
                {value: txValue}
              )
          )
            .to.emit(contractGate, eventNames.LOG_VOUCHER_SET_REGISTERED)
            .withArgs(tokenSupplyKey, constants.NFT_TOKEN_ID);
        });

        it('[NEGATIVE] Should revert if non empty nft token id and wrong gate address', async () => {
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );
          await expect(
            contractBosonRouter
              .connect(users.seller.signer)
              .requestCreateOrderETHETHConditional(
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.PROMISE_DEPOSITSE1,
                  constants.PROMISE_DEPOSITBU1,
                  constants.QTY_10,
                ],
                users.other1.address, /// gate address that maps to EOA
                constants.NFT_TOKEN_ID,
                {value: txValue}
              )
          ).to.be.revertedWith(revertReasons.INVALID_GATE);
        });
      });

      it('One should get the gate address that handles conditional commit', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );
        await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderETHETHConditional(
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            contractGate.address,
            constants.EMPTY_NFT_TOKEN_ID,
            {value: txValue}
          );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .getVoucherSetToGateContract(tokenSupplyKey)
        ).to.equal(contractGate.address);
      });

      it('Non conditional voucher set should have zero address gate contract', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );
        await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderETHETH(
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            {value: txValue}
          );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .getVoucherSetToGateContract(tokenSupplyKey)
        ).to.equal(constants.ZERO_ADDRESS);
      });

      it('[NEGATIVE] Supplying invalid gate address should revert', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );
        await expect(
          contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderETHETHConditional(
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              constants.ZERO_ADDRESS,
              constants.EMPTY_NFT_TOKEN_ID,
              {value: txValue}
            )
        ).to.be.revertedWith(revertReasons.INVALID_GATE);
      });
    });

    describe('TKNTKN', () => {
      beforeEach(async () => {
        await deployContracts();
        await preparePromiseKey();

        const tokensToMint = BN(constants.product_price).mul(
          BN(constants.QTY_20)
        );

        utils = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNTKN()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenPrice,
            contractBSNTokenDeposit
          );

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.seller.address,
          tokensToMint
        );
      });

      it('Should be able to create Voucher with gate address', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.seller,
          constants.PROMISE_DEPOSITSE1,
          constants.QTY_10
        );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderTKNTKNWithPermitConditional(
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
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              contractGate.address,
              constants.EMPTY_NFT_TOKEN_ID
            )
        )
          .to.emit(
            contractBosonRouter,
            eventNames.LOG_CONDITIONAL_ORDER_CREATED
          )
          .withArgs(tokenSupplyKey, contractGate.address)
          .to.emit(contractBosonRouter, eventNames.LOG_ORDER_CREATED)
          .withArgs(
            tokenSupplyKey,
            users.seller.address,
            constants.QTY_10,
            paymentMethods.TKNTKN
          )
          .to.emit(contractVoucherKernel, eventNames.LOG_PROMISE_CREATED)
          .withArgs(
            promiseId,
            constants.ONE,
            users.seller.address,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.ZERO
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            constants.ZERO_ADDRESS,
            users.seller.address,
            tokenSupplyKey,
            constants.QTY_10
          );

        //Check VocherKernel State
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

        // Check VoucherSets state
        const sellerVoucherSetsBalance = (
          await contractVoucherSets.functions[fnSignatures.balanceOf1155](
            users.seller.address,
            tokenSupplyKey
          )
        )[0];

        assert.isTrue(
          sellerVoucherSetsBalance.eq(constants.QTY_10),
          'VoucherSets seller balance mismatch'
        );
      });

      describe('Flow with automatic gate.registerVoucherSetId', () => {
        it('Should be able to create Voucher with gate address and non empty nft token id', async () => {
          const {txValue, v, r, s} = await generateInputs(
            users.seller,
            constants.PROMISE_DEPOSITSE1,
            constants.QTY_10
          );

          expect(
            await contractBosonRouter
              .connect(users.seller.signer)
              .requestCreateOrderTKNTKNWithPermitConditional(
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
                  constants.PROMISE_DEPOSITSE1,
                  constants.PROMISE_DEPOSITBU1,
                  constants.QTY_10,
                ],
                contractGate.address,
                constants.NFT_TOKEN_ID
              )
          )
            .to.emit(contractGate, eventNames.LOG_VOUCHER_SET_REGISTERED)
            .withArgs(tokenSupplyKey, constants.NFT_TOKEN_ID);
        });

        it('[NEGATIVE] Should revert if non empty nft token id and wrong gate address', async () => {
          const {txValue, v, r, s} = await generateInputs(
            users.seller,
            constants.PROMISE_DEPOSITSE1,
            constants.QTY_10
          );

          await expect(
            contractBosonRouter
              .connect(users.seller.signer)
              .requestCreateOrderTKNTKNWithPermitConditional(
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
                  constants.PROMISE_DEPOSITSE1,
                  constants.PROMISE_DEPOSITBU1,
                  constants.QTY_10,
                ],
                users.other1.address, /// gate address that maps to EOA
                constants.NFT_TOKEN_ID
              )
          ).to.be.revertedWith(revertReasons.INVALID_GATE);
        });
      });

      it('One should get the gate address that handles conditional commit', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.seller,
          constants.PROMISE_DEPOSITSE1,
          constants.QTY_10
        );

        await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderTKNTKNWithPermitConditional(
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
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            contractGate.address,
            constants.EMPTY_NFT_TOKEN_ID
          );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .getVoucherSetToGateContract(tokenSupplyKey)
        ).to.equal(contractGate.address);
      });

      it('Non conditional voucher set should have zero address gate contract', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.seller,
          constants.PROMISE_DEPOSITSE1,
          constants.QTY_10
        );

        await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderTKNTKNWithPermit(
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
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ]
          );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .getVoucherSetToGateContract(tokenSupplyKey)
        ).to.equal(constants.ZERO_ADDRESS);
      });

      it('[NEGATIVE] Supplying invalid gate address should revert', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.seller,
          constants.PROMISE_DEPOSITSE1,
          constants.QTY_10
        );

        await expect(
          contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderTKNTKNWithPermitConditional(
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
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              constants.ZERO_ADDRESS,
              constants.EMPTY_NFT_TOKEN_ID
            )
        ).to.be.revertedWith(revertReasons.INVALID_GATE);
      });
    });

    describe('ETHTKN', () => {
      beforeEach(async () => {
        await deployContracts();
        await preparePromiseKey();

        const tokensToMint = BN(constants.product_price).mul(
          BN(constants.QTY_20)
        );

        utils = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNTKN()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenPrice,
            contractBSNTokenDeposit
          );

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.seller.address,
          tokensToMint
        );
      });

      it('Should be able to create Voucher with gate address', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.seller,
          constants.PROMISE_DEPOSITSE1,
          constants.QTY_10
        );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderETHTKNWithPermitConditional(
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
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              contractGate.address,
              constants.EMPTY_NFT_TOKEN_ID
            )
        )
          .to.emit(
            contractBosonRouter,
            eventNames.LOG_CONDITIONAL_ORDER_CREATED
          )
          .withArgs(tokenSupplyKey, contractGate.address)
          .to.emit(contractBosonRouter, eventNames.LOG_ORDER_CREATED)
          .withArgs(
            tokenSupplyKey,
            users.seller.address,
            constants.QTY_10,
            paymentMethods.ETHTKN
          )
          .to.emit(contractVoucherKernel, eventNames.LOG_PROMISE_CREATED)
          .withArgs(
            promiseId,
            constants.ONE,
            users.seller.address,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.ZERO
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            constants.ZERO_ADDRESS,
            users.seller.address,
            tokenSupplyKey,
            constants.QTY_10
          );

        //Check VocherKernel State
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

        // Check VoucherSets state
        const sellerVoucherSetsBalance = (
          await contractVoucherSets.functions[fnSignatures.balanceOf1155](
            users.seller.address,
            tokenSupplyKey
          )
        )[0];

        assert.isTrue(
          sellerVoucherSetsBalance.eq(constants.QTY_10),
          'VoucherSets seller balance mismatch'
        );
      });

      describe('Flow with automatic gate.registerVoucherSetId', () => {
        it('Should be able to create Voucher with gate address and non empty nft token id', async () => {
          const {txValue, v, r, s} = await generateInputs(
            users.seller,
            constants.PROMISE_DEPOSITSE1,
            constants.QTY_10
          );

          expect(
            await contractBosonRouter
              .connect(users.seller.signer)
              .requestCreateOrderETHTKNWithPermitConditional(
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
                  constants.PROMISE_DEPOSITSE1,
                  constants.PROMISE_DEPOSITBU1,
                  constants.QTY_10,
                ],
                contractGate.address,
                constants.NFT_TOKEN_ID
              )
          )
            .to.emit(contractGate, eventNames.LOG_VOUCHER_SET_REGISTERED)
            .withArgs(tokenSupplyKey, constants.NFT_TOKEN_ID);
        });

        it('[NEGATIVE] Should revert if non empty nft token id and wrong gate address', async () => {
          const {txValue, v, r, s} = await generateInputs(
            users.seller,
            constants.PROMISE_DEPOSITSE1,
            constants.QTY_10
          );

          await expect(
            contractBosonRouter
              .connect(users.seller.signer)
              .requestCreateOrderETHTKNWithPermitConditional(
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
                  constants.PROMISE_DEPOSITSE1,
                  constants.PROMISE_DEPOSITBU1,
                  constants.QTY_10,
                ],
                users.other1.address, /// gate address that maps to EOA
                constants.NFT_TOKEN_ID
              )
          ).to.be.revertedWith(revertReasons.INVALID_GATE);
        });
      });

      it('One should get the gate address that handles conditional commit', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.seller,
          constants.PROMISE_DEPOSITSE1,
          constants.QTY_10
        );

        await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderETHTKNWithPermitConditional(
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
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            contractGate.address,
            constants.EMPTY_NFT_TOKEN_ID
          );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .getVoucherSetToGateContract(tokenSupplyKey)
        ).to.equal(contractGate.address);
      });

      it('Non conditional voucher set should have zero address gate contract', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.seller,
          constants.PROMISE_DEPOSITSE1,
          constants.QTY_10
        );

        await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderETHTKNWithPermit(
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
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ]
          );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .getVoucherSetToGateContract(tokenSupplyKey)
        ).to.equal(constants.ZERO_ADDRESS);
      });

      it('[NEGATIVE]Supplying invalid gate address should revert', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.seller,
          constants.PROMISE_DEPOSITSE1,
          constants.QTY_10
        );

        await expect(
          contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderETHTKNWithPermitConditional(
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
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              constants.ZERO_ADDRESS,
              constants.EMPTY_NFT_TOKEN_ID
            )
        ).to.be.revertedWith(revertReasons.INVALID_GATE);
      });
    });

    describe('TKNETH', () => {
      beforeEach(async () => {
        await deployContracts();
        await preparePromiseKey();
      });

      it('Should be able to create Voucher with gate address', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );
        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderTKNETHConditional(
              contractBSNTokenPrice.address,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              contractGate.address,
              constants.EMPTY_NFT_TOKEN_ID,
              {value: txValue}
            )
        )
          .to.emit(
            contractBosonRouter,
            eventNames.LOG_CONDITIONAL_ORDER_CREATED
          )
          .withArgs(tokenSupplyKey, contractGate.address)
          .to.emit(contractBosonRouter, eventNames.LOG_ORDER_CREATED)
          .withArgs(
            tokenSupplyKey,
            users.seller.address,
            constants.QTY_10,
            paymentMethods.TKNETH
          )
          .to.emit(contractVoucherKernel, eventNames.LOG_PROMISE_CREATED)
          .withArgs(
            promiseId,
            constants.ONE,
            users.seller.address,
            constants.PROMISE_VALID_FROM,
            constants.PROMISE_VALID_TO,
            constants.ZERO
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            constants.ZERO_ADDRESS,
            users.seller.address,
            tokenSupplyKey,
            constants.QTY_10
          );

        //Check VocherKernel State
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

        // Check VoucherSets state
        const sellerVoucherSetsBalance = (
          await contractVoucherSets.functions[fnSignatures.balanceOf1155](
            users.seller.address,
            tokenSupplyKey
          )
        )[0];

        assert.isTrue(
          sellerVoucherSetsBalance.eq(constants.QTY_10),
          'VoucherSets seller balance mismatch'
        );
      });

      describe('Flow with automatic gate.registerVoucherSetId', () => {
        it('Should be able to create Voucher with gate address and non empty nft token id', async () => {
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );
          expect(
            await contractBosonRouter
              .connect(users.seller.signer)
              .requestCreateOrderTKNETHConditional(
                contractBSNTokenPrice.address,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.PROMISE_DEPOSITSE1,
                  constants.PROMISE_DEPOSITBU1,
                  constants.QTY_10,
                ],
                contractGate.address,
                constants.NFT_TOKEN_ID,
                {value: txValue}
              )
          )
            .to.emit(contractGate, eventNames.LOG_VOUCHER_SET_REGISTERED)
            .withArgs(tokenSupplyKey, constants.NFT_TOKEN_ID);
        });

        it('[NEGATIVE] Should revert if non empty nft token id and wrong gate address', async () => {
          const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
            BN(constants.QTY_10)
          );
          await expect(
            contractBosonRouter
              .connect(users.seller.signer)
              .requestCreateOrderTKNETHConditional(
                contractBSNTokenPrice.address,
                [
                  constants.PROMISE_VALID_FROM,
                  constants.PROMISE_VALID_TO,
                  constants.PROMISE_PRICE1,
                  constants.PROMISE_DEPOSITSE1,
                  constants.PROMISE_DEPOSITBU1,
                  constants.QTY_10,
                ],
                users.other1.address, /// gate address that maps to EOA
                constants.NFT_TOKEN_ID,
                {value: txValue}
              )
          ).to.be.revertedWith(revertReasons.INVALID_GATE);
        });
      });

      it('One should get the gate address that handles conditional commit', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );
        await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderTKNETHConditional(
            contractBSNTokenPrice.address,
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            contractGate.address,
            constants.EMPTY_NFT_TOKEN_ID,
            {value: txValue}
          );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .getVoucherSetToGateContract(tokenSupplyKey)
        ).to.equal(contractGate.address);
      });

      it('Non conditional voucher set should have zero address gate contract', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );
        await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderTKNETH(
            contractBSNTokenPrice.address,
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            {value: txValue}
          );

        expect(
          await contractBosonRouter
            .connect(users.seller.signer)
            .getVoucherSetToGateContract(tokenSupplyKey)
        ).to.equal(constants.ZERO_ADDRESS);
      });

      it('[NEGATIVE] Supplying invalid gate address should revert', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );
        await expect(
          contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderTKNETHConditional(
              contractBSNTokenPrice.address,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              constants.ZERO_ADDRESS,
              constants.EMPTY_NFT_TOKEN_ID,
              {value: txValue}
            )
        ).to.be.revertedWith(revertReasons.INVALID_GATE);
      });
    });
  });

  describe('VOUCHER CREATION (Commit to buy)', () => {
    describe('ETHETH', () => {
      beforeEach(async () => {
        await deployContracts();
        await preparePromiseKey();

        await contractERC1155NonTransferable.mint(
          users.buyer.address,
          constants.NFT_TOKEN_ID,
          constants.ONE,
          constants.ZERO_BYTES
        );

        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );

        const txOrder = await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderETHETHConditional(
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            contractGate.address,
            constants.EMPTY_NFT_TOKEN_ID,
            {value: txValue}
          );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        tokenSupplyKey = eventArgs._tokenIdSupply;

        await contractGate.registerVoucherSetId(
          tokenSupplyKey,
          constants.NFT_TOKEN_ID
        );
      });

      it('Should be able to request voucher', async () => {
        const voucherTokenId = tokenSupplyKey.or(constants.ONE);

        const txValue = BN(constants.PROMISE_DEPOSITBU1).add(
          BN(constants.PROMISE_PRICE1)
        );
        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;

        expect(
          await buyerInstance.requestVoucherETHETH(
            tokenSupplyKey,
            users.seller.address,
            {
              value: txValue,
            }
          )
        )
          .to.emit(contractGate, eventNames.LOG_USER_VOUCHER_DEACTIVATED)
          .withArgs(users.buyer.address, tokenSupplyKey)
          .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
          .withArgs(
            tokenSupplyKey,
            voucherTokenId,
            users.seller.address,
            users.buyer.address,
            promiseId
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            users.seller.address,
            constants.ZERO,
            tokenSupplyKey,
            constants.ONE
          )
          .to.emit(contractVouchers, eventNames.TRANSFER)
          .withArgs(constants.ZERO, users.buyer.address, voucherTokenId);

        const voucherStatus = await contractVoucherKernel.getVoucherStatus(
          voucherTokenId
        );

        const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

        assert.equal(
          voucherStatus[0],
          expectedStatus.toNumber(),
          'Wrong status'
        );
        assert.isFalse(voucherStatus[1], 'Payment should not be released');
        assert.isFalse(voucherStatus[2], 'Deposit should not be released');
        assert.isTrue(
          voucherStatus[3].eq(constants.ZERO),
          'Complaint period should not started yet'
        );
        assert.isTrue(
          voucherStatus[4].eq(constants.ZERO),
          'COF period should not started yet'
        );
      });

      it('[NEGATIVE] Should not be able to request voucher twice', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITBU1).add(
          BN(constants.PROMISE_PRICE1)
        );

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;

        await buyerInstance.requestVoucherETHETH(
          tokenSupplyKey,
          users.seller.address,
          {
            value: txValue,
          }
        );

        await expect(
          buyerInstance.requestVoucherETHETH(
            tokenSupplyKey,
            users.seller.address,
            {
              value: txValue,
            }
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should not be able to request voucher without NFT token', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITBU1).add(
          BN(constants.PROMISE_PRICE1)
        );

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;

        await expect(
          buyerInstance.requestVoucherETHETH(
            tokenSupplyKey,
            users.seller.address,
            {
              value: txValue,
            }
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should revert if specified gate contract is not approved', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );

        await contractBosonRouter.setGateApproval(contractGate.address, false);

        await expect(
          contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderETHETHConditional(
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              contractGate.address,
              constants.EMPTY_NFT_TOKEN_ID,
              {value: txValue}
            )
        ).to.be.revertedWith(revertReasons.INVALID_GATE);
      });

      it('[NEGATIVE] Should revert if mapping between voucherset and nfttoken does not exist', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );

        await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderETHETHConditional(
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            contractGate.address,
            constants.EMPTY_NFT_TOKEN_ID,
            {value: txValue}
          );

        const tokenSupplyKey = calculateTokenSupplyKey(constants.TWO);

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherETHETH(
            tokenSupplyKey,
            users.seller.address,
            {
              value: txValue,
            }
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });
    }); // end ETHETH

    describe('TKNTKN', () => {
      async function generateInputs(
        account: Account,
        deposit: number | string,
        product_price: number | string
      ) {
        const txValue = BN(deposit).add(BN(product_price));
        const DEPOSIT = await generateDepositInputs(account, deposit);
        const PRICE = await generatePriceInputs(account, product_price);
        return {txValue, DEPOSIT, PRICE};
      }

      async function generateDepositInputs(
        account: Account,
        deposit: number | string
      ) {
        const nonce = await contractBSNTokenDeposit.nonces(account.address);

        const digest = await getApprovalDigest(
          contractBSNTokenDeposit,
          account.address,
          contractBosonRouter.address,
          deposit,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(account.privateKey.slice(2), 'hex')
        );

        return {v, r, s};
      }

      async function generatePriceInputs(
        account: Account,
        product_price: number | string
      ) {
        const nonce = await contractBSNTokenDeposit.nonces(account.address);

        const digest = await getApprovalDigest(
          contractBSNTokenPrice,
          account.address,
          contractBosonRouter.address,
          product_price,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(account.privateKey.slice(2), 'hex')
        );

        return {v, r, s};
      }

      beforeEach(async () => {
        await deployContracts();
        await preparePromiseKey();

        const tokensToMint = BN(constants.product_price).mul(
          BN(constants.QTY_20)
        );

        utils = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNTKN()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenPrice,
            contractBSNTokenDeposit
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

        await contractERC1155NonTransferable.mint(
          users.buyer.address,
          constants.NFT_TOKEN_ID,
          constants.ONE,
          constants.ZERO_BYTES
        );

        const txOrder = await utils.createOrderConditional(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.PROMISE_DEPOSITSE1,
          constants.buyer_deposit,
          constants.QTY_10,
          contractGate,
          0,
          true
        );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        tokenSupplyKey = eventArgs._tokenIdSupply;

        await contractGate.registerVoucherSetId(
          tokenSupplyKey,
          constants.NFT_TOKEN_ID
        );
      });

      it('Should be able to request voucher', async () => {
        const voucherTokenId = tokenSupplyKey.or(constants.ONE);

        const {txValue, DEPOSIT, PRICE} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );
        const vDeposit = DEPOSIT.v;
        const rDeposit = DEPOSIT.r;
        const sDeposit = DEPOSIT.s;
        const vPrice = PRICE.v;
        const rPrice = PRICE.r;
        const sPrice = PRICE.s;

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;
        expect(
          await buyerInstance.requestVoucherTKNTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          )
        )
          .to.emit(contractGate, eventNames.LOG_USER_VOUCHER_DEACTIVATED)
          .withArgs(users.buyer.address, tokenSupplyKey)
          .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
          .withArgs(
            tokenSupplyKey,
            voucherTokenId,
            users.seller.address,
            users.buyer.address,
            promiseId
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            users.seller.address,
            constants.ZERO,
            tokenSupplyKey,
            constants.ONE
          )
          .to.emit(contractVouchers, eventNames.TRANSFER)
          .withArgs(constants.ZERO, users.buyer.address, voucherTokenId);

        const voucherStatus = await contractVoucherKernel.getVoucherStatus(
          voucherTokenId
        );

        const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

        assert.equal(
          voucherStatus[0],
          expectedStatus.toNumber(),
          'Wrong status'
        );
        assert.isFalse(voucherStatus[1], 'Payment should not be released');
        assert.isFalse(voucherStatus[2], 'Deposit should not be released');
        assert.isTrue(
          voucherStatus[3].eq(constants.ZERO),
          'Complaint period should not started yet'
        );
        assert.isTrue(
          voucherStatus[4].eq(constants.ZERO),
          'COF period should not started yet'
        );
      });

      it('[NEGATIVE] Should not be able to request voucher twice', async () => {
        await utils.commitToBuy(
          users.buyer,
          users.seller,
          tokenSupplyKey,
          constants.product_price,
          constants.buyer_deposit
        );

        const {txValue, DEPOSIT, PRICE} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );
        const vDeposit = DEPOSIT.v;
        const rDeposit = DEPOSIT.r;
        const sDeposit = DEPOSIT.s;
        const vPrice = PRICE.v;
        const rPrice = PRICE.r;
        const sPrice = PRICE.s;

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should not be able to request voucher without NFT token', async () => {
        const {txValue, DEPOSIT, PRICE} = await generateInputs(
          users.other1,
          constants.buyer_deposit,
          constants.product_price
        );

        const vDeposit = DEPOSIT.v;
        const rDeposit = DEPOSIT.r;
        const sDeposit = DEPOSIT.s;
        const vPrice = PRICE.v;
        const rPrice = PRICE.r;
        const sPrice = PRICE.s;

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should revert if specified gate contract does not exist', async () => {
        await expect(
          utils.createOrderConditional(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.product_price,
            constants.seller_deposit,
            constants.buyer_deposit,
            constants.QTY_10,
            users.other1, /// gate address that maps to EOA
            0
          )
        ).to.be.revertedWith(revertReasons.INVALID_GATE);
      });

      it('[NEGATIVE] Should revert if mapping between voucherset and nfttoken does not exist', async () => {
        await utils.createOrderConditional(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_10,
          contractGate,
          0
        );

        const tokenSupplyKey = calculateTokenSupplyKey(constants.TWO);

        const {txValue, DEPOSIT, PRICE} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const vDeposit = DEPOSIT.v;
        const rDeposit = DEPOSIT.r;
        const sDeposit = DEPOSIT.s;
        const vPrice = PRICE.v;
        const rPrice = PRICE.r;
        const sPrice = PRICE.s;

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            vPrice,
            rPrice,
            sPrice,
            vDeposit,
            rDeposit,
            sDeposit
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });
    }); // end TKNTKN

    describe('TKNTKN same', () => {
      async function generateInputs(
        account: Account,
        deposit: number | string,
        product_price: number | string
      ) {
        const nonce = await contractBSNTokenDeposit.nonces(account.address);
        const txValue = BN(deposit).add(BN(product_price));

        const digest = await getApprovalDigest(
          contractBSNTokenDeposit,
          account.address,
          contractBosonRouter.address,
          txValue,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(account.privateKey.slice(2), 'hex')
        );
        return {txValue, v, r, s};
      }

      beforeEach(async () => {
        await deployContracts();
        await preparePromiseKey();

        const tokensToMint = BN(constants.product_price).mul(
          BN(constants.QTY_20)
        );

        utils = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNTKN()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenDeposit,
            contractBSNTokenDeposit
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

        await contractERC1155NonTransferable.mint(
          users.buyer.address,
          constants.NFT_TOKEN_ID,
          constants.ONE,
          constants.ZERO_BYTES
        );

        const txOrder = await utils.createOrderConditional(
          users.seller,
          constants.PROMISE_VALID_FROM,
          constants.PROMISE_VALID_TO,
          constants.product_price,
          constants.PROMISE_DEPOSITSE1,
          constants.buyer_deposit,
          constants.QTY_10,
          contractGate,
          0,
          true
        );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        tokenSupplyKey = eventArgs._tokenIdSupply;

        await contractGate.registerVoucherSetId(
          tokenSupplyKey,
          constants.NFT_TOKEN_ID
        );
      });

      it('Should be able to request voucher', async () => {
        const voucherTokenId = tokenSupplyKey.or(constants.ONE);

        const {txValue, v, r, s} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;
        expect(
          await buyerInstance.requestVoucherTKNTKNSameWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            v,
            r,
            s
          )
        )
          .to.emit(contractGate, eventNames.LOG_USER_VOUCHER_DEACTIVATED)
          .withArgs(users.buyer.address, tokenSupplyKey)
          .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
          .withArgs(
            tokenSupplyKey,
            voucherTokenId,
            users.seller.address,
            users.buyer.address,
            promiseId
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            users.seller.address,
            constants.ZERO,
            tokenSupplyKey,
            constants.ONE
          )
          .to.emit(contractVouchers, eventNames.TRANSFER)
          .withArgs(constants.ZERO, users.buyer.address, voucherTokenId);

        const voucherStatus = await contractVoucherKernel.getVoucherStatus(
          voucherTokenId
        );

        const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

        assert.equal(
          voucherStatus[0],
          expectedStatus.toNumber(),
          'Wrong status'
        );
        assert.isFalse(voucherStatus[1], 'Payment should not be released');
        assert.isFalse(voucherStatus[2], 'Deposit should not be released');
        assert.isTrue(
          voucherStatus[3].eq(constants.ZERO),
          'Complaint period should not started yet'
        );
        assert.isTrue(
          voucherStatus[4].eq(constants.ZERO),
          'COF period should not started yet'
        );
      });

      it('[NEGATIVE] Should not be able to request voucher twice', async () => {
        let {txValue, v, r, s} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;

        await buyerInstance.requestVoucherTKNTKNSameWithPermit(
          tokenSupplyKey,
          users.seller.address,
          txValue,
          deadline,
          v,
          r,
          s
        );

        ({txValue, v, r, s} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        ));

        await expect(
          buyerInstance.requestVoucherTKNTKNSameWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            v,
            r,
            s
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should not be able to request voucher without NFT token', async () => {
        const {txValue, v, r, s} = await generateInputs(
          users.other1,
          constants.buyer_deposit,
          constants.product_price
        );

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNSameWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            v,
            r,
            s
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should revert if specified gate contract does not exist', async () => {
        await expect(
          utils.createOrderConditional(
            users.seller,
            timestamp,
            timestamp + constants.SECONDS_IN_DAY,
            constants.product_price,
            constants.seller_deposit,
            constants.buyer_deposit,
            constants.QTY_10,
            users.other1, /// gate address that maps to EOA
            0
          )
        ).to.be.revertedWith(revertReasons.INVALID_GATE);
      });

      it('[NEGATIVE] Should revert if mapping between voucherset and nfttoken not exist', async () => {
        await utils.createOrderConditional(
          users.seller,
          timestamp,
          timestamp + constants.SECONDS_IN_DAY,
          constants.product_price,
          constants.seller_deposit,
          constants.buyer_deposit,
          constants.QTY_10,
          contractGate,
          0
        );

        const tokenSupplyKey = calculateTokenSupplyKey(constants.TWO);

        const {txValue, v, r, s} = await generateInputs(
          users.buyer,
          constants.buyer_deposit,
          constants.product_price
        );

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNTKNSameWithPermit(
            tokenSupplyKey,
            users.seller.address,
            txValue,
            deadline,
            v,
            r,
            s
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });
    }); // end TKNTKN

    describe('ETHTKN', () => {
      async function generateInputs(
        account: Account,
        deposit: number | string
      ) {
        const nonce = await contractBSNTokenDeposit.nonces(account.address);

        const digest = await getApprovalDigest(
          contractBSNTokenDeposit,
          account.address,
          contractBosonRouter.address,
          deposit,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(account.privateKey.slice(2), 'hex')
        );
        return {v, r, s};
      }

      beforeEach(async () => {
        await deployContracts();
        await preparePromiseKey();

        const tokensToMint = BN(constants.product_price).mul(
          BN(constants.QTY_20)
        );

        utils = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNTKN()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenDeposit,
            contractBSNTokenDeposit
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

        await contractERC1155NonTransferable.mint(
          users.buyer.address,
          constants.NFT_TOKEN_ID,
          constants.ONE,
          constants.ZERO_BYTES
        );

        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );

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

        const txOrder = await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderETHTKNWithPermitConditional(
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
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            contractGate.address,
            constants.EMPTY_NFT_TOKEN_ID
          );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        tokenSupplyKey = eventArgs._tokenIdSupply;

        await contractGate.registerVoucherSetId(
          tokenSupplyKey,
          constants.NFT_TOKEN_ID
        );
      });

      it('Should be able to request voucher', async () => {
        const voucherTokenId = tokenSupplyKey.or(constants.ONE);

        const {v, r, s} = await generateInputs(
          users.buyer,
          constants.PROMISE_DEPOSITBU1
        );

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;

        expect(
          await buyerInstance.requestVoucherETHTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            constants.PROMISE_DEPOSITBU1,
            deadline,
            v,
            r,
            s,
            {value: constants.PROMISE_PRICE1}
          )
        )
          .to.emit(contractGate, eventNames.LOG_USER_VOUCHER_DEACTIVATED)
          .withArgs(users.buyer.address, tokenSupplyKey)
          .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
          .withArgs(
            tokenSupplyKey,
            voucherTokenId,
            users.seller.address,
            users.buyer.address,
            promiseId
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            users.seller.address,
            constants.ZERO,
            tokenSupplyKey,
            constants.ONE
          )
          .to.emit(contractVouchers, eventNames.TRANSFER)
          .withArgs(constants.ZERO, users.buyer.address, voucherTokenId);

        const voucherStatus = await contractVoucherKernel.getVoucherStatus(
          voucherTokenId
        );

        const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

        assert.equal(
          voucherStatus[0],
          expectedStatus.toNumber(),
          'Wrong status'
        );
        assert.isFalse(voucherStatus[1], 'Payment should not be released');
        assert.isFalse(voucherStatus[2], 'Deposit should not be released');
        assert.isTrue(
          voucherStatus[3].eq(constants.ZERO),
          'Complaint period should not started yet'
        );
        assert.isTrue(
          voucherStatus[4].eq(constants.ZERO),
          'COF period should not started yet'
        );
      });

      it('[NEGATIVE] Should not be able to request voucher twice', async () => {
        let {v, r, s} = await generateInputs(
          users.buyer,
          constants.PROMISE_DEPOSITBU1
        );

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;

        await buyerInstance.requestVoucherETHTKNWithPermit(
          tokenSupplyKey,
          users.seller.address,
          constants.PROMISE_DEPOSITBU1,
          deadline,
          v,
          r,
          s,
          {value: constants.PROMISE_PRICE1}
        );

        ({v, r, s} = await generateInputs(
          users.buyer,
          constants.PROMISE_DEPOSITBU1
        ));

        await expect(
          buyerInstance.requestVoucherETHTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            constants.PROMISE_DEPOSITBU1,
            deadline,
            v,
            r,
            s,
            {value: constants.PROMISE_PRICE1}
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should not be able to request voucher without NFT token', async () => {
        const {v, r, s} = await generateInputs(
          users.other1,
          constants.PROMISE_DEPOSITBU1
        );

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherETHTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            constants.PROMISE_DEPOSITBU1,
            deadline,
            v,
            r,
            s,
            {value: constants.PROMISE_PRICE1}
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should revert if specified gate contract does not exist', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );

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

        const sellerSignature = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(users.seller.privateKey.slice(2), 'hex')
        );

        await expect(
          contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderETHTKNWithPermitConditional(
              contractBSNTokenDeposit.address,
              txValue,
              deadline,
              sellerSignature.v,
              sellerSignature.r,
              sellerSignature.s,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              users.other1.address, /// gate address that maps to EOA
              constants.EMPTY_NFT_TOKEN_ID
            )
        ).to.be.revertedWith(revertReasons.INVALID_GATE);
      });

      it('[NEGATIVE] Should revert if mapping between voucherset and nfttoken does not exist', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );

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

        const sellerSignature = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(users.seller.privateKey.slice(2), 'hex')
        );

        const txOrder = await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderETHTKNWithPermitConditional(
            contractBSNTokenDeposit.address,
            txValue,
            deadline,
            sellerSignature.v,
            sellerSignature.r,
            sellerSignature.s,
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            contractGate.address,
            constants.EMPTY_NFT_TOKEN_ID
          );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        const tokenSupplyKey = eventArgs._tokenIdSupply;

        const {v, r, s} = await generateInputs(
          users.buyer,
          constants.PROMISE_DEPOSITBU1
        );

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherETHTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            constants.PROMISE_DEPOSITBU1,
            deadline,
            v,
            r,
            s,
            {value: constants.PROMISE_PRICE1}
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });
    }); // end ETHTKN

    describe('TKNETH', () => {
      async function generateInputs(
        account: Account,
        product_price: number | string
      ) {
        const nonce = await contractBSNTokenDeposit.nonces(account.address);

        const digest = await getApprovalDigest(
          contractBSNTokenDeposit,
          account.address,
          contractBosonRouter.address,
          product_price,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(account.privateKey.slice(2), 'hex')
        );
        return {v, r, s};
      }

      beforeEach(async () => {
        await deployContracts();
        await preparePromiseKey();

        const tokensToMint = BN(constants.product_price).mul(
          BN(constants.QTY_20)
        );

        utils = await UtilsBuilder.create()
          .ERC20withPermit()
          .TKNTKN()
          .buildAsync(
            contractVoucherSets,
            contractVouchers,
            contractVoucherKernel,
            contractCashier,
            contractBosonRouter,
            contractBSNTokenDeposit,
            contractBSNTokenDeposit
          );

        await utils.mintTokens(
          'contractBSNTokenDeposit',
          users.buyer.address,
          tokensToMint
        );

        await contractERC1155NonTransferable.mint(
          users.buyer.address,
          constants.NFT_TOKEN_ID,
          constants.ONE,
          constants.ZERO_BYTES
        );

        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );

        const txOrder = await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderTKNETHConditional(
            contractBSNTokenDeposit.address,
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            contractGate.address,
            constants.EMPTY_NFT_TOKEN_ID,
            {value: txValue}
          );

        const txReceipt = await txOrder.wait();

        let eventArgs;

        eventUtils.assertEventEmitted(
          txReceipt,
          BosonRouter_Factory,
          eventNames.LOG_ORDER_CREATED,
          (e) => (eventArgs = e)
        );

        tokenSupplyKey = eventArgs._tokenIdSupply;

        await contractGate.registerVoucherSetId(
          tokenSupplyKey,
          constants.NFT_TOKEN_ID
        );
      });

      it('Should be able to request voucher', async () => {
        const voucherTokenId = tokenSupplyKey.or(constants.ONE);

        const {v, r, s} = await generateInputs(
          users.buyer,
          constants.PROMISE_PRICE1
        );

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;

        expect(
          await buyerInstance.requestVoucherTKNETHWithPermit(
            tokenSupplyKey,
            users.seller.address,
            constants.PROMISE_PRICE1,
            deadline,
            v,
            r,
            s,
            {value: constants.PROMISE_DEPOSITBU1}
          )
        )
          .to.emit(contractGate, eventNames.LOG_USER_VOUCHER_DEACTIVATED)
          .withArgs(users.buyer.address, tokenSupplyKey)
          .to.emit(contractVoucherKernel, eventNames.LOG_VOUCHER_DELIVERED)
          .withArgs(
            tokenSupplyKey,
            voucherTokenId,
            users.seller.address,
            users.buyer.address,
            promiseId
          )
          .to.emit(contractVoucherSets, eventNames.TRANSFER_SINGLE)
          .withArgs(
            contractVoucherKernel.address,
            users.seller.address,
            constants.ZERO,
            tokenSupplyKey,
            constants.ONE
          )
          .to.emit(contractVouchers, eventNames.TRANSFER)
          .withArgs(constants.ZERO, users.buyer.address, voucherTokenId);

        const voucherStatus = await contractVoucherKernel.getVoucherStatus(
          voucherTokenId
        );

        const expectedStatus = constants.ZERO.or(constants.ONE.shl(6)); // as per contract implementations

        assert.equal(
          voucherStatus[0],
          expectedStatus.toNumber(),
          'Wrong status'
        );
        assert.isFalse(voucherStatus[1], 'Payment should not be released');
        assert.isFalse(voucherStatus[2], 'Deposit should not be released');
        assert.isTrue(
          voucherStatus[3].eq(constants.ZERO),
          'Complaint period should not started yet'
        );
        assert.isTrue(
          voucherStatus[4].eq(constants.ZERO),
          'COF period should not started yet'
        );
      });

      it('[NEGATIVE] Should not be able to request voucher twice', async () => {
        let {v, r, s} = await generateInputs(
          users.buyer,
          constants.PROMISE_PRICE1
        );

        const buyerInstance = contractBosonRouter.connect(
          users.buyer.signer
        ) as BosonRouter;

        await buyerInstance.requestVoucherTKNETHWithPermit(
          tokenSupplyKey,
          users.seller.address,
          constants.PROMISE_PRICE1,
          deadline,
          v,
          r,
          s,
          {value: constants.PROMISE_DEPOSITBU1}
        );

        ({v, r, s} = await generateInputs(
          users.buyer,
          constants.PROMISE_PRICE1
        ));

        await expect(
          buyerInstance.requestVoucherTKNETHWithPermit(
            tokenSupplyKey,
            users.seller.address,
            constants.PROMISE_PRICE1,
            deadline,
            v,
            r,
            s,
            {value: constants.PROMISE_DEPOSITBU1}
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should not be able to request voucher without NFT token', async () => {
        const {v, r, s} = await generateInputs(
          users.other1,
          constants.PROMISE_PRICE1
        );

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherTKNETHWithPermit(
            tokenSupplyKey,
            users.seller.address,
            constants.PROMISE_PRICE1,
            deadline,
            v,
            r,
            s,
            {value: constants.PROMISE_DEPOSITBU1}
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });

      it('[NEGATIVE] Should revert if specified gate contract does not exist', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );
        await expect(
          contractBosonRouter
            .connect(users.seller.signer)
            .requestCreateOrderTKNETHConditional(
              contractBSNTokenDeposit.address,
              [
                constants.PROMISE_VALID_FROM,
                constants.PROMISE_VALID_TO,
                constants.PROMISE_PRICE1,
                constants.PROMISE_DEPOSITSE1,
                constants.PROMISE_DEPOSITBU1,
                constants.QTY_10,
              ],
              users.other1.address, /// gate address that maps to EOA
              constants.EMPTY_NFT_TOKEN_ID,
              {value: txValue}
            )
        ).to.be.revertedWith(revertReasons.INVALID_GATE);
      });

      it('[NEGATIVE] Should revert if mapping between voucherset and nfttoken does not exist', async () => {
        const txValue = BN(constants.PROMISE_DEPOSITSE1).mul(
          BN(constants.QTY_10)
        );

        await contractBosonRouter
          .connect(users.seller.signer)
          .requestCreateOrderTKNETHConditional(
            contractBSNTokenDeposit.address,
            [
              constants.PROMISE_VALID_FROM,
              constants.PROMISE_VALID_TO,
              constants.PROMISE_PRICE1,
              constants.PROMISE_DEPOSITSE1,
              constants.PROMISE_DEPOSITBU1,
              constants.QTY_10,
            ],
            contractGate.address,
            constants.EMPTY_NFT_TOKEN_ID,
            {value: txValue}
          );

        const tokenSupplyKey = calculateTokenSupplyKey(constants.TWO);

        const {v, r, s} = await generateInputs(
          users.buyer,
          constants.PROMISE_PRICE1
        );

        const buyerInstance = contractBosonRouter.connect(
          users.other1.signer
        ) as BosonRouter;
        await expect(
          buyerInstance.requestVoucherETHTKNWithPermit(
            tokenSupplyKey,
            users.seller.address,
            constants.PROMISE_DEPOSITBU1,
            deadline,
            v,
            r,
            s,
            {value: constants.PROMISE_PRICE1}
          )
        ).to.be.revertedWith(revertReasons.NOT_ELIGIBLE);
      });
    }); // end TKNETH
  });
});
