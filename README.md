# Core prototype
Repo for Boson Protocol prototype of the core exchange mechanism

## Install
Install dependencies from project root folder:
```
    $ npm install @openzeppelin/contracts truffle-assertions ethers
```

Migrations are using HDWalletProvider, install it if you need it:
```
    $ npm install @truffle/hdwallet-provider
```

## Contracts initialization 
[Migrations script](./migrations/2_deploy_contracts.js) for Truffle also does this initialization:
- ERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
- ERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
- VoucherKernel.setCashierAddress(contractCashier.address)

## Deployed contracts
Contract are deployed on Ropsten testnet at addresses:  
ERC1155ERC721: 0xe7028d66222aD1AfEB0098956347A6284443bd16  
VoucherKernel: 0xa93f95bf0039CE30957b77A6638e2e273598D576  
Cashier: 0x014b8baF57bA77FaE23075aa93c2B768eeb440bD  

## Progress
See the project board at [https://github.com/bosonprotocol/bsn-core-prototype/projects/2](https://github.com/bosonprotocol/bsn-core-prototype/projects/2).