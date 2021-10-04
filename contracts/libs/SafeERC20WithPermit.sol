// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "../interfaces/IERC20WithPermit.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title SafeERC20WithPermit
 * @dev Wrappers around ERC20 operations that throw on failure (when the token
 * contract returns false). Tokens that return no value (and instead revert or
 * throw on failure) are also supported, non-reverting calls are assumed to be
 * successful.
 * To use this library you can add a `using SafeERC20WithPermit for IERC20WithPermit;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20WithPermit {
    using Address for address;

    function safeTransferFrom(
        IERC20WithPermit _token,
        address _from,
        address _to,
        uint256 _value
    ) internal {
        _callOptionalReturn(
            _token,
            abi.encodeWithSelector(
                _token.transferFrom.selector,
                _from,
                _to,
                _value
            )
        );
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param _token The token targeted by the call.
     * @param _data The call data (encoded using abi.encode or one of its variants).
     */
    function _callOptionalReturn(IERC20WithPermit _token, bytes memory _data)
        private
    {
        // We need to perform a low level call here, to bypass Solidity's return data size checking mechanism, since
        // we're implementing it ourselves. We use {Address.functionCall} to perform this call, which verifies that
        // the target address contains contract code and also asserts for success in the low-level call.

        bytes memory returndata =
            address(_token).functionCall(
                _data,
                "SafeERC20WithPermit: low-level call failed"
            );
        if (returndata.length > 0) {
            // Return data is optional
            // solhint-disable-next-line max-line-length
            require(
                abi.decode(returndata, (bool)),
                "SafeERC20WithPermit: ERC20WithPermit operation did not succeed"
            );
        }
    }
}
