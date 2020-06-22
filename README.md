# Core prototype
Repo for Boson Protocol prototype of the core exchange mechanism

## Install
Install dependencies from project root folder:
```
    $ npm install @openzeppelin/contracts truffle-assertions ethers
```

## Contracts initialization 
Once deployed (see [migrations](./migrations/2_deploy_contracts.js)), call:
- ERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
- ERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
- VoucherKernel.setCashierAddress(contractCashier.address)


## Progress
See the project board at [https://github.com/bosonprotocol/bsn-core-prototype/projects/2](https://github.com/bosonprotocol/bsn-core-prototype/projects/2).