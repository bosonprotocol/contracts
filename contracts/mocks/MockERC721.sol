// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;
 
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract MockERC721 is ERC721, IERC721Receiver {
  constructor() ERC721("MockERC721", "M721") {
  }

  function onERC721Received(address, address, uint256, bytes calldata) external override pure returns(bytes4) {
    return bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));
  }
}
