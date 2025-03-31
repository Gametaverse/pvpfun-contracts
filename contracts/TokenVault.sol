// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./VerifySign.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract TokenVault is VerifySign {
    using SafeERC20 for IERC20;

    mapping(uint256 => bool) public usedNonces;

    struct VerifySignData {
        uint64 nonce;
        address token;
        uint256 amount;
        uint64 deadline;
        bytes signature;
    }

    event Claimed(
        uint64 indexed nonce,
        address indexed reciver,
        address token,
        uint256 amount
    );

    event WithdrawFunds(address reciver, address token, uint256 amount);

    constructor(address _authorizer) VerifySign() {
        authorizer = _authorizer;
    }

    function _verifySign(VerifySignData memory sign) internal view {
        address recoveredAddr = recoverAuthorizer(
            keccak256(
                abi.encodePacked(
                    block.chainid,
                    address(this),
                    sign.nonce,
                    msg.sender,
                    sign.token,
                    sign.amount,
                    sign.deadline
                )
            ),
            sign.signature
        );
        require(recoveredAddr == authorizer, "PVP: Invalid signature");
    }

    function claimReward(VerifySignData memory data) public {
        require(
            block.timestamp <= data.deadline,
            "PVP: The signature has expired"
        );
        require(!usedNonces[data.nonce], "PVP: nonce has been used");
        require(data.amount > 0, "PVP: amount must be greater than 0");

        _verifySign(data);
        usedNonces[data.nonce] = true;

        IERC20(data.token).safeTransfer(msg.sender, data.amount);

        emit Claimed(data.nonce, msg.sender, data.token, data.amount);
    }

    function batchClaimReward(VerifySignData[] memory list) public {
        for (uint256 i = 0; i < list.length; i++) {
            claimReward(list[i]);
        }
    }

    function withdrawFunds(address token, uint256 amount) public onlyOwner {
        require(amount > 0, "PVP: amount must be greater than 0");
        IERC20(token).safeTransfer(msg.sender, amount);
        emit WithdrawFunds(msg.sender, token, amount);
    }
}
