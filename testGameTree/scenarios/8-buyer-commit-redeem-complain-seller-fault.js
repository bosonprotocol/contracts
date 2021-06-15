const sellerCreate = require('../seller/createVoucher');
const commitVocucher = require('../buyer/commitVoucher');
const redeemVoucher = require('../buyer/redeemVoucher');
const checkBalance = require('../helpers/checkBalance');
const complainVoucher = require('../buyer/complainVoucher');
const faultVoucher = require('../seller/faultVoucher');
const Utils = require('../helpers/utils');
const Users = require('../helpers/users');
const {describe, it} = require('mocha');
let format = require('../helpers/formatter');
let helpers = require('../helpers/constants');
let assert = require('chai').assert;
let Web3 = require('web3');
let web3 = new Web3(new Web3.providers.HttpProvider(helpers.PROVIDER));

describe('TEST SCENARIO 008 :: SELLER CREATES, BUYER COMMITS, REDEEMS & COMPLAINS, SELLER FAULTS', async function () {
  let committedVoucher;
  let voucherSetDetails;
  let redeemedVoucher;
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

  it('TEST SCENARIO 08 :: SELLER CREATE :: 1.0 Seller creates a voucher set', async function () {
    const timestamp = await Utils.getCurrTimestamp();
    voucherSetDetails = await sellerCreate(timestamp, users);
    await format(voucherSetDetails);
  });

  it('TEST SCENARIO 08 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM', async function () {
    aql(voucherSetDetails['ValidFrom'], helpers.PROMISE_VALID_FROM);
  });

  it('TEST SCENARIO 08 :: SELLER CREATE :: 1.2 VALIDATE VALID TO', async function () {
    aql(voucherSetDetails['ValidTo'], helpers.PROMISE_VALID_TO);
  });

  it('TEST SCENARIO 08 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY', async function () {
    aql(voucherSetDetails['nftSupply'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 08 :: SELLER CREATE :: 1.4 VALIDATE SELLER', async function () {
    aql(voucherSetDetails['nftSeller'], users.seller.address);
  });

  it('TEST SCENARIO 08 :: SELLER CREATE :: 1.5 VALIDATE PAYMENT TYPE', async function () {
    aql(voucherSetDetails['paymentType'], 1);
  });

  it('TEST SCENARIO 08 :: SELLER CREATE :: 1.6 VALIDATE ERC1155ERC721 DATA', async function () {
    aql(voucherSetDetails['operator'], Utils.contractVoucherKernel.address);
    aql(voucherSetDetails['transferFrom'], helpers.ZERO_ADDRESS);
    aql(voucherSetDetails['transferTo'], users.seller.address);
    aql(voucherSetDetails['transferValue'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 08 :: BUYER COMMITS :: 2.0 Buyer commits to purchases a voucher', async function () {
    console.log(await checkBalance(users));
    committedVoucher = await commitVocucher(
      voucherSetDetails['createdVoucherSetID'],
      users
    );
    await format(committedVoucher);
  });

  it('TEST SCENARIO 08 :: BUYER COMMITS :: 2.1 VALIDATE ISSUER', async function () {
    aql(committedVoucher['issuer'], users.seller.address);
  });

  it('TEST SCENARIO 08 :: BUYER COMMITS :: 2.2 VALIDATE HOLDER', async function () {
    aql(committedVoucher['holder'], users.buyer.address);
  });

  it('TEST SCENARIO 08 :: BUYER REDEEMS :: 3.0 Buyer redeems a purchased voucher', async function () {
    console.log(await checkBalance(users));
    redeemedVoucher = await redeemVoucher(
      committedVoucher['MintedVoucherID'],
      users
    );
    await format(redeemedVoucher);
  });

  it('TEST SCENARIO 06 :: SELLER CREATE :: 3.1 VALIDATE REDEEMED VOUCHER', async function () {
    aql(
      redeemedVoucher['redeemedVoucherID'],
      committedVoucher['MintedVoucherID']
    );
    aql(redeemedVoucher[('holder', users.buyer.address)]);
    aql(redeemedVoucher['promiseID'], committedVoucher['promiseID']);
  });

  it('TEST SCENARIO 08 :: BUYER COMPLAINS :: 4.0 Buyer complains a redeemed voucher', async function () {
    console.log(await checkBalance(users));
    complainedVoucher = await complainVoucher(
      committedVoucher['MintedVoucherID'],
      users
    );
    await format(complainedVoucher);
  });

  it('TEST SCENARIO 08 :: BUYER COMPLAINS :: 4.1 VALIDATE COMPLAINED VOUCHER', async function () {
    aql(
      complainedVoucher['complainedVoucherID'],
      committedVoucher['MintedVoucherID']
    );
  });

  it('TEST SCENARIO 08 :: SELLER FAULTS :: 5.0 Seller accepts fault on a complained voucher', async function () {
    console.log(await checkBalance(users));
    faultedVoucher = await faultVoucher(
      committedVoucher['MintedVoucherID'],
      users
    );
    await format(faultedVoucher);
  });

  it('TEST SCENARIO 08 :: SELLER FAULTS :: 5.1 VALIDATE FAULTED VOUCHER', async function () {
    aql(
      faultedVoucher['FaultedVoucherID'],
      complainedVoucher['complainedVoucherID']
    );
  });

  after('Check Balances', async function () {
    let balances = await checkBalance(users);
    console.log(balances);
  });
});
