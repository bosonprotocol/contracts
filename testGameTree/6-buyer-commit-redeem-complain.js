const sellerCreate = require("./seller/createVoucher");
const commitVocucher = require("./buyer/commitVoucher");
const redeemVoucher = require("./buyer/redeemVoucher");
const checkBalance = require("./helpers/checkBalance");
const complainVoucher = require("./buyer/compainVoucher");
const delay = require("./helpers/delay");
const {describe,it} = require("mocha");

let format = require("./helpers/formatter");


describe("TEST SCENARIO 06 :: SELLER CREATES, BUYER COMMITS, REDEEMS & COMPLAINS", async function() {

    let committedVoucher;
    let voucherSetDetails;


    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 06 :: SELLER CREATES :: 1. Seller creates a voucher set", async function (){
        await delay();
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    })

    it("TEST SCENARIO 06 :: BUYER COMMITS :: 2. Buyer commits to purchases a voucher", async function() {
        await delay();
        console.log(await checkBalance());
        committedVoucher = await commitVocucher(voucherSetDetails["createdVoucherSetID"]);
        await format(committedVoucher);
    });

    it("TEST SCENARIO 06 :: BUYER REDEEMS :: 3. Buyer redeems a purchased voucher", async function() {
        await delay();
        console.log(await checkBalance());
        let redeemed  = await redeemVoucher(committedVoucher["MintedVoucherID"]);
        await format(redeemed);
    });

    it("TEST SCENARIO 06 :: BUYER COMPLAINS :: 4. Buyer complains about redeemed voucher", async function() {
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

