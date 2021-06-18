
const MockERC20Permit = artifacts.require("MockERC20Permit")
const FundLimitsOracle = artifacts.require('FundLimitsOracle');

module.exports = async function(deployer, network, accounts) {
    console.log("network: ", network);

    //Only deploy the mock token for running contracts locally
    if(network == 'development' || network == 'test'){
        const TOKEN_LIMIT = (5 * 10 ** 18).toString();
        const fundsLimitOracle = await FundLimitsOracle.deployed();

        //Deploy a mock BOSON token
        const mockBOSONToken = await deployer.deploy(MockERC20Permit, "MockBOSONToken", "MBOSON");
        console.log("Mock BOSON Token Address: ", mockBOSONToken.address);
     
        //Set token limit
        await fundsLimitOracle.setTokenLimit(
            mockBOSONToken.address,
            TOKEN_LIMIT
        );
    } else {
        console.log("NOT deploying mock token");
    }
};