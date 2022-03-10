[![banner](docs/assets/banner.png)](https://bosonprotocol.io)

<h1 align="center">Boson Protocol Contracts</h1>

[![Gitter chat](https://badges.gitter.im/bosonprotocol.png)](https://gitter.im/bosonprotocol/community)

Welcome to Boson Protocol. Please find a set of Solidity smart contracts that implement Boson Protocol. You are invited to learn more about the project through its code and perhaps test locally how you might use it within your own project. 

This is version 1 of the Protocol. You will find the addresses of the deployed contracts on Ethereum's main net and Ropsten test net [here](https://github.com/bosonprotocol/contracts/blob/main/docs/contracts/deployment.md).

This version of Boson Protocol is a stepping stone on the way to the release of version 2 of the Protocol next year, which will be accompanied with SDKs and plug-ins to make it easy to integrate. While you may prefer to wait until the new features that will be released in version 2 before building dApps using the Protocol, we encourage you to use the contracts locally and to participate in our [bug bounty](https://github.com/bosonprotocol/community/blob/main/BugBountyProgram.md). 

For more details about how Boson Protocol works and how you might make use of
it, please see the [documentation site](https://docs.bosonprotocol.io/).  

---
**Table of Contents**

- [Local Development](#local-development)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
    - [Forking Rinkeby to localnode](#forking-rinkeby-to-localnode)
    - [Special deployments](#special-deployments)
  - [Test](#test)
    - [Testing with DAI](#testing-with-dai)
    - [Unit Tests](#unit-tests)
    - [Coverage](#coverage)
  - [Code Linting & Formatting](#code-linting--formatting)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---
## Local Development

### Prerequisites

For local development of the contracts, your development machine will need a few
tools installed.

You'll need:
* Node (12.20.x)
* NPM (7.15.x)
* Git

For instructions on how to get set up with these specific versions:
* See the [OS X guide](docs/setup/osx.md) if you are on a Mac.
* See the [Linux guide](docs/setup/linux.md) if you use a Linux distribution.

---
### Installation

To install dependencies:
```shell script
npm install
````

---
### Configuration

Before you can start interacting with the contracts, via hardhat, please make a copy of the `.env.example` file and call it `.env`.

---
### Build

All of the available commands can be found in `package.json`.

To compile:
```shell script
npm run contracts:compile
````

---
### Run

```shell
npm run contracts:run
```

*Note that*: This command starts up built-in Hardhat Network and migrates all contracts to the Hardhat Network instance. The `.env` file has a hard-coded value for the `BOSON_TOKEN` address, which points to account #9 of the local hardhat network. This isn't an actual BOSON token address but just a valid address that will allow the deployment scripts to work. When deploying to a public network, this value should be replaced by the address of the Boson Token on the network you are deploying to. When deploying locally (env == hardhat), a mock Boson Token will be deployed. The unit tests deploy their own contracts and do not rely on the `deploy.ts` script.

If preferred by those who are familiar with Hardhat, the standard Hardhat commands can be used.

In a separate terminal, contracts can be deployed using
```shell
npx hardhat deploy
```
The above command deploys to the built-in hardhat EVM. 


#### Forking Rinkeby to localnode

It is possible to fork the state of the Rinkeby chain to have it deployed locally. 
The following hardhat commands will achieve this:

```shell script
npx hardhat node --fork https://eth-rinkeby.alchemyapi.io/v2/<<alchemy key>>
```

*Note that*: Alchemy is recommended by Hardhat over Infura because its free accounts provide archived data, which is required for successful forking.

You can then deploy from a separate terminal using the command:

```shell script
npx hardhat deploy --network localhost
```

This makes the BOSON test token deployed on Rinkeby (0xEDa08eF1c6ff51Ca7Fd681295797102c1B84606c) and the official DAI token deployed on Rinkeby (0x6A9865aDE2B6207dAAC49f8bCba9705dEB0B0e6D) available to your local hardhat chain.


#### Special deployments

Calling `npx hardhat deploy` will deploy the protocol contracts. Beside that we provide addtional utility script for the following deployment cases:

- Deploy all protocol contracts and ERC1155NonTransferable (equivalent to v1.0 deployment script)

  ```
  npx hardhat deploy-with-erc1155
  ```
- Deploy only ERC1155NonTransferable and set the metadata uri defined in `.env` file
  ```
  npx hardhat deploy-erc1155-only
  ```
- Deploy a set of mock token contracts ERC20, ERC721, ERC1155 and ERC1155NonTransferable which can be used to test conditional commit
  ```
  npx hardhat deploy-mocks
  ```
- Deploy a Gate contract on a provided network
  ```
  npx hardhat deploy-gate
  ```

---
### Test

#### Testing with DAI
There is no faucet for getting DAI tokens on a testnet. If you deploy the Boson Protocol contracts to a testnet or a local forked instance, you may want to use DAI test tokens for testing purposes. The easiest way to do this is to deploy your
own DAI test token instance. See [here](docs/dai/daiTestToken.md) for instructions.

#### Unit Tests

All contracts are thoroughly unit tested using 
[Hardhat's testing framework](https://hardhat.org/tutorial/testing-contracts.html#_5-testing-contracts) 
support.

To run the unit tests:

```shell script
npm run tests:unit
```

By default, the build system automates starting and stopping [Hardhat Network](https://hardhat.org/hardhat-network/#hardhat-network) on port `http://localhost:8545` in the background ready for each test run.

#### Coverage

We use [solidity-coverage](https://github.com/sc-forks/solidity-coverage) to 
provide test coverage reports. 

To check the test coverage: 

```shell script 
npm run tests:coverage
```

`solidity-coverage` runs its own instance of the hardhatEVM internally, as well as instrumenting contracts before running, note that the contracts are not run through an optimiser when calculating the code coverage, so please do ignore any warnings about contract size when calculating the code coverage. 

---
### Code Linting & Formatting

Both the contracts themselves and the tests are linted and formatted as part of
the build process.

For the contracts, we use:
* [solhint](https://protofire.github.io/solhint/) for linting
* [prettier-solidity](https://github.com/prettier-solidity/prettier-plugin-solidity) for formatting

For the tests, we use:
* [eslint](https://eslint.org/) for linting
* [prettier](https://prettier.io/) for formatting

To lint the Solidity code:

```shell script
npm run contracts:lint
```

This will check if the linter is satisfied. If instead you want to attempt to
automatically fix any linting issues:

```shell script
npm run contracts:lint-fix
```

To format the Solidity code: 

```shell script
npm run contracts:format
```

To attempt to automatically fix any formatting issues: 

```shell script
npm run contracts:format-fix
```

Similarly, for the tests, to perform the same tasks:

```shell script
npm run tests:lint
npm run tests:lint-fix
npm run tests:format
npm run tests:format-fix
```

---
## Documentation

For an overview of the contracts and their responsibilities, see [Overview](docs/contracts/overview.md).  

The whitepaper is available through the project's [website](https://www.bosonprotocol.io/).

---
## Contributing

We welcome contributions! Until now, Boson Protocol has been largely worked on by a small dedicated team. However, the ultimate goal is for all of the Boson Protocol repositories to be fully owned by the community and contributors. Issues, pull requests, suggestions, and any sort of involvement are more than welcome.

If you have noticed a bug, please follow the [bug bounty procedure](https://github.com/bosonprotocol/community/blob/52725b04d1d3013dfc936d3d27ddc34019c6d02d/BugBountyProgram.md).

Questions and feedback are always welcome, we will use them to improve our offering.

All PRs must pass all tests before being merged.

By being in this community, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Take a look at it, if you haven't already.

---
## License

Licensed under [LGPL v3](LICENSE).
