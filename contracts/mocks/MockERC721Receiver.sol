// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC721/ERC721Holder.sol";
import "@openzeppelin/contracts/introspection/ERC165.sol";

// solhint-disable-next-line no-empty-blocks
contract MockERC721Receiver is ERC165, ERC721Holder {
    // Equals to `bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))`
    // which can be also obtained as `IERC721Receiver(0).onERC721Received.selector`
    bytes4 private constant _ERC721_RECEIVED = 0x150b7a02;

        constructor () {
        _registerInterface(_ERC721_RECEIVED);
    }
}
