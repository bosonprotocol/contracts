// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title Sample ERC721 NFT for Unit Testing
 * @author Cliff Hall
 */
contract SampleERC721 is ERC721 {
    constructor()
        ERC721(TOKEN_NAME, TOKEN_SYMBOL)
    // solhint-disable-next-line no-empty-blocks
    {

    }

    string public constant TOKEN_NAME = "SampleERC721";
    string public constant TOKEN_SYMBOL = "SE721";

    /**
     * Mint a Sample NFT
     * @param _owner the address that will own the token
     */
    function mintSample(address _owner) public returns (uint256 tokenId) {
        tokenId = totalSupply();
        _mint(_owner, tokenId);
    }
}
