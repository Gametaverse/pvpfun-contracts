// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "solady/src/utils/SafeTransferLib.sol";
import "solady/src/utils/FixedPointMathLib.sol";

import "./VerifySignLib.sol";
import "./interface/ITokenVault.sol";

contract TokenVaultWithNoLP is
    Initializable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable
{
    using SafeERC20 for IERC20;
    using SafeTransferLib for address;
    using FixedPointMathLib for uint256;

    mapping(uint256 => bool) public usedNonces;
    address public authorizer;

    uint256 public constant DENOMINATOR = 10000;

    event Claimed(
        uint64 indexed nonce,
        address indexed reciver,
        address indexed token,
        uint256 amount
    );
    event TransferFunds(address reciver, address token, uint256 amount);
    event AuthorizerChanged(address indexed authorizer);

    event Upgraded(address indexed implementation);

    function initialize() public initializer {
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        __Ownable_init(_msgSender());
    }

    function _authorizeUpgrade(
        address /* _newImplementation */
    ) internal override {
        require(_msgSender() == owner(), "PVP: Only owner can upgrade");
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

    /**
     * @notice Claims a specific amount of tokens by providing a valid signature from the authorizer.
     * @dev The signature must be valid for the given nonce, amount, receiver, and deadline.
     * This allows for off-chain reward calculation and authorization. The authorizer is fetched from the factory.
     * @param data A struct containing the signature, nonce, amount, and other required data.
     * @param receiver The address that will receive the claimed tokens.
     */
    function claimReward(
        VerifySignData memory data,
        address receiver
    ) public nonReentrant {
        _claimReward(data, receiver);
    }

    function _claimReward(
        VerifySignData memory data,
        address receiver
    ) internal {
        require(receiver != address(0), "PVP: Invalid receiver");
        require(
            block.timestamp <= data.deadline,
            "PVP: The signature has expired"
        );
        require(!usedNonces[data.nonce], "PVP: nonce has been used");
        require(data.amount > 0, "PVP: amount must be greater than 0");
        uint256 balance = IERC20(data.token).balanceOf(address(this));
        require(
            balance >= data.amount,
            "PVP: Insufficient balance for transfer"
        );

        _verifySign(data, receiver);
        usedNonces[data.nonce] = true;

        IERC20(data.token).safeTransfer(receiver, data.amount);

        emit Claimed(data.nonce, receiver, data.token, data.amount);
    }

    /**
     * @notice Claims multiple rewards in a single transaction to save gas.
     * @dev Iterates through an array of `VerifySignData` and processes each claim for the same receiver.
     * @param list An array of `VerifySignData` structs for each reward to be claimed.
     * @param reciver The address that will receive all the claimed tokens.
     */
    function batchClaimReward(
        VerifySignData[] memory list,
        address reciver
    ) public nonReentrant {
        for (uint256 i = 0; i < list.length; i++) {
            _claimReward(list[i], reciver);
        }
    }

    /**
     * @notice Allows the factory owner to transfer a specific amount of the underlying token out of the vault.
     * @dev This is an administrative function for managing funds that are not backing LP tokens (e.g., fees, surplus).
     * Only callable by the factory owner.
     * @param receiver The address to receive the funds.
     * @param amount The amount of the underlying token to transfer.
     */
    function transferFunds(
        address token,
        address receiver,
        uint256 amount
    ) public nonReentrant onlyOwner {
        require(amount > 0, "PVP: Amount must be positive");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance >= amount, "PVP: Insufficient balance for transfer");
        IERC20(token).safeTransfer(receiver, amount);
        emit TransferFunds(receiver, token, amount);
    }

    /// @notice Set authorizer address.
    /// @dev Only owner can execute.
    /// @param _authorizer Authorizer address.
    function setAuthorizer(address _authorizer) external onlyOwner {
        require(
            _authorizer != authorizer && _authorizer != address(0),
            "Factory: authorizer not changed or authorizer invalid"
        );
        authorizer = _authorizer;
        emit AuthorizerChanged(_authorizer);
    }

    uint256[40] private __gap;

    function VERSION() external pure returns (uint8) {
        return 2;
    }
}
