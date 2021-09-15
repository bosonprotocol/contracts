import {ethers} from 'hardhat';
import {ContractFactory, Contract, Wallet} from 'ethers';
import {waffle} from 'hardhat';
import {expect} from 'chai';
import {ecsign} from 'ethereumjs-util';
import constants from '../testHelpers/constants';
import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';
import UtilsBuilder from '../testHelpers/utilsBuilder';
import {toWei, getApprovalDigestNoToken} from '../testHelpers/permitUtils';
import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
import fnSignatures from '../testHelpers/functionSignatures';
import IDAI from '../artifacts/contracts/DAITokenWrapper.sol/IDAI.json';
import DATTokenWrapper from '../artifacts/contracts/DAITokenWrapper.sol/DAITokenWrapper.json'; //only used by deployContract
import {DAITokenWrapper, BosonRouter} from '../typechain';
//import { Provider } from '@ethersproject/providers';

const provider = waffle.provider;
const {deployContract, deployMockContract} = waffle;

const eventNames = eventUtils.eventNames;
const BN = ethers.BigNumber.from;
let utils: Utils;
let users;

let mockDAI: Contract;
let owner,
  otherToken,
  user1,
  attacker,
  contractVoucherKernel,
  contractTokenRegistry,
  contractCashier: Wallet;

let DAITokenWrapper_Factory: ContractFactory;
let BosonRouter_Factory: ContractFactory;

describe('Token Wrappers', () => {
  before(async () => {
    [
      owner,
      otherToken,
      user1,
      attacker,
      contractVoucherKernel,
      contractTokenRegistry,
      contractCashier,
    ] = provider.getWallets();

    DAITokenWrapper_Factory = await ethers.getContractFactory(
      'DAITokenWrapper'
    );
    BosonRouter_Factory = await ethers.getContractFactory('BosonRouter');
  });

  let contractDAITokenWrapperWithMock: Contract;
  let contractDAITokenWrapper: DAITokenWrapper;
  let contractBosonRouter: BosonRouter;

  const ZERO = BN(0);
  const ONE_VOUCHER = 1;

  const deadline = toWei(1);

  let timestamp;

  async function deployContracts() {
    mockDAI = await deployMockContract(owner, IDAI.abi); //deploys mock

    console.log('mockDAI.address ', mockDAI.address);

    contractDAITokenWrapperWithMock = await deployContract(
      owner,
      DATTokenWrapper,
      [mockDAI.address]
    );

    console.log(
      'contractDAITokenWrapperWithMock.address ',
      contractDAITokenWrapperWithMock.address
    );

    contractDAITokenWrapper = (await DAITokenWrapper_Factory.deploy(
      mockDAI.address
    )) as Contract & DAITokenWrapper;
    contractBosonRouter = (await BosonRouter_Factory.deploy(
      contractVoucherKernel.address,
      contractTokenRegistry.address,
      contractCashier.address
    )) as Contract & BosonRouter;

    console.log(
      'contractDAITokenWrapper.address ',
      contractDAITokenWrapper.address
    );
    console.log('contractBosonRouter.address ', contractBosonRouter.address);
    console.log(
      'contractBosonRouter.signer.address ',
      await contractBosonRouter.signer.getAddress()
    );

    await contractDAITokenWrapper.deployed();
    await contractBosonRouter.deployed();

    contractDAITokenWrapper.setBosonRouterAddress(contractBosonRouter.address);
  }

  describe('DAI Token Wrapper', () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it('test mock DAI', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      //const nonce = await contractDAITokenWrapperWithMock.nonces(user1.address);

      const nonce = await contractDAITokenWrapper.nonces(user1.address);

      console.log('nonce ', nonce.toString());

      expect(nonce).to.be.equal(0);

      const daiTokenAddress = await contractDAITokenWrapperWithMock.getTokenAddress();

      console.log('daiTokenAddress ', daiTokenAddress);
    });

    it('Should allow owner to set the token address', async () => {
      await expect(contractDAITokenWrapper.setTokenAddress(otherToken.address))
        .to.emit(contractDAITokenWrapper, eventNames.LOG_TOKEN_ADDRESS_CHANGED)
        .withArgs(otherToken.address, owner.address);

      expect(await contractDAITokenWrapper.getTokenAddress()).to.equal(
        otherToken.address
      );
    });

    it('Should allow owner to pause contract', async () => {
      await expect(contractDAITokenWrapper.pause())
        .to.emit(contractDAITokenWrapper, eventNames.PAUSED)
        .withArgs(owner.address);

      expect(await contractDAITokenWrapper.paused()).to.be.true;
    });

    it('Should allow owner to unpause contract', async () => {
      contractDAITokenWrapper.pause();
      await expect(contractDAITokenWrapper.unpause())
        .to.emit(contractDAITokenWrapper, eventNames.UNPAUSED)
        .withArgs(owner.address);

      expect(await contractDAITokenWrapper.paused()).to.be.false;
    });

    ////////////////////
    // Error Test Cases //
    /////////////////////

    it('Should revert if token address is zero when contract is constructed', async () => {
      await expect(
        deployContract(owner, DATTokenWrapper, [constants.ZERO_ADDRESS])
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('Should revert if owner sets token address to zero address', async () => {
      await expect(
        contractDAITokenWrapper.setTokenAddress(constants.ZERO_ADDRESS)
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('Should revert if attacker tries to set token address', async () => {
      const newInstance = contractDAITokenWrapper.connect(attacker);
      await expect(
        newInstance.setTokenAddress(otherToken.address)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('Should revert if attacker tries to pause or unpause contract', async () => {
      const newInstance = contractDAITokenWrapper.connect(attacker);
      await expect(newInstance.pause()).to.be.revertedWith(
        revertReasons.UNAUTHORIZED_OWNER
      );

      await expect(newInstance.unpause()).to.be.revertedWith(
        revertReasons.UNAUTHORIZED_OWNER
      );
    });

    it('Should revert when certain functions are called on paused contract', async () => {
      contractDAITokenWrapper.pause();

      //setTokenAddress
      await expect(
        contractDAITokenWrapper.setTokenAddress(otherToken.address)
      ).to.be.revertedWith(revertReasons.PAUSED);

      //setBosonRouterAddress
      await expect(
        contractDAITokenWrapper.setBosonRouterAddress(
          contractBosonRouter.address
        )
      ).to.be.revertedWith(revertReasons.PAUSED);
    });

    //set and get boson router address
    //permit onlyfromRouter, zero address for owner, spender, wrong deadline, . . . .
    //

    /*
    const txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));

      console.log("mockDAI.address ", mockDAI.address);
      await mockDAI.mock.name.returns('MockDAI');

      const digest = await getApprovalDigestNoToken(
        "MockDAI",
        user1.address,
        contractDAITokenWrapper.address,
        txValue,
        0,
        deadline,
        mockDAI.address
      );

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );
   
      //permit
      await expect(contractDAITokenWrapper.permit(user1.address, contractDAITokenWrapper.address, txValue, deadline, v, r, s))
        .to.be.revertedWith('Pausable: paused');
  */
  });
});
