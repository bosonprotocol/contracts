// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

// some old ERC20 implementations do not return (bool) when transferFrom is called
interface IERC20Old {
    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external;
}
