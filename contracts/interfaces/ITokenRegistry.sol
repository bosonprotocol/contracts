// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

interface ITokenRegistry {
    /**
     * @notice Set new limit for a token. It's used while seller tries to create a voucher. The limit is determined by a voucher set. Voucher price * quantity, seller deposit * quantity, buyer deposit * qty must be below the limit.
     * @param _tokenAddress Address of the token which will be updated.
     * @param _newLimit New limit which will be set. It must comply to the decimals of the token, so the limit is set in the correct decimals.
     */
    function setTokenLimit(address _tokenAddress, uint256 _newLimit) external;

    /**
     * @notice Get the maximum allowed token limit for the specified Token.
     * @param _tokenAddress Address of the token which will be update.
     * @return The max limit for this token
     */
    function getTokenLimit(address _tokenAddress)
        external
        view
        returns (uint256);

    /**
     * @notice Set new limit for ETH. It's used while seller tries to create a voucher. The limit is determined by a voucher set. Voucher price * quantity, seller deposit * quantity, buyer deposit * qty must be below the limit.
     * @param _newLimit New limit which will be set.
     */
    function setETHLimit(uint256 _newLimit) external;

    /**
     * @notice Get the maximum allowed ETH limit to set as price of voucher, buyer deposit or seller deposit.
     * @return The max ETH limit
     */
    function getETHLimit() external view returns (uint256);

    /**
     * @notice Set the address of the wrapper contract for the token. The wrapper is used to, for instance, allow the Boson Protocol functions that use permit functionality to work in a uniform way.
     * @param _tokenAddress Address of the token which will be updated.
     * @param _wrapperAddress Address of the wrapper contract
     */
    function setTokenWrapperAddress(
        address _tokenAddress,
        address _wrapperAddress
    ) external;

    /**
     * @notice Get the address of the token wrapper contract for the specified token
     * @param _tokenAddress Address of the token which will be updated.
     * @return Address of the token wrapper contract
     */
    function getTokenWrapperAddress(address _tokenAddress)
        external
        view
        returns (address);
}
