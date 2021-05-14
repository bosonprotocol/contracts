const sellerCreate = require("./seller/createVoucher");
const commitVocucher = require("./buyer/commitVoucher");
const refundVoucher = require("./buyer/refundVoucher");
const checkBalance = require("./helpers/checkBalance");
const complainVoucher = require("./buyer/compainVoucher");
const delay = require("./helpers/delay");
const {describe,it} = require("mocha");

const format = require("./helpers/formatter");

describe("TEST SCENARIO 07 :: SELLER CREATES, BUYER COMMITS, REFUNDS & COMPLAINS", async function() {

    let committedVoucher;
    let voucherSetDetails;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 07 :: SELLER CREATES :: 1. Seller creates a voucher set", async function (){
        await delay();
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    })

    it("TEST SCENARIO 07 :: BUYER COMMITS :: 2. Buyer commits to purchases a voucher", async function() {
        await delay();
        console.log(await checkBalance());
        committedVoucher = await commitVocucher(voucherSetDetails["createdVoucherSetID"]);
        await format(committedVoucher);
    });

    it("TEST SCENARIO 07 :: BUYER REFUNDS :: 3. Buyer refunds a purchased voucher", async function() {
        await delay();
        console.log(await checkBalance());
        let refund = await refundVoucher(committedVoucher["MintedVoucherID"]);
        await format(refund);

    });

    it("TEST SCENARIO 07 :: BUYER COMPLAINS :: 4. Buyer complains about a refunded voucher", async function() {
        await delay();
        console.log(await checkBalance());
        let complain = await complainVoucher(committedVoucher["MintedVoucherID"]);
        await format(complain);
    });

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});

