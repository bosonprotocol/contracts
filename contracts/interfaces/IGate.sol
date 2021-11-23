// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

interface IGate {
    /**
     * @notice Registers connection between setID and tokenID
     * @param _tokenIdSupply an ID of a supply token (ERC-1155)
     * @param _conditionalTokenId an ID of a conditional token
     */
    function registerVoucherSetId(
        uint256 _tokenIdSupply,
        uint256 _conditionalTokenId
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
