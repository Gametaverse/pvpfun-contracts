// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "solady/src/utils/SafeTransferLib.sol";
import "solady/src/utils/FixedPointMathLib.sol";
import "./VerifySignLib.sol";

contract BscAlphaVault is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using SafeTransferLib for address;
    using FixedPointMathLib for uint256;

    mapping(uint256 => bool) public usedNonces;

    address public authorizer;

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
        address indexed token,
        uint256 amount
    );

    event TransferFunds(address reciver, address token, uint256 amount);
    event AuthorizerChanged(address indexed authorizer);

    constructor(address _authorizer) Ownable(msg.sender) {
        require(_authorizer != address(0), "PVP: Invalid authorizer");
        authorizer = _authorizer;
    }

    function _verifySign(
        VerifySignData memory sign,
        address _expectReciver
    ) internal view {
        bytes32 msgHash = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                sign.nonce,
                _expectReciver,
                sign.token,
                sign.amount,
                sign.deadline
            )
        );
        VerifySignLib.requireValidSignature(
            authorizer,
            msgHash,
            sign.signature
        );
    }

    function claimReward(VerifySignData memory data) public nonReentrant {
        _claimReward(data);
    }

    function _claimReward(VerifySignData memory data) internal {
        require(
            block.timestamp <= data.deadline,
            "PVP: The signature has expired"
        );
        require(!usedNonces[data.nonce], "PVP: nonce has been used");
        require(data.amount > 0, "PVP: amount must be greater than 0");

        _verifySign(data, msg.sender);
        usedNonces[data.nonce] = true;

        IERC20(data.token).safeTransfer(msg.sender, data.amount);

        emit Claimed(data.nonce, msg.sender, data.token, data.amount);
    }

    function batchClaimReward(
        VerifySignData[] memory list
    ) public nonReentrant {
        for (uint256 i = 0; i < list.length; i++) {
            _claimReward(list[i]);
        }
    }

    function transferFunds(
        address token,
        address _receiver,
        uint256 amount
    ) public onlyOwner {
        require(amount > 0, "PVP: Amount must be positive");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance >= amount, "PVP: Insufficient balance for transfer");
        IERC20(token).safeTransfer(_receiver, amount);
        emit TransferFunds(_receiver, token, amount);
    }

    /// @notice Set authorizer address.
    /// @dev Only owner can execute.
    /// @param _authorizer Authorizer address.
    function setAuthorizer(address _authorizer) external onlyOwner {
        require(
            _authorizer != authorizer && _authorizer != address(0),
            "VerifySign: authorizer not changed or authorizer invalid"
        );
        authorizer = _authorizer;
        emit AuthorizerChanged(_authorizer);
    }
}
