import {ethers} from 'hardhat';
import {ContractFactory, Contract, Wallet, BigNumber} from 'ethers';
import {waffle} from 'hardhat';
import {assert, expect} from 'chai';
import {ecsign} from 'ethereumjs-util';
import constants from '../testHelpers/constants';
import {advanceTimeSeconds} from '../testHelpers/timemachine';
import Utils from '../testHelpers/utils';
import {toWei, getApprovalDigest} from '../testHelpers/permitUtils';
import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
import IDAI from '../artifacts/contracts/DAITokenWrapper.sol/IDAI.json';
import DATTokenWrapper from '../artifacts/contracts/DAITokenWrapper.sol/DAITokenWrapper.json'; //only used by deployContract
import {DAITokenWrapper} from '../typechain';

const provider = waffle.provider;
const {deployContract, deployMockContract} = waffle;
const eventNames = eventUtils.eventNames;
const BN = ethers.BigNumber.from;
const deadline = toWei(1);
const ONE_VOUCHER = 1;

let mockDAI: Contract;
let owner, otherToken, user1, attacker: Wallet;
let DAITokenWrapper_Factory: ContractFactory;
let txValue: BigNumber;
let digest: any;
let contractDAITokenWrapper: DAITokenWrapper;
let timestamp: number;

describe('Token Wrappers', () => {
  before(async () => {
    [owner, otherToken, user1, attacker] = provider.getWallets();

    DAITokenWrapper_Factory = await ethers.getContractFactory(
      'DAITokenWrapper'
    );

    txValue = BN(constants.seller_deposit).mul(BN(ONE_VOUCHER));
  });

  async function deployContracts() {
    mockDAI = await deployMockContract(owner, IDAI.abi); //deploys mock

    contractDAITokenWrapper = (await DAITokenWrapper_Factory.deploy(
      mockDAI.address
    )) as Contract & DAITokenWrapper;

    await contractDAITokenWrapper.deployed();
  }

  describe('DAI Token Wrapper', () => {
    beforeEach(async () => {
      await deployContracts();

      await mockDAI.mock.name.returns('MockDAI');

      digest = await getApprovalDigest(
        mockDAI,
        user1.address,
        contractDAITokenWrapper.address,
        txValue,
        0,
        deadline
      );
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

    it('Should call permit on the DAI token', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      assert.isDefined(user1.address.toString());
      assert.isDefined(mockDAI.address.toString());
      assert.isDefined(contractDAITokenWrapper.address.toString());
      assert.isDefined(txValue.toString());

      //permit
      //permit
      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractDAITokenWrapper.address,
          txValue,
          deadline,
          v,
          r,
          s
        )
      )
        .to.emit(contractDAITokenWrapper, eventNames.LOG_PERMT_CALLED_ON_TOKEN)
        .withArgs(
          mockDAI.address,
          user1.address,
          contractDAITokenWrapper.address,
          ethers.constants.Zero
        );
    });

    it('Should call permit on the DAI token if deadline is zero', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      //permit
      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractDAITokenWrapper.address,
          txValue,
          ethers.constants.Zero,
          v,
          r,
          s
        )
      )
        .to.emit(contractDAITokenWrapper, eventNames.LOG_PERMT_CALLED_ON_TOKEN)
        .withArgs(
          mockDAI.address,
          user1.address,
          contractDAITokenWrapper.address,
          ethers.constants.Zero
        );
    });

    /////////////////////
    // Error Test Cases //
    /////////////////////

    it('Should revert if token address is zero when contract is deployed', async () => {
      await expect(
        deployContract(owner, DATTokenWrapper, [ethers.constants.AddressZero])
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('Should revert if owner sets token address to zero address', async () => {
      await expect(
        contractDAITokenWrapper.setTokenAddress(ethers.constants.AddressZero)
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

      //permit
      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      //permit
      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractDAITokenWrapper.address,
          txValue,
          deadline,
          v,
          r,
          s
        )
      ).to.be.revertedWith(revertReasons.PAUSED);
    });

    it('Should revert when token owner address is zero address', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      await expect(
        contractDAITokenWrapper.permit(
          ethers.constants.AddressZero,
          contractDAITokenWrapper.address,
          txValue,
          deadline,
          v,
          r,
          s
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('Should revert when token spender address is zero address', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          ethers.constants.AddressZero,
          txValue,
          deadline,
          v,
          r,
          s
        )
      ).to.be.revertedWith(revertReasons.ZERO_ADDRESS_NOT_ALLOWED);
    });

    it('Should revert if deadline has expired', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      timestamp = await Utils.getCurrTimestamp();
      const newDeadline: number = timestamp + 2 * constants.ONE_MINUTE;

      await advanceTimeSeconds(newDeadline * 2);

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractDAITokenWrapper.address,
          txValue,
          newDeadline,
          v,
          r,
          s
        )
      ).to.be.revertedWith(revertReasons.PERMIT_EXPIRED);
    });

    it('Should revert if signatue portion r is invalid', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      const {v, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractDAITokenWrapper.address,
          txValue,
          deadline,
          v,
          ethers.constants.HashZero,
          s
        )
      ).to.be.revertedWith(revertReasons.INVALID_SIGNATURE_COMPONENTS);
    });

    it('Should revert if signatue portion s is invalid', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      const {v, r} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractDAITokenWrapper.address,
          txValue,
          deadline,
          v,
          r,
          ethers.constants.HashZero
        )
      ).to.be.revertedWith(revertReasons.INVALID_SIGNATURE_COMPONENTS);
    });

    it('Should revert if the DAI token reverts', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.revertsWithReason('Dai/invalid-permit');

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractDAITokenWrapper.address,
          txValue,
          deadline,
          v,
          r,
          s
        )
      ).to.be.revertedWith(revertReasons.DAI_INVALID_PERMIT);
    });
  });
});
