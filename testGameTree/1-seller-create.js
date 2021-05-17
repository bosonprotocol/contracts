const sellerCreate = require("./seller/createVoucher");
const checkBalance = require("./helpers/checkBalance");
const {describe,it} = require("mocha");
let format = require("./helpers/formatter")



describe("TEST SCENARIO 01 :: SELLER CREATES A VOUCHER SET", async function() {

    let value

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 01 :: SELLER CREATE :: CREATION OF VOUCHER", async function() {
        value = await sellerCreate();
        await format(value);
    });

    after("Check Balances", async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

});