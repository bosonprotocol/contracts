// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.1;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IFundLimitsOracle.sol";

/**
 * @title Contract for managing maximum allowed funds to be escrowed.
 * The purpose is to limit the total funds locked in escrow in the initial stages of the protocol.
 */

contract FundLimitsOracle is Ownable, IFundLimitsOracle {
    uint256 private ethLimit;
    mapping(address => uint256) private tokenLimits;

    event LogETHLimitChanged(uint256 _newLimit, address _triggeredBy);

    event LogTokenLimitChanged(uint256 _newLimit, address _triggeredBy);

    modifier notZeroAddress(address tokenAddress) {
        require(tokenAddress != address(0), "INVALID_TOKEN_ADDRESS");
        _;
    }

    constructor() {
        ethLimit = 1 ether;
    }

    /**
     * @notice Set new limit for ETH. It's used while seller tries to create a voucher. The limit is determined by a voucher set. Voucher price * quantity, seller deposit * quantity, buyer deposit * qty must be below the limit.
     * @param _newLimit New limit which will be set.
     */
    function setETHLimit(uint256 _newLimit) external override onlyOwner {
        ethLimit = _newLimit;
        emit LogETHLimitChanged(_newLimit, owner());
    }

    /**
     * @notice Set new limit for a token. It's used while seller tries to create a voucher. The limit is determined by a voucher set. Voucher price * quantity, seller deposit * quantity, buyer deposit * qty must be below the limit.
     * @param _tokenAddress Address of the token which will be updated.
     * @param _newLimit New limit which will be set. It must comply to the decimals of the token, so the limit is set in the correct decimals.
     */
    function setTokenLimit(address _tokenAddress, uint256 _newLimit)
        external
        override
        onlyOwner
        notZeroAddress(_tokenAddress)
    {
        tokenLimits[_tokenAddress] = _newLimit;
        emit LogTokenLimitChanged(_newLimit, owner());
    }

    // // // // // // // //
    // GETTERS
    // // // // // // // //

    /**
     * @notice Get the maximum allowed ETH limit to set as price of voucher, buyer deposit or seller deposit.
     */
    function getETHLimit() external view override returns (uint256) {
        return ethLimit;
    }

    /**
     * @notice Get the maximum allowed token limit for the specified Token.
     * @param _tokenAddress Address of the token which will be update.
     */
    function getTokenLimit(address _tokenAddress)
        external
        view
        override
        returns (uint256)
    {
        return tokenLimits[_tokenAddress];
    }
}
