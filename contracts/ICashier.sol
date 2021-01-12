// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.6 <0.7.0;

interface ICashier {

    function pause() external;
    
    function unpause() external;

    function getEscrowAmount(address _account) external view returns (uint256);

    function updateEscrowAmount(address _account, uint256 _newAmount) external;

}