// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./VerifySign.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract Launches is VerifySign {
    using SafeERC20 for IERC20;

    mapping(uint256 => CommitmentData) public gameData;
    mapping(address => address) public tokenVault;

    struct CommitmentData {
        address player;
        uint64 gameID;
        bytes commitment;
        address token;
        uint256 amount;
        uint64 rate;
    }

    struct VerifySignData {
        CommitmentData data;
        uint64 deadline;
        bytes signature;
    }

    event GameStarted(
        uint64 indexed gameID,
        bytes commitment,
        address indexed player,
        address token,
        uint256 amount,
        uint64 rate
    );

    constructor(address _authorizer) VerifySign() {
        authorizer = _authorizer;
    }

    function _verifySign(VerifySignData memory sign) internal view {
        address recoveredAddr = recoverAuthorizer(
            keccak256(
                abi.encodePacked(
                    block.chainid,
                    address(this),
                    sign.data.player,
                    sign.data.gameID,
                    sign.data.commitment,
                    sign.data.token,
                    sign.data.amount,
                    sign.data.rate,
                    sign.deadline
                )
            ),
            sign.signature
        );
        require(recoveredAddr == authorizer, "PVP: Invalid signature");
    }

    function startGame(
        uint64 _gameID,
        bytes memory _commitment,
        address _token,
        uint256 _amount,
        uint64 _rate,
        uint64 _deadline,
        bytes memory _signature
    ) public {
        require(block.number <= _deadline, "PVP: The signature has expired");
        require(
            gameData[_gameID].gameID == 0,
            "PVP: orderID has been completed"
        );
        require(tokenVault[_token] != address(0), "PVP: Token not whitelisted");

        CommitmentData memory data = CommitmentData(
            msg.sender,
            _gameID,
            _commitment,
            _token,
            _amount,
            _rate
        );

        _verifySign(VerifySignData(data, _deadline, _signature));
        gameData[_gameID] = data;

        IERC20(_token).safeTransferFrom(
            msg.sender,
            tokenVault[_token],
            _amount
        );

        emit GameStarted(
            _gameID,
            _commitment,
            data.player,
            data.token,
            data.amount,
            data.rate
        );
    }
}
