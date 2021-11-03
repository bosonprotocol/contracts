// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IVoucherKernel.sol";
import "./interfaces/IVoucherSets.sol";
import "./interfaces/ICashier.sol";

//preparing for ERC-1066, ERC-1444, EIP-838

/**
 * @title Voucher sets implemented as ERC-1155
 */
contract VoucherSets is IVoucherSets, ERC1155, Ownable, Pausable {
 
    address private voucherKernelAddress; //address of the VoucherKernel contract
    address private cashierAddress; //address of the Cashier contract
    string private contractUri;

    event LogVoucherKernelSet(address _newVoucherKernel, address _triggeredBy);
    event LogCashierSet(address _newCashier, address _triggeredBy);
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
     * @param _uri metadata uri
     * @param _cashierAddress address of the associated Cashier contract
     * @param _voucherKernelAddress address of the associated Voucher Kernel contract
     */
    constructor(string memory _uri, address _cashierAddress, address _voucherKernelAddress) ERC1155(_uri) notZeroAddress(_cashierAddress) notZeroAddress(_voucherKernelAddress)  {
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
    public
    override (ERC1155, IERC1155)
    {
        require(balanceOf(_from, _tokenId) == _value, "IQ"); //invalid qty
        super.safeTransferFrom(_from, _to, _tokenId, _value, _data);
        ICashier(cashierAddress).onVoucherSetTransfer(
            _from,
            _to,
            _tokenId,
            _value
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
    )  
        public
        override (ERC1155, IERC1155)
    {

        //Thes checks need to be called first. Code is duplicated, but super.safeBatchTransferFrom
        //must be called at the end because otherwise the balance check in the loop will always fail
        require(_tokenIds.length == _values.length, "ERC1155: ids and amounts length mismatch");
        require(_to != address(0), "ERC1155: transfer to the zero address");
        require(
            _from == _msgSender() || isApprovedForAll(_from, _msgSender()),
            "ERC1155: transfer caller is not owner nor approved"
        );
   
       

        //This is inefficient because it repeats the loop in ERC1155.safeBatchTransferFrom. However,
        //there is no other good way to call the Boson Protocol cashier contract inside the loop.
        //Doing a full override by copying the ERC1155 code doesn't work because the _balances mapping
        //is private instead of internal and can't be accesssed from this child contract

        for (uint256 i = 0; i < _tokenIds.length; ++i) {
            uint256 tokenId = _tokenIds[i];
            uint256 value = _values[i];

            //A voucher set's quantity cannot be partionally transferred. It's all or nothing
            require(balanceOf(_from, tokenId) == value, "IQ"); //invalid qty

            ICashier(cashierAddress).onVoucherSetTransfer(
                _from,
                _to,
                tokenId,
                value
            );
        }

        super.safeBatchTransferFrom(_from, _to, _tokenIds, _values, _data);
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

    // // // // // // // //
    // METADATA EXTENSIONS
    // // // // // // // //

    /**
     * @dev Sets a new URI for all token types, by relying on the token type ID
     * substitution mechanism
     * https://eips.ethereum.org/EIPS/eip-1155#metadata[defined in the EIP].
     *
     * By this mechanism, any occurrence of the `\{id\}` substring in either the
     * URI or any of the amounts in the JSON file at said URI will be replaced by
     * clients with the token type ID.
     *
     * For example, the `https://token-cdn-domain/\{id\}.json` URI would be
     * interpreted by clients as
     * `https://token-cdn-domain/000000000000000000000000000000000000000000000000000000000004cce0.json`
     * for token type ID 0x4cce0.
     *
     * See {uri}.
     *
     * Because these URIs cannot be meaningfully represented by the {URI} event,
     * this function emits no events.
     * @param _newUri   New uri to be used
     */
    function setUri(string memory _newUri) external onlyOwner {
        _setURI(_newUri);
    }

    /**
     * @notice Setting a contractURI for OpenSea collections integration.
     * @param _contractUri   The contract URI to be used
     */
    function setContractUri(string memory _contractUri) external onlyOwner {
        require(bytes(_contractUri).length != 0, "INVALID_VALUE");
        contractUri = _contractUri;
        emit LogContractUriSet(_contractUri, msg.sender);
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
     * @notice Get the contractURI for Opensea collections integration
     * @return Contract URI
     */
    function contractURI() public view returns (string memory) {
        return contractUri;
    }
}
