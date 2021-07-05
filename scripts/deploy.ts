//AssetRegistry not used in demo-app
//const AssetRegistry = artifacts.require("AssetRegistry");

import fs from 'fs';
import hre, {ethers} from 'hardhat';

export default async function (): Promise<void> {
  const ERC1155ERC721 = await ethers.getContractFactory('ERC1155ERC721');
  const VoucherKernel = await ethers.getContractFactory('VoucherKernel');
  const Cashier = await ethers.getContractFactory('Cashier');
  const BosonRouter = await ethers.getContractFactory('BosonRouter');
  const FundLimitsOracle = await ethers.getContractFactory('FundLimitsOracle');

  const flo = await FundLimitsOracle.deploy();
  const erc1155erc721 = await ERC1155ERC721.deploy();
  const voucherKernel = await VoucherKernel.deploy(erc1155erc721.address);
  const cashier = await Cashier.deploy(voucherKernel.address);
  const br = await BosonRouter.deploy(
    voucherKernel.address,
    flo.address,
    cashier.address
  );

  await flo.deployed();
  await erc1155erc721.deployed();
  await voucherKernel.deployed();
  await cashier.deployed();
  await br.deployed();

  let tx, txReceipt, event;

  console.log('$ Setting initial values ...');

  tx = await erc1155erc721.setApprovalForAll(voucherKernel.address, 'true');
  txReceipt = await tx.wait();
  event = txReceipt.events[0];
  console.log(
    '\n$ ERC1155ERC721: ',
    event.event,
    'approved VoucherKernel:',
    event.args._approved
  );

  tx = await erc1155erc721.setVoucherKernelAddress(voucherKernel.address);
  txReceipt = await tx.wait();
  event = txReceipt.events[0];
  console.log(
    '$ ERC1155ERC721: ',
    event.event,
    'at:',
    event.args._newVoucherKernel
  );

  tx = await erc1155erc721.setCashierAddress(cashier.address);
  txReceipt = await tx.wait();
  event = txReceipt.events[0];
  console.log('$ ERC1155ERC721: ', event.event, 'at:', event.args._newCashier);

  tx = await voucherKernel.setBosonRouterAddress(br.address);
  txReceipt = await tx.wait();
  event = txReceipt.events[0];
  console.log(
    '\n$ VoucherKernel',
    event.event,
    'at:',
    event.args._newBosonRouter
  );

  tx = await voucherKernel.setCashierAddress(cashier.address);
  txReceipt = await tx.wait();
  event = txReceipt.events[0];
  console.log('$ VoucherKernel', event.event, 'at:', event.args._newCashier);

  tx = await cashier.setBosonRouterAddress(br.address);
  txReceipt = await tx.wait();
  event = txReceipt.events[0];
  console.log('\n$ Cashier', event.event, 'at:', event.args._newBosonRouter);

  tx = await cashier.setTokenContractAddress(erc1155erc721.address);
  txReceipt = await tx.wait();
  event = txReceipt.events[0];
  console.log('$ Cashier', event.event, 'at:', event.args._newTokenContract);

  //! for testnet, otherwise below setters for complainPeriod, cancelFaultPeriod && tokenLimit should be removed!
  const SIXTY_SECONDS = 60;
  const TOKEN_LIMIT = (1 * 10 ** 18).toString();
  const BOSON_TOKEN_ON_RINKEBY = '0x5c70A0c47440128eAAA66801B0ec04E9d8C3a570';

  await voucherKernel.setComplainPeriod(2 * SIXTY_SECONDS);
  await voucherKernel.setCancelFaultPeriod(2 * SIXTY_SECONDS);
  await flo.setTokenLimit(BOSON_TOKEN_ON_RINKEBY, TOKEN_LIMIT);
  //! End for testnet

  console.log('\nFundLimitsOracle Contract Address: ', flo.address);
  console.log('ERC1155ERC721 Contract Address: ', erc1155erc721.address);
  console.log('VoucherKernel Contract Address: ', voucherKernel.address);
  console.log('Cashier Contract Address: ', cashier.address);
  console.log('Boson Router Contract Address: ', br.address);

  fs.writeFileSync(
    'scripts/contracts.json',
    JSON.stringify(
      {
        network: hre.network.name,
        flo: flo.address,
        erc1155erc721: erc1155erc721.address,
        voucherKernel: voucherKernel.address,
        cashier: cashier.address,
        br: br.address,
      },
      this,
      2
    ),
    'utf-8'
  );
}
