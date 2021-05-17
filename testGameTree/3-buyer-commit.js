const sellerCreate = require("./seller/createVoucher");
const commitVoucher = require("./buyer/commitVoucher");
const {describe,it,before} = require("mocha");

let format = require("./helpers/formatter")
const checkBalance = require("./helpers/checkBalance");

const TIMEOUT = 500 * 1000;

describe("TEST SCENARIO 03 :: SELLER CREATES & BUYER COMMITS", async function() {

    let commitVoucherDetails;
    let voucherSetDetails;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 03 :: SELLER CREATES :: 1. Seller creates a voucher set", async function (){
        this.timeout(TIMEOUT);
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    })

    it("TEST SCENARIO 03 :: BUYER COMMITS :: 2. Buyer commits to purchase a voucher", async function() {
        commitVoucherDetails = await commitVoucher(voucherSetDetails["createdVoucherSetID"]);
        await format(commitVoucherDetails);
    });

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});