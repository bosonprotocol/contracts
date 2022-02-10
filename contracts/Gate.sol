// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IGate.sol";
import ".//UsingHelpers.sol";

/**
 * @notice Gate contract between Boson router for conditional commits
 *
 * Enables conditional commit, where the user must be a
 * holder of a specific token, which can be either ERC20,
 * ERC721, or ERC1155
 */


interface Token {
    function balanceOf(address account) external view returns (uint256); //ERC-721 and ERC-20
    function ownerOf(uint256 _tokenId) external view returns (address); //ERC-721
}

interface MultiToken {
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

contract Gate is IGate, Ownable, Pausable {

    enum TokenType {FUNGIBLE_TOKEN, NONFUNGIBLE_TOKEN, MULTI_TOKEN} // ERC20, ERC721, ERC1155

    struct ConditionalCommitInfo {
        uint256 conditionalTokenId;
        Condition condition;
    }

    event LogConditionalContractSet(
        address indexed _conditionalToken,
        TokenType indexed _conditionalTokenType,
        address indexed _triggeredBy
    );

    event LogBosonRouterSet(
        address indexed _bosonRouter,
        address indexed _triggeredBy
    );

    event LogVoucherSetRegistered(
        uint256 indexed _tokenIdSupply,
        uint256 indexed _conditionalTokenId,
        Condition _condition
    );

    event LogUserVoucherDeactivated(
        address indexed _user,
        uint256 indexed _tokenIdSupply
    );

    mapping(uint256 => ConditionalCommitInfo) private voucherSetToConditionalCommit;
    mapping(address => mapping(uint256 => bool)) private isDeactivated; // user => voucherSet => bool

    TokenType private conditionalTokenType;
    address private conditionalTokenContract;
    address private bosonRouterAddress;
  
    /**
     * @notice Constructor
     * @param _bosonRouterAddress - address of the associated BosonRouter contract instance
     * @param _conditionalToken - address of the conditional token
     * @param _conditionalTokenType - the type of the conditional token
     */
    constructor(
        address _bosonRouterAddress,
        address _conditionalToken,
        TokenType _conditionalTokenType
    )
    notZeroAddress(_conditionalToken)
    notZeroAddress(_bosonRouterAddress)
    {
        bosonRouterAddress = _bosonRouterAddress;
        conditionalTokenContract = _conditionalToken;
        conditionalTokenType = _conditionalTokenType;

        emit LogBosonRouterSet(_bosonRouterAddress, owner());
        emit LogConditionalContractSet(_conditionalToken, _conditionalTokenType, owner());
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
     * @notice Get the token ID and Condition associated with the supply token ID (voucherSetID)
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return conditional token ID if one is associated with a voucher set. Zero could be a valid token ID
     * @return condition that will be checked when a user commits using a conditional token
     */
    function getConditionalCommitInfo(uint256 _tokenIdSupply) external view returns (uint256, Condition) {
        ConditionalCommitInfo memory conditionalCommitInfo = voucherSetToConditionalCommit[_tokenIdSupply];
        return (
            conditionalCommitInfo.conditionalTokenId,
            conditionalCommitInfo.condition
        );
    }

    /**
     * @notice Sets the contract, where gate contract checks if user holds conditional token
     * @param _conditionalToken address of a conditional token contract
     * @param _conditionalTokenType type of token
     */
    function setConditionalTokenContract(
        address _conditionalToken,
        TokenType _conditionalTokenType
    ) external onlyOwner notZeroAddress(_conditionalToken) whenPaused {
        conditionalTokenContract = _conditionalToken;
        conditionalTokenType = _conditionalTokenType;
        emit LogConditionalContractSet(_conditionalToken, _conditionalTokenType, owner());
    }

    /**
     * @notice Gets the contract address, where gate contract checks if user holds conditional token
     * @return address of conditional token contract
     * @return type of conditional token contract
     */
    function getConditionalTokenContract() external view returns (address, TokenType) {
        return (
            conditionalTokenContract,
            conditionalTokenType
        );
    }

    /**
     * @notice Sets the Boson router contract address, from which deactivate is accepted
     * @param _bosonRouterAddress address of the boson router contract
     */
    function setBosonRouterAddress(address _bosonRouterAddress)
        external
        onlyOwner
        notZeroAddress(_bosonRouterAddress)
        whenPaused
    {
        bosonRouterAddress = _bosonRouterAddress;
        emit LogBosonRouterSet(_bosonRouterAddress, owner());
    }

    /**
     * @notice Registers connection between setID and specific MultiToken tokenID
     *
     * Not necessary if the conditional token is not MultiToken (i.e, ERC1155)
     *
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @param _conditionalTokenId an ID of a conditional token
     * @param _condition condition that will be checked when a user commits using a conditional token
     */
    function registerVoucherSetId(uint256 _tokenIdSupply, uint256 _conditionalTokenId, Condition _condition)
        external
        override
        whenNotPaused
        onlyRouterOrOwner
    {
        require(_conditionalTokenId != 0, "TOKEN_ID_0_NOT_ALLOWED");
        require(_tokenIdSupply != 0, "INVALID_TOKEN_SUPPLY");
        
        if(_condition == Condition.OWNERSHIP) {
            require(conditionalTokenType == TokenType.NONFUNGIBLE_TOKEN, "CONDITION_NOT_AVAILABLE_FOR_TOKEN_TYPE");
        }

        voucherSetToConditionalCommit[_tokenIdSupply] = ConditionalCommitInfo(_conditionalTokenId, _condition);

        emit LogVoucherSetRegistered(_tokenIdSupply, _conditionalTokenId, _condition);
    }

    /**
     * @notice Checks if user possesses the required conditional token for given voucher set
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return true if user possesses conditional token, and the token is not deactivated
     */
    function check(address _user, uint256 _tokenIdSupply)
        external
        view
        override
        returns (bool)
    {
       ConditionalCommitInfo memory conditionalCommitInfo = voucherSetToConditionalCommit[_tokenIdSupply];
    
        return conditionalCommitInfo.condition == Condition.OWNERSHIP
                ? checkOwnership(_user, conditionalCommitInfo.conditionalTokenId)
                : checkBalance(_user, conditionalCommitInfo.conditionalTokenId);
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
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract and allows register and deactivate
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Checks if user possesses the required balance of the conditional token for given voucher set
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return true if user possesses conditional token, and the token is not deactivated
     */
    function checkBalance(address _user, uint256 _tokenIdSupply)
        internal
        view
        returns (bool)
    {
        ConditionalCommitInfo memory conditionalCommitInfo = voucherSetToConditionalCommit[_tokenIdSupply];
        return
            !isDeactivated[_user][_tokenIdSupply] &&
            ((conditionalTokenType == TokenType.NONFUNGIBLE_TOKEN || conditionalTokenType == TokenType.FUNGIBLE_TOKEN)
                ? Token(conditionalTokenContract).balanceOf(_user)
                : MultiToken(conditionalTokenContract).balanceOf(_user, conditionalCommitInfo.conditionalTokenId)
            ) > 0;
    }

     /**
     * @notice Checks if user owns a specific token Id. Only for ERC-721 tokens
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return true if user possesses conditional token, and the token is not deactivated
     */
    function checkOwnership(address _user, uint256 _tokenIdSupply)
        internal
        view
        returns (bool)
    {
        ConditionalCommitInfo memory conditionalCommitInfo = voucherSetToConditionalCommit[_tokenIdSupply];
        return
            !isDeactivated[_user][_tokenIdSupply] &&
            (Token(conditionalTokenContract).ownerOf(conditionalCommitInfo.conditionalTokenId) == _user);
         
    }
        

}
