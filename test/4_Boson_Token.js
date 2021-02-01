const truffleAssert = require('truffle-assertions');
const ethers = require('ethers');
const {assert} = require('chai');
const {ecsign} = require('ethereumjs-util');

const constants = require('../testHelpers/constants');
const Users = require('../testHelpers/users');
const {toWei, getApprovalDigest} = require('../testHelpers/permitUtils');

const BosonToken = artifacts.require("BosonToken");

contract('Boson token', (addresses) => {
  const users = new Users(addresses);

  let BosonTokenContract, bosonContractAddress;

  describe('Boson Token', async () => {
    const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const MINTER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes('MINTER_ROLE')
    );
    const PAUSER_ROLE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("PAUSER_ROLE")
    );

    before(async () => {
      BosonTokenContract = await BosonToken.new('BOSON TOKEN', 'BSNT');
    });

    it("Should be unpaused on deploy", async () =>{
      const paused = await BosonTokenContract.paused();

      assert.isFalse(paused)
    })

    it('Only Deployer Should have admin, minter, pauser rights initially ', async () => {
      const buyerIsAdmin = await BosonTokenContract.hasRole(
        DEFAULT_ADMIN_ROLE,
        users.buyer.address
      );
      const buyerIsMinter = await BosonTokenContract.hasRole(
        MINTER_ROLE,
        users.buyer.address
      );

      const buyerIsPauser = await BosonTokenContract.hasRole(
        PAUSER_ROLE,
        users.buyer.address
      );

      const deployerIsAdmin = await BosonTokenContract.hasRole(
        DEFAULT_ADMIN_ROLE,
        users.deployer.address
      );
      const deployerIsMinter = await BosonTokenContract.hasRole(
        MINTER_ROLE,
        users.deployer.address
      );

      const deployerIsPauser = await BosonTokenContract.hasRole(
        PAUSER_ROLE,
        users.deployer.address
      );

      assert.isTrue(deployerIsAdmin);
      assert.isTrue(deployerIsMinter);
      assert.isTrue(deployerIsPauser);

      assert.isFalse(buyerIsAdmin);
      assert.isFalse(buyerIsMinter);
      assert.isFalse(buyerIsPauser);
    });

    it('should revert if unauthorized address tries to mint tokens ', async () => {
      await truffleAssert.reverts(
        BosonTokenContract.mint(users.seller.address, 1000, {
          from: users.attacker.address,
        })
      );
    });

    it('should grant roles to address', async () => {
      await BosonTokenContract.grantRole(MINTER_ROLE, users.buyer.address);
      await BosonTokenContract.grantRole(PAUSER_ROLE, users.buyer.address);
      await BosonTokenContract.grantRole(DEFAULT_ADMIN_ROLE, users.buyer.address);

      const buyerIsMinter = await BosonTokenContract.hasRole(
        MINTER_ROLE,
        users.buyer.address
      );

      const buyerIsPauser = await BosonTokenContract.hasRole(
        PAUSER_ROLE,
        users.buyer.address
      );

      const buyerIsAdmin = await BosonTokenContract.hasRole(
        DEFAULT_ADMIN_ROLE,
        users.buyer.address
      );

      assert.isTrue(buyerIsMinter);
      assert.isTrue(buyerIsPauser);
      assert.isTrue(buyerIsAdmin);
    });

    it('should mint tokens after minter role is granted', async () => {
      const tokensToMint = 1000;
      let addressBalance = await BosonTokenContract.balanceOf(
        users.other2.address
      );

      assert.equal(addressBalance, 0, 'address has more tokens than expected');

      await BosonTokenContract.mint(users.other2.address, 1000);

      addressBalance = await BosonTokenContract.balanceOf(users.other2.address);

      assert.equal(
        addressBalance,
        tokensToMint,
        'minted tokens do not correspond to address balance'
      );
    });

    it("Should revoke roles for deployer", async () => {
      await BosonTokenContract.revokeRole(MINTER_ROLE, users.deployer.address);
      await BosonTokenContract.revokeRole(PAUSER_ROLE, users.deployer.address);
      await BosonTokenContract.revokeRole(DEFAULT_ADMIN_ROLE, users.deployer.address);

      const deployerIsAdmin = await BosonTokenContract.hasRole(
        DEFAULT_ADMIN_ROLE,
        users.deployer.address
      );
      const deployerIsMinter = await BosonTokenContract.hasRole(
        MINTER_ROLE,
        users.deployer.address
      );

      const deployerIsPauser = await BosonTokenContract.hasRole(
        PAUSER_ROLE,
        users.deployer.address
      );

      assert.isFalse(deployerIsAdmin);
      assert.isFalse(deployerIsMinter);
      assert.isFalse(deployerIsPauser);
    })

    it("[NEGATIVE] Deployer should not be able to grant roles after admin access is revoked", async () => {
      await truffleAssert.reverts(
        BosonTokenContract.grantRole(MINTER_ROLE, users.buyer.address),
        truffleAssert.ErrorType.REVERT
      )
    })

    describe('[PERMIT]', async () => {

      before(async () => {
        BosonTokenContract = await BosonToken.new('BOSON TOKEN', 'BSNT');
        bosonContractAddress = BosonTokenContract.address;
      })

      it('Should approve successfully', async () => {
        const balanceToApprove = 1200;
        const nonce = await BosonTokenContract.nonces(users.buyer.address);
        const deadline = toWei(1);
        const digest = await getApprovalDigest(
          BosonTokenContract,
          users.buyer.address,
          bosonContractAddress,
          balanceToApprove,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(users.buyer.privateKey.slice(2), 'hex')
        );

        await BosonTokenContract.permit(
          users.buyer.address,
          bosonContractAddress,
          balanceToApprove,
          deadline,
          v,
          r,
          s,
          {from: users.buyer.address}
        );

        const tokenAllowanceFromBuyer = await BosonTokenContract.allowance(
          users.buyer.address,
          bosonContractAddress
        );

        assert.equal(
          tokenAllowanceFromBuyer,
          balanceToApprove,
          'Allowance does not equal the amount provided!'
        );
      });

      it('should revert if incorrect nonce is provided', async () => {
        const balanceToApprove = 1200;
        const nonce = 7000000;
        const deadline = toWei(1);
        const digest = await getApprovalDigest(
          BosonTokenContract,
          users.buyer.address,
          bosonContractAddress,
          balanceToApprove,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(users.buyer.privateKey.slice(2), 'hex')
        );

        await truffleAssert.reverts(
          BosonTokenContract.permit(
            users.buyer.address,
            bosonContractAddress,
            balanceToApprove,
            deadline,
            v,
            r,
            s,
            {from: users.buyer.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('should revert if incorrect balance is provided', async () => {
        const balanceToApprove = 1200;
        const incorrectBalance = 1500;
        const nonce = await BosonTokenContract.nonces(users.buyer.address);
        const deadline = toWei(1);
        const digest = await getApprovalDigest(
          BosonTokenContract,
          users.buyer.address,
          bosonContractAddress,
          balanceToApprove,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(users.buyer.privateKey.slice(2), 'hex')
        );

        await truffleAssert.reverts(
          BosonTokenContract.permit(
            users.buyer.address,
            bosonContractAddress,
            incorrectBalance,
            deadline,
            v,
            r,
            s,
            {from: users.buyer.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('should revert if incorrect recipient is provided', async () => {
        const incorrectAddress = addresses[6];
        const balanceToApprove = 1200;
        const nonce = await BosonTokenContract.nonces(users.buyer.address);
        const deadline = toWei(1);
        const digest = await getApprovalDigest(
          BosonTokenContract,
          users.buyer.address,
          bosonContractAddress,
          balanceToApprove,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(users.buyer.privateKey.slice(2), 'hex')
        );

        await truffleAssert.reverts(
          BosonTokenContract.permit(
            users.buyer.address,
            incorrectAddress,
            balanceToApprove,
            deadline,
            v,
            r,
            s,
            {from: users.buyer.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('should revert if owner is incorrect', async () => {
        const incorrectSender = users.other1.address;
        const balanceToApprove = 1200;
        const nonce = await BosonTokenContract.nonces(users.buyer.address);
        const deadline = toWei(1);
        const digest = await getApprovalDigest(
          BosonTokenContract,
          users.buyer.address,
          bosonContractAddress,
          balanceToApprove,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(users.buyer.privateKey.slice(2), 'hex')
        );

        await truffleAssert.reverts(
          BosonTokenContract.permit(
            incorrectSender,
            bosonContractAddress,
            balanceToApprove,
            deadline,
            v,
            r,
            s,
            {from: users.buyer.address}
          ),
          truffleAssert.ErrorType.REVERT
        );
      });

      it('Should transfer tokens on behalf of the buyer', async () => {
        // Buyer has 1000 preminted tokens
        const tokensToMint = 1000;
        await BosonTokenContract.mint(users.buyer.address, tokensToMint, {
          from: users.deployer.address,
        });
        const balanceToApprove = 200;
        const tokensToSend = 200;

        const nonce = await BosonTokenContract.nonces(users.buyer.address);
        const deadline = toWei(1);
        const digest = await getApprovalDigest(
          BosonTokenContract,
          users.buyer.address,
          users.deployer.address,
          balanceToApprove,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(users.buyer.privateKey.slice(2), 'hex')
        );

        await BosonTokenContract.permit(
          users.buyer.address,
          users.deployer.address,
          balanceToApprove,
          deadline,
          v,
          r,
          s,
          {from: users.buyer.address}
        );

        let sellerBalance = await BosonTokenContract.balanceOf(
          users.seller.address
        );
        assert.equal(sellerBalance.toString(), 0, 'Seller has funds');

        await BosonTokenContract.transferFrom(
          users.buyer.address,
          users.seller.address,
          tokensToSend,
          {
            from: users.deployer.address,
          }
        );

        sellerBalance = await BosonTokenContract.balanceOf(
          users.seller.address
        );

        assert.equal(
          sellerBalance.toString(),
          tokensToSend,
          'Seller has different amount of tokens'
        );
      });

      it('Should revert if attacker tries to transfer', async () => {
        // Buyer has 1000 preminted tokens
        const tokensToMint = 1000;
        await BosonTokenContract.mint(users.buyer.address, tokensToMint, {
          from: users.deployer.address,
        });
        const balanceToApprove = 200;
        const tokensToSend = 200;

        const nonce = await BosonTokenContract.nonces(users.buyer.address);
        const deadline = toWei(1);
        const digest = await getApprovalDigest(
          BosonTokenContract,
          users.buyer.address,
          users.deployer.address,
          balanceToApprove,
          nonce,
          deadline
        );

        const {v, r, s} = ecsign(
          Buffer.from(digest.slice(2), 'hex'),
          Buffer.from(users.buyer.privateKey.slice(2), 'hex')
        );

        await BosonTokenContract.permit(
          users.buyer.address,
          users.deployer.address,
          balanceToApprove,
          deadline,
          v,
          r,
          s,
          {from: users.buyer.address}
        );

        await truffleAssert.reverts(
          BosonTokenContract.transferFrom(
            users.buyer.address,
            users.seller.address,
            tokensToSend,
            {
              from: users.attacker.address,
            }
          )
        );
      });

      describe("PAUSED", async () => {

        before(async () => {
          await BosonTokenContract.pause();
        })

        it("Token Contract should be paused", async () => {
          let isPaused = await BosonTokenContract.paused();
          assert.isTrue(isPaused)
        })

        it("[NEGATIVE] Approve should not be executable when paused", async () => {
          await truffleAssert.reverts(
            BosonTokenContract.approve(users.seller.address, 1000),
            truffleAssert.ErrorType.REVERT
          )
        })

        it("[NEGATIVE] Transfer should not be executable when paused", async () => {
          await truffleAssert.reverts(
            BosonTokenContract.transfer(users.seller.address, 1000),
            truffleAssert.ErrorType.REVERT          )
        })

        it("[NEGATIVE] TransferFrom should not be executable when paused", async () => {
          await truffleAssert.reverts(
            BosonTokenContract.transferFrom(users.seller.address, users.buyer.address, 1000),
            truffleAssert.ErrorType.REVERT          )
        })

        it("[NEGATIVE] Permit should not be executable when paused", async () => {
          const balanceToApprove = 1200;
          const nonce = await BosonTokenContract.nonces(users.buyer.address);
          const deadline = toWei(1);
          const digest = await getApprovalDigest(
            BosonTokenContract,
            users.buyer.address,
            bosonContractAddress,
            balanceToApprove,
            nonce,
            deadline
          );

          const {v, r, s} = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(users.buyer.privateKey.slice(2), 'hex')
          );

          await truffleAssert.reverts(
            BosonTokenContract.permit( users.buyer.address,
              bosonContractAddress,
              balanceToApprove,
              deadline,
              v,
              r,
              s,
              {from: users.buyer.address}),
            truffleAssert.ErrorType.REVERT
          
          )
        })
      })
    });
  });
});
