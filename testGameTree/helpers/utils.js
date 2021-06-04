let Web3 = require('web3');
const {PROVIDER} = require('../helpers/config');
let web3 = new Web3(new Web3.providers.HttpProvider(PROVIDER));

class Utils {
  constructor() {}

  static async getCurrTimestamp() {
    let blockNumber = await web3.eth.getBlockNumber();
    let block = await web3.eth.getBlock(blockNumber);

    return block.timestamp;
  }
}

module.exports = Utils;
