const sellerCreate = require('../seller/createExpiringVoucher');
const commitVoucher = require('../buyer/commitVoucher');
const triggerExpire = require('../seller/triggerExpiration');
const checkExpiry = require('../seller/checkExpiryStatus');
const Utils = require('../helpers/utils');
const Users = require('../helpers/users');
const {describe, it, before} = require('mocha');
let format = require('../helpers/formatter');
const checkBalance = require('../helpers/checkBalance');
let helpers = require('../helpers/constants');
let assert = require('chai').assert;
const timemachine = require('../helpers/timemachine');
let Web3 = require('web3');
let web3 = new Web3(new Web3.providers.HttpProvider(helpers.PROVIDER));

const TIMEOUT = 500 * 1000;

describe('TEST SCENARIO 013 :: SELLER CREATES & BUYER COMMITS', async function () {
  let commitVoucherDetails;
  let voucherSetDetails;
  let triggerExpireDetails;
  let checkExpireDetails;
  let users;
  let aql = assert.equal;
  let timestamp;

  before('Before test cases', async function () {
    await Utils.deployContracts();
    users = new Users( await web3.eth.getAccounts() );
    let balances = await checkBalance(users);
    console.log(balances);
  });

  it('TEST SCENARIO 13 :: SELLER CREATE :: 1.0 Seller creates a voucher set', async function () {
    const timestamp = await Utils.getCurrTimestamp();
    voucherSetDetails = await sellerCreate(timestamp, users);
    await format(voucherSetDetails);
  });

  it('TEST SCENARIO 13 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM', async function () {
    aql(voucherSetDetails['ValidFrom'], helpers.PROMISE_VALID_FROM);
  });

  it('TEST SCENARIO 13 :: SELLER CREATE :: 1.2 VALIDATE VALID TO', async function () {
    aql(voucherSetDetails['ValidTo'], helpers.PROMISE_VALID_TO);
  });

  it('TEST SCENARIO 13 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY', async function () {
    aql(voucherSetDetails['nftSupply'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 13 :: SELLER CREATE :: 1.4 VALIDATE SELLER', async function () {
    aql(voucherSetDetails['nftSeller'], users.seller.address);
  });

  it('TEST SCENARIO 13 :: SELLER CREATE :: 1.5 VALIDATE PAYMENT TYPE', async function () {
    aql(voucherSetDetails['paymentType'], 1);
  });

  it('TEST SCENARIO 13 :: SELLER CREATE :: 1.6 VALIDATE ERC1155ERC721 DATA', async function () {
    aql(voucherSetDetails['operator'], Utils.contractVoucherKernel.address);
    aql(voucherSetDetails['transferFrom'], helpers.ZERO_ADDRESS);
    aql(voucherSetDetails['transferTo'], users.seller.address);
    aql(voucherSetDetails['transferValue'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 13 :: BUYER COMMITS :: 2.0 Buyer commits to purchase a voucher', async function () {
    commitVoucherDetails = await commitVoucher(
      voucherSetDetails['createdVoucherSetID'],
      users
    );
    await format(commitVoucherDetails);
  });

  it('TEST SCENARIO 13 :: SELLER CREATE :: 2.1 VALIDATE ISSUER', async function () {
    aql(commitVoucherDetails['issuer'], users.seller.address);
  });

  it('TEST SCENARIO 13 :: SELLER CREATE :: 2.2 VALIDATE HOLDER', async function () {
    aql(commitVoucherDetails['holder'], users.buyer.address);
  });

  it('TEST SCENARIO 13 :: EXPIRE :: 3.0 Expire voucher', async function () {
    // fast-forward for three days
    const secondsInThreeDays = helpers.SECONDS_IN_DAY * 3;
    await timemachine.advanceTimeSeconds(secondsInThreeDays);

    triggerExpireDetails = await triggerExpire(
      commitVoucherDetails['MintedVoucherID'],
      users
    );
    await format(triggerExpireDetails);
  });

  it('TEST SCENARIO 13 :: CHECK EXPIRE :: 3.1 VALIDATE EXPIRY', async function () {
    aql(
      triggerExpireDetails['ExpiredVoucherID'],
      commitVoucherDetails['MintedVoucherID']
    );
    assert.notEqual(triggerExpireDetails['TriggeredBy'], helpers.ZERO_ADDRESS);
  });
  it('TEST SCENARIO 13 :: EXPIRE :: 4.0 CHECK EXPIRY STATUS', async function () {
    checkExpireDetails = await checkExpiry(
      commitVoucherDetails['MintedVoucherID'],
      users
    );
    await format(checkExpireDetails);
    aql(checkExpireDetails['Status'], 144);
  });

  after('Check Balances', async function () {
    let balances = await checkBalance(users);
    console.log(balances);
  });
});
