// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

import "./../BosonRouter.sol";

/**
 * @title Mock Contract for testing purposes.
 * @notice This mock passes an invalide value to createPaymentMethod from  requestCreateOrderETHETH for the purpose of testing calls to VoucherKernel.createPaymentMethod and possibly other functions
 */
contract MockBosonRouter is BosonRouter {
    constructor(
        address _voucherKernel,
        address _tokenRegistry,
        address _cashierAddress
    )
        BosonRouter(_voucherKernel, _tokenRegistry, _cashierAddress)
    // solhint-disable-next-line
    {

    }

    function requestCreateOrderETHETH(uint256[] calldata metadata)
        external
        payable
        override
        nonReentrant
        whenNotPaused
    {
        checkLimits(metadata, address(0), address(0), 0);
        requestCreateOrder(metadata, 5, address(0), address(0), 0);
    }
}
