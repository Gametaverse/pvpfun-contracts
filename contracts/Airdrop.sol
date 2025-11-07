// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VerifySignLib.sol";

contract Airdrop is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable TOKEN;

    mapping(uint8 => bytes32) public merkleRoot;

    // bytes32 public merkleRoot;
    mapping(uint8 => mapping(bytes32 => bool)) public claimed;
    mapping(uint8 => bool) public paused;

    event Claimed(
        address indexed user,
        uint8 phase,
        uint256 amount,
        address indexed receiver
    );
    event MerkleRootUpdated(uint8 phase, bytes32 _oldRoot, bytes32 _newRoot);
    event AirdropPaused(uint8 phase, bool state);

    struct SignData {
        address user;
        uint256 amount;
        bytes32[] proof;
        uint64 expiredAt;
        bytes signature;
    }

    constructor(address token) Ownable(_msgSender()) {
        TOKEN = IERC20(token);
    }

    function setMerkleRoot(
        uint8 phase,
        bytes32 _merkleRoot
    ) external onlyOwner {
        bytes32 _oldRoot = merkleRoot[phase];
        merkleRoot[phase] = _merkleRoot;
        emit MerkleRootUpdated(phase, _oldRoot, _merkleRoot);
    }

    function updateAirdropPause(uint8 phase, bool state) external onlyOwner {
        paused[phase] = state;
        emit AirdropPaused(phase, state);
    }

    function withdrawUnclaimedTokens() external onlyOwner {
        uint256 balance = TOKEN.balanceOf(address(this));
        if (balance > 0) {
            TOKEN.safeTransfer(owner(), balance);
        }
    }

    function _claim(
        uint8 phase,
        address user,
        uint256 amount,
        bytes32[] calldata proof,
        address receiver
    ) internal {

        require(!paused[phase], "Airdrop: Airdrop has paused");

        bytes32 leaf = keccak256(abi.encodePacked(phase, user, amount));

        require(!claimed[phase][leaf], "Airdrop: Already claimed");

        require(
            MerkleProof.verify(proof, merkleRoot[phase], leaf),
            "Airdrop: Invalid proof"
        );

        claimed[phase][leaf] = true;

        TOKEN.safeTransfer(receiver, amount);

        emit Claimed(user, phase, amount, receiver);
    }

    function claim(
        uint8 phase,
        uint256 amount,
        bytes32[] calldata proof
    ) public nonReentrant {
        _claim(phase, _msgSender(), amount, proof, _msgSender());
    }

    function multiClaim(
        uint8 phase,
        SignData[] calldata dataList
    ) public nonReentrant {
        require(dataList.length <= 50, "Airdrop: Array too long");

        for (uint i = 0; i < dataList.length; i++) {
            SignData calldata data = dataList[i];

            require(
                block.timestamp < data.expiredAt,
                "Airdrop: Signature expired"
            );

            // verify sign
            _verifySign(data, _msgSender());

            _claim(phase, data.user, data.amount, data.proof, _msgSender());
        }
    }

    function _verifySign(
        SignData calldata data,
        address _expectReciver
    ) internal view {
        bytes32 proofHash = keccak256(abi.encodePacked(data.proof));

        bytes32 msgHash = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                proofHash,
                _expectReciver,
                data.expiredAt
            )
        );

        VerifySignLib.requireValidSignature(data.user, msgHash, data.signature);
    }

    function chainid() public view returns (uint256) {
        return block.chainid;
    }
}
