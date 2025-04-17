// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface ITokenVaultInitializer {
    function initialize(address _token, address _factory) external;
}
