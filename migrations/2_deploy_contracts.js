//AssetRegistry not used in demo-app
//const AssetRegistry = artifacts.require("AssetRegistry");

const ERC1155ERC721 = artifacts.require("ERC1155ERC721");
const VoucherKernel = artifacts.require("VoucherKernel");
const Cashier = artifacts.require("Cashier");

module.exports = function(deployer, network, accounts) {
	console.log("network: ", network);
	console.log("accounts: ", accounts);	
	
	deployer.deploy(ERC1155ERC721).then(function() {
		return deployer.deploy(VoucherKernel, ERC1155ERC721.address).then(function() {
			return deployer.deploy(Cashier, VoucherKernel.address);
		});
	});
};
