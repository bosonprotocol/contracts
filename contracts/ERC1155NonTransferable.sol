// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC1155/ERC1155Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IERC1155NonTransferable.sol";
import "./MetaTransactionReceiver.sol";

/**
 * @title Non transferable token contract, implementing ERC-1155, but preventing transfers
 */
contract ERC1155NonTransferable is
    IERC1155NonTransferable,
    ERC1155Pausable,
    Ownable,
    MetaTransactionReceiver
{
   
    event LogUriSet(string _newUri, address _triggeredBy);

    /**
     * @notice Construct and initialze the contract. 
     * @param _uri metadata uri
     */
    constructor(string memory _uri) ERC1155(_uri) Ownable() {}

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
    ) external override onlyOwnerOrSelf {
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
    ) external onlyOwnerOrSelf {
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
    ) external override onlyOwnerOrSelf {
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
    ) external onlyOwnerOrSelf {
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
    ) internal virtual override onlyOwner {
        require(
            _from == address(0) || _to == address(0),
            "ERC1155NonTransferable: Tokens are non transferable"
        ); // _beforeTokenTransfer is called in mint/burn to too, we must allow it to pass

        super._beforeTokenTransfer(_operator, _from, _to, _ids, _amounts, _data);
    }

    /**
     * @notice Pause all token mint, transfer, burn
     */
    function pause() external override onlyOwnerOrSelf {
        _pause();
    }

    /**
     * @notice Unpause the contract and allows mint, transfer, burn
     */
    function unpause() external override onlyOwnerOrSelf {
        _unpause();
    }

    /**
     * @notice Setting the metadata uri
     * @param _newUri   New uri to be used
     */
    function setUri(string memory _newUri) external onlyOwnerOrSelf {
        require(bytes(_newUri).length != 0, "INVALID_VALUE");
        _setURI(_newUri);
        emit LogUriSet(_newUri, _msgSender());
    }

    /**
     * @notice When functions are invoked via metatransactions, it is already checked there that signer is the owner of transaction
     * and we can declare it as a message sender
     */
    function _msgSender() internal view virtual override returns (address payable) {
        return msg.sender == address(this) ? payable(owner()) : msg.sender;
    }
}
