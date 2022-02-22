// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;
pragma abicoder v2;

import "./../UsingHelpers.sol";

interface IGate {
    /**
     * @notice Registers connection between setID and tokenID
     * @param _tokenIdSupply an ID of a supply token (ERC-1155)
     * @param _conditionalCommitInfo struct that contains data pertaining to conditional commit:
     *
     * uint256 conditionalTokenId - Id of the conditional token, ownership of which is a condition for committing to redeem a voucher
     * in the voucher set created by this function.
     *
     * uint256 threshold - the number that the balance of a tokenId must be greater than or equal to. Not used for OWNERSHIP condition
     *
     * Condition condition - condition that will be checked when a user commits using a conditional token
     *
     * address gateAddress - address of a gate contract that will handle the interaction between the BosonRouter contract and the conditional token,
     * ownership of which is a condition for committing to redeem a voucher in the voucher set created by this function.
     *
     * bool registerConditionalCommit - indicates whether Gate.registerVoucherSetId should be called. Gate.registerVoucherSetId can also be called separately
     */
    function registerVoucherSetId(
        uint256 _tokenIdSupply,
        ConditionalCommitInfo calldata _conditionalCommitInfo
    ) external;

    /**
     * @notice Checks if user possesses the required conditional token for given voucher set
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     * @return true if user possesses conditional token, and the token is not deactivated
     */
    function check(address _user, uint256 _tokenIdSupply)
        external
        view
        returns (bool);

    /**
     * @notice Stores information that certain user already claimed
     * @param _user user address
     * @param _tokenIdSupply an ID of a supply token (ERC-1155) [voucherSetID]
     */
    function deactivate(address _user, uint256 _tokenIdSupply) external;
}
