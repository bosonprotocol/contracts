const chai = require('chai')
const ethers = require('ethers')
let chaiAsPromised = require("chai-as-promised")
chai.use(chaiAsPromised)
const assert = chai.assert
const truffleAssert = require('truffle-assertions');

var { ecsign } = require('ethereumjs-util');

const BN = web3.utils.BN
const BosonToken = artifacts.require("BosonToken")


const maxuint = new BN('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

const {
    hexlify,
    getAddress,
    keccak256,
    defaultAbiCoder,
    toUtf8Bytes,
    solidityPack
} = require('ethers').utils;

const toWei = (value) => {
    return value + '0'.repeat(18);
}

const PERMIT_TYPEHASH = keccak256(
    toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

const getApprovalDigest = async (
    token,
    owner,
    spender,
    value,
    nonce,
    deadline
) =>  { 

    const name = await token.name();
    const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address);

    return keccak256(
        solidityPack(
            ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
            [
                '0x19',
                '0x01',
                DOMAIN_SEPARATOR,
                keccak256(
                    defaultAbiCoder.encode(
                        ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
                        [PERMIT_TYPEHASH, owner, spender, value.toString(), nonce.toString(), deadline]
                    )
                )
            ]
        )
    )
}

function getDomainSeparator(name, tokenAddress) {
    return keccak256(
        defaultAbiCoder.encode(
            ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
            [
                keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
                keccak256(toUtf8Bytes(name)),
                keccak256(toUtf8Bytes('1')),
                1,
                tokenAddress
            ]
        )
    )
}

contract('Boson token', accounts => {

    let BosonTokenContract, bosonContractAddress;

    let Deployer = accounts[0] //0xD9995BAE12FEe327256FFec1e3184d492bD94C31
    let Deployer_PK = '0x7ab741b57e8d94dd7e1a29055646bafde7010f38a900f55bbd7647880faa6ee8'
    let Seller = accounts[1] //0xd4Fa489Eacc52BA59438993f37Be9fcC20090E39
    let Seller_PK = '0x2030b463177db2da82908ef90fa55ddfcef56e8183caf60db464bc398e736e6f';
    let Buyer = accounts[2] //0x760bf27cd45036a6C486802D30B5D90CfFBE31FE
    let Buyer_PK = '0x62ecd49c4ccb41a70ad46532aed63cf815de15864bc415c87d507afd6a5e8da2'
    let Attacker = accounts[3] //0x56A32fFf5E5A8B40d6A21538579fB8922DF5258c 
    let Attacker_PK = '0xf473040b1a83739a9c7cc1f5719fab0f5bf178f83314d98557c58aae1910e03a' 

    before(async () => {

        BosonTokenContract = await BosonToken.new('BOSON TOKEN', 'BSNT')
        bosonContractAddress = BosonTokenContract.address
    })

    describe('Boson Token', async () => {

        const ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADMIN_ROLE"))
        const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"))

        it("Only Deployer Should have admin and minter rights initiially ", async () => {
           
            const buyerIsAdmin = await BosonTokenContract.hasRole(ADMIN_ROLE, Buyer);
            const buyerIsMinter = await BosonTokenContract.hasRole(MINTER_ROLE, Buyer);
            const deployerIsAdmin = await BosonTokenContract.hasRole(ADMIN_ROLE, Deployer);
            const deployerIsMinter = await BosonTokenContract.hasRole(MINTER_ROLE, Deployer);

            assert.isTrue(deployerIsAdmin)
            assert.isTrue(deployerIsMinter)

            assert.isFalse(buyerIsAdmin)
            assert.isFalse(buyerIsMinter)
        })

        it("should revert if unauthorized address tries to mint tokens ", async () => {
            await truffleAssert.reverts(BosonTokenContract.mint(Seller, 1000, {from: Attacker} ))
        })

        it("should grant minter role to address", async () => {
            await BosonTokenContract.grantRole(MINTER_ROLE, Buyer);

            const buyerIsMinter = await BosonTokenContract.hasRole(MINTER_ROLE, Buyer);
            
            assert.isTrue(buyerIsMinter)
        })

        it("should mint tokens after minter role is granted", async () => {
            const tokensToMint = 1000;
            const randomAddress = accounts[7];
            let addressBalance = await BosonTokenContract.balanceOf(randomAddress)

            assert.equal(addressBalance, 0, 'address has more tokens than expected')

            await BosonTokenContract.mint(randomAddress, 1000);

            addressBalance = await BosonTokenContract.balanceOf(randomAddress)
            assert.equal(addressBalance, tokensToMint, "minted tokens do not correspond to address balance")
        })

        describe("[PERMIT]", async () => {
            it("Should approve successfully", async () => {
                const balanceToApprove = 1200;
                const nonce = await BosonTokenContract.nonces(Buyer)
                const deadline = toWei(1);
                const digest = await getApprovalDigest(
                    BosonTokenContract,
                    Buyer,
                    bosonContractAddress,
                    balanceToApprove,
                    nonce,
                    deadline
                )

                const { v, r, s } = ecsign(
                    Buffer.from(digest.slice(2), 'hex'),
                    Buffer.from(Buyer_PK.slice(2), 'hex'));

                await BosonTokenContract.permit(
                    Buyer,
                    bosonContractAddress,
                    balanceToApprove,
                    deadline,
                    v, r, s,
                    { from: Buyer }
                )

                const tokenAllowanceFromBuyer = await BosonTokenContract.allowance(Buyer, bosonContractAddress);

                assert.equal(tokenAllowanceFromBuyer, balanceToApprove, "Allowance does not equal the amount provided!")

            })

            it("should revert if incorrect nonce is provided", async () => {

                const balanceToApprove = 1200;
                const nonce = maxuint;
                const deadline = toWei(1);
                const digest = await getApprovalDigest(
                    BosonTokenContract,
                    Buyer,
                    bosonContractAddress,
                    balanceToApprove,
                    nonce,
                    deadline
                )

                const { v, r, s } = ecsign(
                    Buffer.from(digest.slice(2), 'hex'),
                    Buffer.from(Buyer_PK.slice(2), 'hex'));

                await truffleAssert.reverts(BosonTokenContract.permit(
                    Buyer,
                    bosonContractAddress,
                    balanceToApprove,
                    deadline,
                    v, r, s,
                    { from: Buyer }
                ), truffleAssert.ErrorType.REVERT)
            })

            it("should revert if incorrect balance is provided", async () => {

                const balanceToApprove = 1200;
                const incorrectBalance = 1500;
                const nonce = await BosonTokenContract.nonces(Buyer);
                const deadline = toWei(1);
                const digest = await getApprovalDigest(
                    BosonTokenContract,
                    Buyer,
                    bosonContractAddress,
                    balanceToApprove,
                    nonce,
                    deadline
                )

                const { v, r, s } = ecsign(
                    Buffer.from(digest.slice(2), 'hex'),
                    Buffer.from(Buyer_PK.slice(2), 'hex'));

                await truffleAssert.reverts(BosonTokenContract.permit(
                    Buyer,
                    bosonContractAddress,
                    incorrectBalance,
                    deadline,
                    v, r, s,
                    { from: Buyer }
                ), truffleAssert.ErrorType.REVERT)
            })

            it("should revert if incorrect recipient is provided", async () => {
                const incorrectAddress = accounts[6]
                const balanceToApprove = 1200;
                const nonce = await BosonTokenContract.nonces(Buyer);
                const deadline = toWei(1);
                const digest = await getApprovalDigest(
                    BosonTokenContract,
                    Buyer,
                    bosonContractAddress,
                    balanceToApprove,
                    nonce,
                    deadline
                )

                const { v, r, s } = ecsign(
                    Buffer.from(digest.slice(2), 'hex'),
                    Buffer.from(Buyer_PK.slice(2), 'hex'));

                await truffleAssert.reverts(BosonTokenContract.permit(
                    Buyer,
                    incorrectAddress,
                    balanceToApprove,
                    deadline,
                    v, r, s,
                    { from: Buyer }
                ), truffleAssert.ErrorType.REVERT)
            })

            it("should revert if owner is incorrect", async () => {
                const inccorectSender = accounts[6]
                const balanceToApprove = 1200;
                const nonce = await BosonTokenContract.nonces(Buyer);
                const deadline = toWei(1);
                const digest = await getApprovalDigest(
                    BosonTokenContract,
                    Buyer,
                    bosonContractAddress,
                    balanceToApprove,
                    nonce,
                    deadline
                )

                const { v, r, s } = ecsign(
                    Buffer.from(digest.slice(2), 'hex'),
                    Buffer.from(Buyer_PK.slice(2), 'hex'));

                await truffleAssert.reverts(BosonTokenContract.permit(
                    inccorectSender,
                    bosonContractAddress,
                    balanceToApprove,
                    deadline,
                    v, r, s,
                    { from: Buyer }
                ), truffleAssert.ErrorType.REVERT)
            })

            it("Should transfer tokens on behalf of the buyer", async() => {
                //Buyer has 1000 preminted tokens
                const tokensToMint = 1000
                await BosonTokenContract.mint(Buyer, tokensToMint, { from: Deployer });
                const balanceToApprove = 200;
                const tokensToSend = 200;

                const nonce = await BosonTokenContract.nonces(Buyer)
                const deadline = toWei(1);
                const digest = await getApprovalDigest(
                    BosonTokenContract,
                    Buyer,
                    Deployer,
                    balanceToApprove,
                    nonce,
                    deadline
                )

                const { v, r, s } = ecsign(
                    Buffer.from(digest.slice(2), 'hex'),
                    Buffer.from(Buyer_PK.slice(2), 'hex'));

                await BosonTokenContract.permit(
                    Buyer,
                    Deployer,
                    balanceToApprove,
                    deadline,
                    v, r, s,
                    { from: Buyer }
                )


                let sellerBalance = await BosonTokenContract.balanceOf(Seller)
                assert.equal(sellerBalance.toString(), 0, 'Seller has funds')

                await BosonTokenContract.transferFrom(Buyer, Seller, tokensToSend, {from: Deployer});

                sellerBalance = await BosonTokenContract.balanceOf(Seller)
                assert.equal(sellerBalance.toString(), tokensToSend, 'Seller has different amount of tokens')

            })

            it("Should revert if attacker tries to transfer", async () => {
                //Buyer has 1000 preminted tokens
                const tokensToMint = 1000
                await BosonTokenContract.mint(Buyer, tokensToMint, { from: Deployer });
                const balanceToApprove = 200;
                const tokensToSend = 200;

                const nonce = await BosonTokenContract.nonces(Buyer)
                const deadline = toWei(1);
                const digest = await getApprovalDigest(
                    BosonTokenContract,
                    Buyer,
                    Deployer,
                    balanceToApprove,
                    nonce,
                    deadline
                )

                const { v, r, s } = ecsign(
                    Buffer.from(digest.slice(2), 'hex'),
                    Buffer.from(Buyer_PK.slice(2), 'hex'));

                await BosonTokenContract.permit(
                    Buyer,
                    Deployer,
                    balanceToApprove,
                    deadline,
                    v, r, s,
                    { from: Buyer }
                )

                await truffleAssert.reverts(BosonTokenContract.transferFrom(Buyer, Seller, tokensToSend, { from: Attacker }));

            })
        })
        
    })

})