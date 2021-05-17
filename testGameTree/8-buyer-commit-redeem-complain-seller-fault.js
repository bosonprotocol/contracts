const sellerCreate = require("./seller/createVoucher");
const commitVocucher = require("./buyer/commitVoucher");
const redeemVoucher = require("./buyer/redeemVoucher");
const checkBalance = require("./helpers/checkBalance");
const complainVoucher = require("./buyer/compainVoucher");
const faultVoucher = require("./seller/faultVoucher");
const delay = require("./helpers/delay");
const {describe,it} = require("mocha");
let format = require("./helpers/formatter");

let helpers = require("./helpers/constants");
const {BUYER_PUBLIC, SELLER_PUBLIC} = require('./helpers/config');
let assert = require('chai').assert;

const TIMEOUT = 500 * 1000;

describe("TEST SCENARIO 08 :: SELLER CREATES, BUYER COMMITS, REDEEMS & COMPLAINS, SELLER FAULTS", async function() {

    let committedVoucher;
    let voucherSetDetails;
    let redeemedVoucher;
    let complainedVoucher;
    let faultedVoucher;
    let aql = assert.equal;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 08 :: SELLER CREATE :: 1.0 Seller creates a voucher set", async function (){
        this.timeout(TIMEOUT);
        await delay();
        console.log(await checkBalance());
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    })

    it("TEST SCENARIO 08 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM", async function () {
        aql(voucherSetDetails['ValidFrom'],helpers.PROMISE_VALID_FROM);
    })

    it("TEST SCENARIO 08 :: SELLER CREATE :: 1.2 VALIDATE VALID TO", async function () {
        aql(voucherSetDetails['ValidTo'],helpers.PROMISE_VALID_TO);
    })

    it("TEST SCENARIO 08 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY", async function () {
        aql(voucherSetDetails['nftSupply'],helpers.ORDER_QUANTITY1);
    })

    it("TEST SCENARIO 08 :: SELLER CREATE :: 1.4 VALIDATE SELLER DEPOSIT", async function () {
        aql(voucherSetDetails['sellerDeposit'],helpers.seller_deposit);
    })

    it("TEST SCENARIO 08 :: BUYER COMMITS :: 2.0 Buyer commits to purchases a voucher", async function() {
        await delay();
        console.log(await checkBalance());
        committedVoucher = await commitVocucher(voucherSetDetails["createdVoucherSetID"]);
        await format(committedVoucher)
    });

    it("TEST SCENARIO 08 :: BUYER COMMITS :: 2.1 VALIDATE ISSUER", async function () {
        aql(committedVoucher['issuer'],SELLER_PUBLIC.toLowerCase());
    })

    it("TEST SCENARIO 08 :: BUYER COMMITS :: 2.2 VALIDATE HOLDER", async function () {
        aql(committedVoucher['holder'],BUYER_PUBLIC.toLowerCase());
    })

    it("TEST SCENARIO 08 :: BUYER REDEEMS :: 3.0 Buyer redeems a purchased voucher", async function() {
        await delay();
        console.log(await checkBalance());
        redeemedVoucher = await redeemVoucher(committedVoucher["MintedVoucherID"]);
        await format(redeemedVoucher);
    });

    it("TEST SCENARIO 08 :: BUYER REDEEMS :: 3.1 VALIDATE REDEEMED VOUCHER", async function () {
        aql(committedVoucher['MintedVoucherID'],redeemedVoucher['redeemedVoucherID']);
    })

    it("TEST SCENARIO 08 :: BUYER COMPLAINS :: 4.0 Buyer complains a redeemed voucher", async function() {
        await delay();
        console.log(await checkBalance());
        complainedVoucher = await complainVoucher(committedVoucher["MintedVoucherID"]);
        await format(complainedVoucher);
    });

    it("TEST SCENARIO 08 :: BUYER COMPLAINS :: 4.1 VALIDATE REDEEMED VOUCHER", async function () {
        aql(committedVoucher['MintedVoucherID'],complainedVoucher['complainedVoucherID']);
    })

    it("TEST SCENARIO 08 :: SELLER FAULTS :: 5.0 Seller accepts fault on a complained voucher", async function() {
        await delay();
        console.log(await checkBalance());
        faultedVoucher = await faultVoucher(committedVoucher["MintedVoucherID"]);
        await format(faultVoucher);
    });

    it("TEST SCENARIO 08 :: SELLER FAULTS :: 5.1 VALIDATE REDEEMED VOUCHER", async function () {
        aql(faultedVoucher['FaultedVoucherID'],complainedVoucher['complainedVoucherID']);
    })

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});

