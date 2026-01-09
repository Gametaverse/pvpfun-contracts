// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title PVPToken
 * @dev ERC20 token with a blacklist feature.
 * The owner can add or remove addresses from the blacklist.
 * Blacklisted addresses are restricted from transferring tokens.
 */
contract PVPToken4Spoke is ERC20, Ownable, AccessControl, ERC20Burnable {
    uint256 public constant MAX_SUPPLY = 100_000_000 * 1e18;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    mapping(address => bool) private _isBlacklisted;

    /**
     * @dev Thrown when an action involves a blacklisted address.
     * @param account The blacklisted address.
     */
    error AddressBlacklisted(address account);
    error MaxSupplyExceeded(uint256 attempted, uint256 maxSupply);

    event AddedToBlacklist(address indexed account);
    event RemovedFromBlacklist(address indexed account);

    /**
     * @dev Mints the max supply of tokens to the deployer.
     * The deployer of the contract will be the initial owner.
     */
    constructor() ERC20("Pvpfun", "PVP") Ownable(_msgSender()) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
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
     * @dev Mint tokens on spoke chain.
     * Callable only by authorized bridge (NTT Spoke).
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert MaxSupplyExceeded(totalSupply() + amount, MAX_SUPPLY);
        }
        _mint(to, amount);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`)
     * and synchronizes the `DEFAULT_ADMIN_ROLE`.
     *
     * This function updates both:
     * - the owner used by `onlyOwner` (Ownable), and
     * - the administrator of AccessControl roles (`DEFAULT_ADMIN_ROLE`).
     *
     * The old owner will have `DEFAULT_ADMIN_ROLE` revoked,
     * and the new owner will be granted `DEFAULT_ADMIN_ROLE`.
     *
     * Requirements:
     *
     * - Caller must be the current owner.
     * - `newOwner` cannot be the zero address.
     *
     * Effects:
     *
     * - Ownership is transferred to `newOwner`.
     * - `DEFAULT_ADMIN_ROLE` is granted to `newOwner`.
     * - `DEFAULT_ADMIN_ROLE` is revoked from the previous owner.
     */
    function transferOwnership(address newOwner) public override onlyOwner {
        address oldOwner = owner();

        super.transferOwnership(newOwner);

        _grantRole(DEFAULT_ADMIN_ROLE, newOwner);
        _revokeRole(DEFAULT_ADMIN_ROLE, oldOwner);
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
