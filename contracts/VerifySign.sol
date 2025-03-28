// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

abstract contract VerifySign is Ownable {
    //authorizer address
    address public authorizer;

    event AuthorizerChanged(address indexed authorizer);

    constructor() Ownable(msg.sender) {}

    /// @notice Set authorizer address.
    /// @dev Only owner can execute.
    /// @param _authorizer Authorizer address.
    function setAuthorizer(address _authorizer) external onlyOwner {
        require(
            _authorizer != authorizer && _authorizer != address(0),
            "VerifySign: authorizer not changed or authorizer invalid"
        );
        authorizer = _authorizer;
        emit AuthorizerChanged(_authorizer);
    }

    /**
     * @notice Recovers the signer's address from a message hash and signature using ECDSA.recover to prevent malleability.
     * @param msgHash The keccak256 hash of the message data that was signed (without the eth_sign prefix).
     * @param signature The ECDSA signature bytes (usually 65 bytes).
     * @return The address of the signer, or reverts on invalid signature.
     * @dev This function expects the signature to correspond to the eth_sign standard (prefixed hash).
     */
    function recoverAuthorizer(
        bytes32 msgHash,
        bytes memory signature
    ) internal pure returns (address) {
        // add the "\x19Ethereum Signed Message:\n32" prefix
        bytes32 prefixedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );

        // Use OZ's recover function which prevents signature malleability
        // It will revert with specific errors (e.g., ECDSAInvalidSignature) on failure
        address recoveredSigner = ECDSA.recover(prefixedHash, signature);

        // Ensure the recovered signer is not the zero address (although ECDSA.recover usually handles this)
        require(
            recoveredSigner != address(0),
            "VerifySign: ECDSA recovery failed"
        );

        return recoveredSigner;
    }
}
