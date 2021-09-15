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

     mapping (uint256 => uint256) private voucherToToken;

    /**
     * @notice Registers connection between setID and tokenID
     * @param _tokenIdSupply an ID of a supply token (ERC-1155)
     * @param _nftTokenID an ID of a quest token
     */
    function registerVoucherSetID(uint256 _tokenIdSupply, uint256 _nftTokenID) external override {
       // should be limited who calls it. Otherwise attacker can "register" wrong mappings
       // Maybe this can be called from boson router?

       require(voucherToToken[_tokenIdSupply] == 0, "ALREADY_REGISTERED");
       voucherToToken[_tokenIdSupply] = _nftTokenID;
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
    function unpause() external override onlyOwner{
        _unpause();
    }
 }