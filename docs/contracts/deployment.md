# Smart Contracts - Deployment

## Initialization
 
[Migrations script](./migrations/2_deploy_contracts.js) for Truffle also does 
this initialization:

- ERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
- ERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
- VoucherKernel.setBosonRouterAddress(bosonRouter.address)

## Deployment addresses

Contracts are deployed on Kovan testnet at addresses:
  
ERC1155ERC721: 0xF3aA8eB3812303F6c86c136557bC23E48d634B58  
VoucherKernel: 0x1806312211bd1521430C953683038d6263580feE  
Cashier: 0xaaf749c8e6e37b51410F1810ADcAEED18d0C166F   

The frontend is currently pointing to Kovan deployment.  

Contract are also deployed on Ropsten testnet at addresses:
  
ERC1155ERC721: 0xe7028d66222aD1AfEB0098956347A6284443bd16  
VoucherKernel: 0xa93f95bf0039CE30957b77A6638e2e273598D576  
Cashier: 0x014b8baF57bA77FaE23075aa93c2B768eeb440bD  
