const sellerCreate = require('../seller/createExpiringVoucher');
const commitVoucher = require('../buyer/commitVoucher');
const faultVoucher = require('../seller/faultVoucher');
const Utils = require('../helpers/utils');
const Users = require('../helpers/users');
const {describe, it, before} = require('mocha');
let format = require('../helpers/formatter');
const checkBalance = require('../helpers/checkBalance');
let helpers = require('../helpers/constants');
let assert = require('chai').assert;
let Web3 = require('web3');
let web3 = new Web3(new Web3.providers.HttpProvider(helpers.PROVIDER));

describe('TEST SCENARIO 14 :: OFFER, COMMIT, COF', async function () {
  let commitVoucherDetails;
  let voucherSetDetails;
  let faultedVoucher;
  let users;
  let aql = assert.equal;

  before('Before test cases', async function () {
    await Utils.deployContracts();
    users = new Users(await web3.eth.getAccounts());
    let balances = await checkBalance(users);
    console.log(balances);
  });

  it('TEST SCENARIO 14 :: OFFER :: 1.0 SELLER CREATES VOUCHER SET', async function () {
    const timestamp = await Utils.getCurrTimestamp();
    voucherSetDetails = await sellerCreate(timestamp, users);
    await format(voucherSetDetails);
  });

  it('TEST SCENARIO 14 :: OFFER :: 1.1 VALIDATE VALID FROM', async function () {
    aql(voucherSetDetails['ValidFrom'], helpers.PROMISE_VALID_FROM);
  });

  it('TEST SCENARIO 14 :: OFFER :: 1.2 VALIDATE VALID TO', async function () {
    aql(voucherSetDetails['ValidTo'], helpers.PROMISE_VALID_TO);
  });

  it('TEST SCENARIO 14 :: OFFER :: 1.3 VALIDATE ORDER QUANTITY', async function () {
    aql(voucherSetDetails['nftSupply'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 14 :: OFFER :: 1.4 VALIDATE SELLER', async function () {
    aql(voucherSetDetails['nftSeller'], users.seller.address);
  });

  it('TEST SCENARIO 14 :: OFFER :: 1.5 VALIDATE PAYMENT TYPE', async function () {
    aql(voucherSetDetails['paymentType'], 1);
  });

  it('TEST SCENARIO 14 :: OFFER :: 1.6 VALIDATE ERC1155ERC721 DATA', async function () {
    aql(voucherSetDetails['operator'], Utils.contractVoucherKernel.address);
    aql(voucherSetDetails['transferFrom'], helpers.ZERO_ADDRESS);
    aql(voucherSetDetails['transferTo'], users.seller.address);
    aql(voucherSetDetails['transferValue'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 14 :: COMMIT:: 2.0 BUYER COMMITS TO REDEEMING A VOUCHER', async function () {
    commitVoucherDetails = await commitVoucher(
      voucherSetDetails['createdVoucherSetID'],
      users
    );
    await format(commitVoucherDetails);
  });

  it('TEST SCENARIO 14 :: COMMIT:: 2.1 VALIDATE ISSUER', async function () {
    aql(commitVoucherDetails['issuer'], users.seller.address);
  });

  it('TEST SCENARIO 14 :: COMMIT:: 2.2 VALIDATE HOLDER', async function () {
    aql(commitVoucherDetails['holder'], users.buyer.address);
  });

  it('TEST SCENARIO 14 :: COF :: 5.0 SELLER ACCEPTS FAULT ON A COMPLAINED VOUCHER', async function () {
    console.log(await checkBalance(users));
    faultedVoucher = await faultVoucher(
      commitVoucherDetails['MintedVoucherID'],
      users
    );
    await format(faultedVoucher);
  });

  it('TEST SCENARIO 14 :: COF :: 5.1 VALIDATE FAULTED VOUCHER', async function () {
    aql(
      faultedVoucher['FaultedVoucherID'],
      commitVoucherDetails['MintedVoucherID']
    );
  });

  after('Check Balances', async function () {
    let balances = await checkBalance(users);
    console.log(balances);
  });
});
