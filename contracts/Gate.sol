// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/introspection/IERC165.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "./interfaces/IGate.sol";

/**
 * @notice Gate contract between Boson router for conditional commits
 *
 * Enables conditional commit, where the user must be a
 * holder of a specific token, which can be either ERC20,
 * ERC721, or ERC1155
 */


interface Token {
    function balanceOf(address account) external view returns (uint256);
}

interface MultiToken {
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

contract Gate is IGate, Ownable, Pausable {

    event LogConditionalContractSet(
        address indexed _conditionalToken,
        address indexed _triggeredBy
    );

    event LogBosonRouterSet(
        address indexed _bosonRouter,
        address indexed _triggeredBy
    );

    event LogVoucherSetRegistered(
        uint256 indexed _tokenIdSupply,
        uint256 indexed _conditionalTokenId
    );

    event LogUserVoucherDeactivated(
        address indexed _user,
        uint256 indexed _tokenIdSupply
    );

    enum TokenType {TOKEN, MULTI_TOKEN} // ERC20 & ERC721 = TOKEN, ERC1155 = MULTI_TOKEN

    mapping(uint256 => uint256) private voucherToToken;
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
        emit LogConditionalContractSet(_conditionalToken, owner());
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
     * @notice If conditional token is MultiToken type, which token is associated with a give voucherset
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return conditional token ID or zero if conditional token is not MultiToken
     */
    function getConditionalTokenId(uint256 _tokenIdSupply) external view returns (uint256) {
        return voucherToToken[_tokenIdSupply];
    }

    /**
     * @notice Sets the contract, where gate contract checks if user holds conditional token
     * @param _conditionalToken address of a non-transferable token contract
     */
    function setConditionalTokenAddress(
        address _conditionalToken
    ) external onlyOwner notZeroAddress(_conditionalToken) whenPaused {
        conditionalTokenContract = _conditionalToken;

        emit LogConditionalContractSet(_conditionalToken, owner());
    }

      /**
     * @notice Gets the contract address, where gate contract checks if user holds conditional token
     * @return Address of conditional token contract
     */
    function getConditionalTokenContract() external view returns (address) {
        return conditionalTokenContract;
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
     */
    function registerVoucherSetId(uint256 _tokenIdSupply, uint256 _conditionalTokenId)
        external
        override
        whenNotPaused
        onlyRouterOrOwner
    {
        require(_conditionalTokenId != 0, "TOKEN_ID_0_NOT_ALLOWED");
        require(_tokenIdSupply != 0, "INVALID_TOKEN_SUPPLY");

        voucherToToken[_tokenIdSupply] = _conditionalTokenId;

        emit LogVoucherSetRegistered(_tokenIdSupply, _conditionalTokenId);
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
        uint256 conditionalTokenId = voucherToToken[_tokenIdSupply];
        return
            !isDeactivated[_user][_tokenIdSupply] &&
            ((conditionalTokenType == TokenType.TOKEN)
                ? Token(conditionalTokenContract).balanceOf(_user)
                : MultiToken(conditionalTokenContract).balanceOf(_user, conditionalTokenId)
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
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract and allows register and deactivate
     */
    function unpause() external onlyOwner {
        _unpause();
    }

}
