const sellerCreate = require('../seller/createVoucher');
const commitVocucher = require('../buyer/commitVoucher');
const refundVoucher = require('../buyer/refundVoucher');
const checkBalance = require('../helpers/checkBalance');
const sellerFault = require('../seller/faultVoucher');
const Utils = require('../helpers/utils');
const {describe, it} = require('mocha');
let format = require('../helpers/formatter');
let helpers = require('../helpers/constants');
const {BUYER_PUBLIC, SELLER_PUBLIC, contracts} = require('../helpers/config');
let assert = require('chai').assert;

describe('TEST SCENARIO 010 :: SELLER CREATES, BUYER COMMITS & BUYER REFUNDS, SELLER FAULTS', async function () {
  let voucherSetDetails;
  let committedVoucher;
  let refundedVoucher;
  let cancelVoucher;
  let aql = assert.equal;

  before(
    'TEST SCENARIO 10 :: SELLER CREATES, BUYER COMMITS & BUYER REFUNDS',
    async function () {
      await Utils.deployContracts();
      let balances = await checkBalance();
      console.log(balances);
    }
  );

  it('TEST SCENARIO 10 :: SELLER CREATE :: 1.0 Seller creates a voucher set', async function () {
    const timestamp = await Utils.getCurrTimestamp();
    voucherSetDetails = await sellerCreate(timestamp);
    await format(voucherSetDetails);
  });

  it('TEST SCENARIO 10 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM', async function () {
    aql(voucherSetDetails['ValidFrom'], helpers.PROMISE_VALID_FROM);
  });

  it('TEST SCENARIO 10 :: SELLER CREATE :: 1.2 VALIDATE VALID TO', async function () {
    aql(voucherSetDetails['ValidTo'], helpers.PROMISE_VALID_TO);
  });

  it('TEST SCENARIO 10 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY', async function () {
    aql(voucherSetDetails['nftSupply'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 10 :: SELLER CREATE :: 1.4 VALIDATE SELLER', async function () {
    aql(voucherSetDetails['nftSeller'], SELLER_PUBLIC);
  });

  it('TEST SCENARIO 10 :: SELLER CREATE :: 1.5 VALIDATE PAYMENT TYPE', async function () {
    aql(voucherSetDetails['paymentType'], 1);
  });

  it('TEST SCENARIO 10 :: SELLER CREATE :: 1.6 VALIDATE ERC1155ERC721 DATA', async function () {
    aql(voucherSetDetails['operator'], Utils.contractVoucherKernel.address);
    aql(voucherSetDetails['transferFrom'], helpers.ZERO_ADDRESS);
    aql(voucherSetDetails['transferTo'], SELLER_PUBLIC);
    aql(voucherSetDetails['transferValue'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 10 :: BUYER COMMITS :: 2.0 Buyer commits to purchases a voucher', async function () {
    console.log(await checkBalance());
    committedVoucher = await commitVocucher(
      voucherSetDetails['createdVoucherSetID']
    );
    await format(committedVoucher);
  });

  it('TEST SCENARIO 10 :: SELLER CREATE :: 2.1 VALIDATE ISSUER', async function () {
    aql(committedVoucher['issuer'], SELLER_PUBLIC);
  });

  it('TEST SCENARIO 10 :: SELLER CREATE :: 2.2 VALIDATE HOLDER', async function () {
    aql(committedVoucher['holder'], BUYER_PUBLIC);
  });

  it('TEST SCENARIO 10 :: BUYER COMMITS :: 3.0 Buyer refunds a purchased voucher', async function () {
    console.log(await checkBalance());
    refundedVoucher = await refundVoucher(committedVoucher['MintedVoucherID']);
    await format(refundedVoucher);
  });

  it('TEST SCENARIO 10 :: SELLER CREATE :: 3.1 VALIDATE REFUNDED VOUCHER', async function () {
    aql(
      refundedVoucher['refundedVoucherID'],
      committedVoucher['MintedVoucherID']
    );
  });

  it('TEST SCENARIO 10 :: SELLER FAULTS :: 4.0 Seller accepts fault on a refunded voucher', async function () {
    console.log(await checkBalance());
    cancelVoucher = await sellerFault(committedVoucher['MintedVoucherID']);
    await format(cancelVoucher);
  });

  it('TEST SCENARIO 10 :: SELLER FAULTS :: 4.1 VALIDATE FAULTED VOUCHER', async function () {
    aql(
      cancelVoucher['FaultedVoucherID'],
      refundedVoucher['refundedVoucherID']
    );
  });

  after('Check Balances', async function () {
    let balances = await checkBalance();
    console.log(balances);
  });
});
