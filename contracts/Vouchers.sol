// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./interfaces/IVoucherKernel.sol";
import "./interfaces/ICashier.sol";
import "./interfaces/IVouchers.sol";

//preparing for ERC-1066, ERC-1444, EIP-838

/**
 * @title Vouchers implemented as ERC-721
 */
// TODO: inherit from OZ ERC721 and remove state vars and local implementations of IERC721
// taking care to be sure that no "special" stuff happening in this implementation gets lost
contract Vouchers is IVouchers, Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using Address for address;

    string public override name = "Boson Smart Voucher";
    string public override symbol = "BSV";

    //min security
    address private voucherKernelAddress; //address of the VoucherKernel contract
    address private cashierAddress; //address of the Cashier contract
    
    //standard reqs
    //ERC-721
    mapping(address => uint256) private balance721;
    mapping(uint256 => address) private owners721;
    mapping(uint256 => address) private operator721;

    
    mapping(address => mapping(address => bool)) private operatorApprovals; //approval of accounts of an operator
    string internal metadataBase;
    string internal metadata721Route;

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
    ) external override {
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
                IERC721Receiver(_to).onERC721Received(
                    _from,
                    _to,
                    _tokenId,
                    _data
                ) == IERC721Receiver(_to).onERC721Received.selector,
                "UNSUPPORTED_ERC721_RECEIVED"
            );
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
        );

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
    ) internal nonReentrant {
        require(ownerOf(_tokenId) == _from, "UNAUTHORIZED_T");
        require(_to != address(0), "UNSPECIFIED_ADDRESS");

        operator721[_tokenId] = address(0);

        balance721[_from]--;
        balance721[_to]++;

        owners721[_tokenId] = _to;

        require(IVoucherKernel(voucherKernelAddress).isVoucherTransferable(_tokenId), "FUNDS_RELEASED");

        ICashier(cashierAddress).onVoucherTransfer(
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
    function approve(address _to, uint256 _tokenId) external override {
        address tokenOwner = ownerOf(_tokenId);
        require(_to != tokenOwner, "REDUNDANT_CALL");

        require(
            msg.sender == tokenOwner ||
                operatorApprovals[tokenOwner][msg.sender], // isApprovedForAll(owner, msg.sender),
            "UNAUTHORIZED_A"
        );
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
        external
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

    /// @notice Count all NFTs assigned to an owner
    /// @dev ERC-721
    /// @param _tokenOwner An address for whom to query the balance
    /// @return The number of NFTs owned by `_owner`, possibly zero
    function balanceOf(address _tokenOwner) external view override returns (uint256) {
        require(_tokenOwner != address(0), "UNSPECIFIED_ADDRESS");

        return balance721[_tokenOwner];
    }

    /**
     * @notice Gets the owner of the specified token ID.
     * @dev ERC-721
     * @param _tokenId uint256 ID of the token to query the owner of
     * @return address currently marked as the owner of the given token ID
     */
    function ownerOf(uint256 _tokenId) public view override returns (address) {
        address tokenOwner = owners721[_tokenId];
        require(tokenOwner != address(0), "UNDEFINED_OWNER");

        return tokenOwner;
    }

    /**
     * @notice Approves or unapproves the operator.
     * will revert if the caller attempts to approve itself as it is redundant
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
            _interfaceId == 0x80ac58cd || //ERC-721
            _interfaceId == 0x5b5e139f;   //ERC-721 metadata extension
    }

    /**
     * @notice Function to mint tokens.
     * @dev ERC-721
     * @param _to The address that will receive the minted tokens.
     * @param _tokenId The token id to mint.
     * @return A boolean that indicates if the operation was successful.
     */
    function mint(address _to, uint256 _tokenId)
        external
        override
        onlyFromVoucherKernel
        returns (bool)
    {
        _mint(_to, _tokenId);
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
        require(_to != address(0), "UNSPECIFIED_ADDRESS");
        require(
            owners721[_tokenId] == address(0),
            "ERC721: token already minted"
        );

        owners721[_tokenId] = _to;
        balance721[_to]++;

        emit Transfer(address(0), _to, _tokenId);
    }


    /* Burning ERC-721 is not allowed, as a voucher (being an ERC-721 token) has a final state and shouldn't be destroyed. */

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
     * @notice Setting the URL route for ERC721 tokens metadata
     * @param _newRoute   New route to be used
     */
    function _set721Route(string memory _newRoute) external onlyOwner {
        metadata721Route = _newRoute;
    }

    /**
     * @notice A distinct Uniform Resource Identifier (URI) for a given asset.
     * @dev ERC-721
     * Throws if `_tokenId` is not a valid NFT. URIs are defined in RFC 3986. The URI may point to a JSON file that conforms to the "ERC721 Metadata JSON Schema".
     * @param _tokenId  ID of the token
     */
    function tokenURI(uint256 _tokenId) external override view returns (string memory) {
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
