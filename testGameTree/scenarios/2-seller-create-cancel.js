const sellerCreate = require('../seller/createVoucher');
const sellerCancel = require('../seller/cancelVoucherSet');
const Utils = require('../helpers/utils');
const Users = require('../helpers/users');
const {describe, it} = require('mocha');
let format = require('../helpers/formatter');
const checkBalance = require('../helpers/checkBalance');
const helpers = require('../helpers/constants');
let assert = require('chai').assert;
let Web3 = require('web3');
let web3 = new Web3(new Web3.providers.HttpProvider(helpers.PROVIDER));

describe('TEST SCENARIO 002 :: SELLER CREATES & CANCELS', async function () {
  let voucherSetDetails;
  let cancelledVoucher;
  let users;
  let aql = assert.equal;

  before('Before test cases', async function () {
    await Utils.deployContracts();
    users = new Users( await web3.eth.getAccounts() );
    let balances = await checkBalance(users);
    console.log(balances);
  });

  it('TEST SCENARIO 02 :: SELLER CREATE :: 1.0 Seller creates a voucher-set', async function () {
    const timestamp = await Utils.getCurrTimestamp();
    voucherSetDetails = await sellerCreate(timestamp, users);
    await format(voucherSetDetails);
  });

  it('TEST SCENARIO 02 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM', async function () {
    aql(voucherSetDetails['ValidFrom'], helpers.PROMISE_VALID_FROM);
  });

  it('TEST SCENARIO 02 :: SELLER CREATE :: 1.2 VALIDATE VALID TO', async function () {
    aql(voucherSetDetails['ValidTo'], helpers.PROMISE_VALID_TO);
  });

  it('TEST SCENARIO 02 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY', async function () {
    aql(voucherSetDetails['nftSupply'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 02 :: SELLER CREATE :: 1.4 VALIDATE SELLER', async function () {
    aql(voucherSetDetails['nftSeller'], users.seller.address);
  });

  it('TEST SCENARIO 02 :: SELLER CREATE :: 1.5 VALIDATE PAYMENT TYPE', async function () {
    aql(voucherSetDetails['paymentType'], 1);
  });

  it('TEST SCENARIO 02 :: SELLER CREATE :: 1.6 VALIDATE ERC1155ERC721 DATA', async function () {
    aql(voucherSetDetails['operator'], Utils.contractVoucherKernel.address);
    aql(voucherSetDetails['transferFrom'], helpers.ZERO_ADDRESS);
    aql(voucherSetDetails['transferTo'], users.seller.address);
    aql(voucherSetDetails['transferValue'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 02:: SELLER CANCEL :: 2.0 Seller cancels a voucher-set', async function () {
    cancelledVoucher = await sellerCancel(
      voucherSetDetails['createdVoucherSetID'],
      users
    );
    await format(cancelledVoucher);
  });

  it('TEST SCENARIO 02 :: SELLER CANCEL :: 2.1 VALIDATE ORDER QUANTITY', async function () {
    aql(cancelledVoucher['transferValue'], voucherSetDetails['nftSupply']);
  });

  it('TEST SCENARIO 02 :: SELLER CANCEL :: 2.2 VALIDATE REFUNDED SELLER DEPOSIT', async function () {
    aql(cancelledVoucher['redfundedSellerDeposit'], helpers.seller_deposit);
    aql(cancelledVoucher['redfundSellerDepositRecipient'], users.seller.address);
  });

  after('Check Balances', async function () {
    let balances = await checkBalance(users);
    console.log(balances);
  });

});
