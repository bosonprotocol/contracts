// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "./interfaces/IGate.sol";

/**
 * @title Gate contract between Boson router and ERC1155NonTransferable
 * Enables conditional commit
 */

contract Gate is IGate, Ownable, Pausable {
    mapping(uint256 => uint256) private voucherToToken;
    mapping(address => mapping(uint256 => bool)) private isDeactivated; // mapping user => voucherSet => bool

    IERC1155 private nonTransferableTokenContract;
    address private bosonRouterAddress;
  
    /**
     * @notice Construct and initialze the contract. Inizializes associated contract address. 
     * @param _bosonRouterAddress address of the associated BosonRouter contract instance
     */
    constructor(address _bosonRouterAddress, address _nonTransferableTokenContractAddress)
    notZeroAddress(_nonTransferableTokenContractAddress) notZeroAddress(_bosonRouterAddress) {
          bosonRouterAddress = _bosonRouterAddress;
        nonTransferableTokenContract = IERC1155(_nonTransferableTokenContractAddress
                );

        emit LogBosonRouterSet(_bosonRouterAddress, owner());
        emit LogNonTransferableContractSet(_nonTransferableTokenContractAddress, owner());
    }

    modifier onlyFromRouter() {
        require(msg.sender == bosonRouterAddress, "UNAUTHORIZED_BR"); 
        _;
    }

    modifier onlyRouterOrOwner() {
        require(msg.sender == bosonRouterAddress || msg.sender == owner(), "UNAUTHORIZED_O_BR"); 
        _;
    }

    /**
     * @notice  Checking if a non-zero address is provided, otherwise reverts.
     */
    modifier notZeroAddress(address _tokenAddress) {
        require(_tokenAddress != address(0), "0A"); //zero address
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
    ) external override onlyOwner notZeroAddress(_nonTransferableTokenContractAddress) whenPaused {
        nonTransferableTokenContract = IERC1155(
            _nonTransferableTokenContractAddress
        );

        emit LogNonTransferableContractSet(_nonTransferableTokenContractAddress, owner());
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
        notZeroAddress(_bosonRouterAddress)
        whenPaused
    {
        bosonRouterAddress = _bosonRouterAddress;

        emit LogBosonRouterSet(_bosonRouterAddress, owner());
    }

    /**
     * @notice Registers connection between setID and tokenID
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @param _nftTokenId an ID of a quest token
     */
    function registerVoucherSetId(uint256 _tokenIdSupply, uint256 _nftTokenId)
        external
        override
        whenNotPaused
        onlyRouterOrOwner
    {
        require(_nftTokenId != 0, "TOKEN_ID_0_NOT_ALLOWED");
        require(_tokenIdSupply != 0, "INVALID_TOKEN_SUPPLY");

        voucherToToken[_tokenIdSupply] = _nftTokenId;

        emit LogVoucherSetRegistered(_tokenIdSupply, _nftTokenId);
    }

    /**
     * @notice Checks if user possesses the required quest NFT token for given voucher set
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return true if user possesses quest NFT token, and the token is not deactivated
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
            ) > 0;
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
