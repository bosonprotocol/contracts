const sellerCreate = require("./seller/createVoucher");
const sellerCancel = require("./seller/cancelVoucherSet");
const {describe,it} = require("mocha");
let format = require("./helpers/formatter");
const checkBalance = require("./helpers/checkBalance");
let helpers = require("./helpers/constants");
let assert = require('chai').assert;

describe("TEST SCENARIO 02 :: SELLER CREATES & CANCELS", async function() {

    let voucherSetDetails;
    let cancelledVoucher;
    let aql = assert.equal;


    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 02 :: SELLER CREATE :: 1.0 Seller creates a voucher-set", async function() {
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    });

    it("TEST SCENARIO 02 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM", async function () {
        aql(voucherSetDetails['ValidFrom'],helpers.PROMISE_VALID_FROM);
    })

    it("TEST SCENARIO 02 :: SELLER CREATE :: 1.2 VALIDATE VALID TO", async function () {
        aql(voucherSetDetails['ValidTo'],helpers.PROMISE_VALID_TO);
    })

    it("TEST SCENARIO 02 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY", async function () {
        aql(voucherSetDetails['nftSupply'],helpers.ORDER_QUANTITY1);
    })

    it("TEST SCENARIO 02 :: SELLER CREATE :: 1.4 VALIDATE SELLER DEPOSIT", async function () {
        aql(voucherSetDetails['sellerDeposit'],helpers.seller_deposit);
    })

    it("TEST SCENARIO 02:: SELLER CANCEL :: 2.0 Seller cancels a voucher-set", async function() {
        cancelledVoucher  =  await sellerCancel(voucherSetDetails["createdVoucherSetID"]);
        await format(cancelledVoucher);
    });

    it("TEST SCENARIO 02 :: SELLER CANCEL :: 2.1 VALIDATE ORDER QUANTITY", async function () {
        aql(voucherSetDetails['nftSupply'],cancelledVoucher['VoucherSetQuantity']);
    })

    it("TEST SCENARIO 02 :: SELLER CANCEL :: 2.2 VALIDATE REFUNDED SELLER DEPOSIT", async function () {
        aql(voucherSetDetails['sellerDeposit'],cancelledVoucher['redfundedSellerDeposit']);
    })

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});