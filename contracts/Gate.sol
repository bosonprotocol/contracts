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
    mapping(uint256 => uint256) private voucherToToken;
    mapping(address => mapping(uint256 => bool)) private isDeactivated; // mapping user => voucherSet => bool

    IERC1155 private nonTransferableTokenContract;
    address private bosonRouterAddress;
  
    modifier onlyFromRouter() {
        require(bosonRouterAddress != address(0), "UNSPECIFIED_BR"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(msg.sender == bosonRouterAddress, "UNAUTHORIZED_BR"); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        _;
    }

    /**
     * @notice For a given _tokenIdSupply, it tells on which NFT it depends
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return quest NFT token ID
     */
    function getNftTokenId(uint256 _tokenIdSupply) external view override returns (uint256) {
        return voucherToToken[_tokenIdSupply];
    }

    /**
     * @notice Sets the contract, where gate contract checks if quest NFT token exists
     * @param _nonTransferableTokenContractAddress address of a non-transferable token contract
     */
    function setNonTransferableTokenContract(
        address _nonTransferableTokenContractAddress
    ) external override onlyOwner {
        nonTransferableTokenContract = IERC1155(
            _nonTransferableTokenContractAddress
        );

        emit LogNonTransferableContractSet(_nonTransferableTokenContractAddress);
    }

      /**
     * @notice Gets the contract address, where gate contract checks if quest NFT token exists
     * @return Address of contract that hold non transferable NFTs (quest NFTs)
     */
    function getNonTransferableTokenContract(
    ) external view override returns (address) {
        return address(nonTransferableTokenContract);
    }

    /**
     * @notice Sets the Boson router contract address, from which deactivate is accepted
     * @param _bosonRouterAddress address of a non-transferable token contract
     */
    function setBosonRouterAddress(address _bosonRouterAddress)
        external
        override
        onlyOwner
    {
        bosonRouterAddress = _bosonRouterAddress;

        emit LogBosonRouterSet(_bosonRouterAddress);
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
        require(_nftTokenID != 0, "TOKEN_ID_0_NOT_ALLOWED");
        require(_tokenIdSupply != 0, "INVALID_TOKEN_SUPPLY");

        voucherToToken[_tokenIdSupply] = _nftTokenID;

        emit LogVoucherSetRegistered(_tokenIdSupply, _nftTokenID);
    }

    /**
     * @notice Checks if user posesses the required quest NFT token for given voucher set
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return true if user posesses quest NFT token, and the token is not deactivated
     */
    function check(address _user, uint256 _tokenIdSupply)
        external
        view
        override
        returns (bool)
    {
        return
            !isDeactivated[_user][_tokenIdSupply] &&
            nonTransferableTokenContract.balanceOf(
                _user,
                voucherToToken[_tokenIdSupply]
            ) >
            0;
    }

    /**
     * @notice Stores information that certain user already claimed
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     */
    function deactivate(address _user, uint256 _tokenIdSupply)
        external
        override
        whenNotPaused
        onlyFromRouter
    {
        isDeactivated[_user][_tokenIdSupply] = true;

        emit LogUserVoucherDeactivated(_user, _tokenIdSupply);
    }

    /**
     * @notice Pause register and deactivate
     */
    function pause() external override onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract and allows register and deactivate
     */
    function unpause() external override onlyOwner {
        _unpause();
    }

}
