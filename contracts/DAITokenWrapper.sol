// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.1;


import "./interfaces/ITokenWrapper.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "hardhat/console.sol";

/**
 * @title DAITokenWrapper
 * @notice Contract for wrapping call to DAI token permit function because the DAI token permit function has a different signature from other tokens with which the protocol integrates
 */
contract DAITokenWrapper is 
    ITokenWrapper,
    Pausable,
    ReentrancyGuard,
    Ownable
{

    address private daiTokenAddress;
    address private bosonRouterAddress;
  

    constructor(
        address _daiTokenAddress
    ) 
    notZeroAddress(_daiTokenAddress)
    {
        daiTokenAddress = _daiTokenAddress;
        
    }

    /**
     * @notice  Checking if a non-zero address is provided, otherwise reverts.
     */
    modifier notZeroAddress(address tokenAddress) {
        require(tokenAddress != address(0), "0A"); //zero address
        _;
    }

    /**
     * @notice Conforms to ERC2612. Calls permit on token, which may or may not have a permit function that conforms to ERC2612
     * @param owner Address of the token owner who is approving tokens to be transferred by spender
     * @param spender Address of the party who is transferring tokens on owner's behalf
     * @param value Number of tokens to be transferred
     * @param deadline Time after which this permission to transfer is no longer valid
     * @param v Part of the owner's signatue
     * @param r Part of the owner's signatue
     * @param s Part of the owner's signatue
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) 
        external
        override
        notZeroAddress(owner)
        notZeroAddress(spender)
        whenNotPaused
    {
        require(deadline == 0 || block.timestamp <= deadline, "PERMIT_EXPIRED");
        require(v >= 0 && r != bytes32(0) && s != bytes32(0), "INVALID_SIGNATURE_COMPONENTS");
        uint nonce =  IDAI(daiTokenAddress).nonces(owner);
        IDAI(daiTokenAddress).permit(owner, spender, nonce, deadline, true, v, r, s);
        emit LogPermitCalledOnToken(daiTokenAddress, owner, spender, 0);    
    }

    /**
     * @notice Set the address of the wrapper contract for the token. The wrapper is used to, for instance, allow the Boson Protocol functions that use permit functionality to work in a uniform way.
     * @param _tokenAddress Address of the token which will be updated.
     */
    function setTokenAddress(address _tokenAddress)
        external
        override
        onlyOwner
        whenNotPaused
        notZeroAddress(_tokenAddress)
    {
        daiTokenAddress = _tokenAddress;
        emit LogTokenAddressChanged(_tokenAddress, owner());
    }

    /**
     * @notice Get the address of the token wrapped by this contract
     * @return Address of the token wrapper contract
     */
    function getTokenAddress()
        external
        view
        override
        returns (address)
    {
        return daiTokenAddress;
    }

    /**
     * @notice Pause the Cashier && the Voucher Kernel contracts in case of emergency.
     * All functions related to creating new batch, requestVoucher or withdraw will be paused, hence cannot be executed.
     * There is special function for withdrawing funds if contract is paused.
     */
    function pause() 
        external 
        override
        onlyOwner
    {
        
        _pause();
    }

    /**
     * @notice Unpause the Cashier && the Voucher Kernel contracts.
     * All functions related to creating new batch, requestVoucher or withdraw will be unpaused.
     */
    function unpause() 
        external 
        override
        onlyOwner
    {
        _unpause();
    }

    function nonces(address owner) external override view returns (uint256)
    {
        return IDAI(daiTokenAddress).nonces(owner);
    }
}

/**
 * @title IDAI
 * @notice Interface for the purpose of calling the permit function on the deployed DAI token
 */
interface IDAI {
 
    function name() external pure returns (string memory);
    
    function permit(address holder, address spender, uint256 nonce, uint256 expiry,
                    bool allowed, uint8 v, bytes32 r, bytes32 s) external;

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);

    function nonces(address owner) external view returns (uint256);
}