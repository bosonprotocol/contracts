const shell = require("shelljs"); // From solidity-coverage

module.exports = {
    skipFiles: ['contracts/mocks/MockBosonRouter.sol', 'contracts/mocks/MockERC20Permit.sol', 'contracts/mocks/MockERC721Receiver.sol', 'contracts/mocks/MockERC1155Receiver.sol', 'contracts/mocks/ERC20WithPermit.sol']
};
