// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "./interfaces/IVoucherKernel.sol";
import "./interfaces/IVoucherSets.sol";
import "./interfaces/ICashier.sol";

//preparing for ERC-1066, ERC-1444, EIP-838

/**
 * @title Voucher sets implemented as ERC-1155
 */
// TODO: inherit from OZ ERC1155 and remove state vars and local implementations of IERC1155
// taking care to be sure that no "special" stuff happening in this implementation gets lost
contract VoucherSets is IVoucherSets, Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using Address for address;

    //min security
    address private voucherKernelAddress; //address of the VoucherKernel contract
    address private cashierAddress; //address of the Cashier contract
    
    //standard reqs
    //ERC-1155
    mapping(uint256 => mapping(address => uint256)) private balances; //balance of token ids of an account

    //shared storage: ERC-1155 & ERC-721
    mapping(address => mapping(address => bool)) private operatorApprovals; //approval of accounts of an operator
    //metadata is shared, too (but ERC-1155 and ERC-721 have different metadata extension reqs)
    string internal metadataBase;
    string internal metadata1155Route;

    //ERC-1155 metadata event: URIs are defined in RFC 3986. The URI MUST point to a JSON file that conforms to the ERC-1155 Metadata URI JSON Schema.
    //not used ATM
    //event URI(string _value, uint256 indexed _id);

    event LogVoucherKernelSet(address _newVoucherKernel, address _triggeredBy);
    event LogCashierSet(address _newCashier, address _triggeredBy);

    modifier onlyFromVoucherKernel() {
        require(
            voucherKernelAddress != address(0),
            "UNSPECIFIED_VOUCHERKERNEL"
        );
        require(msg.sender == voucherKernelAddress, "UNAUTHORIZED_VK");
        _;
    }

    modifier notZeroAddress(address _address) {
        require(_address != address(0), "ZERO_ADDRESS");
        _;
    }

    /**
     * @notice Transfers amount of _tokenId from-to addresses with safety call.
     * If _to is a smart contract, will call onERC1155Received
     * @dev ERC-1155
     * @param _from    Source address
     * @param _to      Destination address
     * @param _tokenId ID of the token
     * @param _value   Transfer amount
     * @param _data    Additional data forwarded to onERC1155Received if _to is a contract
     */
    function safeTransferFrom(
        address _from,
        address _to,
        uint256 _tokenId,
        uint256 _value,
        bytes calldata _data
    )
    external
    override
    nonReentrant
    {
        require(_to != address(0), "UNSPECIFIED_ADDRESS");
        require(
            _from == msg.sender || operatorApprovals[_from][msg.sender],
            "UNAUTHORIZED_ST"
        );

        require(balances[_tokenId][_from] == _value, "IQ"); //invalid qty

        // SafeMath throws with insufficient funds or if _id is not valid (balance will be 0)
        balances[_tokenId][_from] = balances[_tokenId][_from].sub(_value);
        balances[_tokenId][_to] = _value.add(balances[_tokenId][_to]);

        ICashier(cashierAddress).onVoucherSetTransfer(
            _from,
            _to,
            _tokenId,
            _value
        );

        emit TransferSingle(msg.sender, _from, _to, _tokenId, _value);

        //make sure the tx was accepted - in case of a revert below, the event above is reverted, too
        _doSafeTransferAcceptanceCheck(
            msg.sender,
            _from,
            _to,
            _tokenId,
            _value,
            _data
        );
    }

    /**
        @notice Transfers amount of _tokenId from-to addresses with safety call.
        If _to is a smart contract, will call onERC1155BatchReceived
        @dev ERC-1155
        @param _from    Source address
        @param _to      Destination address
        @param _tokenIds array of token IDs
        @param _values   array of transfer amounts
        @param _data    Additional data forwarded to onERC1155BatchReceived if _to is a contract
    */
    function safeBatchTransferFrom(
        address _from,
        address _to,
        uint256[] calldata _tokenIds,
        uint256[] calldata _values,
        bytes calldata _data
    ) external override {
        require(_to != address(0), "UNSPECIFIED_ADDRESS");
        require(_tokenIds.length == _values.length, "MISMATCHED_ARRAY_LENGTHS");
        require(
            _from == msg.sender || operatorApprovals[_from][msg.sender],
            "UNAUTHORIZED_SB"
        );

        for (uint256 i = 0; i < _tokenIds.length; ++i) {
            uint256 tokenId = _tokenIds[i];
            uint256 value = _values[i];

            require(balances[tokenId][_from] == value, "IQ"); //invalid qty

            // SafeMath throws with insufficient funds or if _id is not valid (balance will be 0)
            balances[tokenId][_from] = balances[tokenId][_from].sub(value);
            balances[tokenId][_to] = value.add(balances[tokenId][_to]);

            ICashier(cashierAddress).onVoucherSetTransfer(
                _from,
                _to,
                tokenId,
                value
            );
        }

        emit TransferBatch(msg.sender, _from, _to, _tokenIds, _values);

        //make sure the tx was accepted - in case of a revert below, the event above is reverted, too
        _doSafeBatchTransferAcceptanceCheck(
            msg.sender,
            _from,
            _to,
            _tokenIds,
            _values,
            _data
        );
    }

    /**
     * @notice Check successful transfer if recipient is a contract
     * @dev ERC-1155
     * @param _operator The operator of the transfer
     * @param _from     Address of sender
     * @param _to       Address of recipient
     * @param _tokenId  ID of the token
     * @param _value    Value transferred
     * @param _data     Optional data
     */
    function _doSafeTransferAcceptanceCheck(
        address _operator,
        address _from,
        address _to,
        uint256 _tokenId,
        uint256 _value,
        bytes memory _data
    ) internal {
        if (_to.isContract()) {
            require(
                IERC1155Receiver(_to).onERC1155Received(
                    _operator,
                    _from,
                    _tokenId,
                    _value,
                    _data
                ) == IERC1155Receiver(_to).onERC1155Received.selector,
                "NOT_SUPPORTED"
            );
        }
    }

    /**
     * @notice Check successful transfer if recipient is a contract
     * @dev ERC-1155
     * @param _operator The operator of the transfer
     * @param _from     Address of sender
     * @param _to       Address of recipient
     * @param _tokenIds Array of IDs of tokens
     * @param _values   Array of values transferred
     * @param _data     Optional data
     */
    function _doSafeBatchTransferAcceptanceCheck(
        address _operator,
        address _from,
        address _to,
        uint256[] memory _tokenIds,
        uint256[] memory _values,
        bytes memory _data
    ) internal {
        if (_to.isContract()) {
            require(
                IERC1155Receiver(_to).onERC1155BatchReceived(
                    _operator,
                    _from,
                    _tokenIds,
                    _values,
                    _data
                ) == IERC1155Receiver(_to).onERC1155BatchReceived.selector,
                "NOT_SUPPORTED"
            );
        }
    }

    /**
        @notice Get the balance of tokens of an account
        @dev ERC-1155
        @param _account The address of the token holder
        @param _tokenId ID of the token
        @return         balance
     */
    function balanceOf(address _account, uint256 _tokenId)
        external
        view
        override
        returns (uint256)
    {
        return balances[_tokenId][_account];
    }

    /**
        @notice Get the balance of account-token pairs.
        @dev ERC-1155
        @param _accounts The addresses of the token holders
        @param _tokenIds IDs of the tokens
        @return         balances
     */
    function balanceOfBatch(
        address[] calldata _accounts,
        uint256[] calldata _tokenIds
    ) external view override returns (uint256[] memory) {
        require(
            _accounts.length == _tokenIds.length,
            "MISMATCHED_ARRAY_LENGTHS"
        );
        uint256[] memory batchBalances = new uint256[](_accounts.length);

        for (uint256 i = 0; i < _accounts.length; ++i) {
            batchBalances[i] = balances[_tokenIds[i]][_accounts[i]];
        }

        return batchBalances;
    }

    /**
     * @notice Approves or unapproves the operator.
     * will revert if the caller attempts to approve itself as it is redundant
     * @dev ERC-1155 & ERC-721
     * @param _operator to (un)approve
     * @param _approve flag to set or unset
     */
    function setApprovalForAll(address _operator, bool _approve)
        external
        override
    {
        require(msg.sender != _operator, "REDUNDANT_CALL");
        operatorApprovals[msg.sender][_operator] = _approve;
        emit ApprovalForAll(msg.sender, _operator, _approve);
    }

    /**
        @notice Gets approval status of an operator for a given account.
        @dev ERC-1155 & ERC-721
        @param _account   token holder
        @param _operator  operator to check
        @return           True if the operator is approved, false if not
    */
    function isApprovedForAll(address _account, address _operator)
        external
        view
        override
        returns (bool)
    {
        return operatorApprovals[_account][_operator];
    }

    /**
     * @notice Returns true if this contract implements the interface defined by _interfaceId_.
     * This function call must use less than 30 000 gas. ATM not enforced.
     */
    function supportsInterface(bytes4 _interfaceId)
        external
        pure
        override
        returns (bool)
    {
        return
            //check matching against ERC-165 identifiers
            _interfaceId == 0x01ffc9a7 || //ERC-165
            _interfaceId == 0xd9b67a26 || //ERC-1155
            _interfaceId == 0x0e89341c;   //ERC-1155 metadata extension
    }

    // // // // // // // //
    // STANDARD - UTILS
    // // // // // // // //
    /**
     * @notice Mint an amount of a desired token
     * Currently no restrictions as to who is allowed to mint - so, it is public.
     * @dev ERC-1155
     * @param _to       owner of the minted token
     * @param _tokenId  ID of the token to be minted
     * @param _value    Amount of the token to be minted
     * @param _data     Additional data forwarded to onERC1155BatchReceived if _to is a contract
     */
    function mint(
        address _to,
        uint256 _tokenId,
        uint256 _value,
        bytes memory _data
    ) external override onlyFromVoucherKernel {
        _mint(_to, _tokenId, _value, _data);
    }

    /**
     * @notice Internal function to mint an amount of a desired token
     * @dev ERC-1155
     * @param _to       owner of the minted token
     * @param _tokenId  ID of the token to be minted
     * @param _value    Amount of the token to be minted
     * @param _data     Additional data forwarded to onERC1155BatchReceived if _to is a contract
     */
    function _mint(
        address _to,
        uint256 _tokenId,
        uint256 _value,
        bytes memory _data
    ) internal {
        require(_to != address(0), "UNSPECIFIED_ADDRESS");

        balances[_tokenId][_to] = balances[_tokenId][_to].add(_value);
        emit TransferSingle(msg.sender, address(0), _to, _tokenId, _value);

        _doSafeTransferAcceptanceCheck(
            msg.sender,
            address(0),
            _to,
            _tokenId,
            _value,
            _data
        );
    }

    /**
     * @notice Batch minting of tokens
     * Currently no restrictions as to who is allowed to mint - so, it is public.
     * @dev ERC-1155
     * @param _to The address that will own the minted token
     * @param _tokenIds IDs of the tokens to be minted
     * @param _values Amounts of the tokens to be minted
     * @param _data Additional data forwarded to onERC1155BatchReceived if _to is a contract
     */
    function mintBatch(
        address _to,
        uint256[] memory _tokenIds,
        uint256[] memory _values,
        bytes memory _data
    ) external onlyFromVoucherKernel {
        //require approved minter

        _mintBatch(_to, _tokenIds, _values, _data);
    }

    /**
     * @notice Internal function for batch minting of tokens\
     * @dev ERC-1155
     * @param _to The address that will own the minted token
     * @param _tokenIds IDs of the tokens to be minted
     * @param _values Amounts of the tokens to be minted
     * @param _data Additional data forwarded to onERC1155BatchReceived if _to is a contract
     */
    function _mintBatch(
        address _to,
        uint256[] memory _tokenIds,
        uint256[] memory _values,
        bytes memory _data
    ) internal {
        require(_to != address(0), "UNSPECIFIED_ADDRESS");
        require(_tokenIds.length == _values.length, "MISMATCHED_ARRAY_LENGTHS");

        for (uint256 i = 0; i < _tokenIds.length; i++) {
            balances[_tokenIds[i]][_to] = _values[i].add(
                balances[_tokenIds[i]][_to]
            );
        }

        emit TransferBatch(msg.sender, address(0), _to, _tokenIds, _values);

        _doSafeBatchTransferAcceptanceCheck(
            msg.sender,
            address(0),
            _to,
            _tokenIds,
            _values,
            _data
        );
    }

    /**
     * @notice Burn an amount of tokens with the given ID
     * @dev ERC-1155
     * @param _account  Account which owns the token
     * @param _tokenId  ID of the token
     * @param _value    Amount of the token
     */
    function burn(
        address _account,
        uint256 _tokenId,
        uint256 _value
    ) external override onlyFromVoucherKernel {
        _burn(_account, _tokenId, _value);
    }

    /**
     * @notice Burn an amount of tokens with the given ID
     * @dev ERC-1155
     * @param _account  Account which owns the token
     * @param _tokenId  ID of the token
     * @param _value    Amount of the token
     */
    function _burn(
        address _account,
        uint256 _tokenId,
        uint256 _value
    ) internal {
        require(_account != address(0), "UNSPECIFIED_ADDRESS");

        balances[_tokenId][_account] = balances[_tokenId][_account].sub(_value);
        emit TransferSingle(msg.sender, _account, address(0), _tokenId, _value);
    }

    /* Burning ERC-721 is not allowed, as a voucher (being an ERC-721 token) has a final state and shouldn't be destructed. */

    /**
     * @notice Batch burn an amounts of tokens
     * @dev ERC-1155
     * @param _account Account which owns the token
     * @param _tokenIds IDs of the tokens
     * @param _values Amounts of the tokens
     */
    function burnBatch(
        address _account,
        uint256[] memory _tokenIds,
        uint256[] memory _values
    ) external onlyFromVoucherKernel {
        _burnBatch(_account, _tokenIds, _values);
    }

    /**
     * @notice Internal function to batch burn an amounts of tokens
     * @dev ERC-1155
     * @param _account Account which owns the token
     * @param _tokenIds IDs of the tokens
     * @param _values Amounts of the tokens
     */
    function _burnBatch(
        address _account,
        uint256[] memory _tokenIds,
        uint256[] memory _values
    ) internal {
        require(_account != address(0), "UNSPECIFIED_ADDRESS");
        require(_tokenIds.length == _values.length, "MISMATCHED_ARRAY_LENGTHS");

        for (uint256 i = 0; i < _tokenIds.length; i++) {
            balances[_tokenIds[i]][_account] = balances[_tokenIds[i]][_account]
                .sub(_values[i]);
        }

        emit TransferBatch(
            msg.sender,
            _account,
            address(0),
            _tokenIds,
            _values
        );
    }

    // // // // // // // //
    // METADATA EXTENSIONS
    // // // // // // // //

    /**
     * @notice Setting the URL prefix for tokens metadata
     * @param _newBase   New prefix to be used
     */
    function _setMetadataBase(string memory _newBase) external onlyOwner {
        metadataBase = _newBase;
    }

    /**
     * @notice Setting the URL route for ERC1155 tokens metadata
     * @param _newRoute   New route to be used
     */
    function _set1155Route(string memory _newRoute) external onlyOwner {
        metadata1155Route = _newRoute;
    }

    /**
     * @notice A distinct Uniform Resource Identifier (URI) for a given token.
     * @dev ERC-1155
     * URIs are defined in RFC 3986. The URI MUST point to a JSON file that conforms to the "ERC-1155 Metadata URI JSON Schema".
     * @param _tokenId  The ID of the token
     * @return          Full URI string for metadata of the _tokenId
     */
    function uri(uint256 _tokenId) external view returns (string memory) {
        return
            string(
                abi.encodePacked(metadataBase, metadata1155Route, _uint2str(_tokenId))
            );
    }

    // // // // // // // //
    // UTILS
    // // // // // // // //

    /**
     * @notice Set the address of the VoucherKernel contract
     * @param _voucherKernelAddress   The address of the Voucher Kernel contract
     */
    function setVoucherKernelAddress(address _voucherKernelAddress)
        external
        override
        onlyOwner
        notZeroAddress(_voucherKernelAddress)
    {
        voucherKernelAddress = _voucherKernelAddress;

        emit LogVoucherKernelSet(_voucherKernelAddress, msg.sender);
    }

    /**
     * @notice Set the address of the cashier contract
     * @param _cashierAddress   The Cashier contract
     */
    function setCashierAddress(address _cashierAddress)
        external
        override
        onlyOwner
        notZeroAddress(_cashierAddress)
    {
        cashierAddress = _cashierAddress;
        emit LogCashierSet(_cashierAddress, msg.sender);
    }

    /**
     * @notice Convert UINT to string
     *  Thank you, Oraclize (aka Provable)!
     *      https://github.com/provable-things/ethereum-api/blob/master/provableAPI_0.5.sol
     * @param _i    uint parameter
     */
    function _uint2str(uint256 _i)
        internal
        pure
        returns (string memory _uintAsString)
    {
        if (_i == 0) {
            return "0";
        }
        uint256 j = _i;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint256 k = len - 1;
        while (_i != 0) {
            bstr[k--] = bytes1(uint8(48 + (_i % 10)));
            _i /= 10;
        }
        return string(bstr);
    }

    /**
     * @notice Get the address of Voucher Kernel contract
     * @return Address of Voucher Kernel contract
     */
    function getVoucherKernelAddress()
    external
    view
    override
    returns (address)
    {
        return voucherKernelAddress;
    }

    /**
     * @notice Get the address of Cashier contract
     * @return Address of Cashier address
     */
    function getCashierAddress()
    external
    view
    override
    returns (address)
    {
        return cashierAddress;
    }
    
}
