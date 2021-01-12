
// @ts-nocheck
const Utils = require('./utils')

class UtilsBuilder {

    constructor() {
        this.utils = new Utils()
    }

    static NEW ()  {
       return new UtilsBuilder()
    };

    ETH_ETH () {
        this.utils.createOrder = this.utils.requestCreateOrder_ETH_ETH
        this.utils.commitToBuy = this.utils.commitToBuy_ETH_ETH
        
        return this
    }

    ERC20withPermit () {
        this.ETH_TKN = this.ETH_TKN_WithPermit
        this.TKN_TKN = this.TKN_TKN_WithPermit
        this.TKN_ETH = this.TKN_ETH_WithPermit
        this.TKN_TKN_SAME = this.TKN_TKN_SameWithPermit

        return this
    }

    build(erc1155721, voucherKernel, cashier, bsnRouter, bsnTokenPrice, bsnTokenDeposit) {
        this.utils.setContracts(erc1155721, voucherKernel, cashier, bsnRouter, bsnTokenPrice, bsnTokenDeposit);
        return this.utils;
    }

    ETH_TKN_WithPermit() {
        this.utils.createOrder = this.utils.requestCreateOrder_ETH_TKN_WithPermit
        this.utils.commitToBuy = this.utils.commitToBuy_ETH_TKN_WithPermit
        
        return this
    }

    TKN_TKN_WithPermit() {
        this.utils.createOrder = this.utils.requestCreateOrder_TKN_TKN_WithPermit
        this.utils.commitToBuy = this.utils.commitToBuy_TKN_TKN_WithPermit

        return this
    }

    TKN_TKN_SameWithPermit() {
        this.utils.createOrder = this.utils.requestCreateOrder_TKN_TKN_Same_WithPermit
        this.utils.commitToBuy = this.utils.commitToBuy_TKN_TKN_Same_WithPermit

        return this
    }

    TKN_ETH_WithPermit() {
        this.utils.createOrder = this.utils.requestCreateOrder_TKN_ETH
        this.utils.commitToBuy = this.utils.commitToBuy_TKN_ETH_WithPermit

        return this
    }

    
}

module.exports = UtilsBuilder;