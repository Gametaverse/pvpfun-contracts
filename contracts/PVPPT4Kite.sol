// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PVPPT4Kite
 * @dev ERC20 token with a blacklist feature.
 * The owner can add or remove addresses from the blacklist.
 * Blacklisted addresses are restricted from transferring tokens.
 */
contract PVPPT4Kite is ERC20, Ownable {
    uint256 private constant MAX_SUPPLY = 100_000_000 * (10 ** 18);

    mapping(address => bool) private _isBlacklisted;

    /**
     * @dev Thrown when an action involves a blacklisted address.
     * @param account The blacklisted address.
     */
    error AddressBlacklisted(address account);

    event AddedToBlacklist(address indexed account);
    event RemovedFromBlacklist(address indexed account);

    /**
     * @dev Mints the max supply of tokens to the deployer.
     * The deployer of the contract will be the initial owner.
     */
    constructor() ERC20("PVP FUN Points", "PVPPT") Ownable(msg.sender) {
        _mint(msg.sender, MAX_SUPPLY);
    }

    /**
     * @dev Adds an address to the blacklist.
     * @param account The address to add to the blacklist.
     */
    function addToBlacklist(address account) external onlyOwner {
        _isBlacklisted[account] = true;
        emit AddedToBlacklist(account);
    }

    /**
     * @dev Removes an address from the blacklist.
     * @param account The address to remove from the blacklist.
     */
    function removeFromBlacklist(address account) external onlyOwner {
        _isBlacklisted[account] = false;
        emit RemovedFromBlacklist(account);
    }

    /**
     * @dev Returns true if the address is blacklisted, false otherwise.
     * @param account The address to check.
     */
    function isBlacklisted(address account) public view returns (bool) {
        return _isBlacklisted[account];
    }

    /**
     * @dev Hook that is called before any transfer of tokens. This includes
     * minting and burning.
     *
     * Overrides the internal _update function to check for blacklisted addresses.
     *
     * Requirements:
     *
     * - The `from` and `to` addresses cannot be blacklisted.
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        if (_isBlacklisted[_msgSender()]) {
            revert AddressBlacklisted(_msgSender());
        }
        if (_isBlacklisted[from]) {
            revert AddressBlacklisted(from);
        }
        if (_isBlacklisted[to]) {
            revert AddressBlacklisted(to);
        }
        super._update(from, to, value);
    }

    /**
     * @dev Overrides the public `approve` function to prevent approvals
     * involving blacklisted addresses, as recommended by the audit.
     *
     * Requirements:
     * - The token owner (`_msgSender()`) and the `spender` cannot be blacklisted.
     */
    function approve(
        address spender,
        uint256 value
    ) public override returns (bool) {
        if (_isBlacklisted[_msgSender()]) {
            revert AddressBlacklisted(_msgSender());
        }
        if (_isBlacklisted[spender]) {
            revert AddressBlacklisted(spender);
        }
        return super.approve(spender, value);
    }
}
