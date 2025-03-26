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

    mapping(uint256 => bytes) public gameData;

    struct VerifySignData {
        address player;
        uint64 gameID;
        bytes commitment;
        uint64 deadline;
        bytes signature;
    }

    constructor(address _authorizer) VerifySign() {
        authorizer = _authorizer;
    }

    function _verifySign(VerifySignData memory data) internal view {
        address recoveredAddr = recoverAuthorizer(
            keccak256(
                abi.encodePacked(
                    block.chainid,
                    this,
                    data.player,
                    data.gameID,
                    data.commitment,
                    data.deadline
                )
            ),
            data.signature
        );
        require(recoveredAddr == authorizer, "PVP: Invalid signature");
    }

    function startGame(
        uint64 _gameID,
        bytes memory _commitment,
        uint64 _underblock,
        bytes memory _signature
    ) public {
        require(block.number <= _underblock, "PVP: The signature has expired");
        require(
            gameData[_gameID].length == 0,
            "POT: orderID has been completed"
        );

        _verifySign(
            VerifySignData(
                msg.sender,
                _gameID,
                _commitment,
                _underblock,
                _signature
            )
        );
        gameData[_gameID] = _commitment;
    }
}
