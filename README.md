[![banner](docs/assets/banner.png)](https://bosonprotocol.io)

<h1 align="center">Boson Protocol Contracts</h1>

[![Gitter chat](https://badges.gitter.im/bosonprotocol.png)](https://gitter.im/bosonprotocol/community)

This is the place for smart contracts that are implementing Boson Protocol. You 
are invited to learn more about the project through its code and perhaps test 
locally how you might use it within your own project. When you are ready to 
integrate with Boson Protocol on a live network, you will soon be able to find 
the latest deployment details here, as well.

> Note: the contracts are not yet deployed on Ethereum mainnet or other main networks.

For more details about how Boson Protocol works and how you might make use of
it, please see the [documentation site](https://docs.bosonprotocol.io/).  

**Table of Contents**

- [Local Development](#local-development)
- [Testing](#testing)
- [Code Linting](#code-linting)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Local Development

### Prerequisites

For local development of the contracts, your development machine will need a few
tools installed.

At a minimum, you'll need:
* Node (12.20)
* NPM (> 6)
* Ruby (2.7)
* Bundler (> 2)
* Git
* direnv

For instructions on how to get set up with these specific versions:
* See the [OS X guide](docs/setup/osx.md) if you are on a Mac.
* See the [Linux guide](docs/setup/linux.md) if you use a Linux distribution.

### Running the build

We have a fully automated local build process to check that your changes are
good to be merged. To run the build:

```shell script
./go
````

By default, the build process fetches all dependencies, compiles, lints, 
formats and tests the codebase. There are also tasks for each step. This and
subsequent sections provide more details of each of the tasks.

To fetch dependencies:

```shell script
./go dependencies:install
```

To compile the contracts:

```shell script
./go contracts:compile
```

## Testing

### Unit Tests

All contracts are thoroughly unit tested using 
[Truffle's JavaScript testing](https://www.trufflesuite.com/docs/truffle/testing/writing-tests-in-javascript) 
support.

To run the unit tests:

```shell script
./go tests:unit
```

By default, the build system automates starting and stopping 
[Ganache](https://www.trufflesuite.com/docs/ganache/overview) on a free port in
the background ready for each test run.

If instead, you want to run the tests against an existing node, Ganache or
otherwise, create a JSON file creating accounts in the same format as
`config/accounts.json` and execute:

```shell script
./go "tests:unit[<port>,<path-to-accounts-json>]"
```

### Coverage

We use [solidity-coverage](https://github.com/sc-forks/solidity-coverage) to 
provide test coverage reports. 

To check the test coverage: 

```shell script 
./go tests:coverage
```

`solidity-coverage` runs its own instance of Ganache internally, as well as
instrumenting contracts before running.

### Interaction Tests

To run the interaction tests, follow the instructions in the
[interaction tests README.md](testUserInteractions/README.md).

## Code Linting

Both the contracts themselves and the tests are linted and formatted as part of
the build process.

For the contracts, we use:
* [solhint](https://protofire.github.io/solhint/) for linting
* [prettier-solidity](https://github.com/prettier-solidity/prettier-plugin-solidity)
  for formatting

For the tests, we use:
* [eslint](https://eslint.org/) for linting
* [prettier](https://prettier.io/) for formatting

To lint the contracts:

```shell script
./go contracts:lint
```

This will check if the linter is satisfied. If instead you want to attempt to
automatically fix any linting issues:

```shell script
./go contracts:lint_fix
```

To check the formatting of the contracts:

```shell script
./go contracts:format
```

To automatically fix formatting issues:

```shell script
./go contracts:format_fix
```

Similarly, for the tests, to perform the same tasks:

```shell script
./go tests:lint
./go tests:lint_fix
./go tests:format
./go tests:format_fix
```

## Documentation

For an overview of the contracts and their responsibilities, see 
[Overview](docs/contracts/overview.md).  
The whitepaper is available through the project's [website](https://www.bosonprotocol.io/).

## Contributing

We welcome contributions! Until now, Boson Protocol has been largely worked on by a small dedicated team. However, the ultimate goal is for all of the Boson Protocol repositories to be fully owned by the community and contributors. Issues, pull requests, suggestions, and any sort of involvement are more than welcome.

If you have noticed a bug, [file an issue](/issues). If you have a large pull request, we recommend filing an issue first; small PRs are always welcome.

Questions are also welcome, as long as they are tech related. We can use them to improve our documentation.

All PRs must pass all tests before being merged.

By being in this community, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Take a look at it, if you haven't already.

## License

Licensed under [LGPL v3](LICENSE).
