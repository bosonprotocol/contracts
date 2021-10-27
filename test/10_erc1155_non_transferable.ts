import {ethers} from 'hardhat';
import {Signer, ContractFactory, Contract} from 'ethers';

import {randomBytes} from 'crypto';

import {expect} from 'chai';
import constants from '../testHelpers/constants';

import Users from '../testHelpers/users';

const BN = ethers.BigNumber.from;

import {ERC1155NonTransferable} from '../typechain';

let ERC1155NonTransferable_Factory: ContractFactory;

import revertReasons from '../testHelpers/revertReasons';
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
    contractERC1155NonTransferable =
      (await ERC1155NonTransferable_Factory.deploy(
        'https://token-cdn-domain/{id}.json'
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

    it('Owner should be able to burn batch', async () => {
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

    it('Owner should be able to set URI', async () => {
      const newUri = 'https://new.domain/{id}.json';
      expect(await contractERC1155NonTransferable.setUri(newUri))
        .to.emit(contractERC1155NonTransferable, eventNames.LOG_URI_SET)
        .withArgs(newUri, users.deployer.address);

      expect(
        await contractERC1155NonTransferable.uri(constants.NFT_TOKEN_ID)
      ).to.equal(newUri);
    });

    it('[NEGATIVE] Regular users cannot execute transfer', async () => {
      const nftTokenID = BN('2');

      await contractERC1155NonTransferable.mint(
        users.other1.address,
        nftTokenID,
        constants.ONE,
        constants.ZERO_BYTES
      );

      const tokenOwnerInstance = contractERC1155NonTransferable.connect(
        users.other1.signer
      );

      await expect(
        tokenOwnerInstance.safeTransferFrom(
          users.other1.address,
          users.other2.address,
          nftTokenID,
          constants.ONE,
          constants.ZERO_BYTES
        )
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER);
    });

    it('[NEGATIVE] Tokens are non-transferable', async () => {
      const nftTokenID = BN('2');
      await contractERC1155NonTransferable.mint(
        users.deployer.address,
        nftTokenID,
        constants.ONE,
        constants.ZERO_BYTES
      );

      await expect(
        contractERC1155NonTransferable.safeTransferFrom(
          users.deployer.address,
          users.other2.address,
          nftTokenID,
          constants.ONE,
          constants.ZERO_BYTES
        )
      ).to.be.revertedWith(revertReasons.NON_TRANSFERABLE);

      expect(
        await contractERC1155NonTransferable.balanceOf(
          users.deployer.address,
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
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER_OR_SELF);
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
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER_OR_SELF);
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
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER_OR_SELF);
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
      ).to.be.revertedWith(revertReasons.UNAUTHORIZED_OWNER_OR_SELF);
    });

    it('[NEGATIVE][setUri] Should revert if executed by attacker', async () => {
      const attackerInstance = contractERC1155NonTransferable.connect(
        users.attacker.signer
      );

      const newUri = 'https://new.domain/{id}.json';

      await expect(attackerInstance.setUri(newUri)).to.be.revertedWith(
        revertReasons.UNAUTHORIZED_OWNER_OR_SELF
      );
    });

    it('[NEGATIVE][setUri] Should revert if uri is empty string', async () => {
      const newUri = '';

      await expect(
        contractERC1155NonTransferable.setUri(newUri)
      ).to.be.revertedWith(revertReasons.INVALID_VALUE);
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
        revertReasons.UNAUTHORIZED_OWNER_OR_SELF
      );
    });

    it('[NEGATIVE][unpause] Should revert if executed by attacker', async () => {
      await contractERC1155NonTransferable.pause();

      const attackerInstance = contractERC1155NonTransferable.connect(
        users.attacker.signer
      );
      await expect(attackerInstance.unpause()).to.be.revertedWith(
        revertReasons.UNAUTHORIZED_OWNER_OR_SELF
      );
    });

    describe('Metatransaction', () => {
      function signData(signer, dataToSign, nonce = constants.ONE) {
        const relayTransactionHash = ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ['string', 'uint', 'address', 'uint', 'bytes'],
            [
              'boson:',
              ethers.provider.network.chainId,
              contractERC1155NonTransferable.address,
              nonce,
              dataToSign,
            ]
          )
        );

        const sig = signer.signMessage(
          ethers.utils.arrayify(relayTransactionHash)
        );

        return sig;
      }

      function getRandomNonce() {
        const value = randomBytes(32); // 32 bytes = 256 bits
        return BN(value);
      }

      beforeEach(async () => {
        await deployContracts();
      });

      it('Self should be able to mint', async () => {
        const nftTokenID = BN('2');
        const nonce = getRandomNonce();

        const mintData =
          contractERC1155NonTransferable.interface.encodeFunctionData('mint', [
            users.other1.address,
            nftTokenID,
            constants.ONE,
            constants.ZERO_BYTES,
          ]);

        const sig = signData(users.deployer.signer, mintData, nonce);

        expect(
          await contractERC1155NonTransferable.executeMetaTransaction(
            nonce,
            mintData,
            sig
          )
        )
          .to.emit(contractERC1155NonTransferable, eventNames.TRANSFER_SINGLE)
          .withArgs(
            users.deployer.address,
            constants.ZERO_ADDRESS,
            users.other1.address,
            nftTokenID,
            constants.ONE
          )
          .to.emit(contractERC1155NonTransferable, eventNames.USED_NONCE)
          .withArgs(nonce)
          .to.emit(contractERC1155NonTransferable, eventNames.EXECUTED_META_TX)
          .withArgs(mintData, '0x');

        expect(
          await contractERC1155NonTransferable.balanceOf(
            users.other1.address,
            nftTokenID
          )
        ).to.equal(constants.ONE);

        expect(await contractERC1155NonTransferable.isUsedNonce(nonce)).to.be
          .true;
      });

      it('Self should be able to mint batch', async () => {
        const nonce = getRandomNonce();
        const nftTokenIDs = [BN('2'), BN('5'), BN('7'), BN('9')];
        const balances = [
          constants.ONE,
          constants.ONE,
          constants.ONE,
          constants.ONE,
        ];

        const mintBatchData =
          contractERC1155NonTransferable.interface.encodeFunctionData(
            'mintBatch',
            [users.other1.address, nftTokenIDs, balances, constants.ZERO_BYTES]
          );

        const sig = signData(users.deployer.signer, mintBatchData, nonce);

        expect(
          await contractERC1155NonTransferable.executeMetaTransaction(
            nonce,
            mintBatchData,
            sig
          )
        )
          .to.emit(contractERC1155NonTransferable, eventNames.TRANSFER_BATCH)
          .withArgs(
            users.deployer.address,
            constants.ZERO_ADDRESS,
            users.other1.address,
            nftTokenIDs,
            balances
          )
          .to.emit(contractERC1155NonTransferable, eventNames.USED_NONCE)
          .withArgs(nonce)
          .to.emit(contractERC1155NonTransferable, eventNames.EXECUTED_META_TX)
          .withArgs(mintBatchData, '0x');

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

        expect(await contractERC1155NonTransferable.isUsedNonce(nonce)).to.be
          .true;
      });

      it('Self should be able to burn', async () => {
        const nonce = getRandomNonce();
        const nftTokenID = BN('2');

        const burnData =
          contractERC1155NonTransferable.interface.encodeFunctionData('burn', [
            users.other1.address,
            nftTokenID,
            constants.ONE,
          ]);

        const sig = signData(users.deployer.signer, burnData, nonce);

        await contractERC1155NonTransferable.mint(
          users.other1.address,
          nftTokenID,
          constants.ONE,
          constants.ZERO_BYTES
        );

        expect(
          await contractERC1155NonTransferable.executeMetaTransaction(
            nonce,
            burnData,
            sig
          )
        )
          .to.emit(contractERC1155NonTransferable, eventNames.TRANSFER_SINGLE)
          .withArgs(
            users.deployer.address,
            users.other1.address,
            constants.ZERO_ADDRESS,
            nftTokenID,
            constants.ONE
          )
          .to.emit(contractERC1155NonTransferable, eventNames.USED_NONCE)
          .withArgs(nonce)
          .to.emit(contractERC1155NonTransferable, eventNames.EXECUTED_META_TX)
          .withArgs(burnData, '0x');

        expect(
          await contractERC1155NonTransferable.balanceOf(
            users.other1.address,
            nftTokenID
          )
        ).to.equal(constants.ZERO);

        expect(await contractERC1155NonTransferable.isUsedNonce(nonce)).to.be
          .true;
      });

      it('Self should be able to burn batch', async () => {
        const nonce = getRandomNonce();
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

        const burnBatchData =
          contractERC1155NonTransferable.interface.encodeFunctionData(
            'burnBatch',
            [users.other1.address, nftTokenIDs, balances]
          );

        const sig = signData(users.deployer.signer, burnBatchData, nonce);

        await contractERC1155NonTransferable.mintBatch(
          users.other1.address,
          nftTokenIDs,
          balances,
          constants.ZERO_BYTES
        );

        expect(
          await contractERC1155NonTransferable.executeMetaTransaction(
            nonce,
            burnBatchData,
            sig
          )
        )
          .to.emit(contractERC1155NonTransferable, eventNames.TRANSFER_BATCH)
          .withArgs(
            users.deployer.address,
            users.other1.address,
            constants.ZERO_ADDRESS,
            nftTokenIDs,
            balances
          )
          .to.emit(contractERC1155NonTransferable, eventNames.USED_NONCE)
          .withArgs(nonce)
          .to.emit(contractERC1155NonTransferable, eventNames.EXECUTED_META_TX)
          .withArgs(burnBatchData, '0x');

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

        expect(await contractERC1155NonTransferable.isUsedNonce(nonce)).to.be
          .true;
      });

      it('Self should be able to set URI', async () => {
        const nonce = getRandomNonce();
        const newUri = 'https://new.domain/{id}.json';

        const setUriData =
          contractERC1155NonTransferable.interface.encodeFunctionData(
            'setUri',
            [newUri]
          );

        const sig = signData(users.deployer.signer, setUriData, nonce);

        expect(
          await contractERC1155NonTransferable.executeMetaTransaction(
            nonce,
            setUriData,
            sig
          )
        )
          .to.emit(contractERC1155NonTransferable, eventNames.LOG_URI_SET)
          .withArgs(newUri, users.deployer.address)
          .to.emit(contractERC1155NonTransferable, eventNames.USED_NONCE)
          .withArgs(nonce)
          .to.emit(contractERC1155NonTransferable, eventNames.EXECUTED_META_TX)
          .withArgs(setUriData, '0x');

        expect(
          await contractERC1155NonTransferable.uri(constants.NFT_TOKEN_ID)
        ).to.equal(newUri);

        expect(await contractERC1155NonTransferable.isUsedNonce(nonce)).to.be
          .true;
      });

      it('Self should be able to pause', async () => {
        const nonce = getRandomNonce();
        const pauseData =
          contractERC1155NonTransferable.interface.encodeFunctionData('pause');

        const sig = signData(users.deployer.signer, pauseData, nonce);

        expect(
          await contractERC1155NonTransferable.executeMetaTransaction(
            nonce,
            pauseData,
            sig
          )
        )
          .to.emit(contractERC1155NonTransferable, eventNames.PAUSED)
          .withArgs(users.deployer.address)
          .to.emit(contractERC1155NonTransferable, eventNames.USED_NONCE)
          .withArgs(nonce)
          .to.emit(contractERC1155NonTransferable, eventNames.EXECUTED_META_TX)
          .withArgs(pauseData, '0x');

        expect(await contractERC1155NonTransferable.paused()).to.be.true;

        expect(await contractERC1155NonTransferable.isUsedNonce(nonce)).to.be
          .true;
      });

      it('Self should be able to unpause', async () => {
        const nonce = getRandomNonce();
        await contractERC1155NonTransferable.pause();

        const unpauseData =
          contractERC1155NonTransferable.interface.encodeFunctionData(
            'unpause'
          );

        const sig = signData(users.deployer.signer, unpauseData, nonce);

        expect(
          await contractERC1155NonTransferable.executeMetaTransaction(
            nonce,
            unpauseData,
            sig
          )
        )
          .to.emit(contractERC1155NonTransferable, eventNames.UNPAUSED)
          .withArgs(users.deployer.address)
          .to.emit(contractERC1155NonTransferable, eventNames.USED_NONCE)
          .withArgs(nonce)
          .to.emit(contractERC1155NonTransferable, eventNames.EXECUTED_META_TX)
          .withArgs(unpauseData, '0x');

        expect(await contractERC1155NonTransferable.paused()).to.be.false;

        expect(await contractERC1155NonTransferable.isUsedNonce(nonce)).to.be
          .true;
      });

      it('[Negative][mint] Attacker should not be able to mint', async () => {
        const nftTokenID = BN('2');

        const mintData =
          contractERC1155NonTransferable.interface.encodeFunctionData('mint', [
            users.other1.address,
            nftTokenID,
            constants.ONE,
            constants.ZERO_BYTES,
          ]);

        const sig = signData(users.other1.signer, mintData);

        await expect(
          contractERC1155NonTransferable.executeMetaTransaction(
            constants.ONE,
            mintData,
            sig
          )
        ).to.be.revertedWith(revertReasons.METATX_UNAUTHORIZED);
      });

      it('[Negative][mint] Owner should not be able to replay', async () => {
        const nftTokenID = BN('2');

        const mintData =
          contractERC1155NonTransferable.interface.encodeFunctionData('mint', [
            users.other1.address,
            nftTokenID,
            constants.ONE,
            constants.ZERO_BYTES,
          ]);

        const sig = signData(users.deployer.signer, mintData);

        await contractERC1155NonTransferable.executeMetaTransaction(
          constants.ONE,
          mintData,
          sig
        );

        await expect(
          contractERC1155NonTransferable.executeMetaTransaction(
            constants.ONE,
            mintData,
            sig
          )
        ).to.be.revertedWith(revertReasons.METATX_NONCE);
      });

      it('[Negative][XXXX] Owner should fail to call a non-existant method', async () => {
        const nftTokenID = BN('2');

        const mintiface = new ethers.utils.Interface([
          'function XXXX(address _to, uint256 _tokenId, uint256 _value, bytes memory _data)',
        ]);
        const xxxxData = mintiface.encodeFunctionData('XXXX', [
          users.other1.address,
          nftTokenID,
          constants.ONE,
          constants.ZERO_BYTES,
        ]);

        const sig = signData(users.deployer.signer, xxxxData);

        await expect(
          contractERC1155NonTransferable.executeMetaTransaction(
            constants.ONE,
            xxxxData,
            sig
          )
        ).to.be.revertedWith('');
      });
    });
  });
});
