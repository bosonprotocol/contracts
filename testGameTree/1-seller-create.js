const sellerCreate = require("./seller/createVoucher");
const checkBalance = require("./helpers/checkBalance");
const {describe,it} = require("mocha");
let format = require("./helpers/formatter")
let helpers = require("./helpers/constants");
let assert = require('chai').assert;

describe("TEST SCENARIO 01 :: SELLER CREATES A VOUCHER SET", async function() {

    let value;
    let aql = assert.equal;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 01 :: SELLER CREATE :: 1.0 CREATION OF VOUCHER", async function() {
        value = await sellerCreate();
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

    it("TEST SCENARIO 01 :: SELLER CREATE :: 1.4 VALIDATE SELLER DEPOSIT", async function () {
        aql(value['sellerDeposit'],helpers.seller_deposit);
    })

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});