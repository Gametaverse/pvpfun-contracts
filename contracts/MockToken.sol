// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // Optional: if you want minting controlled

// A simple mock ERC20 token for testing purposes
contract MockERC20 is ERC20, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {}

    /**
     * @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply. Only callable by the owner.
     */
    function mint(address account, uint256 amount) public onlyOwner {
        _mint(account, amount);
    }

    // You can add burn functions or other features if needed for tests
}
