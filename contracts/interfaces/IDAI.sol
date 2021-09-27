// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

/**
 * @title IDAI
 * @notice Interface for the purpose of calling the permit function on the deployed DAI token
 */
interface IDAI {
    function name() external pure returns (string memory);

    function permit(
        address _holder,
        address _spender,
        uint256 _nonce,
        uint256 _expiry,
        bool _allowed,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external;

    function transferFrom(
        address _from,
        address _to,
        uint256 _value
    ) external returns (bool);

    function nonces(address _owner) external view returns (uint256);
}
