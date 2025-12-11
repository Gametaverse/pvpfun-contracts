// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AirdropPT4Kite is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint256 public constant amountPerClaim = 2000 * (10 ** 18);
    uint256 public totalClaimedCount;
    uint256 public constant MAX_CLAIMANTS = 1000;

    mapping(address => bool) public hasClaimed;

    event Claimed(address indexed claimant, uint256 amount);
    event Withdrawal(address indexed admin, uint256 amount);

    constructor(address _tokenAddress) Ownable(_msgSender()) {
        require(_tokenAddress != address(0), "Token cannot be zero address");
        token = IERC20(_tokenAddress);
    }

    function claim() public nonReentrant {
        require(
            totalClaimedCount < MAX_CLAIMANTS,
            "Airdrop has ended (Limit reached)"
        );

        require(!hasClaimed[_msgSender()], "You have already claimed");

        uint256 contractBalance = token.balanceOf(address(this));
        require(
            contractBalance >= amountPerClaim,
            "Contract has insufficient funds"
        );

        hasClaimed[_msgSender()] = true;
        totalClaimedCount += 1;

        token.safeTransfer(_msgSender(), amountPerClaim);

        emit Claimed(_msgSender(), amountPerClaim);
    }

    function remainingSlots() public view returns (uint256) {
        if (totalClaimedCount >= MAX_CLAIMANTS) return 0;
        return MAX_CLAIMANTS - totalClaimedCount;
    }

    function withdrawRemainingTokens() public onlyOwner {
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");

        token.safeTransfer(owner(), balance);
        emit Withdrawal(owner(), balance);
    }
}
