// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title VerifySignLib
 * @notice A library for verifying Ethereum signed messages against a known authorizer address.
 */
library VerifySignLib {
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

    /**
     * @notice Verifies if the signature corresponds to the expected authorizer for the given message hash.
     * @param authorizer The expected signer address (the authorizer).
     * @param msgHash The keccak256 hash of the message data.
     * @param signature The ECDSA signature bytes.
     * @return True if the signer is the authorizer, false otherwise (or reverts on invalid signature).
     * @dev Convenience function combining recovery and comparison.
     */
    function verifySignature(
        address authorizer,
        bytes32 msgHash,
        bytes memory signature
    ) internal pure returns (bool) {
        address recoveredSigner = recoverAuthorizer(msgHash, signature);
        return recoveredSigner == authorizer;
    }

    /**
     * @notice Verifies if the signature corresponds to the expected authorizer. Reverts if not.
     * @param authorizer The expected signer address (the authorizer).
     * @param msgHash The keccak256 hash of the message data.
     * @param signature The ECDSA signature bytes.
     * @dev Similar to verifySignature, but reverts on mismatch instead of returning false.
     */
    function requireValidSignature(
        address authorizer,
        bytes32 msgHash,
        bytes memory signature
    ) internal pure {
        require(
            verifySignature(authorizer, msgHash, signature),
            "VerifySignLib: Invalid signature"
        );
    }
}
