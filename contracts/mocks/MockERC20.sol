// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Mock ERC20 NFT for Unit Testing
 * @author Cliff Hall
 */
contract MockERC20 is ERC20 {
    constructor()
        ERC20(TOKEN_NAME, TOKEN_SYMBOL)
    // solhint-disable-next-line no-empty-blocks
    {

    }

    string public constant TOKEN_NAME = "MockERC20";
    string public constant TOKEN_SYMBOL = "SE20";

    /**
     * Mint a sample token
     * @param _owner the address that will own the token
     */
    function mint(address _owner, uint256 _amount) public {
        _mint(_owner, _amount);
    }
}
