/* eslint @typescript-eslint/no-var-requires: "off" */

let Web3 = require("web3");
let Contract = require("web3-eth-contract");
let Table = require("cli-table");
const helpers = require("../helpers/constants");
let web3 = new Web3(new Web3.providers.HttpProvider(helpers.PROVIDER));

// set provider for all later instances to use
Contract.setProvider(helpers.PROVIDER);

async function checkBalances(users) {
  let sellerBalance = await web3.eth.getBalance(users.seller.address);
  let buyerBalance = await web3.eth.getBalance(users.buyer.address);
  let denominator = 10 ** 18;
  let sbal = sellerBalance / denominator;
  let bbal = buyerBalance / denominator;
  console.assert(sbal >= 0);
  console.assert(bbal >= 0);
  let table = new Table({
    head: ["ACCOUNT TYPE", "ADDRESS", "ETH VALUE"],
  });
  table.push(["SELLER", users.seller.address, sbal]);
  table.push(["BUYER", users.buyer.address, bbal]);
  return table.toString();
}

module.exports = checkBalances;
