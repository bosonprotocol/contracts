const sellerCreate = require("../seller/createVoucher");
const checkBalance = require("../helpers/checkBalance");
const Utils = require('../helpers/utils');
const { SELLER_PUBLIC, contracts } = require('../helpers/config');
const {describe,it} = require("mocha");
let format = require("../helpers/formatter")
let helpers = require("../helpers/constants");
let assert = require('chai').assert;

describe("TEST SCENARIO 001 :: SELLER CREATES A VOUCHER SET", async function() {

    let value;
    let aql = assert.equal;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 01 :: SELLER CREATE :: 1.0 CREATION OF VOUCHER", async function() {
        const timestamp = await Utils.getCurrTimestamp();
        value = await sellerCreate(timestamp);
        await format(value);
    });

    it("TEST SCENARIO 01 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM", async function () {
        aql(value['ValidFrom'],helpers.PROMISE_VALID_FROM);
    })

    it("TEST SCENARIO 01 :: SELLER CREATE :: 1.2 VALIDATE VALID TO", async function () {
        aql(value['ValidTo'],helpers.PROMISE_VALID_TO);
    })

    it("TEST SCENARIO 01 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY", async function () {
        aql(value['nftSupply'],helpers.ORDER_QUANTITY1);
    })

    it("TEST SCENARIO 01 :: SELLER CREATE :: 1.4 VALIDATE SELLER", async function () {
        aql(value['nftSeller'],SELLER_PUBLIC);
    })

    it("TEST SCENARIO 01 :: SELLER CREATE :: 1.5 VALIDATE PAYMENT TYPE", async function () {
        aql(value['paymentType'],1);
    })

    it("TEST SCENARIO 01 :: SELLER CREATE :: 1.6 VALIDATE ERC1155ERC721 DATA", async function () {
        aql(value['operator'],contracts.VoucherKernelContractAddress);
        aql(value['transferFrom'],helpers.ZERO_ADDRESS);
        aql(value['transferTo'],SELLER_PUBLIC);
        aql(value['transferValue'],helpers.ORDER_QUANTITY1);
    })

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});