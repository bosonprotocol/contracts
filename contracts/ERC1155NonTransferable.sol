// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.1;

import "@openzeppelin/contracts/token/ERC1155/ERC1155Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Non transferable token contract, implementing ERC-1155, but preventing transfers
 */
contract ERC1155NonTransferable is ERC1155Pausable, Ownable {
    constructor (string memory uri_) ERC1155(uri_) Ownable() {}
    
    /**
     * @dev See {ERC1155-_beforeTokenTransfer}.
     *
     * Requirements:
     *
     * - tokens cannot be transferred after minter
     * - tokens cannot be minted if user already have it
     * - at most
     */
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal virtual override {
        require(
            from == address(0),
            "ERC1155NonTransferable: Tokens are non transferable"
        ); // _beforeTokenTransfer is called in mint too, we must allow it to pass

        for (uint256 i = 0; i < ids.length; i++) {
            require(
                balanceOf(to, ids[i]) == 0,
                "ERC1155NonTransferable: User already has the token"
            );
            require(
                amounts[i] == 1,
                "ERC1155NonTransferable: User can have at most 1 NFT per tokenID"
            ); // alternatively we could force it to be 1
        }

        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
    }



    /**
     * @notice Pause all token mint, transfer, burn
     */
    function pause() external virtual override onlyOwner {
       _pause();
    }

    /**
     * @notice Unpause the contract and allows mint, transfer, burn
     */
    function unpause() external virtual override onlyOwner{
        _unpause();
    }
}
