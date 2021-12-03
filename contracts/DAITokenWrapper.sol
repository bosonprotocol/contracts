// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ITokenWrapper.sol";
import "./interfaces/IDAI.sol";

/**
 * @title DAITokenWrapper
 * @notice Contract for wrapping call to DAI token permit function because the DAI token permit function has a different signature from other tokens with which the protocol integrates
 */
contract DAITokenWrapper is ITokenWrapper, Ownable, ReentrancyGuard {

    address private daiTokenAddress;


    constructor(
        address _daiTokenAddress
    ) 
    notZeroAddress(_daiTokenAddress)
    {
        daiTokenAddress = _daiTokenAddress;
        emit LogTokenAddressChanged(_daiTokenAddress, owner());
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
        uint256,
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
        // Ensure signature is unique
        // See https://github.com/OpenZeppelin/openzeppelin-contracts/blob/04695aecbd4d17dddfd55de766d10e3805d6f42f/contracts/cryptography/ECDSA.sol#L5
        require(uint256(_s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "INVALID_SIG_S");
        require(_v == 27 || _v == 28, "INVALID_SIG_V");
        uint nonce =  IDAI(daiTokenAddress).nonces(_tokenOwner);
        IDAI(daiTokenAddress).permit(_tokenOwner, _spender, nonce, _deadline, true, _v, _r, _s);
        emit LogPermitCalledOnToken(daiTokenAddress, _tokenOwner, _spender, type(uint256).max);
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
