import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

import {assert, expect} from 'chai';
import constants from '../testHelpers/constants';

import Users from '../testHelpers/users';
import Utils from '../testHelpers/utils';

const BN = ethers.BigNumber.from;

import {ERC1155NonTransferable} from '../typechain';

let ERC1155NonTransferable_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';
import * as eventUtils from '../testHelpers/events';
import {eventNames} from '../testHelpers/events';

let users;

describe('ERC1155 non transferable functionality', async () => {
  before(async () => {
    const signers: Signer[] = await ethers.getSigners();
    users = new Users(signers);

    ERC1155NonTransferable_Factory = await ethers.getContractFactory(
      'ERC1155NonTransferable'
    );
  });

  let contractERC1155NonTransferable: ERC1155NonTransferable;

  async function deployContracts() {
    contractERC1155NonTransferable = (await ERC1155NonTransferable_Factory.deploy(
      '/non/transferable/uri'
    )) as Contract & ERC1155NonTransferable;

    await contractERC1155NonTransferable.deployed();
  }

  describe('Basic operations', () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it('Owner should be able to mint', async () => {
      const nftTokenID = BN('2');
      expect(
        await contractERC1155NonTransferable.mint(
          users.other1.address,
          nftTokenID,
          constants.ONE,
          constants.ZERO_BYTES
        )
      )
        .to.emit(contractERC1155NonTransferable, eventNames.TRANSFER_SINGLE)
        .withArgs(
          users.deployer.address,
          constants.ZERO_ADDRESS,
          users.other1.address,
          nftTokenID,
          constants.ONE
        );

      expect(
        await contractERC1155NonTransferable.balanceOf(
          users.other1.address,
          nftTokenID
        )
      ).to.equal(constants.ONE);
    });

    it('Owner should be able to mint batch', async () => {
      const nftTokenIDs = [BN('2'), BN('5'), BN('7'), BN('9')];
      const balances = [
        constants.ONE,
        constants.ONE,
        constants.ONE,
        constants.ONE,
      ];

      expect(
        await contractERC1155NonTransferable.mintBatch(
          users.other1.address,
          nftTokenIDs,
          balances,
          constants.ZERO_BYTES
        )
      )
        .to.emit(contractERC1155NonTransferable, eventNames.TRANSFER_BATCH)
        .withArgs(
          users.deployer.address,
          constants.ZERO_ADDRESS,
          users.other1.address,
          nftTokenIDs,
          balances
        );

      expect(
        (
          await contractERC1155NonTransferable.balanceOfBatch(
            [
              users.other1.address,
              users.other1.address,
              users.other1.address,
              users.other1.address,
            ],
            nftTokenIDs
          )
        ).map((balance) => balance.toString())
      ).to.include.members(balances.map((balance) => balance.toString()));
    });

    it('Owner should be able to burn', async () => {
      const nftTokenID = BN('2');
      await contractERC1155NonTransferable.mint(
        users.other1.address,
        nftTokenID,
        constants.ONE,
        constants.ZERO_BYTES
      );

      expect(
        await contractERC1155NonTransferable.burn(
          users.other1.address,
          nftTokenID,
          constants.ONE
        )
      )
        .to.emit(contractERC1155NonTransferable, eventNames.TRANSFER_SINGLE)
        .withArgs(
          users.deployer.address,
          users.other1.address,
          constants.ZERO_ADDRESS,
          nftTokenID,
          constants.ONE
        );

      expect(
        await contractERC1155NonTransferable.balanceOf(
          users.other1.address,
          nftTokenID
        )
      ).to.equal(constants.ZERO);
    });

    it('Owner should be able to mint batch', async () => {
      const nftTokenIDs = [BN('2'), BN('5'), BN('7'), BN('9')];
      const balances = [
        constants.ONE,
        constants.ONE,
        constants.ONE,
        constants.ONE,
      ];
      const zeroBalances = [
        constants.ZERO,
        constants.ZERO,
        constants.ZERO,
        constants.ZERO,
      ];

      await contractERC1155NonTransferable.mintBatch(
        users.other1.address,
        nftTokenIDs,
        balances,
        constants.ZERO_BYTES
      );

      expect(
        await contractERC1155NonTransferable.burnBatch(
          users.other1.address,
          nftTokenIDs,
          balances
        )
      )
        .to.emit(contractERC1155NonTransferable, eventNames.TRANSFER_BATCH)
        .withArgs(
          users.deployer.address,
          users.other1.address,
          constants.ZERO_ADDRESS,
          nftTokenIDs,
          balances
        );

      expect(
        (
          await contractERC1155NonTransferable.balanceOfBatch(
            [
              users.other1.address,
              users.other1.address,
              users.other1.address,
              users.other1.address,
            ],
            nftTokenIDs
          )
        ).map((balance) => balance.toString())
      ).to.include.members(zeroBalances.map((balance) => balance.toString()));
    });

    it('Tokens are non-transferable', async () => {
      const nftTokenID = BN('2');
      await contractERC1155NonTransferable.mint(
        users.other1.address,
        nftTokenID,
        constants.ONE,
        constants.ZERO_BYTES
      );

      const ownerInstance = contractERC1155NonTransferable.connect(
        users.other1.signer
      );

      await expect(
        ownerInstance.safeTransferFrom(
          users.other1.address,
          users.other2.address,
          nftTokenID,
          constants.ONE,
          constants.ZERO_BYTES
        )
      ).to.be.revertedWith(revertReasons.NON_TRANSFERABLE);

      expect(
        await contractERC1155NonTransferable.balanceOf(
          users.other1.address,
          nftTokenID
        )
      ).to.equal(constants.ONE);

      expect(
        await contractERC1155NonTransferable.balanceOf(
          users.other2.address,
          nftTokenID
        )
      ).to.equal(constants.ZERO);
    });

    it('[NEGATIVE][mint] Should revert if executed by attacker', async () => {
      const attackerInstance = contractERC1155NonTransferable.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.mint(
          users.other1.address,
          BN('2'),
          constants.ONE,
          constants.ZERO_BYTES
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][mintBatch] Should revert if executed by attacker', async () => {
      const attackerInstance = contractERC1155NonTransferable.connect(
        users.attacker.signer
      );
      await expect(
        attackerInstance.mintBatch(
          users.other1.address,
          [BN('2'), BN('3'), BN('4')],
          [constants.ONE, constants.ONE, constants.ONE],
          constants.ZERO_BYTES
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][burn] Should revert if executed by attacker', async () => {
      const attackerInstance = contractERC1155NonTransferable.connect(
        users.attacker.signer
      );

      const nftTokenID = BN('2');
      await contractERC1155NonTransferable.mint(
        users.other1.address,
        nftTokenID,
        constants.ONE,
        constants.ZERO_BYTES
      );

      await expect(
        attackerInstance.burn(users.other1.address, nftTokenID, constants.ONE)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE][burnBatch] Should revert if executed by attacker', async () => {
      const attackerInstance = contractERC1155NonTransferable.connect(
        users.attacker.signer
      );

      const nftTokenIDs = [BN('2'), BN('5'), BN('7'), BN('9')];
      const balances = [
        constants.ONE,
        constants.ONE,
        constants.ONE,
        constants.ONE,
      ];
      await contractERC1155NonTransferable.mintBatch(
        users.other1.address,
        nftTokenIDs,
        balances,
        constants.ZERO_BYTES
      );

      await expect(
        attackerInstance.burnBatch(users.other1.address, nftTokenIDs, balances)
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('Owner should be able to pause', async () => {
      expect(await contractERC1155NonTransferable.pause())
        .to.emit(contractERC1155NonTransferable, eventNames.PAUSED)
        .withArgs(users.deployer.address);

      expect(await contractERC1155NonTransferable.paused()).to.be.true;
    });

    it('Owner should be able to unpause', async () => {
      await contractERC1155NonTransferable.pause();

      expect(await contractERC1155NonTransferable.unpause())
        .to.emit(contractERC1155NonTransferable, eventNames.UNPAUSED)
        .withArgs(users.deployer.address);

      expect(await contractERC1155NonTransferable.paused()).to.be.false;
    });

    it('[NEGATIVE] During the pause mint and burn does not work', async () => {
      await contractERC1155NonTransferable.pause();

      const nftTokenID = BN('2');

      const nftTokenIDs = [BN('2'), BN('5'), BN('7'), BN('9')];
      const balances = [
        constants.ONE,
        constants.ONE,
        constants.ONE,
        constants.ONE,
      ];
      // const zeroBalances = [constants.ZERO, constants.ZERO, constants.ZERO, constants.ZERO]

      await expect(
        contractERC1155NonTransferable.mint(
          users.other1.address,
          nftTokenID,
          constants.ONE,
          constants.ZERO_BYTES
        )
      ).to.be.revertedWith(revertReasons.PAUSED_ERC1155);

      await expect(
        contractERC1155NonTransferable.burn(
          users.other1.address,
          nftTokenID,
          constants.ONE
        )
      ).to.be.revertedWith(revertReasons.PAUSED_ERC1155);

      await expect(
        contractERC1155NonTransferable.mintBatch(
          users.other1.address,
          nftTokenIDs,
          balances,
          constants.ZERO_BYTES
        )
      ).to.be.revertedWith(revertReasons.PAUSED_ERC1155);

      await expect(
        contractERC1155NonTransferable.burnBatch(
          users.other1.address,
          nftTokenIDs,
          balances
        )
      ).to.be.revertedWith(revertReasons.PAUSED_ERC1155);
    });

    it('[NEGATIVE][pause] Should revert if executed by attacker', async () => {
      const attackerInstance = contractERC1155NonTransferable.connect(
        users.attacker.signer
      );
      await expect(attackerInstance.pause()).to.be.revertedWith(
        revertReasons.UNAUTHORIZED_OWNER
      );
    });

    it('[NEGATIVE][unpause] Should revert if executed by attacker', async () => {
      await contractERC1155NonTransferable.pause();

      const attackerInstance = contractERC1155NonTransferable.connect(
        users.attacker.signer
      );
      await expect(attackerInstance.unpause()).to.be.revertedWith(
        revertReasons.UNAUTHORIZED_OWNER
      );
    });
  });
});
