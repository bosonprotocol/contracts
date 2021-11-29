// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/**
 * @title Sample ERC1155 NFT for Unit Testing
 * @author Cliff Hall
 */
contract SampleERC1155 is ERC1155 {
    constructor()
        ERC1155("") // solhint-disable-next-line no-empty-blocks
    {}

    /**
     * Mint a Sample NFT
     * @param _owner the address that will own the token
     * @param _tokenId the token ID to mint an amount of
     * @param _amount the amount of tokens to mint
     */
    function mintSample(
        address _owner,
        uint256 _tokenId,
        uint256 _amount
    ) public {
        _mint(_owner, _tokenId, _amount, "");
    }
}