// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;
 
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
 
contract MockERC721 is ERC721 {
  constructor() ERC721("MockERC721", "M721") {
  }
}
