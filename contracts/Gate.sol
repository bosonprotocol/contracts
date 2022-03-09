// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IGate.sol";
import "./UsingHelpers.sol";

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
        Condition _condition,
        uint256 threshold
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

        emit LogBosonRouterSet(_bosonRouterAddress, msg.sender);
        emit LogConditionalContractSet(_conditionalToken, _conditionalTokenType, msg.sender);
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
     * @return threshold that may be checked when a user commits using a conditional token
     */
    function getConditionalCommitInfo(uint256 _tokenIdSupply) external view returns (uint256, Condition, uint256) {
        ConditionalCommitInfo storage conditionalCommitInfo = voucherSetToConditionalCommit[_tokenIdSupply];
        return (
            conditionalCommitInfo.conditionalTokenId,
            conditionalCommitInfo.condition,
            conditionalCommitInfo.threshold
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
        emit LogConditionalContractSet(_conditionalToken, _conditionalTokenType, msg.sender);
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
        emit LogBosonRouterSet(_bosonRouterAddress, msg.sender);
    }

    /**
     * @notice Registers connection between setID and specific MultiToken tokenID
     *
     * Not necessary if the conditional token is not MultiToken (i.e, ERC1155)
     *
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @param _conditionalCommitInfo struct that contains data pertaining to conditional commit:
     *
     * uint256 conditionalTokenId - Id of the conditional token, ownership of which is a condition for committing to redeem a voucher
     * in the voucher set created by this function.
     *
     * uint256 threshold - the number that the balance of a tokenId must be greater than or equal to. Not used for OWNERSHIP condition
     *
     * Condition condition - condition that will be checked when a user commits using a conditional token
     *
     * address gateAddress - address of a gate contract that will handle the interaction between the BosonRouter contract and the conditional token,
     * ownership of which is a condition for committing to redeem a voucher in the voucher set created by this function.
     *
     * bool registerConditionalCommit - indicates whether Gate.registerVoucherSetId should be called. Gate.registerVoucherSetId can also be called separately
     */
    function registerVoucherSetId(uint256 _tokenIdSupply, ConditionalCommitInfo calldata _conditionalCommitInfo)
        external
        override
        whenNotPaused
        onlyRouterOrOwner
    {
        require(_tokenIdSupply != 0, "INVALID_TOKEN_SUPPLY");
        
        
        if(_conditionalCommitInfo.condition == Condition.OWNERSHIP) {
            require(conditionalTokenType == TokenType.NONFUNGIBLE_TOKEN, "CONDITION_NOT_AVAILABLE_FOR_TOKEN_TYPE");
        } else {
            require(_conditionalCommitInfo.threshold != 0, "INVALID_THRESHOLD");
        }

        voucherSetToConditionalCommit[_tokenIdSupply] = _conditionalCommitInfo;

        emit LogVoucherSetRegistered(_tokenIdSupply, _conditionalCommitInfo.conditionalTokenId, _conditionalCommitInfo.condition, _conditionalCommitInfo.threshold);
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

        if(conditionalCommitInfo.condition == Condition.NOT_SET) {
            return false;
        }

        return conditionalCommitInfo.condition == Condition.OWNERSHIP
                ? checkOwnership(_user, _tokenIdSupply, conditionalCommitInfo.conditionalTokenId)
                : checkBalance(_user, _tokenIdSupply, conditionalCommitInfo.conditionalTokenId, conditionalCommitInfo.threshold);


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
     * @param _conditionalTokenId an ID of a conditional token
     * @param _threshold the number that the balance must be greater than or equal to
     * @return true if user possesses conditional token, and the token is not deactivated
     */
    function checkBalance(address _user, uint256 _tokenIdSupply, uint256 _conditionalTokenId, uint256 _threshold)
        internal
        view
        returns (bool)
    {
        return
            !isDeactivated[_user][_tokenIdSupply] &&
            ((conditionalTokenType == TokenType.MULTI_TOKEN)
                ? MultiToken(conditionalTokenContract).balanceOf(_user, _conditionalTokenId)
                : Token(conditionalTokenContract).balanceOf(_user)
            ) >= _threshold;
    }

     /**
     * @notice Checks if user owns a specific token Id. Only for ERC-721 tokens
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @param _conditionalTokenId an ID of a conditional token
     * @return true if user possesses conditional token, and the token is not deactivated
     */
    function checkOwnership(address _user, uint256 _tokenIdSupply, uint256 _conditionalTokenId)
        internal
        view
        returns (bool)
    {
        return
            !isDeactivated[_user][_tokenIdSupply] &&
            (Token(conditionalTokenContract).ownerOf(_conditionalTokenId) == _user);
         
    }
        

}
