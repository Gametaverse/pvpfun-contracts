// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct VerifySignData {
    uint64 nonce;
    uint256 amount;
    uint64 deadline;
    bytes signature;
}

interface ITokenVaultInitializer {
    function initialize(address _token, address _factory) external;

    function claimReward(VerifySignData memory data, address receiver) external;
}
