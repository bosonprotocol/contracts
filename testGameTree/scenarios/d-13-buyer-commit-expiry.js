const sellerCreate = require("../seller/createExpiringVoucher");
const commitVoucher = require("../buyer/commitVoucher");
const triggerExpire = require("../seller/triggerExpiration");
const checkExpiry = require("../seller/checkExpiryStatus");
const Utils = require('../helpers/utils');
const {describe,it,before} = require("mocha");
let format = require("../helpers/formatter")
const checkBalance = require("../helpers/checkBalance");
let helpers = require("../helpers/constants");
const {BUYER_PUBLIC, SELLER_PUBLIC} = require('../helpers/config');
let assert = require('chai').assert;
const delay = require('../helpers/delay');
const wait = require('wait');

const TIMEOUT = 500 * 1000;

describe("TEST SCENARIO 013 :: SELLER CREATES & BUYER COMMITS", async function() {

    let commitVoucherDetails;
    let voucherSetDetails;
    let triggerExpireDetails;
    let checkExpireDetails;
    let aql = assert.equal;

    // creates current timestamp in epoch
    /*
    Date.prototype.toUnixTime = function() { return this.getTime()/1000|0 };
    Date.time = function() { return new Date().toUnixTime(); }
    let currentTimeStamp = Date.time();
    let expiryTimeStamp = currentTimeStamp+360;
*/
    let timestamp;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 13 :: SELLER CREATE :: 1.0 Seller creates a voucher set", async function (){
        this.timeout(TIMEOUT);
        timestamp = await Utils.getCurrTimestamp();
        voucherSetDetails  =  await sellerCreate(timestamp);
        await format(voucherSetDetails);
    })

    it("TEST SCENARIO 13 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM", async function () {
        aql(voucherSetDetails['ValidFrom'],timestamp);
    })

/*
    it("TEST SCENARIO 13 :: SELLER CREATE :: 1.2 VALIDATE VALID TO", async function () {
        aql(voucherSetDetails['ValidTo'],expiryTimeStamp);
    })
*/
    it("TEST SCENARIO 13 :: SELLER CREATE :: 1.1 VALIDATE ORDER QUANTITY", async function () {
        aql(voucherSetDetails['nftSupply'],helpers.ORDER_QUANTITY1);
    })

    it("TEST SCENARIO 13 :: SELLER CREATE :: 1.2 VALIDATE SELLER DEPOSIT", async function () {
        aql(voucherSetDetails['sellerDeposit'],helpers.seller_deposit);
    })

    it("TEST SCENARIO 13 :: BUYER COMMITS :: 2.0 Buyer commits to purchase a voucher", async function() {
        await delay();
        await wait(120000);
        commitVoucherDetails = await commitVoucher(voucherSetDetails["createdVoucherSetID"]);
        await wait(120000);
        await format(commitVoucherDetails);
    });

    it("TEST SCENARIO 13 :: SELLER CREATE :: 2.1 VALIDATE ISSUER", async function () {
        aql(commitVoucherDetails['issuer'],SELLER_PUBLIC.toLowerCase());
    })

    it("TEST SCENARIO 13 :: SELLER CREATE :: 2.2 VALIDATE HOLDER", async function () {
        aql(commitVoucherDetails['holder'],BUYER_PUBLIC.toLowerCase());
    })

    it("TEST SCENARIO 13 :: EXPIRE :: 3.0 Expire voucher", async function() {
        await wait(240000);
        triggerExpireDetails = await triggerExpire(commitVoucherDetails["MintedVoucherID"]);
        await format(triggerExpireDetails);
    });

    it("TEST SCENARIO 13 :: EXPIRE :: 3.0 CHECK EXPIRY STATUS", async function() {
        checkExpireDetails = await checkExpiry(commitVoucherDetails["MintedVoucherID"]);
        await format(checkExpireDetails);
        aql(checkExpireDetails["Status"],144);
    });
/*
    it("TEST SCENARIO 13 :: CHECK EXPIRE :: 3.1 VALIDATE EXPIRY", async function () {
        await delay();
        let timeStamp = Date.time();
        assert.isBelow(expiryTimeStamp,timeStamp);
    })
*/
    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});