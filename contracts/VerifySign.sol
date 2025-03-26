// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

contract VerifySign is Ownable {
    //authorizer address
    address public authorizer;

    event AuthorizerChanged(address indexed authorizer);

    constructor() public Ownable(msg.sender) {}

    /// @notice Set authorizer address.
    /// @dev Only owner can execute.
    /// @param _authorizer Authorizer address.
    function setAuthorizer(address _authorizer) external onlyOwner {
        require(
            _authorizer != authorizer && _authorizer != address(0),
            "authorizer not changed or authorizer invalid"
        );
        authorizer = _authorizer;
        emit AuthorizerChanged(_authorizer);
    }

    /// @notice Recover out the autorizer's address by the withdrawal info and the signature.
    /// @param msgHash The valid block, if current block number is higher than this block, the authorization(signature) will be invalid.
    /// @param signature Authorizer's signature.
    function recoverAuthorizer(
        bytes32 msgHash,
        bytes memory signature
    ) internal pure returns (address) {
        bytes32 message = prefixed(msgHash);
        return recoverSigner(message, signature);
    }

    // 'v, r, s', The separating signature information.
    function splitSignature(
        bytes memory sig
    ) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        require(sig.length == 65);

        assembly {
            // first 32 bytes, after the length prefix.
            r := mload(add(sig, 32))
            // second 32 bytes.
            s := mload(add(sig, 64))
            // final byte (first byte of the next 32 bytes).
            v := byte(0, mload(add(sig, 96)))
        }

        return (v, r, s);
    }

    function recoverSigner(
        bytes32 message,
        bytes memory sig
    ) internal pure returns (address) {
        (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);

        return ecrecover(message, v, r, s);
    }

    // Add a prefix, because it will be added when eth_sign is signed.
    function prefixed(bytes32 hash) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
            );
    }
}
