const hre = require('hardhat')
const fs = require('fs')
const contracts = JSON.parse(fs.readFileSync('./scripts/contracts.json', 'utf-8'))

async function verifyContracts() {
    if (contracts.network != hre.network.name) {
        throw new Error('Contracts are not deployer on the same network, that you are trying to verify!')
    }

    //verify Fund Limits Oracle
   try {
    await hre.run('verify:verify', {
        address: contracts.flo,
    })
   } catch (error) {
        logError('Fund Limits Oracle', error.message)
   }

    //verify ERC1155ERC721
    try {
        await hre.run('verify:verify', {
            address: contracts.erc1155erc721,
        })
    } catch (error) {
        logError('ERC1155ERC721', error.message)
    }
    
    //verify VoucherKernel
    try {
        await hre.run('verify:verify', {
            address: contracts.voucherKernel,
            constructorArguments: [contracts.erc1155erc721]
        })
    } catch (error) {
        logError('VoucherKernel', error.message)
    }

    //verify Cashier
    try {
        await hre.run('verify:verify', {
            address: contracts.cashier,
            constructorArguments: [contracts.voucherKernel]
        })
    } catch (error) {
        logError('Cashier', error.message)
    }

    //verify BosonRouter
    try {
        await hre.run('verify:verify', {
            address: contracts.br,
            constructorArguments: [
                contracts.voucherKernel,
                contracts.erc1155erc721,
                contracts.flo,
                contracts.cashier
            ]
        })
    } catch (error) {
        logError('BosonRouter', error.message)
    }
}

function logError(contractName, msg) {
    console.log(`\x1b[31mError while trying to verify contract: ${contractName}!`);
    console.log(`Error message: ${msg}`);
    resetConsoleColor()
}

function resetConsoleColor() {
    console.log("\x1b[0m");
}

module.exports = verifyContracts;