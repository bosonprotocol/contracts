// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ITokenWrapper.sol";
import "./interfaces/IDAI.sol";

/**
 * @title DAITokenWrapper
 * @notice Contract for wrapping call to DAI token permit function because the DAI token permit function has a different signature from other tokens with which the protocol integrates
 */
contract DAITokenWrapper is 
    ITokenWrapper,
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
     * @notice Conforms to EIP-2612. Calls permit on token, which may or may not have a permit function that conforms to EIP-2612
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
    {
        require(deadline == 0 || block.timestamp <= deadline, "PERMIT_EXPIRED");
        require(r != bytes32(0) && s != bytes32(0), "INVALID_SIGNATURE_COMPONENTS");
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
}
