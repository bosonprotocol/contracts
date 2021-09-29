// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

interface ITokenWrapper {
    event LogTokenAddressChanged(
        address indexed _newWrapperAddress,
        address indexed _triggeredBy
    );

    event LogPermitCalledOnToken(
        address indexed _tokenAddress,
        address indexed _owner,
        address indexed _spender,
        uint256 _value
    );

    /**
     * @notice Provides a way to make calls to the permit function of tokens in a uniform way
     * @param _owner Address of the token owner who is approving tokens to be transferred by spender
     * @param _spender Address of the party who is transferring tokens on owner's behalf
     * @param _value Number of tokens to be transferred
     * @param _deadline Time after which this permission to transfer is no longer valid
     * @param _v Part of the owner's signatue
     * @param _r Part of the owner's signatue
     * @param _s Part of the owner's signatue
     */
    function permit(
        address _owner,
        address _spender,
        uint256 _value,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external;

    /**
     * @notice Set the address of the wrapper contract for the token. The wrapper is used to, for instance, allow the Boson Protocol functions that use permit functionality to work in a uniform way.
     * @param _tokenAddress Address of the token which will be updated.
     */
    function setTokenAddress(address _tokenAddress) external;

    /**
     * @notice Get the address of the token wrapped by this contract
     * @return Address of the token wrapper contract
     */
    function getTokenAddress() external view returns (address);
}
