
const helpers = require('./constants')
const config = require('./config.json')
const BN = web3.utils.BN
const truffleAssert = require('truffle-assertions')

let instance;

const { ecsign } = require('ethereumjs-util');

const {
    PERMIT_TYPEHASH,
    toWei,
    getApprovalDigest
} = require('../testHelpers/permitUtils');

class Utils {

    constructor() {
        this.createOrder = ''
        this.commitToBuy = ''
    }

    setContracts(erc1155721, voucherKernel, cashier, bsnTokenPrice, bsnTokenDeposit) {
            this.contractERC1155ERC721 = erc1155721
            this.contractVoucherKernel = voucherKernel
            this.contractCashier = cashier
            this.contractBSNTokenPrice = bsnTokenPrice
            this.contractBSNTokenDeposit = bsnTokenDeposit
    }

    async requestCreateOrder_ETH_ETH(seller, from, to) {
        const sellerDepoist = helpers.seller_deposit;
        const qty = 10
        const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))

        let txOrder = await this.contractCashier.requestCreateOrder(
            [from, 
            to, 
            helpers.product_price, 
            sellerDepoist, 
            helpers.buyer_deposit, 
            qty], 
            { 
                from: seller, 
                value: txValue.toString()
            }
        );

        return (txOrder.logs[0].args._tokenIdSupply).toString() 
    }

    async requestCreateOrder_WithPermit_TKN_TKN(seller, from, to, sellerDeposit, qty) {
        const txValue = new BN(sellerDeposit.toString()).mul(new BN(qty))
        const deadline = toWei(1)

        const nonce = await this.contractBSNTokenDeposit.nonces(seller.address);

        const digest = await getApprovalDigest(
            this.contractBSNTokenDeposit,
            seller.address,
            this.contractCashier.address,
            txValue.toString(),
            nonce,
            deadline
        )

        const { v, r, s } = ecsign( 
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(seller.pk.slice(2), 'hex'));
       
        let txOrder = await this.contractCashier.requestCreateOrderTknTknWithPermit(
            this.contractBSNTokenPrice.address,
            this.contractBSNTokenDeposit.address,
            txValue.toString(),
            deadline,
            v,r,s,
            [
                from,
                to,
                helpers.product_price,
                sellerDeposit,
                helpers.buyer_deposit,
                qty
            ],
            {
                from: seller.address
            }
        );

        return (txOrder.logs[0].args._tokenIdSupply).toString()
    }

    async requestCreateOrder_WithPermit_ETH_TKN(seller, from, to, sellerDeposit, qty) {
        const txValue = new BN(sellerDeposit.toString()).mul(new BN(qty));
        const deadline = toWei(1)
        const nonce = await this.contractBSNTokenDeposit.nonces(seller.address);

        const digest = await getApprovalDigest(
            this.contractBSNTokenDeposit,
            seller.address,
            this.contractCashier.address,
            txValue.toString(),
            nonce,
            deadline
        )

        const { v, r, s } = ecsign(
            Buffer.from(digest.slice(2), 'hex'),
            Buffer.from(seller.pk.slice(2), 'hex'));


        let txOrder = await this.contractCashier.requestCreateOrderEthTknWithPermit(
            this.contractBSNTokenDeposit.address,
            txValue,
            deadline,
            v, r, s,
            [
                from,
                to,
                helpers.product_price,
                sellerDeposit,
                helpers.buyer_deposit,
                qty
            ],
            {
                from: seller.address
            }
        );

        return (txOrder.logs[0].args._tokenIdSupply).toString()
    }

    async requestCreateOrder_WithPermit_TKN_ETH(seller, from, to, sellerDeposit, qty) {
        const txValue = new BN(sellerDeposit.toString()).mul(new BN(qty));

        let txOrder = await this.contractCashier.requestCreateOrder_TKN_ETH_WithPermit(
            this.contractBSNTokenPrice.address,
            [
                from,
                to,
                helpers.product_price,
                sellerDeposit,
                helpers.buyer_deposit,
                qty
            ],
            {
                from: seller.address,
                value: txValue.toString()
            }
        );

        return (txOrder.logs[0].args._tokenIdSupply).toString()
    }

    async commitToBuy_WithPermit_TKN_TKN(buyer, seller, tokenSupplyId) {
        const buyerDeposit = helpers.buyer_deposit;
        const price = helpers.product_price;
        const txValue = new BN(buyerDeposit).add(new BN(price))

        const deadline = toWei(1)
        const nonce1 = await this.contractBSNTokenDeposit.nonces(buyer.address);

        const digestDeposit = await getApprovalDigest(
            this.contractBSNTokenDeposit,
            buyer.address,
            this.contractCashier.address,
            buyerDeposit,
            nonce1,
            deadline
        )

        let VRS_DEPOSIT = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(buyer.pk.slice(2), 'hex'));

        let vDeposit = VRS_DEPOSIT.v
        let rDeposit = VRS_DEPOSIT.r
        let sDeposit = VRS_DEPOSIT.s

        const nonce2 = await this.contractBSNTokenPrice.nonces(buyer.address);

        const digestPrice = await getApprovalDigest(
            this.contractBSNTokenPrice,
            buyer.address,
            this.contractCashier.address,
            price,
            nonce2,
            deadline
        )

        let VRS_PRICE = ecsign(
            Buffer.from(digestPrice.slice(2), 'hex'),
            Buffer.from(buyer.pk.slice(2), 'hex'));

        let vPrice = VRS_PRICE.v
        let rPrice = VRS_PRICE.r
        let sPrice = VRS_PRICE.s

        let CommitTx = await this.contractCashier.requestVoucherTknTKnWithPermit(
            tokenSupplyId,
            seller.address,
            txValue.toString(),
            deadline,
            vPrice, rPrice, sPrice,
            vDeposit, rDeposit, sDeposit,
        { from: buyer.address });

        let nestedValue = (await truffleAssert.createTransactionResult(this.contractVoucherKernel, CommitTx.tx)).logs

        let filtered = nestedValue.filter(e => e.event == 'LogVoucherDelivered')[0]
        return filtered.returnValues['_tokenIdVoucher']
    }

    async commitToBuy_WithPermit_ETH_TKN(buyer, seller, tokenSupplyId) {
        const buyerDeposit = helpers.buyer_deposit;
        const price = helpers.product_price;
        const depositInTokens = new BN(buyerDeposit)
        const sellerAddress = seller.address;

        const deadline = toWei(1)

        const nonce1 = await this.contractBSNTokenDeposit.nonces(buyer.address);

        const digestDeposit = await getApprovalDigest(
            this.contractBSNTokenDeposit,
            buyer.address,
            this.contractCashier.address,
            buyerDeposit.toString(),
            nonce1,
            deadline
        )

        let { v, r, s } = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(buyer.pk.slice(2), 'hex'));


        let txOrder = await this.contractCashier.requestVoucherEthTknWithPermit(
            tokenSupplyId,
            sellerAddress,
            buyerDeposit.toString(),
            deadline,
            v, r, s,
            { from: buyer.address, value: helpers.product_price.toString() }
        );

        let nestedValue = (await truffleAssert.createTransactionResult(this.contractVoucherKernel, txOrder.tx)).logs

        let filtered = nestedValue.filter(e => e.event == 'LogVoucherDelivered')[0]
        return filtered.returnValues['_tokenIdVoucher']
    }

    async commitToBuy_ETH_ETH(buyer, seller, tokenSupplyId) {

        const buyerDeposit = helpers.buyer_deposit;
        const price = helpers.product_price;
        const txValue = new BN(buyerDeposit).add(new BN(price))

        let CommitTx = await this.contractCashier.requestVoucher(tokenSupplyId, seller, { from: buyer, value: txValue.toString() });

        let nestedValue = (await truffleAssert.createTransactionResult(this.contractVoucherKernel, CommitTx.tx)).logs

        let filtered = nestedValue.filter(e => e.event == 'LogVoucherDelivered')[0]
        return filtered.returnValues['_tokenIdVoucher']

    }

    async commitToBuy_WithPermit_TKN_ETH(buyer, seller, tokenSupplyId) {
        const buyerDeposit = helpers.buyer_deposit;
        const price = helpers.product_price;
        const sellerAddress = seller.address;

        const deadline = toWei(1)

        const nonce1 = await this.contractBSNTokenPrice.nonces(buyer.address);

        const digestDeposit = await getApprovalDigest(
            this.contractBSNTokenPrice,
            buyer.address,
            this.contractCashier.address,
            price,
            nonce1,
            deadline
        )

        let { v, r, s } = ecsign(
            Buffer.from(digestDeposit.slice(2), 'hex'),
            Buffer.from(buyer.pk.slice(2), 'hex'));


        let txOrder = await this.contractCashier.requestVoucher_TKN_ETH_WithPermit(
            tokenSupplyId,
            sellerAddress,
            price,
            deadline,
            v, r, s,
            { from: buyer.address, value: helpers.buyer_deposit }
        );

        let nestedValue = (await truffleAssert.createTransactionResult(this.contractVoucherKernel, txOrder.tx)).logs

        let filtered = nestedValue.filter(e => e.event == 'LogVoucherDelivered')[0]
        return filtered.returnValues['_tokenIdVoucher']
    }

    async refund(voucherID, buyer) {
        await this.contractVoucherKernel.refund(voucherID, { from: buyer });
    }

    async redeem(voucherID, buyer) {
        await this.contractVoucherKernel.redeem(voucherID, { from: buyer });
    }

    async complain(voucherID, buyer) {
        await this.contractVoucherKernel.complain(voucherID, { from: buyer });
    }

    async cancel(voucherID, seller) {
        await this.contractVoucherKernel.cancelOrFault(voucherID, { from: seller });
    }

    async finalize(voucherID, deployer) {
        await this.contractVoucherKernel.triggerFinalizeVoucher(voucherID, {from: deployer})
    }

    async withdraw(voucherID, deployer) {
        const tx =  await this.contractCashier.withdraw([voucherID], {from: deployer});
        console.log('GAS USED: ', tx.receipt.gasUsed);
        return tx
    }

    calcTotalAmountToRecipients(event, distributionAmounts, recipient) {
        if (event[recipient] == config.accounts.buyer) {
            distributionAmounts.buyerAmount = new BN(distributionAmounts.buyerAmount.toString()).add(new BN(event._payment.toString()))
        } else if (event[recipient] == config.accounts.seller) {
            distributionAmounts.sellerAmount = new BN(distributionAmounts.sellerAmount.toString()).add(new BN(event._payment.toString()))
        } else {
            distributionAmounts.escrowAmount = new BN(distributionAmounts.escrowAmount.toString()).add(new BN(event._payment.toString()))
        }
    }

    async mintTokens(tokenContract, to, value) {

        await this[tokenContract].mint(to, value);
    }

    static async  getCurrTimestamp() {
        let blockNumber = await web3.eth.getBlockNumber()
        let block = await web3.eth.getBlock(blockNumber)

        return block.timestamp
    }
}

module.exports = Utils