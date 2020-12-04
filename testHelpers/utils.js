
const helpers = require('./constants')
const config = require('./config.json')
const BN = web3.utils.BN

let instance;

class Utils {
    static getInstance(erc1155721, voucherKernel, cashier) {
        if (!instance) {
            return new Utils(erc1155721, voucherKernel, cashier)
        }

        return instance;
    }

    constructor(erc1155721, voucherKernel, cashier) {
        this.contractERC1155ERC721 = erc1155721
        this.contractVoucherKernel = voucherKernel
        this.contractCashier = cashier
    }

    async requestCreateOrder(seller, from, to) {
        const sellerDepoist = helpers.seller_deposit;
        const qty = 10
        const txValue = new BN(sellerDepoist.toString()).mul(new BN(qty))

        let txOrder = await this.contractCashier.requestCreateOrder(
            helpers.ASSET_TITLE, 
            from, 
            to, 
            helpers.product_price, 
            sellerDepoist, 
            helpers.buyer_deposit, 
            qty, 
            { 
                from: seller, 
                value: txValue.toString()
            }
        );

        return (txOrder.logs[0].args._tokenIdSupply).toString() 
    }

    async commitToBuy(buyer, seller, tokenSupplyId) {

        const buyerDeposit = helpers.buyer_deposit;
        const price = helpers.product_price;
        const txValue = new BN(buyerDeposit).add(new BN(price))

        let tx = await this.contractCashier.requestVoucher(tokenSupplyId, seller, { from: buyer, value: txValue.toString() });
        return (tx.logs[0].args._tokenIdVoucher).toString() 

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

     async withdrawWhenPaused(voucherID, executor) {
        const tx =  await this.contractCashier.withdrawWhenPaused(voucherID, {from: executor});
        console.log('GAS USED: ', tx.receipt.gasUsed);
        return tx
    }

    calcTotalAmountToRecipients(event, distributionAmounts) {
        if (event._to == config.accounts.buyer) {
            distributionAmounts.buyerAmount = new BN(distributionAmounts.buyerAmount.toString()).add(new BN(event._payment.toString()))
        } else if (event._to == config.accounts.seller) {
            distributionAmounts.sellerAmount = new BN(distributionAmounts.sellerAmount.toString()).add(new BN(event._payment.toString()))
        } else {
            distributionAmounts.escrowAmount = new BN(distributionAmounts.escrowAmount.toString()).add(new BN(event._payment.toString()))
        }
    }

    static async  getCurrTimestamp() {
        let blockNumber = await web3.eth.getBlockNumber()
        let block = await web3.eth.getBlock(blockNumber)

        return block.timestamp
    }
}

module.exports = Utils