// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.6 <0.7.0;


interface IFundLimitsOracle {
    
    function setTokenLimit(address _tokenAddress, uint256 _newLimit) external;
    function getTokenLimit(address _tokenAddress) external view returns(uint256);

    function setETHLimit(uint256 _newLimit) external;
    function getETHLimit() external view returns(uint256);
}