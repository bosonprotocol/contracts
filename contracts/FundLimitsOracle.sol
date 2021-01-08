// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity >=0.6.6 <0.7.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract FundLimitsOracle is Ownable {

    uint256 private ethLimit;
    mapping (address => uint256) private tokenLimits;

    event LogETHLimitChanged(
        uint256 _newLimit,
        address _triggeredBy
    );

    event LogTokenLimitChanged(
        uint256 _newLimit,
        address _triggeredBy
    );

    modifier notZeroAddress(address tokenAddress) {
        require(tokenAddress != address(0), "INVALID_TOKEN_ADDRESS");
        _;
    }

    constructor() public {
        ethLimit = 1 ether;
    }

    function setETHLimit(uint256 _newLimit)
        external
        onlyOwner 
    {
        ethLimit = _newLimit;
        emit LogETHLimitChanged(_newLimit, owner());
    }

    /**
     * @notice Set new limit for a token.
        @param _tokenAddress Address of the token which will be update.
        @param _newLimit New limit which will be set. It must comply to the decimals of the token, so the limit is set in the correct decimals.
    */
    function setTokenLimit(address _tokenAddress, uint256 _newLimit) 
        external 
        onlyOwner
        notZeroAddress(_tokenAddress)
    {
        tokenLimits[_tokenAddress] = _newLimit;
        emit LogTokenLimitChanged(_newLimit, owner());
    }

    function getETHLimit() external view returns(uint256) {
        return ethLimit;
    }

    function getTokenLimit(address _tokenAddress) external view returns(uint256) {
        return tokenLimits[_tokenAddress];
    }

}