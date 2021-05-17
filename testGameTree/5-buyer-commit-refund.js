const sellerCreate = require("./seller/createVoucher");
const commitVocucher = require("./buyer/commitVoucher");
const refundVoucher = require("./buyer/refundVoucher");
const checkBalance = require("./helpers/checkBalance");
const delay = require("./helpers/delay");
const {describe,it} = require("mocha");

let format = require("./helpers/formatter");

describe("TEST SCENARIO 05 :: SELLER CREATES, BUYER COMMITS & BUYER REFUNDS", async function() {

    let voucherSetDetails;
    let committedVoucher;
    let refundedVoucher;

    before("TEST SCENARIO 05 :: SELLER CREATES, BUYER COMMITS & BUYER REFUNDS",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 05 :: SELLER CREATES :: 1. Seller creates a voucher set", async function (){
        await delay();
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    })

    it("TEST SCENARIO 05 :: BUYER COMMITS :: 2. Buyer commits to purchases a voucher", async function() {
        await delay();
        console.log(await checkBalance());
        committedVoucher = await commitVocucher(voucherSetDetails["createdVoucherSetID"]);
        await format(committedVoucher);
    });

    it("TEST SCENARIO 05 :: BUYER COMMITS :: 2. Buyer refunds a purchased voucher", async function() {
        await delay();
        console.log(await checkBalance());
        let refundedVoucher = await refundVoucher(committedVoucher["MintedVoucherID"]);
        await format(refundedVoucher);
    });

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});

