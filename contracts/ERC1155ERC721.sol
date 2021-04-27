// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.1;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/IERC1155.sol";
import "./interfaces/IERC1155TokenReceiver.sol";
import "./interfaces/IERC721.sol";
import "./interfaces/IERC721TokenReceiver.sol";
import "./interfaces/IERC1155ERC721.sol";
import "./interfaces/IVoucherKernel.sol";
import "./interfaces/ICashier.sol";

//preparing for ERC-1066, ERC-1444, EIP-838

/**
 * @title Multi-token contract, implementing ERC-1155 and ERC-721 hybrid
 *  Inspired by: https://github.com/pixowl/sandbox-smart-contracts
 */
contract ERC1155ERC721 is IERC1155, IERC721, IERC1155ERC721 {
    using SafeMath for uint256;
    using Address for address;

    //min security
    address public owner; //contract owner
    address public voucherKernelAddress; //address of the VoucherKernel contract
    address public cashierAddress; //address of the Cashier contract

    //standard reqs
    //ERC-1155
    mapping(uint256 => mapping(address => uint256)) private balances; //balance of token ids of an account

    //ERC-721
    mapping(address => uint256) private balance721;
    mapping(uint256 => address) private owners721;
    mapping(uint256 => address) private operator721;

    //shared storage: ERC-1155 & ERC-721
    mapping(address => mapping(address => bool)) private operatorApprovals; //approval of accounts of an operator
    //metadata is shared, too (but ERC-1155 and ERC-721 have different metadata extension reqs)
    string internal metadataBase;
    string internal metadata1155Route;
    string internal metadata721Route;

    //ERC-1155 metadata event: URIs are defined in RFC 3986. The URI MUST point to a JSON file that conforms to the ERC-1155 Metadata URI JSON Schema.
    //not used ATM
    //event URI(string _value, uint256 indexed _id);

    event LogVoucherKernelSet(address _newVoucherKernel, address _triggeredBy);
    event LogCashierSet(address _newCashier, address _triggeredBy);

    modifier onlyOwner() {
        require(msg.sender == owner, "UNAUTHORIZED_O"); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        _;
    }

    modifier onlyFromVoucherKernel() {
        require(
            voucherKernelAddress != address(0),
            "UNSPECIFIED_VOUCHERKERNEL"
        ); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(msg.sender == voucherKernelAddress, "UNAUTHORIZED_VK"); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        _;
    }

    modifier notZeroAddress(address _address) {
        require(_address != address(0), "ZERO_ADDRESS");
        _;
    }

    constructor() {
        owner = msg.sender;
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
    ) external override {
        require(_to != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(
            _from == msg.sender || operatorApprovals[_from][msg.sender] == true,
            "UNAUTHORIZED_ST"
        ); //hex"10"FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)

        require(balances[_tokenId][_from] == _value, "IQ"); //invalid qty

        // SafeMath throws with insufficient funds or if _id is not valid (balance will be 0)
        balances[_tokenId][_from] = balances[_tokenId][_from].sub(_value);
        balances[_tokenId][_to] = _value.add(balances[_tokenId][_to]);

        ICashier(cashierAddress).onERC1155Transfer(
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
     * @notice Safely transfers the ownership of a given token ID to another address
     * If the target address is a contract, it must implement `onERC721Received`,
     * which is called upon a safe transfer, and return the magic value
     * `bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"))`; otherwise,
     * the transfer is reverted.
     * Requires the msg.sender to be the owner, approved, or operator
     * @dev ERC-721
     * @param _from current owner of the token
     * @param _to address to receive the ownership of the given token ID
     * @param _tokenId uint256 ID of the token to be transferred
     */
    function safeTransferFrom(
        address _from,
        address _to,
        uint256 _tokenId
    ) public override {
        safeTransferFrom(_from, _to, _tokenId, "");
    }

    /**
     * @notice Safely transfers the ownership of a given token ID to another address
     * If the target address is a contract, it must implement `onERC721Received`
     * Requires the msg.sender to be the owner, approved, or operator
     * @dev ERC-721
     * @param _from current owner of the token
     * @param _to address to receive the ownership of the given token ID
     * @param _tokenId uint256 ID of the token to be transferred
     * @param _data bytes data to send along with a safe transfer check
     */
    function safeTransferFrom(
        address _from,
        address _to,
        uint256 _tokenId,
        bytes memory _data
    ) public override {
        transferFrom(_from, _to, _tokenId);

        if (_to.isContract()) {
            require(
                ERC721TokenReceiver(_to).onERC721Received(
                    _from,
                    _to,
                    _tokenId,
                    _data
                ) == ERC721TokenReceiver(_to).onERC721Received.selector,
                "UNSUPPORTED_ERC721_RECEIVED"
            ); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        }
    }

    /**
     * @notice Transfers the ownership of a given token ID to another address.
     * Usage of this method is discouraged, use `safeTransferFrom` whenever possible.
     * Requires the msg.sender to be the owner, approved, or operator.
     * @dev ERC-721
     * @param _from current owner of the token
     * @param _to address to receive the ownership of the given token ID
     * @param _tokenId uint256 ID of the token to be transferred
     */
    function transferFrom(
        address _from,
        address _to,
        uint256 _tokenId
    ) public override {
        require(
            operator721[_tokenId] == msg.sender ||
                ownerOf(_tokenId) == msg.sender,
            "NOT_OWNER_NOR_APPROVED"
        ); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)

        _transferFrom(_from, _to, _tokenId);
    }

    /**
     * @notice Internal function to transfer ownership of a given token ID to another address.
     * As opposed to transferFrom, this imposes no restrictions on msg.sender.
     * @dev ERC-721
     * @param _from current owner of the token
     * @param _to address to receive the ownership of the given token ID
     * @param _tokenId uint256 ID of the token to be transferred
     */
    function _transferFrom(
        address _from,
        address _to,
        uint256 _tokenId
    ) internal {
        require(ownerOf(_tokenId) == _from, "UNAUTHORIZED_T"); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        require(_to != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        operator721[_tokenId] = address(0);

        balance721[_from]--;
        balance721[_to]++;

        owners721[_tokenId] = _to;

        require(IVoucherKernel(voucherKernelAddress).isVoucherTransferable(_tokenId), "FUNDS_RELEASED");

        ICashier(cashierAddress).onERC721Transfer(
            _from,
            _to,
            _tokenId
        );

        emit Transfer(_from, _to, _tokenId);
    }

    /**
     * @notice Approves another address to transfer the given token ID
     * The zero address indicates there is no approved address.
     * There can only be one approved address per token at a given time.
     * Can only be called by the token owner or an approved operator.
     * @dev ERC-721
     * @param _to address to be approved for the given token ID
     * @param _tokenId uint256 ID of the token to be approved
     */
    function approve(address _to, uint256 _tokenId) public override {
        address tokenOwner = ownerOf(_tokenId);
        require(_to != tokenOwner, "REDUNDANT_CALL"); //hex"18" FISSION.code(FISSION.Category.Permission, FISSION.Status.NotApplicatableToCurrentState)

        require(
            msg.sender == tokenOwner ||
                operatorApprovals[tokenOwner][msg.sender], // isApprovedForAll(owner, msg.sender),
            "UNAUTHORIZED_A"
        ); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
        //"ERC721: approve caller is not owner nor approved for all"

        operator721[_tokenId] = _to;
        emit Approval(tokenOwner, _to, _tokenId);
    }

    /**
     * @notice Gets the approved address for a token ID, or zero if no address set
     * Reverts if the token ID does not exist.
     * @dev ERC-721
     * @param _tokenId uint256 ID of the token to query the approval of
     * @return address currently approved for the given token ID
     */
    function getApproved(uint256 _tokenId)
        public
        view
        override
        returns (address)
    {
        require(
            owners721[_tokenId] != address(0),
            "ERC721: approved query for nonexistent token"
        );

        return operator721[_tokenId];
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
        require(_to != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(_tokenIds.length == _values.length, "MISMATCHED_ARRAY_LENGTHS"); //hex"28" FISSION.code(FISSION.Category.Find, FISSION.Status.Duplicate_Conflict_Collision)
        require(
            _from == msg.sender || operatorApprovals[_from][msg.sender] == true,
            "UNAUTHORIZED_SB"
        ); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)

        for (uint256 i = 0; i < _tokenIds.length; ++i) {
            uint256 tokenId = _tokenIds[i];
            uint256 value = _values[i];

            require(balances[tokenId][_from] == value, "IQ"); //invalid qty

            // SafeMath throws with insufficient funds or if _id is not valid (balance will be 0)
            balances[tokenId][_from] = balances[tokenId][_from].sub(value);
            balances[tokenId][_to] = value.add(balances[tokenId][_to]);

            ICashier(cashierAddress).onERC1155Transfer(
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
                ERC1155TokenReceiver(_to).onERC1155Received(
                    _operator,
                    _from,
                    _tokenId,
                    _value,
                    _data
                ) == ERC1155TokenReceiver(_to).onERC1155Received.selector,
                "NOT_SUPPORTED"
            ); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
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
                ERC1155TokenReceiver(_to).onERC1155BatchReceived(
                    _operator,
                    _from,
                    _tokenIds,
                    _values,
                    _data
                ) == ERC1155TokenReceiver(_to).onERC1155BatchReceived.selector,
                "NOT_SUPPORTED"
            ); //hex"10" FISSION.code(FISSION.Category.Permission, FISSION.Status.Disallowed_Stop)
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

    /// @notice Count all NFTs assigned to an owner
    /// @dev ERC-721
    /// @param _owner An address for whom to query the balance
    /// @return The number of NFTs owned by `_owner`, possibly zero
    function balanceOf(address _owner) public view override returns (uint256) {
        require(_owner != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        return balance721[_owner];
    }

    /**
     * @notice Gets the owner of the specified token ID.
     * @dev ERC-721
     * @param _tokenId uint256 ID of the token to query the owner of
     * @return address currently marked as the owner of the given token ID
     */
    function ownerOf(uint256 _tokenId) public view override returns (address) {
        address tokenOwner = owners721[_tokenId];
        require(tokenOwner != address(0), "UNDEFINED_OWNER"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

        return tokenOwner;
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
        ); //hex"28" FISSION.code(FISSION.Category.Find, FISSION.Status.Duplicate_Conflict_Collision)
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
        override(IERC1155, IERC721)
    {
        require(msg.sender != _operator, "REDUNDANT_CALL"); //hex"18" FISSION.code(FISSION.Category.Permission, FISSION.Status.NotApplicatableToCurrentState)
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
        public
        view
        override(IERC1155, IERC721)
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
            _interfaceId == 0x80ac58cd || //ERC-721
            _interfaceId == 0x5b5e139f || //ERC-721 metadata extension
            _interfaceId == 0x0e89341c; //ERC-1155 metadata extension
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
    ) public override onlyFromVoucherKernel {
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
        require(_to != address(0), "UNSPECIFIED_ADDRESS"); //FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

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
     * @notice Function to mint tokens.
     * @dev ERC-721
     * @param to The address that will receive the minted tokens.
     * @param tokenId The token id to mint.
     * @return A boolean that indicates if the operation was successful.
     */
    function mint(address to, uint256 tokenId)
        public
        override
        onlyFromVoucherKernel
        returns (bool)
    {
        _mint(to, tokenId);
        return true;
    }

    /**
     * @notice Internal function to mint a new token.
     * Reverts if the given token ID already exists.
     * @dev ERC-721
     * @param _to The address that will own the minted token
     * @param _tokenId uint256 ID of the token to be minted
     */
    function _mint(address _to, uint256 _tokenId) internal {
        require(_to != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(
            owners721[_tokenId] == address(0),
            "ERC721: token already minted"
        );

        owners721[_tokenId] = _to;
        balance721[_to]++;

        emit Transfer(address(0), _to, _tokenId);
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
    ) public onlyFromVoucherKernel {
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
        require(_to != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(_tokenIds.length == _values.length, "MISMATCHED_ARRAY_LENGTHS"); //hex"28" FISSION.code(FISSION.Category.Find, FISSION.Status.Duplicate_Conflict_Collision)

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
    ) public override onlyFromVoucherKernel {
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
        require(_account != address(0), "UNSPECIFIED_ADDRESS"); //"UNSPECIFIED_ADDRESS" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)

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
    ) public onlyFromVoucherKernel {
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
        require(_account != address(0), "UNSPECIFIED_ADDRESS"); //hex"20" FISSION.code(FISSION.Category.Find, FISSION.Status.NotFound_Unequal_OutOfRange)
        require(_tokenIds.length == _values.length, "MISMATCHED_ARRAY_LENGTHS"); //hex"28" FISSION.code(FISSION.Category.Find, FISSION.Status.Duplicate_Conflict_Collision)

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
    function _setMetadataBase(string memory _newBase) public onlyOwner {
        metadataBase = _newBase;
    }

    /**
     * @notice Setting the URL route for ERC1155 tokens metadata
     * @param _newRoute   New route to be used
     */
    function _set1155Route(string memory _newRoute) public onlyOwner {
        metadata1155Route = _newRoute;
    }

    /**
     * @notice Setting the URL route for ERC721 tokens metadata
     * @param _newRoute   New route to be used
     */
    function _set721Route(string memory _newRoute) public onlyOwner {
        metadata721Route = _newRoute;
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

    /**
     * @notice A descriptive name for a collection of NFTs in this contract
     * @dev ERC-721
     */
    function name() external pure returns (string memory _name) {
        return "Boson Smart Voucher";
    }

    /**
     * @notice An abbreviated name for NFTs in this contract
     * @dev ERC-721
     */
    function symbol() external pure returns (string memory _symbol) {
        return "BSV";
    }

    /**
     * @notice A distinct Uniform Resource Identifier (URI) for a given asset.
     * @dev ERC-721
     * Throws if `_tokenId` is not a valid NFT. URIs are defined in RFC 3986. The URI may point to a JSON file that conforms to the "ERC721 Metadata JSON Schema".
     * @param _tokenId  ID of the token
     */
    function tokenURI(uint256 _tokenId) external view returns (string memory) {
        require(owners721[_tokenId] != address(0), "INVALID_ID");
        return
            string(
                abi.encodePacked(metadataBase, metadata721Route, _uint2str(_tokenId))
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
}
