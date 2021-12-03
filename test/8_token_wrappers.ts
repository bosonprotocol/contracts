import {ethers} from 'hardhat';
import {ContractFactory, Contract, Wallet, BigNumber, Signer} from 'ethers';
import {waffle} from 'hardhat';
import {expect} from 'chai';
import {ecsign} from 'ethereumjs-util';
import constants from '../testHelpers/constants';
import {advanceTimeSeconds} from '../testHelpers/timemachine';
import Utils from '../testHelpers/utils';
import {toWei, getApprovalDigestDAI} from '../testHelpers/permitUtilsDAI';
import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
import Users from '../testHelpers/users';
import IDAI from '../artifacts/contracts/interfaces/IDAI.sol/IDAI.json';
import DATTokenWrapper from '../artifacts/contracts/DAITokenWrapper.sol/DAITokenWrapper.json'; //only used by deployContract
import {DAITokenWrapper} from '../typechain';

const provider = waffle.provider;
const {deployContract, deployMockContract} = waffle;
const eventNames = eventUtils.eventNames;
const BN = ethers.BigNumber.from;
const deadline = toWei(1);
const ONE_VOUCHER = 1;

let mockDAI: Contract;
let owner, otherToken, user1, attacker, contractBosonRouter: Wallet;
let txValue: BigNumber;
let digest: any;
let timestamp: number;
let DAITokenWrapper_Factory: ContractFactory;
let contractDAITokenWrapper: DAITokenWrapper;

describe('Token Wrappers', () => {
  before(async () => {
    [owner, otherToken, user1, attacker, contractBosonRouter] =
      provider.getWallets();

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
    });

    it('Should emit LogTokenAddressChanged event when deployed', async () => {
      const signers: Signer[] = await ethers.getSigners();
      const users = new Users(signers);

      expect(contractDAITokenWrapper.deployTransaction)
        .to.emit(contractDAITokenWrapper, eventNames.LOG_TOKEN_ADDRESS_CHANGED)
        .withArgs(mockDAI.address, users.deployer.address);
    });

    it('Should allow owner to set the token address', async () => {
      await expect(contractDAITokenWrapper.setTokenAddress(otherToken.address))
        .to.emit(contractDAITokenWrapper, eventNames.LOG_TOKEN_ADDRESS_CHANGED)
        .withArgs(otherToken.address, owner.address);

      expect(await contractDAITokenWrapper.getTokenAddress()).to.equal(
        otherToken.address
      );
    });

    it('Should call permit on the DAI token', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      digest = await getApprovalDigestDAI(
        mockDAI,
        user1.address,
        contractBosonRouter.address,
        txValue,
        0,
        deadline
      );

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      //permit
      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractBosonRouter.address,
          txValue,
          deadline,
          v,
          r,
          s
        )
      )
        .to.emit(contractDAITokenWrapper, eventNames.LOG_PERMIT_CALLED_ON_TOKEN)
        .withArgs(
          mockDAI.address,
          user1.address,
          contractBosonRouter.address,
          ethers.constants.MaxUint256.toString()
        );
    });

    it('Should call permit on the DAI token if deadline is zero', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      digest = await getApprovalDigestDAI(
        mockDAI,
        user1.address,
        contractBosonRouter.address,
        txValue,
        0,
        ethers.constants.Zero
      );

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      //permit
      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractBosonRouter.address,
          txValue,
          ethers.constants.Zero,
          v,
          r,
          s
        )
      )
        .to.emit(contractDAITokenWrapper, eventNames.LOG_PERMIT_CALLED_ON_TOKEN)
        .withArgs(
          mockDAI.address,
          user1.address,
          contractBosonRouter.address,
          ethers.constants.MaxUint256.toString()
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

    it('Should revert when token owner address is zero address', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      digest = await getApprovalDigestDAI(
        mockDAI,
        user1.address,
        contractBosonRouter.address,
        txValue,
        0,
        deadline
      );

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      await expect(
        contractDAITokenWrapper.permit(
          ethers.constants.AddressZero,
          contractBosonRouter.address,
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

      digest = await getApprovalDigestDAI(
        mockDAI,
        user1.address,
        contractBosonRouter.address,
        txValue,
        0,
        deadline
      );

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
      await mockDAI.mock.permit.revertsWithReason(
        revertReasons.DAI_PERMIT_EXPIRED
      );

      timestamp = await Utils.getCurrTimestamp();
      const newDeadline: number = timestamp + 2 * constants.ONE_MINUTE;

      await advanceTimeSeconds(newDeadline * 2);

      digest = await getApprovalDigestDAI(
        mockDAI,
        user1.address,
        contractBosonRouter.address,
        txValue,
        0,
        newDeadline
      );

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractBosonRouter.address,
          txValue,
          newDeadline,
          v,
          r,
          s
        )
      ).to.be.revertedWith(revertReasons.DAI_PERMIT_EXPIRED);
    });

    it('Should revert if signature component s is invalid', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      digest = await getApprovalDigestDAI(
        mockDAI,
        user1.address,
        contractBosonRouter.address,
        txValue,
        0,
        deadline
      );

      const {v, r} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      // to revert, s must be greater than 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
      const abiCoder = new ethers.utils.AbiCoder();
      const s = abiCoder.encode(['bytes32'], [ethers.constants.MaxUint256]);

      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractBosonRouter.address,
          txValue,
          deadline,
          v,
          r,
          s
        )
      ).to.be.revertedWith(revertReasons.INVALID_SIG_S);
    });

    it('Should revert if signature component v is invalid', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.returns();

      digest = await getApprovalDigestDAI(
        mockDAI,
        user1.address,
        contractBosonRouter.address,
        txValue,
        0,
        deadline
      );

      const {r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      // to revert, v must NOT be 27 or 28
      const abiCoder = new ethers.utils.AbiCoder();
      const v = abiCoder.encode(['uint8'], [ethers.constants.HashZero]);

      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractBosonRouter.address,
          txValue,
          deadline,
          v,
          r,
          s
        )
      ).to.be.revertedWith(revertReasons.INVALID_SIG_V);
    });

    it('Should revert if the DAI token reverts', async () => {
      await mockDAI.mock.nonces.withArgs(user1.address).returns(0);
      await mockDAI.mock.permit.revertsWithReason('Dai/invalid-permit');

      digest = await getApprovalDigestDAI(
        mockDAI,
        user1.address,
        contractBosonRouter.address,
        txValue,
        0,
        deadline
      );

      const {v, r, s} = ecsign(
        Buffer.from(digest.slice(2), 'hex'),
        Buffer.from(user1.privateKey.slice(2), 'hex')
      );

      await expect(
        contractDAITokenWrapper.permit(
          user1.address,
          contractBosonRouter.address,
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
