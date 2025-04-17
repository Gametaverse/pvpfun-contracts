// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./VerifySignLib.sol";
import {VerifySignData as TokenVaultVerifySignData, ITokenVaultInitializer} from "./interface/ITokenVault.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract Launches is Ownable {
    using SafeERC20 for IERC20;

    mapping(uint256 => CommitmentData) public gameData;
    mapping(address => address) public tokenVault;
    address public authorizer;

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
        address indexed token,
        uint256 amount,
        uint64 rate
    );

    event TokenVaultSet(
        address indexed token,
        address indexed oldVault,
        address indexed newVault
    );

    event TokenVaultRemoved(address indexed token, address indexed oldVault);
    event AuthorizerChanged(address indexed authorizer);

    constructor(address _authorizer) Ownable(msg.sender) {
        require(
            _authorizer != address(0),
            "Launches: Invalid initial authorizer"
        );
        authorizer = _authorizer;
    }

    function _verifySign(VerifySignData memory sign) internal view {
        bytes32 msgHash = keccak256(
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
        );

        VerifySignLib.requireValidSignature(
            authorizer,
            msgHash,
            sign.signature
        );
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
        require(
            block.timestamp <= _deadline,
            "Launches: The signature has expired"
        );
        require(
            gameData[_gameID].gameID == 0,
            "Launches: gameID has been completed"
        );
        require(
            tokenVault[_token] != address(0),
            "Launches: Token not whitelisted"
        );
        require(_amount > 0, "Launches: Amount must be greater than zero");

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

    function startGameAndClaimReward(
        uint64 _gameID,
        bytes memory _commitment,
        address _token,
        uint256 _amount,
        uint64 _rate,
        uint64 _deadline,
        bytes memory _signature,
        TokenVaultVerifySignData memory data
    ) public {
        startGame(
            _gameID,
            _commitment,
            _token,
            _amount,
            _rate,
            _deadline,
            _signature
        );

        ITokenVaultInitializer(tokenVault[data.token]).claimReward(
            data,
            msg.sender
        );
    }

    // --- Vault Management Functions (Only Owner) ---

    /**
     * @dev Sets or updates the vault address for a given token.
     * Only the contract owner can call this function.
     * @param _token The address of the ERC20 token.
     * @param _vault The address where tokens of type `_token` should be sent.
     */
    function setTokenVault(address _token, address _vault) public onlyOwner {
        require(_token != address(0), "Launches: Token address cannot be zero");
        require(_vault != address(0), "Launches: Vault address cannot be zero");

        address oldVault = tokenVault[_token];
        tokenVault[_token] = _vault;

        emit TokenVaultSet(_token, oldVault, _vault);
    }

    /**
     * @dev Removes the vault address associated with a given token.
     * After removal, `startGame` will fail for this token until a new vault is set.
     * Only the contract owner can call this function.
     * @param _token The address of the ERC20 token whose vault should be removed.
     */
    function removeTokenVault(address _token) public onlyOwner {
        require(_token != address(0), "Launches: Token address cannot be zero");

        address oldVault = tokenVault[_token];
        require(
            oldVault != address(0),
            "Launches: Vault for this token does not exist"
        );

        delete tokenVault[_token]; // Set the vault address back to zero

        emit TokenVaultRemoved(_token, oldVault);
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
