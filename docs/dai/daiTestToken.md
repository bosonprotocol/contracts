## How to generate the DAI token contract (on testnet)
MakerDao has published instructions in [GitHub](https://github.com/makerdao/developerguides/blob/master/dai/dai-token/dai-token.md#deploy-on-testnet) for deploying your own DAI test token to a testnet.  However, there were some details missing. Below are the same information with some of the missing details provided.

### Install the dapp.tools
Please refer to <https://github.com/dapphub/dapptools#installation>

### Generate the keys store
source: <https://github.com/dapphub/dapptools/tree/master/src/ethsign>

1. `export ETH_KEYSTORE=~/keys `: Define where your keys are stored
2. `ethsign import`: Enter the private key of your test account, in order to generate this account in the keystore

### Build & Deploy the DAI contract
source: <https://github.com/makerdao/developerguides/blob/master/dai/dai-token/dai-token.md#deploy-on-testnet>

1. `git clone` <https://github.com/makerdao/dss>
2. `cd dss`
3. `git checkout 1.0.1` (to insure you're on the version deployed on mainnet)
4. `dapp update`
5. `dapp --use solc:0.5.12 build` (to insure you're using the needed version of the compiler)
6. `export SETH_CHAIN=rinkeby`
7. `export ETH_KEYSTORE=~/keys` : Define where your keys are store
8. `export ETH_FROM=<address>` : Set your test account
9. `export ETH_RPC_URL=<RPC URL> `: Set the URL for a testnet RPC node (Infura or other)
10. `export chainid=$(seth --to-uint256 4)`: Deploying the contract requires passing the chain id, for use with the permit function. For Rinkeby, the id is 4.
11. `export ETH_GAS=2500000` to increase the gasLimit enough to deploy this contract
12. `dapp create Dai $chainid` : To deploy the contract. If successful, this will return the address of your new contract.

If you want to verify your contract on Etherscan, use the output of

`hevm flatten --source-file src/dai.sol --json-file out/dapp.sol.json`

and specify the content of `$chainid` as the ABI formatted constructor (without the '0x')

### Test & fund accounts
Once deployed, you may test your contract

1. `export DAIK=<deployed contract address>`
2. `seth call $DAIK 'wards(address)' $ETH_FROM:` Should return 1 because the adress that deployed the contract is part of wards by default.
3. `seth send $DAIK 'mint(address,uint256)' $ETH_FROM $(seth --to-uint256 $(seth --to-wei 100000000 eth))`: Will mint yourself 100,000,000 test-DAI
4. `seth --from-wei $(seth --to-dec $(seth call $DAIK 'balanceOf(address)' $ETH_FROM))`: To see your test-Dai balance