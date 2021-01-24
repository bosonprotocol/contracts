const ethers = require('ethers');
const provider = new ethers.providers.JsonRpcProvider();
const {DEPLOYER_PUBLIC, BUYER_PUBLIC, SELLER_PUBLIC} = require('./config');
let wallet = new ethers.Wallet(
  '0x7ab741b57e8d94dd7e1a29055646bafde7010f38a900f55bbd7647880faa6ee8',
  provider
); // account 0 from local etherlime ganache

(async () => {
  await fundWallets();
})();

async function fundWallets() {
  const fundAmount = ethers.utils.parseEther('5');

  let transactionSeller = {
    to: SELLER_PUBLIC,
    value: fundAmount,
  };

  let transactionBuyer = {
    to: BUYER_PUBLIC,
    value: fundAmount,
  };

  let transactionDeployer = {
    to: DEPLOYER_PUBLIC,
    value: fundAmount,
  };

  await wallet.sendTransaction(transactionSeller);
  await wallet.sendTransaction(transactionBuyer);
  await wallet.sendTransaction(transactionDeployer);
}
