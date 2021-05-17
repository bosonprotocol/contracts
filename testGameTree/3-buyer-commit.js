const sellerCreate = require("./seller/createVoucher");
const commitVoucher = require("./buyer/commitVoucher");
const {describe,it,before} = require("mocha");

let format = require("./helpers/formatter")
const checkBalance = require("./helpers/checkBalance");

let helpers = require("./helpers/constants");
const {BUYER_PUBLIC, SELLER_PUBLIC} = require('./helpers/config');
let assert = require('chai').assert;

const TIMEOUT = 500 * 1000;

describe("TEST SCENARIO 03 :: SELLER CREATES & BUYER COMMITS", async function() {

    let commitVoucherDetails;
    let voucherSetDetails;
    let aql = assert.equal;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 03 :: SELLER CREATE :: 1.0 Seller creates a voucher set", async function (){
        this.timeout(TIMEOUT);
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    })

    it("TEST SCENARIO 03 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM", async function () {
        aql(voucherSetDetails['ValidFrom'],helpers.PROMISE_VALID_FROM);
    })

    it("TEST SCENARIO 03 :: SELLER CREATE :: 1.2 VALIDATE VALID TO", async function () {
        aql(voucherSetDetails['ValidTo'],helpers.PROMISE_VALID_TO);
    })

    it("TEST SCENARIO 03 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY", async function () {
        aql(voucherSetDetails['nftSupply'],helpers.ORDER_QUANTITY1);
    })

    it("TEST SCENARIO 03 :: SELLER CREATE :: 1.4 VALIDATE SELLER DEPOSIT", async function () {
        aql(voucherSetDetails['sellerDeposit'],helpers.seller_deposit);
    })

    it("TEST SCENARIO 03 :: BUYER COMMITS :: 2.0 Buyer commits to purchase a voucher", async function() {
        commitVoucherDetails = await commitVoucher(voucherSetDetails["createdVoucherSetID"]);
        await format(commitVoucherDetails);
    });

    it("TEST SCENARIO 03 :: SELLER CREATE :: 2.1 VALIDATE ISSUER", async function () {
        aql(commitVoucherDetails['issuer'],SELLER_PUBLIC.toLowerCase());
    })

    it("TEST SCENARIO 03 :: SELLER CREATE :: 2.2 VALIDATE HOLDER", async function () {
        aql(commitVoucherDetails['holder'],BUYER_PUBLIC.toLowerCase());
    })

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});