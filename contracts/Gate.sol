// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.1;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

import "./interfaces/IGate.sol";
import "./interfaces/IERC1155.sol";

/**
 * @title Gate contract between Boson router and ERC1155NonTransferable
 * Enables conditional commit
 */

contract Gate is IGate, Ownable, Pausable {
    // assuming that gate calls only 1 ERC1155 contract (not dynamic)

    mapping(uint256 => uint256) private voucherToToken;

    IERC1155 private nonTrasferableTokenContract;

    /**
     * @notice Sets the address, where gate contract checks if quest NFT token exists
     * @param _nonTrasferableTokenContractAddress address of a non-transferable token contract
     */
    function setNonTrasferableTokenContract(address _nonTrasferableTokenContractAddress) external onlyOwner {
        nonTrasferableTokenContract = IERC1155(_nonTrasferableTokenContractAddress);
    }

    /**
     * @notice Registers connection between setID and tokenID
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @param _nftTokenID an ID of a quest token
     */
    function registerVoucherSetID(uint256 _tokenIdSupply, uint256 _nftTokenID)
        external
        override
    {
        // should be limited who calls it. Otherwise attacker can "register" wrong mappings
        // Maybe this can be called from boson router?

        require(voucherToToken[_tokenIdSupply] == 0, "ALREADY_REGISTERED");
        voucherToToken[_tokenIdSupply] = _nftTokenID;
    }

    /**
     * @notice Checks if user posesses the required quest NFT token for given voucher set
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return true if user posesses quest NFT token, and the token is not revoked
     */
    function check(address _user, uint256 _tokenIdSupply)
        external
        view
        returns (bool)
    {
        // TODO check token is not revoked
        return nonTrasferableTokenContract.balanceOf(_user, _tokenIdSupply) > 0;
    }


    /**
     * @notice Pause register and revoke
     */
    function pause() external override onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract and allows register and revoke
     */
    function unpause() external override onlyOwner {
        _unpause();
    }
}
