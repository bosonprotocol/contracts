// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ITokenWrapper.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "hardhat/console.sol";

/**
 * @title NoPermitTokenWrapper
 * @notice Contract for wrapping call any ERC20 token that does not have a permit function
 */
contract NoPermitTokenWrapper is ITokenWrapper, Ownable, ReentrancyGuard {

    address private tokenAddress;


    constructor(
        address _tokenAddress
    ) 
    notZeroAddress(_tokenAddress)
    {
        tokenAddress = _tokenAddress;
        emit LogTokenAddressChanged(_tokenAddress, owner());
    }

    /**
     * @notice  Checking if a non-zero address is provided, otherwise reverts.
     */
    modifier notZeroAddress(address _tokenAddress) {
        require(_tokenAddress != address(0), "0A"); //zero address
        _;
    }

    /**
     * @notice Conforms to EIP-2612. Calls permit on token, which may or may not have a permit function that conforms to EIP-2612
     * @param _tokenOwner Address of the token owner who is approving tokens to be transferred by spender
     * @param _spender Address of the party who is transferring tokens on owner's behalf
     * @param _deadline Time after which this permission to transfer is no longer valid
     * @param _v Part of the owner's signatue
     * @param _r Part of the owner's signatue
     * @param _s Part of the owner's signatue
     */
    function permit(
        address _tokenOwner,
        address _spender,
        uint256 _value,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) 
        external
        override
        nonReentrant
        notZeroAddress(_tokenOwner)
        notZeroAddress(_spender)
    {
        console.log("calling NoPermitTokenWrapper.permit");
        uint256 allowance = IERC20(tokenAddress).allowance(_tokenOwner, _spender);
        console.log("allowance", allowance);
        console.log("_value", _value);
        require(allowance >= _value, "ALLOWANCE_TOO_LOW");
        emit LogPermitCalledOnToken(tokenAddress, _tokenOwner, _spender, _value);
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
        tokenAddress = _tokenAddress;
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
        return tokenAddress;
    }
}
