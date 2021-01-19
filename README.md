# Core prototype

Code repository for Boson Protocol smart contracts. The description of the 
contracts and process can be found in [doc_contracts.md](doc_contracts.md).    

## Getting started

Note: all commands below are run from the project root.

To install dependencies:

```shell script
npm install
````

To compile all contracts:

```shell script
npm run compile
```

To run the unit tests:

1. Ensure Ethereum is running locally on port 8545. This can be achieved using
   Ganache, `ganache-cli` or `etherlime ganache`.
1. Copy your 12 word mnemonic to `.secret`. Create the file if it doesn't 
   already exist.
1. Execute the unit tests:

```shell script
npm run test:unit
``` 

Note: currently, the unit test suite will fail the second time it is run against
the same Ethereum instance. As a reuls, you'll need to reset between test runs.

To run the integration tests, follow the instructions in 
[`testUserInteractions/README.md](testUserInteractions/README.md).

## Contracts initialization
 
[Migrations script](./migrations/2_deploy_contracts.js) for Truffle also does 
this initialization:

- ERC1155ERC721.setApprovalForAll(contractVoucherKernel.address, 'true')
- ERC1155ERC721.setVoucherKernelAddress(contractVoucherKernel.address)
- VoucherKernel.setCashierAddress(contractCashier.address)

## Deployed contracts

Contracts are deployed on Kovan testnet at addresses:
  
ERC1155ERC721: 0xF3aA8eB3812303F6c86c136557bC23E48d634B58  
VoucherKernel: 0x1806312211bd1521430C953683038d6263580feE  
Cashier: 0xaaf749c8e6e37b51410F1810ADcAEED18d0C166F   

The frontend is currently pointing to Kovan deployment.  

Contract are also deployed on Ropsten testnet at addresses:
  
ERC1155ERC721: 0xe7028d66222aD1AfEB0098956347A6284443bd16  
VoucherKernel: 0xa93f95bf0039CE30957b77A6638e2e273598D576  
Cashier: 0x014b8baF57bA77FaE23075aa93c2B768eeb440bD  

## Progress

See the  
[project board](https://github.com/bosonprotocol/bsn-core-prototype/projects/2).

## Coverage

Test coverage is executed by running the following command: 

``` 
npm run coverage
```
