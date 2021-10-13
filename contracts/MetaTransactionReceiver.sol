// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";

/*
 * This contract accepts metatransactions signed by the Owner.
 * The signature of the Owner is verfied on chain and as a result 
 * the metatransactions can be sent to the network by any EOA
 */
contract MetaTransactionReceiver is Ownable {

    using ECDSA for bytes32;

    mapping(uint256 => bool) private usedNonce;

    event ExecutedMetaTransaction(bytes _data, bytes _returnData);
    event UsedNonce(uint256 _nonce);

    /// @dev Checks if the caller of the method is the contract itself
    modifier onlyOwnerOrSelf() {
        require(msg.sender == owner() || msg.sender == address(this), "UNAUTHORIZED_O_SELF");
        _;
    }

    /// @dev This function allows for anyone to relay transactions on the owner's behalf. The owner's signature is verified onchain.
    /// @param _nonce only used for relayed transactions. This is used as an idempotency key
    /// @param _data abi encoded data payload.
    /// @param _signature signed prefix + data.
    function executeMetaTransaction(
        uint256 _nonce,
        bytes calldata _data,
        bytes calldata _signature
    ) external {
        // Expecting prefixed data ("boson:") indicating relayed transaction...
        // ...and an Ethereum Signed Message to protect user from signing an actual Tx
        require(!usedNonce[_nonce], "METATX_NONCE");

        uint256 id;
        assembly {
            id := chainid() //1 for Ethereum mainnet, > 1 for public testnets.
        }
        bytes32 dataHash = keccak256(abi.encodePacked("boson:", id, address(this), _nonce, _data)).toEthSignedMessageHash();
        // Verify signature validity i.e. signer == owner
        isValidOwnerSignature(dataHash, _signature);
        // Verify that the nonce hasn't been used before
        

        // Store the nonce provided to avoid playback of the same tx
        usedNonce[_nonce] = true;

        emit UsedNonce(_nonce);

        // invoke local function with an external call
        (bool success, bytes memory returnData) = address(this).call(_data);
        require(success, string(returnData));

        emit ExecutedMetaTransaction(_data, returnData);
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

}
