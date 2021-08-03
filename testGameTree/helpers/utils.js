let Web3 = require('web3');
const truffleContract = require('truffle-contract');
const helpers = require('../helpers/constants');
let web3 = new Web3(new Web3.providers.HttpProvider(helpers.PROVIDER));
const BosonRouter = truffleContract(
  require(__dirname +
    '/../../artifacts/contracts/BosonRouter.sol/BosonRouter.json')
);
BosonRouter.setProvider(web3.currentProvider);
const VoucherKernel = truffleContract(
  require(__dirname +
    '/../../artifacts/contracts/VoucherKernel.sol/VoucherKernel.json')
);
VoucherKernel.setProvider(web3.currentProvider);
const ERC1155ERC721 = truffleContract(
  require(__dirname +
    '/../../artifacts/contracts/ERC1155ERC721.sol/ERC1155ERC721.json')
);
ERC1155ERC721.setProvider(web3.currentProvider);
const Cashier = truffleContract(
  require(__dirname + '/../../artifacts/contracts/Cashier.sol/Cashier.json')
);
Cashier.setProvider(web3.currentProvider);
const FundLimitsOracle = truffleContract(
  require(__dirname +
    '/../../artifacts/contracts/FundLimitsOracle.sol/FundLimitsOracle.json')
);
FundLimitsOracle.setProvider(web3.currentProvider);

class Utils {
  constructor() {}

  static async getCurrTimestamp() {
    let blockNumber = await web3.eth.getBlockNumber();
    let block = await web3.eth.getBlock(blockNumber);

    return block.timestamp;
  }

  static async setContracts(erc1155721, voucherKernel, cashier, bsnRouter) {
    this.contractERC1155ERC721 = erc1155721;
    this.contractVoucherKernel = voucherKernel;
    this.contractCashier = cashier;
    this.contractBSNRouter = bsnRouter;
  }

  static async deployContracts() {
    let accounts;

    let contractERC1155ERC721,
      contractVoucherKernel,
      contractCashier,
      contractBosonRouter,
      contractFundLimitsOracle;

    accounts = await web3.eth.getAccounts();

    const sixtySeconds = 60;

    contractFundLimitsOracle = await FundLimitsOracle.new({
      from: accounts[0],
      gas: 5000000,
    });
    contractERC1155ERC721 = await ERC1155ERC721.new({
      from: accounts[0],
      gas: 5000000,
    });

    contractVoucherKernel = await VoucherKernel.new(
      contractERC1155ERC721.address,
      {from: accounts[0], gas: 5000000}
    );

    contractCashier = await Cashier.new(contractVoucherKernel.address, {
      from: accounts[0],
      gas: 5000000,
    });
    contractBosonRouter = await BosonRouter.new(
      contractVoucherKernel.address,
      contractFundLimitsOracle.address,
      contractCashier.address,
      {from: accounts[0], gas: 5000000}
    );

    await contractERC1155ERC721.setApprovalForAll(
      contractVoucherKernel.address,
      'true',
      {from: accounts[0], gas: 3000000}
    );
    await contractERC1155ERC721.setVoucherKernelAddress(
      contractVoucherKernel.address,
      {from: accounts[0], gas: 3000000}
    );

    await contractERC1155ERC721.setCashierAddress(contractCashier.address, {
      from: accounts[0],
      gas: 3000000,
    });

    await contractVoucherKernel.setBosonRouterAddress(
      contractBosonRouter.address,
      {from: accounts[0], gas: 3000000}
    );
    await contractVoucherKernel.setCashierAddress(contractCashier.address, {
      from: accounts[0],
      gas: 3000000,
    });

    await contractCashier.setBosonRouterAddress(contractBosonRouter.address, {
      from: accounts[0],
      gas: 3000000,
    });
    await contractCashier.setTokenContractAddress(
      contractERC1155ERC721.address,
      {from: accounts[0], gas: 3000000}
    );

    await contractVoucherKernel.setComplainPeriod(sixtySeconds, {
      from: accounts[0],
      gas: 3000000,
    });
    await contractVoucherKernel.setCancelFaultPeriod(sixtySeconds, {
      from: accounts[0],
      gas: 3000000,
    });

    this.setContracts(
      contractERC1155ERC721,
      contractVoucherKernel,
      contractCashier,
      contractBosonRouter
    );

    return {
      contractBosonRouter,
      contractVoucherKernel,
      contractERC1155ERC721,
      contractCashier,
      contractFundLimitsOracle,
    };
  }
}

module.exports = Utils;
