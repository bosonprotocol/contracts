// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.1;

import "@openzeppelin/contracts/token/ERC1155/ERC1155Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IERC1155NonTransferable.sol";

/**
 * @title Non transferable token contract, implementing ERC-1155, but preventing transfers
 */
contract ERC1155NonTransferable is
    IERC1155NonTransferable,
    ERC1155Pausable,
    Ownable
{
    constructor(string memory uri_) ERC1155(uri_) Ownable() {}

    /*
     * @notice Mint an amount of a desired token
     * @dev ERC-1155
     * @param _to       owner of the minted token
     * @param _tokenId  ID of the token to be minted
     * @param _value    Amount of the token to be minted
     * @param _data     Additional data forwarded to onERC1155BatchReceived if _to is a contract
     */
    function mint(
        address _to,
        uint256 _tokenId,
        uint256 _value,
        bytes memory _data
    ) public override onlyOwner {
        _mint(_to, _tokenId, _value, _data);
    }

    /**
     * @notice Batch minting of tokens
     * @dev ERC-1155
     * @param _to The address that will own the minted token
     * @param _tokenIds IDs of the tokens to be minted
     * @param _values Amounts of the tokens to be minted
     * @param _data Additional data forwarded to onERC1155BatchReceived if _to is a contract
     */
    function mintBatch(
        address _to,
        uint256[] memory _tokenIds,
        uint256[] memory _values,
        bytes memory _data
    ) public onlyOwner {
        _mintBatch(_to, _tokenIds, _values, _data);
    }

    /**
     * @notice Burn an amount of tokens with the given ID
     * @dev ERC-1155
     * @param _account  Account which owns the token
     * @param _tokenId  ID of the token
     * @param _value    Amount of the token
     */
    function burn(
        address _account,
        uint256 _tokenId,
        uint256 _value
    ) public override onlyOwner {
        _burn(_account, _tokenId, _value);
    }

    /**
     * @notice Batch burn an amounts of tokens
     * @dev ERC-1155
     * @param _account Account which owns the token
     * @param _tokenIds IDs of the tokens
     * @param _values Amounts of the tokens
     */
    function burnBatch(
        address _account,
        uint256[] memory _tokenIds,
        uint256[] memory _values
    ) public onlyOwner {
        _burnBatch(_account, _tokenIds, _values);
    }

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
        address _operator,
        address _from,
        address _to,
        uint256[] memory _ids,
        uint256[] memory _amounts,
        bytes memory _data
    ) internal virtual override {
        require(
            _from == address(0) || _to == address(0),
            "ERC1155NonTransferable: Tokens are non transferable"
        ); // _beforeTokenTransfer is called in mint/burn to too, we must allow it to pass

        super._beforeTokenTransfer(_operator, _from, _to, _ids, _amounts, _data);
    }

    /**
     * @notice Pause all token mint, transfer, burn
     */
    function pause() external override onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract and allows mint, transfer, burn
     */
    function unpause() external override onlyOwner {
        _unpause();
    }
}
