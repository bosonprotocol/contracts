// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

import "../BosonRouter.sol";

/**
 * @title A mock BosonRouter for tests only
 */
contract MockBosonRouter is BosonRouter {
    /**
     * @notice Construct and initialze the contract. Iniialises associated contract addresses
     * @param _voucherKernel address of the associated VocherKernal contract instance
     * @param _tokenRegistry address of the associated TokenRegistry contract instance
     * @param _cashierAddress address of the associated Cashier contract instance
     */
    constructor(
        address _voucherKernel,
        address _tokenRegistry,
        address _cashierAddress
    )
        BosonRouter(_voucherKernel, _tokenRegistry, _cashierAddress)
    // solhint-disable-next-line no-empty-blocks
    {

    }

    /**
     * @notice Issuer/Seller offers promise as supply token and needs to escrow the deposit. A supply token is
     * also known as a voucher set. Payment and deposits are specified in ETH.
     *
     * @dev uses an invalid payment method for a test case
     *
     * @param _metadata metadata which is required for creation of a voucher set
     * Metadata array is used for consistency across the permutations of similar functions.
     * Some functions require other parameters, and the number of parameters causes stack too deep error.
     * The use of the matadata array mitigates the stack too deep error.
     *
     * uint256 _validFrom = _metadata[0];
     * uint256 _validTo = _metadata[1];
     * uint256 _price = _metadata[2];
     * uint256 _depositSe = _metadata[3];
     * uint256 _depositBu = _metadata[4];
     * uint256 _quantity = _metadata[5];
     */
    function requestCreateOrderETHETH(uint256[] calldata _metadata)
        external
        payable
        override
        nonReentrant
        whenNotPaused
    {
        checkLimits(_metadata, address(0), address(0), 0);
        requestCreateOrder(_metadata, 5, address(0), address(0), 0);
    }

    // only for test
    function transferFromAndAddEscrowTest(
        address _tokenAddress,
        uint256 _amount
    ) external {
        transferFromAndAddEscrow(_tokenAddress, _amount);
    }
}
