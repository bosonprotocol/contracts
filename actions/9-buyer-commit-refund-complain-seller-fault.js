const sellerCreate = require("./seller/createVoucher");
const commitVocucher = require("./buyer/commitVoucher");
const refundVoucher = require("./buyer/refundVoucher");
const checkBalance = require("./helpers/checkBalance");
const complainVoucher = require("./buyer/compainVoucher");
const faultVoucher = require("./seller/faultVoucher");
const delay = require("./helpers/delay");
const {describe,it} = require("mocha");
let format = require("./helpers/formatter");


describe("TEST SCENARIO 09 :: SELLER CREATES, BUYER COMMITS, REFUNDS & COMPLAINS, SELLER FAULTS", async function() {

    let committedVoucher;
    let voucherSetDetails;

    before("Check Balances",async function () {
        let balances = await checkBalance();
        console.log(balances);
    })

    it("TEST SCENARIO 09 :: SELLER CREATES :: 1. Seller creates a voucher set", async function (){
        await delay();
        voucherSetDetails  =  await sellerCreate();
        await format(voucherSetDetails);
    })

    it("TEST SCENARIO 09 :: BUYER COMMITS :: 1. Buyer commits to purchases a voucher", async function() {
        await delay();
        console.log(await checkBalance());
        committedVoucher = await commitVocucher(voucherSetDetails["createdVoucherSetID"]);
        await format(committedVoucher);
    });

    it("TEST SCENARIO 09 :: BUYER REFUNDS :: 1. Buyer refunds a purchased voucher", async function() {
        await delay();
        console.log(await checkBalance());
        let  refund = await refundVoucher(committedVoucher["MintedVoucherID"]);
        await format(refund);
    });

    it("TEST SCENARIO 09 :: BUYER COMPLAINS :: 1. Buyer complains a refunded voucher", async function() {
        await delay();
        console.log(await checkBalance());
        let complainedVoucher = await complainVoucher(committedVoucher["MintedVoucherID"]);
        await format(complainedVoucher);

    });

    it("TEST SCENARIO 09 :: SELLER FAULTS :: 1. Seller faults a complained voucher", async function() {
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

