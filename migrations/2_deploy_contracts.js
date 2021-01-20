//AssetRegistry not used in demo-app
//const AssetRegistry = artifacts.require("AssetRegistry");

const ERC1155ERC721 = artifacts.require("ERC1155ERC721");
const VoucherKernel = artifacts.require("VoucherKernel");
const Cashier = artifacts.require("Cashier");
const FundLimitsOracle 	= artifacts.require('FundLimitsOracle');
const BosonTokenPrice = artifacts.require("BosonTokenPrice") 
const BosonTokenDeposit = artifacts.require("BosonTokenDeposit") 



module.exports = function(deployer, network, accounts) {
	console.log("network: ", network);
	console.log("accounts: ", accounts);
	
	deployer.deploy(FundLimitsOracle).then(function() {
		return deployer.deploy(ERC1155ERC721).then(function() {
			return deployer.deploy(VoucherKernel, ERC1155ERC721.address).then(function() {
				return deployer.deploy(Cashier, VoucherKernel.address, ERC1155ERC721.address, FundLimitsOracle.address).then(function() {
					return deployer.deploy(BosonTokenPrice, "BosonTokenPrice", "BPRC").then(function () {
						return deployer.deploy(BosonTokenDeposit, "BosonTokenDeposit", "BDEP").then(function() {

							console.log("$ Setting initial values ...");
							ERC1155ERC721.deployed().then(instance => { instance.setApprovalForAll(VoucherKernel.address, 'true').then(tx => 
								console.log("\n$ ERC1155ERC721", tx.logs[0].event, "approved VoucherKernel:", tx.logs[0].args._approved))});
							ERC1155ERC721.deployed().then(instance => { instance.setVoucherKernelAddress(VoucherKernel.address).then(tx => 
								console.log("\n$ ERC1155ERC721", tx.logs[0].event, "at:", tx.logs[0].args._newVoucherKernel))});
							ERC1155ERC721.deployed().then(instance => { instance.setCashierContract(Cashier.address).then(tx => 
								console.log("\n$ ERC1155ERC721", tx.logs[0].event, "at:", tx.logs[0].args._newCashier))});

							VoucherKernel.deployed().then(instance => { instance.setCashierAddress(Cashier.address).then(tx => 
								console.log("\n$ VoucherKernel", tx.logs[0].event, "at:", tx.logs[0].args._newCashier))});					
					
							console.log("FundLimitsOracle Contract Address: ", FundLimitsOracle.address);
							console.log("ERC1155ERC721 Contract Address: ", ERC1155ERC721.address);
							console.log("VoucherKernel Contract Address: ", VoucherKernel.address);
							console.log("Cashier Contract Address: ", Cashier.address);
							console.log("Boson Token Price Contract Address: ", BosonTokenPrice.address);
							console.log("Boson Token Deposit Contract Address: ", BosonTokenDeposit.address);
						})
					})
				});
			})
		})
	});
};
