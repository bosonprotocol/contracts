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
    mapping(address => mapping(uint256 => bool)) private isRevoked; // mapping user => voucherSet => bool
    // alternative mapping(bytes32 => bool) private isRevoked; // where byte32 is keccak256(abi.encodePacked(_user,_tokenIdSupply))

    IERC1155 private nonTrasferableTokenContract;
    address private bosonRouter;

    /**
     * @notice Sets the contract, where gate contract checks if quest NFT token exists
     * @param _nonTrasferableTokenContractAddress address of a non-transferable token contract
     */
    function setNonTrasferableTokenContract(
        address _nonTrasferableTokenContractAddress
    ) external override onlyOwner {
        nonTrasferableTokenContract = IERC1155(
            _nonTrasferableTokenContractAddress
        );
    }

    /**
     * @notice Sets the Boson router contract address, from which revoke is accepted
     * @param _bosonRouter address of a non-transferable token contract
     */
    function setBosonRouterAddress(address _bosonRouter)
        external
        override
        onlyOwner
    {
        bosonRouter = _bosonRouter;
    }

    /**
     * @notice Registers connection between setID and tokenID
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @param _nftTokenID an ID of a quest token
     */
    function registerVoucherSetID(uint256 _tokenIdSupply, uint256 _nftTokenID)
        external
        override
        whenNotPaused
        onlyOwner
    {
        // should be limited who calls it. Otherwise attacker can "register" wrong mappings
        // Maybe this can be called from boson router?

        require(_nftTokenID != 0, "TOKEN_ID_0_NOT_ALLOWED");
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
        public
        view
        override
        returns (bool)
    {
        return
            !isRevoked[_user][_tokenIdSupply] &&
            nonTrasferableTokenContract.balanceOf(_user, _tokenIdSupply) > 0;
    }

    /**
     * @notice Stores information that certain user already claimed
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     */
    function revoke(address _user, uint256 _tokenIdSupply)
        external
        override
        whenNotPaused
    {
        require(msg.sender == bosonRouter, "NOT_A_ROUTER");
        require(check(_user, _tokenIdSupply), "NOTHING_TO_REVOKE"); // not necessary under assumption that router is written correctly
        isRevoked[_user][_tokenIdSupply] = true;

        // alternative revoked[keccak256(abi.encodePacked(_user,_tokenIdSupply))] = true
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
