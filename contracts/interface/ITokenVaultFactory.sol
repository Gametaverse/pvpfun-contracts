// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITokenVaultFactory {
    function getOwner() external view returns (address);

    function getAuthorizer() external view returns (address);

    function getFeeRate() external view returns (uint256);

    function getLockPeriod() external view returns (uint64);

    function depositEnable() external view returns (bool);

    function withdrawEnable() external view returns (bool);

    function getTokenVault(address _token) external view returns (address);
}
