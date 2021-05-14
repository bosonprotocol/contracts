const sellerCreate = require("./seller/createVoucher");
const commitVocucher = require("./buyer/commitVoucher");
const redeemVoucher = require("./buyer/redeemVoucher");
const checkBalance = require("./helpers/checkBalance");
const delay = require("./helpers/delay");
const {describe,it} = require("mocha");

let format = require("./helpers/formatter")


describe("TEST SCENARIO 04 :: SELLER CREATES, BUYER COMMITS & BUYER REDEEMS", async function() {

    let committedVoucher;
    let voucherSetDetails;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 04 :: SELLER CREATES :: 1. Seller creates a voucher set", async function (){
        await delay();
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    })

    it("TEST SCENARIO 04 :: BUYER COMMITS :: 3. Buyer commits to purchases a voucher", async function() {
        await delay();
        console.log(await checkBalance());
        committedVoucher = await commitVocucher(voucherSetDetails["createdVoucherSetID"]);
        await format(committedVoucher)
    });

    it("TEST SCENARIO 04 :: BUYER REDEEMS :: 3. Buyer redeems a purchased voucher", async function() {
        await delay();
        console.log(await checkBalance());
        let redeemedVoucher = await redeemVoucher(committedVoucher["MintedVoucherID"]);
        await format(redeemedVoucher);

    });

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});

