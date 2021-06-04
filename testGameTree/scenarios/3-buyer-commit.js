const sellerCreate = require('../seller/createVoucher');
const commitVoucher = require('../buyer/commitVoucher');
const Utils = require('../helpers/utils');
const {describe, it, before} = require('mocha');
let format = require('../helpers/formatter');
const checkBalance = require('../helpers/checkBalance');
let helpers = require('../helpers/constants');
const {BUYER_PUBLIC, SELLER_PUBLIC, contracts} = require('../helpers/config');
let assert = require('chai').assert;

const TIMEOUT = 500 * 1000;

describe('TEST SCENARIO 003 :: SELLER CREATES & BUYER COMMITS', async function () {
  let commitVoucherDetails;
  let voucherSetDetails;
  let aql = assert.equal;

  before('Check Balances', async function () {
    let balances = await checkBalance();
    console.log(balances);
  });

  it('TEST SCENARIO 03 :: SELLER CREATE :: 1.0 Seller creates a voucher set', async function () {
    this.timeout(TIMEOUT);
    const timestamp = await Utils.getCurrTimestamp();
    voucherSetDetails = await sellerCreate(timestamp);
    await format(voucherSetDetails);
  });

  it('TEST SCENARIO 03 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM', async function () {
    aql(voucherSetDetails['ValidFrom'], helpers.PROMISE_VALID_FROM);
  });

  it('TEST SCENARIO 03 :: SELLER CREATE :: 1.2 VALIDATE VALID TO', async function () {
    aql(voucherSetDetails['ValidTo'], helpers.PROMISE_VALID_TO);
  });

  it('TEST SCENARIO 03 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY', async function () {
    aql(voucherSetDetails['nftSupply'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 03 :: SELLER CREATE :: 1.4 VALIDATE SELLER', async function () {
    aql(voucherSetDetails['nftSeller'], SELLER_PUBLIC);
  });

  it('TEST SCENARIO 03 :: SELLER CREATE :: 1.5 VALIDATE PAYMENT TYPE', async function () {
    aql(voucherSetDetails['paymentType'], 1);
  });

  it('TEST SCENARIO 03 :: SELLER CREATE :: 1.6 VALIDATE ERC1155ERC721 DATA', async function () {
    aql(voucherSetDetails['operator'], contracts.VoucherKernelContractAddress);
    aql(voucherSetDetails['transferFrom'], helpers.ZERO_ADDRESS);
    aql(voucherSetDetails['transferTo'], SELLER_PUBLIC);
    aql(voucherSetDetails['transferValue'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 03 :: BUYER COMMITS :: 2.0 Buyer commits to purchase a voucher', async function () {
    commitVoucherDetails = await commitVoucher(
      voucherSetDetails['createdVoucherSetID']
    );
    await format(commitVoucherDetails);
  });

  it('TEST SCENARIO 03 :: SELLER CREATE :: 2.1 VALIDATE ISSUER', async function () {
    aql(commitVoucherDetails['issuer'], SELLER_PUBLIC);
  });

  it('TEST SCENARIO 03 :: SELLER CREATE :: 2.2 VALIDATE HOLDER', async function () {
    aql(commitVoucherDetails['holder'], BUYER_PUBLIC);
  });

  after('Check Balances', async function () {
    let balances = await checkBalance();
    console.log(balances);
  });
});
