// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./interfaces/IVoucherKernel.sol";
import "./interfaces/ICashier.sol";
import "./interfaces/IVouchers.sol";

//preparing for ERC-1066, ERC-1444, EIP-838

/**
 * @title Vouchers implemented as ERC-721
 */
contract Vouchers is IVouchers, ERC721, Ownable, Pausable {
    using Address for address;
    using Strings for uint256;

    //min security
    address private voucherKernelAddress; //address of the VoucherKernel contract
    address private cashierAddress; //address of the Cashier contract
    string private contractUri;

    event LogVoucherKernelSet(address _newVoucherKernel, address _triggeredBy);
    event LogCashierSet(address _newCashier, address _triggeredBy);
    event LogUriSet(string _newUri, address _triggeredBy);
    event LogContractUriSet(string _contractUri, address _triggeredBy);

    modifier onlyFromVoucherKernel() {
        require(msg.sender == voucherKernelAddress, "UNAUTHORIZED_VK");
        _;
    }

    modifier notZeroAddress(address _address) {
        require(_address != address(0), "ZERO_ADDRESS");
        _;
    }

    /**
     * @notice Construct and initialze the contract. 
     * @param baseURI_ base metadata uri
     * @param name_ token name
     * @param symbol_ token symbol
     * @param _cashierAddress address of the associated Cashier contract
     * @param _voucherKernelAddress address of the associated Voucher Kernel contract
     */
    constructor(string memory baseURI_, string memory name_, string memory symbol_, address _cashierAddress, address _voucherKernelAddress) 
        ERC721(name_, symbol_) notZeroAddress(_cashierAddress) notZeroAddress(_voucherKernelAddress)
    {
        _setBaseURI(baseURI_);

        cashierAddress = _cashierAddress;
        voucherKernelAddress = _voucherKernelAddress;
    }

    /**
     * @notice Pause the process of interaction with voucherID's (ERC-721), in case of emergency.
     * Only BR contract is in control of this function.
     */
    function pause() external override onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the process of interaction with voucherID's (ERC-721).
     * Only BR contract is in control of this function.
     */
    function unpause() external override onlyOwner {
        _unpause();
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
    ) public override (ERC721, IERC721)  
    {
        transferFrom(_from, _to, _tokenId);

        _doSafeTransferAcceptanceCheck(
            _from,
            _to,
            _tokenId,
            _data
        );
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
    ) public 
      override (ERC721, IERC721) 
    {
        super.transferFrom(_from, _to, _tokenId);
        require(IVoucherKernel(voucherKernelAddress).isVoucherTransferable(_tokenId), "FUNDS_RELEASED");

        ICashier(cashierAddress).onVoucherTransfer(
            _from,
            _to,
            _tokenId
        );
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
        super._mint(_to, _tokenId);
        _doSafeTransferAcceptanceCheck(
            address(0),
            _to,
            _tokenId,
            ""
        );
        return true;
    }

    /* Burning ERC-721 is not allowed, as a voucher (being an ERC-721 token) has a final state and shouldn't be destroyed. */

    // // // // // // // //
    // METADATA EXTENSIONS
    // // // // // // // //

    /**
     * @notice Setting the URL prefix for tokens metadata
     * @param _newUri   New prefix to be used
     */

    function setTokenURI(string memory _newUri) external onlyOwner {
        require(bytes(_newUri).length != 0, "INVALID_VALUE");
        super._setBaseURI(_newUri);
        emit LogUriSet(_newUri, _msgSender());
    }

    /**
     * @notice Setting a contractURI for OpenSea collections integration.
     * @param _contractUri   The contract URI to be used
     */
    function setContractUri(string memory _contractUri) external onlyOwner {
        require(bytes(_contractUri).length != 0, "INVALID_VALUE");
        contractUri = _contractUri;
        emit LogContractUriSet(_contractUri, _msgSender());
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
        whenPaused
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
        whenPaused
    {
        cashierAddress = _cashierAddress;
        emit LogCashierSet(_cashierAddress, msg.sender);
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

    /**
     * @notice Check successful transfer if recipient is a contract
     * @dev ERC-721
     * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.4.0-rc.0/contracts/token/ERC721/ERC721.sol
     * @param _from     Address of sender
     * @param _to       Address of recipient
     * @param _tokenId  ID of the token
     * @param _data     Optional data
     */
    function _doSafeTransferAcceptanceCheck(
        address _from,
        address _to,
        uint256 _tokenId,
        bytes memory _data
    ) internal {
        if (_to.isContract()) {
            try IERC721Receiver(_to).onERC721Received(_msgSender(), _from, _tokenId, _data) returns (bytes4 response) {
                if (response != IERC721Receiver.onERC721Received.selector) {
                    revert("ERC721: transfer to non ERC721Receiver implementer");
                }
            } catch Error(string memory reason) {
                revert(reason);
            } catch {
                revert("ERC721: transfer to non ERC721Receiver implementer");
            }
        }
    }

    /**
     * @notice Get the contractURI for Opensea collections integration
     * @return Contract URI
     */
    function contractURI() public view returns (string memory) {
        return contractUri;
    }
}
