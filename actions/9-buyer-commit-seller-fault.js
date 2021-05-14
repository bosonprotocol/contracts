const sellerCreate = require("./seller/createVoucher");
// const sellerCancel = require("./seller/cancelVoucherSet");
const commitVocucher = require("./buyer/commitVoucher");
const faultVoucher = require("./seller/faultVoucher");
const delay = require("./helpers/delay");
const checkBalance = require("./helpers/checkBalance");
const {describe,it} = require("mocha");


const chai = require('chai').use(require('chai-as-promised'));

const expect = chai.expect;

const TIMEOUT = 500 * 1000;

describe("TEST SCENARIO 01 :: SELLER CREATE", async function() {

    let commitedVoucherDetails;
    let voucherSetDetails;
    // let cancelledVoucher;

    it("SELLER CREATE VOUCHER", async function (){
        this.timeout(TIMEOUT);
        await delay();
        console.log(await checkBalance());
        voucherSetDetails  =  await sellerCreate();
        console.log(voucherSetDetails);
    })

    it("TEST SCENARIO 01 :: BUYER COMMIT :: 1. Buyer purchases a voucher", async function() {
        await delay();
        console.log(await checkBalance());
        commitedVoucherDetails = await commitVocucher(voucherSetDetails["createdVoucherSetID"]);
        console.log(commitedVoucherDetails);
    });

    it("FAULT", async function() {
        await delay();
        console.log(await checkBalance());
        commitedVoucherDetails = await faultVoucher(voucherSetDetails["createdVoucherSetID"]);
    });


});