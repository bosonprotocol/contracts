const ERC1155ERC721 = require('../build/ERC1155ERC721.json');
const VoucherKernel = require('../build/VoucherKernel.json');
const Cashier = require('../build/Cashier.json');

const ethers = require('ethers');

const provider = new ethers.providers.JsonRpcProvider();
const {DEPLOYER_SECRET, SELLER_SECRET} = require('./config');
const deployer = new ethers.Wallet(DEPLOYER_SECRET, provider);
const accountSeller = new ethers.Wallet(SELLER_SECRET, provider);

(async () => {
  const ERC1155_Factory = new ethers.ContractFactory(
    ERC1155ERC721.abi,
    ERC1155ERC721.bytecode,
    deployer
  );
  const VoucherKernel_Factory = new ethers.ContractFactory(
    VoucherKernel.abi,
    VoucherKernel.bytecode,
    deployer
  );
  const Cashier_Factory = new ethers.ContractFactory(
    Cashier.abi,
    Cashier.bytecode,
    deployer
  );

  const TokenContract = await ERC1155_Factory.deploy();
  const TokenContractSeller = await new ethers.Contract(
    TokenContract.address,
    ERC1155ERC721.abi,
    accountSeller
  );
  const VoucherKernelContract = await VoucherKernel_Factory.deploy(
    TokenContract.address
  );
  const CashierContract = await Cashier_Factory.deploy(
    VoucherKernelContract.address
  );

  await TokenContract.setApprovalForAll(VoucherKernelContract.address, 'true');
  await TokenContractSeller.setApprovalForAll(
    VoucherKernelContract.address,
    'true'
  );
  await TokenContract.setVoucherKernelAddress(VoucherKernelContract.address);
  await VoucherKernelContract.setCashierAddress(CashierContract.address);

  console.log('Token Contract Address: ', TokenContract.address);
  console.log(
    'Voucher Kernel Contract Address: ',
    VoucherKernelContract.address
  );
  console.log('Cashier Contract Address: ', CashierContract.address);
})();
