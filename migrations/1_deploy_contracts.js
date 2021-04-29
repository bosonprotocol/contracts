//AssetRegistry not used in demo-app
//const AssetRegistry = artifacts.require("AssetRegistry");

const ERC1155ERC721 = artifacts.require("ERC1155ERC721");
const VoucherKernel = artifacts.require("VoucherKernel");
const Cashier = artifacts.require("Cashier");
const BosonRouter = artifacts.require("BosonRouter")
const FundLimitsOracle = artifacts.require('FundLimitsOracle');

module.exports = function(deployer, network, accounts) {
    console.log("network: ", network);
    console.log("accounts: ", accounts);

    deployer.deploy(FundLimitsOracle).then(function() {
        return deployer.deploy(ERC1155ERC721).then(function() {
            return deployer.deploy(VoucherKernel, ERC1155ERC721.address).then(function() {
                return deployer.deploy(Cashier, VoucherKernel.address).then(function() {
                    return deployer.deploy(BosonRouter, VoucherKernel.address, FundLimitsOracle.address, Cashier.address).then(async function() {

                        console.log("$ Setting initial values ...");
                        await ERC1155ERC721.deployed().then(async(instance) => {
                            await instance.setApprovalForAll(VoucherKernel.address, 'true').then(tx =>
                                console.log("\n$ ERC1155ERC721", tx.logs[0].event, "approved VoucherKernel:", tx.logs[0].args._approved))
                        });
                        
                        await ERC1155ERC721.deployed().then(async(instance) => {
                            await instance.setVoucherKernelAddress(VoucherKernel.address).then(tx =>
                                console.log("\n$ ERC1155ERC721", tx.logs[0].event, "at:", tx.logs[0].args._newVoucherKernel))
                        });

                        await ERC1155ERC721.deployed().then(async(instance) => {
                            await instance.setCashierAddress(Cashier.address).then(tx =>
                                console.log("\n$ ERC1155ERC721", tx.logs[0].event, "at:", tx.logs[0].args._newCashier))
                        });

                        await VoucherKernel.deployed().then(async(instance) => {
                            await instance.setBosonRouterAddress(BosonRouter.address).then(tx =>
                                console.log("\n$ VoucherKernel", tx.logs[0].event, "at:", tx.logs[0].args._newBosonRouter))
                        });

                        await VoucherKernel.deployed().then(async(instance) => {
                            await instance.setCashierAddress(Cashier.address).then(tx =>
                                console.log("\n$ VoucherKernel", tx.logs[0].event, "at:", tx.logs[0].args._newCashier))
                        });

                        await Cashier.deployed().then(async(instance) => {
                            await instance.setBosonRouterAddress(BosonRouter.address).then(tx =>
                                console.log("\n$ Cashier", tx.logs[0].event, "at:", tx.logs[0].args._newBosonRouter))
                        });

                        await Cashier.deployed().then(async(instance) => {
                            await instance.setTokenContractAddress(ERC1155ERC721.address).then(tx =>
                                console.log("\n$ Cashier", tx.logs[0].event, "at:", tx.logs[0].args._newTokenContract))
                        });

                        console.log("FundLimitsOracle Contract Address: ", FundLimitsOracle.address);
                        console.log("ERC1155ERC721 Contract Address: ", ERC1155ERC721.address);
                        console.log("VoucherKernel Contract Address: ", VoucherKernel.address);
                        console.log("Cashier Contract Address: ", Cashier.address);
                        console.log("Boson Router Contract Address: ", BosonRouter.address);
                    })
                });
            })
        })
    });
};