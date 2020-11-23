pragma solidity >=0.6.6 <0.7.0;
import "./ERC20WithPermit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract BosonToken is ERC20WithPermit, AccessControl {
// SPDX-License-Identifier: MIT

    address private owner;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    event LogRecoveredAddress (address recovered);

   modifier onlyOwner() {
        require(msg.sender == owner, "UNAUTHORIZED_O");
        _;
    }

    constructor(string memory name, string memory symbol)
        ERC20WithPermit(name, symbol)
        public  
    {
        _mint(msg.sender, 100 * 10 ** uint(decimals));
        owner = msg.sender;

        _setupRole(MINTER_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
        _setRoleAdmin(MINTER_ROLE, ADMIN_ROLE);
    }

    function grantMinterRole(address _to) public onlyOwner {
        grantRole(MINTER_ROLE, _to);
    }

    function mint(address to, uint256 amount) public {
        require(hasRole(MINTER_ROLE, _msgSender()), "ERC20PresetMinterPauser: must have minter role to mint");
        _mint(to, amount);
    }
}