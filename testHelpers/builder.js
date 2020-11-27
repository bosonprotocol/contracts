
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

    withPermit () {
        this.ETH_TKN = this.ETH_TKN_WithPermit
        this.TKN_TKN = this.TKN_TKN_WithPermit
        this.TKN_ETH = this.TKN_ETH_WithPermit

        return this
    }

    build(erc1155721, voucherKernel, cashier, bsnTokenPrice, bsnTokenDeposit) {
        this.utils.setContracts(erc1155721, voucherKernel, cashier, bsnTokenPrice, bsnTokenDeposit);
        return this.utils;
    }

    ETH_TKN_WithPermit() {
        this.utils.createOrder = this.utils.requestCreateOrder_WithPermit_ETH_TKN
        this.utils.commitToBuy = this.utils.commitToBuy_WithPermit_ETH_TKN
        
        return this
    }

    TKN_TKN_WithPermit() {
        this.utils.createOrder = this.utils.requestCreateOrder_WithPermit_TKN_TKN
        this.utils.commitToBuy = this.utils.commitToBuy_WithPermit_TKN_TKN

        return this
    }

    TKN_ETH_WithPermit() {

    }

    
}

module.exports = UtilsBuilder;