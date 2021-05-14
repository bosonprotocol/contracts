const sellerCreate = require("./seller/createVoucher");
const commitVocucher = require("./buyer/commitVoucher");
const redeemVoucher = require("./buyer/redeemVoucher");
const checkBalance = require("./helpers/checkBalance");
const complainVoucher = require("./buyer/compainVoucher");
const faultVoucher = require("./seller/faultVoucher");
const delay = require("./helpers/delay");
const {describe,it} = require("mocha");
let format = require("./helpers/formatter");

const TIMEOUT = 500 * 1000;

describe("TEST SCENARIO 08 :: SELLER CREATES, BUYER COMMITS, REDEEMS & COMPLAINS, SELLER FAULTS", async function() {

    let committedVoucher;
    let voucherSetDetails;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 08 :: SELLER CREATES :: 1. Seller creates a voucher set", async function (){
        this.timeout(TIMEOUT);
        await delay();
        console.log(await checkBalance());
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    })

    it("TEST SCENARIO 08 :: BUYER COMMITS :: 2. Buyer commits to purchases a voucher", async function() {
        await delay();
        console.log(await checkBalance());
        committedVoucher = await commitVocucher(voucherSetDetails["createdVoucherSetID"]);
        await format(committedVoucher)
    });

    it("TEST SCENARIO 08 :: BUYER REDEEMS :: 3. Buyer redeems a purchased voucher", async function() {
        await delay();
        console.log(await checkBalance());
        let redeem = await redeemVoucher(committedVoucher["MintedVoucherID"]);
        await format(redeem);
    });

    it("TEST SCENARIO 08 :: BUYER COMPLAINS :: 4. Buyer complains a redeemed voucher", async function() {
        await delay();
        console.log(await checkBalance());
        let complain = await complainVoucher(committedVoucher["MintedVoucherID"]);
        await format(complain);
    });

    it("TEST SCENARIO 08 :: SELLER FAULTS :: 1. Seller accepts fault on a complained voucher", async function() {
        await delay();
        console.log(await checkBalance());
        let fault = await faultVoucher(committedVoucher["MintedVoucherID"]);
        await format(fault);
    });

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});

