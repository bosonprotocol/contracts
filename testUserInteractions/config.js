module.exports = {
    TOKEN_SUPPLY_ID: "token supply id", 
    VOUCHER_ID: "voucher id", 
    contracts: {
        TokenContractAddress: 'token contract address',
        VoucherKernelContractAddress: 'voucher kernel contract address',
        CashierContractAddress: 'cashier contract address'
    },
    DEPLOYER_PUBLIC: 'deployer public key',
    DEPLOYER_SECRET: 'deployer secret key',
    BUYER_PUBLIC: 'buyer public key',
    BUYER_SECRET: 'buyer secret key', 
    SELLER_PUBLIC: 'seller public key',
    SELLER_SECRET: 'seller secret key',
    DB_VOUCHER_TO_MODIFY: "", // this is if you would like to manipulate some record in a local DB. The voucher you are editing must be with the same price, buyer deposit and seller deposit!
    SEND_TO_DB: false
}


