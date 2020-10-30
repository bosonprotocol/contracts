# Test user interactions locally
Repo for Boson Protocol prototype of the core exchange mechanism

## Install
Install dependencies from project root folder:
```
    $ npm install
```


### When you are ready with the initial installation there are few more step to be done
* ``` etherlime compile ``` 
* ``` etherlime ganache ``` 
* ``` cd testUserInteractions``` 
* Here in the `config` file, you should paste your deployer, seller & buyer addresses.
* ``` node fundWallets ```
* ``` node deploy ``` Once you have your contracts deployed on your local network, you have to go into the config file and place the respective addresses under the `contracts` object.
* ``` node seller_requestCreateOrder ```. Seller is creating the initial Token Supply.  Grab the `_tokenIdSupply` from the console and place it in the `config` file so you can operate as a buyer over it.
* ``` node buyer_requestVoucher ``` Buyer is commiting 1 voucher from the Token Supply.  Store the `_tokenIdVoucher` in the `config`.
* Now you could operate with all other actions from the smart contracts
* Every time when you want a new voucher to be issued, you call `node buyer_requestVoucher` and place the id into the config

