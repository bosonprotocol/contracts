// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./EIP712Base.sol";

import "hardhat/console.sol";

/*
 * This contract accepts metatransactions signed by the Owner.
 * The signature of the Owner is verfied on chain and as a result 
 * the metatransactions can be sent to the network by any EOA
 */
contract MetaTransactionEIP712Receiver is Ownable, EIP712Base {

    using ECDSA for bytes32;

    struct MetaTransaction {
      uint256 nonce;
      address from;
      address contractAddress;
      string functionName;
      uint256 tokenIdSupply;
      bytes functionSignature;
    }

    bytes32 private constant META_TRANSACTION_TYPEHASH = keccak256(
      bytes(
          "MetaTransaction(uint256 nonce,address from,address contractAddress,string functionName,uint256 tokenIdSupply,bytes functionSignature)"
      )
    );

    mapping(uint256 => bool) private usedNonce;

    event ExecutedMetaTransaction(bytes _data, bytes _returnData);
    event UsedNonce(uint256 _nonce);

    /// @dev Checks if the caller of the method is the contract itself
    modifier onlyOwnerOrSelf() {
        require(_msgSender() == owner(), "UNAUTHORIZED_O_SELF");
        _;
    }

    constructor(string memory name) EIP712Base(name) {
    }

    function executeMetaTransaction(
        uint256 _nonce,
        address _signer,
        bytes calldata _data,
        bytes calldata _signature
    ) external {
        // Expecting prefixed data ("boson:") indicating relayed transaction...
        // ...and an Ethereum Signed Message to protect user from signing an actual Tx
        require(!usedNonce[_nonce], "METATX_NONCE");

        bytes4 functionPrefix;
        uint256 tokenIdSupply;
        bytes memory data = _data;
        assembly {
          // 0x20 needs to be added to the bytes array because the first slot contains the array length
          functionPrefix := and(mload(add(data, 0x20)), 0xffffffff00000000000000000000000000000000000000000000000000000000)
          // Add again 4 bytes to get the tokenIdSupply
          tokenIdSupply := mload(add(data, 0x24))
        }
        console.log("executeMetaTransaction() --> functionPrefix");
        console.logBytes4(functionPrefix);
        console.log("executeMetaTransaction() --> tokenIdSupply");
        console.log(tokenIdSupply);

        uint256 id;
        assembly {
            id := chainid() //1 for Ethereum mainnet, > 1 for public testnets.
        }
        MetaTransaction memory metaTx = MetaTransaction({
            nonce: _nonce,
            from: _signer,
            contractAddress: address(this),
            functionName: "requestVoucher",
            tokenIdSupply: tokenIdSupply,
            functionSignature: _data
        });
        require(
            verifySigner(_signer, metaTx, _signature),
            "Signer and signature do not match"
        );

        // Store the nonce provided to avoid playback of the same tx
        usedNonce[_nonce] = true;

        emit UsedNonce(_nonce);

        // invoke local function with an external call
        // appending _signer at the end to extract it from calling context
        (bool success, bytes memory returnData) = address(this).call(abi.encodePacked(_data, _signer));
        require(success, string(returnData));

        emit ExecutedMetaTransaction(_data, returnData);
    }

   function verifySigner(
        address signer,
        MetaTransaction memory metaTx,
        bytes memory _signature
    ) internal view returns (bool) {
        require(signer != address(0), "NativeMetaTransaction: INVALID_SIGNER");
        bytes32 hash = toTypedMessageHash(hashMetaTransaction(metaTx));
        address recover = hash.recover(_signature);
        return (signer == recover);
    }
    function hashMetaTransaction(MetaTransaction memory metaTx)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    META_TRANSACTION_TYPEHASH,
                    metaTx.nonce,
                    metaTx.from,
                    metaTx.contractAddress,
                    keccak256(bytes(metaTx.functionName)),
                    metaTx.tokenIdSupply,
                    keccak256(metaTx.functionSignature)
                )
            );
    }


    /// @dev Tells if nonce was used already
    /// @param _nonce only used for relayed transactions. This is used as an idempotency key
    /// @return true if used already, otherwise false
    function isUsedNonce(uint256 _nonce) external view returns(bool) {
        return usedNonce[_nonce];
    }

    /// @dev This method ensures that the signature belongs to the owner
    /// @param _hashedData Hashed data signed on the behalf of address(this)
    /// @param _signature Signature byte array associated with _dataHash
    function isValidOwnerSignature(bytes32 _hashedData, bytes memory _signature) public view {
        address from = _hashedData.recover(_signature);
        require(owner() == from, "METATX_UNAUTHORIZED");
    }

    function _msgSender() internal view virtual override returns (address payable) {
        if(msg.sender == address(this)) {
            bytes memory array = msg.data;
            uint256 index = msg.data.length;
            address payable sender;
            assembly {
                // Load the 32 bytes word from memory with the address on the lower 20 bytes, and mask those.
                sender := and(mload(add(array, index)), 0xffffffffffffffffffffffffffffffffffffffff)
            }
            return sender;
        } else {
            return msg.sender;
        }
    }

}
