// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

import "./ERC20WithPermit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract MockERC20Permit is ERC20WithPermit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    constructor(string memory _name, string memory _symbol)
        ERC20WithPermit(_name, _symbol)
    {
        _setupRole(MINTER_ROLE, _msgSender());
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(PAUSER_ROLE, _msgSender());
    }

    function mint(address _to, uint256 _amount) external {
        require(
            hasRole(MINTER_ROLE, _msgSender()),
            "ERC20PresetMinterPauser: must have minter role to mint"
        );
        _mint(_to, _amount);
    }

    function pause() external {
        require(
            hasRole(PAUSER_ROLE, _msgSender()),
            "ERC20PresetMinterPauser: must have pauser role to pause"
        );
        _pause();
    }

    function unpause() external {
        require(
            hasRole(PAUSER_ROLE, _msgSender()),
            "ERC20PresetMinterPauser: must have pauser role to unpause"
        );
        _unpause();
    }
}
