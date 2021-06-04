const sellerCreate = require("../seller/createExpiringVoucher");
const commitVoucher = require("../buyer/commitVoucher");
const triggerExpire = require("../seller/triggerExpiration");
const checkExpiry = require("../seller/checkExpiryStatus");
const Utils = require('../helpers/utils');
const {describe,it,before} = require("mocha");
let format = require("../helpers/formatter")
const checkBalance = require("../helpers/checkBalance");
let helpers = require("../helpers/constants");
const {BUYER_PUBLIC, SELLER_PUBLIC, contracts} = require('../helpers/config');
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
        aql(voucherSetDetails['ValidFrom'],helpers.PROMISE_VALID_FROM);
    })

    it("TEST SCENARIO 13 :: SELLER CREATE :: 1.2 VALIDATE VALID TO", async function () {
        aql(voucherSetDetails['ValidTo'],helpers.PROMISE_VALID_TO);
    })

    it("TEST SCENARIO 13 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY", async function () {
        aql(voucherSetDetails['nftSupply'],helpers.ORDER_QUANTITY1);
    })

    it("TEST SCENARIO 13 :: SELLER CREATE :: 1.4 VALIDATE SELLER", async function () {
        aql(voucherSetDetails['nftSeller'],SELLER_PUBLIC);
    })

    it("TEST SCENARIO 13 :: SELLER CREATE :: 1.5 VALIDATE PAYMENT TYPE", async function () {
        aql(voucherSetDetails['paymentType'],1);
    })

    it("TEST SCENARIO 13 :: SELLER CREATE :: 1.6 VALIDATE ERC1155ERC721 DATA", async function () {
        aql(voucherSetDetails['operator'],contracts.VoucherKernelContractAddress);
        aql(voucherSetDetails['transferFrom'],helpers.ZERO_ADDRESS);
        aql(voucherSetDetails['transferTo'],SELLER_PUBLIC);
        aql(voucherSetDetails['transferValue'],helpers.ORDER_QUANTITY1);
    })
    
    it("TEST SCENARIO 13 :: BUYER COMMITS :: 2.0 Buyer commits to purchase a voucher", async function() {
        await delay();
        await wait(120000);
        commitVoucherDetails = await commitVoucher(voucherSetDetails["createdVoucherSetID"]);
        await wait(120000);
        await format(commitVoucherDetails);
    });

    it("TEST SCENARIO 13 :: SELLER CREATE :: 2.1 VALIDATE ISSUER", async function () {
        aql(commitVoucherDetails['issuer'],SELLER_PUBLIC);
    })

    it("TEST SCENARIO 13 :: SELLER CREATE :: 2.2 VALIDATE HOLDER", async function () {
        aql(commitVoucherDetails['holder'],BUYER_PUBLIC);
    })

    it("TEST SCENARIO 13 :: EXPIRE :: 3.0 Expire voucher", async function() {
        await wait(240000);
        triggerExpireDetails = await triggerExpire(commitVoucherDetails["MintedVoucherID"]);
        await format(triggerExpireDetails);
    });

    it("TEST SCENARIO 13 :: CHECK EXPIRE :: 3.1 VALIDATE EXPIRY", async function () {
        await delay();
        aql(triggerExpireDetails['ExpiredVoucherID'], commitVoucherDetails['MintedVoucherID']);
        assert.notEqual(triggerExpireDetails['TriggeredBy'], helpers.ZERO_ADDRESS);
    })
    it("TEST SCENARIO 13 :: EXPIRE :: 4.0 CHECK EXPIRY STATUS", async function() {
        checkExpireDetails = await checkExpiry(commitVoucherDetails["MintedVoucherID"]);
        await format(checkExpireDetails);
        aql(checkExpireDetails["Status"],144);
    });

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })
});