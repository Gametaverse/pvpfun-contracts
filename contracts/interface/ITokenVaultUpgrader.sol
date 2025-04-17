// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface ITokenVaultUpgrader {
    function upgradeToAndCall(
        address newImplementation,
        bytes memory data
    ) external;
}
