// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

/**
 * @title IDAI
 * @notice Interface for the purpose of calling the permit function on the deployed DAI token
 */
interface IDAI {
    function name() external pure returns (string memory);

    function permit(
        address holder,
        address spender,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);

    function nonces(address owner) external view returns (uint256);
}
