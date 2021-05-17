const sellerCreate = require("./seller/createVoucher");
const sellerCancel = require("./seller/cancelVoucherSet");
const {describe,it} = require("mocha");

let format = require("./helpers/formatter");
const checkBalance = require("./helpers/checkBalance");


describe("TEST SCENARIO 02 :: SELLER CREATES & CANCELS", async function() {

    let voucherSetDetails;
    let cancelledVoucher;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 02 :: SELLER CREATE :: 1. Seller creates a voucher-set", async function() {
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    });

    it("TEST SCENARIO 02:: SELLER CANCEL :: 3. Seller cancels a voucher-set", async function() {
        cancelledVoucher  =  await sellerCancel(voucherSetDetails["createdVoucherSetID"]);
        await format(cancelledVoucher);
    });

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});