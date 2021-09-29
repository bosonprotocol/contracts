// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.7.6;

import "../interfaces/IERC20WithPermit.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract ERC20WithPermit is IERC20WithPermit, Pausable {
    using SafeMath for uint256;

    string public override name;
    string public override symbol;
    // solhint-disable-next-line const-name-snakecase
    uint8 public constant override decimals = 18;

    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    // prevents collision of identical structures. Formed in the initialization of the contract
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public override DOMAIN_SEPARATOR;
    // representation of keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 public constant override PERMIT_TYPEHASH =
        0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;
    mapping(address => uint256) public override nonces;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;

        uint256 chainId;

        // solhint-disable-next-line
        assembly {
            chainId := chainid()
        }

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    function _mint(address _to, uint256 _value) internal {
        totalSupply = totalSupply.add(_value);
        balanceOf[_to] = balanceOf[_to].add(_value);
        emit Transfer(address(0), _to, _value);
    }

    function _burn(address _from, uint256 _value) internal {
        balanceOf[_from] = balanceOf[_from].sub(_value);
        totalSupply = totalSupply.sub(_value);
        emit Transfer(_from, address(0), _value);
    }

    function _approve(
        address _owner,
        address _spender,
        uint256 _value
    ) private {
        allowance[_owner][_spender] = _value;
        emit Approval(_owner, _spender, _value);
    }

    function _transfer(
        address _from,
        address _to,
        uint256 _value
    ) private {
        balanceOf[_from] = balanceOf[_from].sub(_value);
        balanceOf[_to] = balanceOf[_to].add(_value);
        emit Transfer(_from, _to, _value);
    }

    function approve(address _spender, uint256 _value)
        external
        override
        whenNotPaused
        returns (bool)
    {
        _approve(msg.sender, _spender, _value);
        return true;
    }

    function transfer(address _to, uint256 _value)
        external
        override
        whenNotPaused
        returns (bool)
    {
        _transfer(msg.sender, _to, _value);
        return true;
    }

    function transferFrom(
        address _from,
        address _to,
        uint256 _value
    ) external override whenNotPaused returns (bool) {
        if (allowance[_from][msg.sender] != uint256(-1)) {
            allowance[_from][msg.sender] = allowance[_from][msg.sender].sub(
                _value
            );
        }
        _transfer(_from, _to, _value);
        return true;
    }

    function permit(
        address _owner,
        address _spender,
        uint256 _value,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external override whenNotPaused {
        // solhint-disable-next-line
        require(_deadline >= block.timestamp, "ERC20WithPermit: EXPIRED");

        bytes32 digest =
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    DOMAIN_SEPARATOR,
                    keccak256(
                        abi.encode(
                            PERMIT_TYPEHASH,
                            _owner,
                            _spender,
                            _value,
                            nonces[_owner]++,
                            _deadline
                        )
                    )
                )
            );

        address recoveredAddress = ecrecover(digest, _v, _r, _s);
        require(
            recoveredAddress != address(0) && recoveredAddress == _owner,
            "ERC20WithPermit: INVALID_SIGNATURE"
        );

        _approve(_owner, _spender, _value);
    }
}
