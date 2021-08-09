const sellerCreate = require('../seller/createExpiringVoucher');
const commitVoucher = require('../buyer/commitVoucher');
const triggerExpire = require('../seller/triggerExpiration');
const checkExpiry = require('../seller/checkExpiryStatus');
const complainVoucher = require('../buyer/complainVoucher');
const faultVoucher = require('../seller/faultVoucher');
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

describe('TEST SCENARIO 019 :: SELLER CREATES & BUYER COMMITS', async function () {
  let commitVoucherDetails;
  let voucherSetDetails;
  let triggerExpireDetails;
  let checkExpireDetails;
  let complainedVoucher;
  let faultedVoucher;
  let users;
  let aql = assert.equal;

  before('Before test cases', async function () {
    await Utils.deployContracts();
    users = new Users(await web3.eth.getAccounts());
    let balances = await checkBalance(users);
    console.log(balances);
  });

  it('TEST SCENARIO 19 :: SELLER CREATE :: 1.0 Seller creates a voucher set', async function () {
    const timestamp = await Utils.getCurrTimestamp();
    voucherSetDetails = await sellerCreate(timestamp, users);
    await format(voucherSetDetails);
  });

  it('TEST SCENARIO 19 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM', async function () {
    aql(voucherSetDetails['ValidFrom'], helpers.PROMISE_VALID_FROM);
  });

  it('TEST SCENARIO 19 :: SELLER CREATE :: 1.2 VALIDATE VALID TO', async function () {
    aql(voucherSetDetails['ValidTo'], helpers.PROMISE_VALID_TO);
  });

  it('TEST SCENARIO 19 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY', async function () {
    aql(voucherSetDetails['nftSupply'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 19 :: SELLER CREATE :: 1.4 VALIDATE SELLER', async function () {
    aql(voucherSetDetails['nftSeller'], users.seller.address);
  });

  it('TEST SCENARIO 19 :: SELLER CREATE :: 1.5 VALIDATE PAYMENT TYPE', async function () {
    aql(voucherSetDetails['paymentType'], 1);
  });

  it('TEST SCENARIO 19 :: SELLER CREATE :: 1.6 VALIDATE ERC1155ERC721 DATA', async function () {
    aql(voucherSetDetails['operator'], Utils.contractVoucherKernel.address);
    aql(voucherSetDetails['transferFrom'], helpers.ZERO_ADDRESS);
    aql(voucherSetDetails['transferTo'], users.seller.address);
    aql(voucherSetDetails['transferValue'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 19 :: BUYER COMMITS :: 2.0 Buyer commits to purchase a voucher', async function () {
    commitVoucherDetails = await commitVoucher(
      voucherSetDetails['createdVoucherSetID'],
      users
    );
    await format(commitVoucherDetails);
  });

  it('TEST SCENARIO 19 :: BUYER COMMITS :: 2.1 VALIDATE ISSUER', async function () {
    aql(commitVoucherDetails['issuer'], users.seller.address);
  });

  it('TEST SCENARIO 19 :: BUYER COMMITS :: 2.2 VALIDATE HOLDER', async function () {
    aql(commitVoucherDetails['holder'], users.buyer.address);
  });

  it('TEST SCENARIO 19 :: EXPIRE :: 3.0 Expire voucher', async function () {
    // fast-forward time
    const numberOfSeconds = helpers.SECONDS_IN_DAY * 2 + 10;
    await timemachine.advanceTimeSeconds(numberOfSeconds);

    triggerExpireDetails = await triggerExpire(
      commitVoucherDetails['MintedVoucherID'],
      users
    );
    await format(triggerExpireDetails);
  });

  it('TEST SCENARIO 19 :: CHECK EXPIRE :: 3.1 VALIDATE EXPIRY', async function () {
    aql(
      triggerExpireDetails['ExpiredVoucherID'],
      commitVoucherDetails['MintedVoucherID']
    );
    assert.notEqual(triggerExpireDetails['TriggeredBy'], helpers.ZERO_ADDRESS);
  });
  it('TEST SCENARIO 19 :: EXPIRE :: 4.0 CHECK EXPIRY STATUS', async function () {
    checkExpireDetails = await checkExpiry(
      commitVoucherDetails['MintedVoucherID'],
      users
    );
    await format(checkExpireDetails);
    aql(checkExpireDetails['Status'], 144);
  });

  it('TEST SCENARIO 19 :: SELLER FAULTS :: 5.0 Seller admits fault on a expired voucher', async function () {
    console.log(await checkBalance(users));
    faultedVoucher = await faultVoucher(
      commitVoucherDetails['MintedVoucherID'],
      users
    );
    await format(faultedVoucher);
  });

  it('TEST SCENARIO 19 :: SELLER FAULTS :: 5.1 VALIDATE FAULTED VOUCHER', async function () {
    aql(
      faultedVoucher['FaultedVoucherID'],
      commitVoucherDetails['MintedVoucherID']
    );

    aql(
      faultedVoucher['FaultedVoucherID'],
      triggerExpireDetails['ExpiredVoucherID']
    );
  });

  it('TEST SCENARIO 19 :: BUYER COMPLAINS :: 6.0 Buyer complains about expired voucher', async function () {
    console.log(await checkBalance(users));
    complainedVoucher = await complainVoucher(
      commitVoucherDetails['MintedVoucherID'],
      users
    );
    await format(complainedVoucher);
  });

  it('TEST SCENARIO 19 :: BUYER COMPLAINS :: 6.1 VALIDATE COMPLAINED VOUCHER', async function () {
    aql(
      complainedVoucher['complainedVoucherID'],
      faultedVoucher['FaultedVoucherID']
    );

    aql(
      complainedVoucher['complainedVoucherID'],
      triggerExpireDetails['ExpiredVoucherID']
    );
  });

  after('Check Balances', async function () {
    let balances = await checkBalance(users);
    console.log(balances);
  });
});
