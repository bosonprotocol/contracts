const sellerCreate = require('../seller/createVoucher');
const checkBalance = require('../helpers/checkBalance');
const Utils = require('../helpers/utils');
const Users = require('../helpers/users');
const {describe, it} = require('mocha');
let format = require('../helpers/formatter');
const helpers = require('../helpers/constants');
let assert = require('chai').assert;
let Web3 = require('web3');
let web3 = new Web3(new Web3.providers.HttpProvider(helpers.PROVIDER));

describe('TEST SCENARIO 001 :: SELLER CREATES A VOUCHER SET', async function () {
  let value, users;
  let aql = assert.equal;

  before('Before test cases', async function () {
    await Utils.deployContracts();
    users = new Users(await web3.eth.getAccounts());
    let balances = await checkBalance(users);
    console.log(balances);
  });

  it('TEST SCENARIO 01 :: SELLER CREATE :: 1.0 CREATION OF VOUCHER', async function () {
    const timestamp = await Utils.getCurrTimestamp();
    value = await sellerCreate(timestamp, users);
    await format(value);
  });

  it('TEST SCENARIO 01 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM', async function () {
    aql(value['ValidFrom'], helpers.PROMISE_VALID_FROM);
  });

  it('TEST SCENARIO 01 :: SELLER CREATE :: 1.2 VALIDATE VALID TO', async function () {
    aql(value['ValidTo'], helpers.PROMISE_VALID_TO);
  });

  it('TEST SCENARIO 01 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY', async function () {
    aql(value['nftSupply'], helpers.ORDER_QUANTITY1);
  });

  it('TEST SCENARIO 01 :: SELLER CREATE :: 1.4 VALIDATE SELLER', async function () {
    aql(value['nftSeller'], users.seller.address);
  });

  it('TEST SCENARIO 01 :: SELLER CREATE :: 1.5 VALIDATE PAYMENT TYPE', async function () {
    aql(value['paymentType'], 1);
  });

  it('TEST SCENARIO 01 :: SELLER CREATE :: 1.6 VALIDATE ERC1155ERC721 DATA', async function () {
    aql(value['operator'], Utils.contractVoucherKernel.address);
    aql(value['transferFrom'], helpers.ZERO_ADDRESS);
    aql(value['transferTo'], users.seller.address);
    aql(value['transferValue'], helpers.ORDER_QUANTITY1);
  });

  after('Check Balances', async function () {
    let balances = await checkBalance(users);
    console.log(balances);
  });
});
