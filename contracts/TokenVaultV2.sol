// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "solady/src/utils/LibClone.sol";
import "solady/src/utils/SafeTransferLib.sol";
import "solady/src/utils/FixedPointMathLib.sol";

import "./VerifySignLib.sol";
import "./interface/ITokenVaultFactory.sol";
import "hardhat/console.sol";

contract TokenVaultV2 is
    Initializable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;
    using SafeTransferLib for address;
    using FixedPointMathLib for uint256;

    mapping(uint256 => bool) public usedNonces;

    ITokenVaultFactory public factory;
    uint256 public constant DENOMINATOR = 10000;

    uint256 public totalShares;
    address public token;

    mapping(address => Banker) public bankers;

    struct VerifySignData {
        uint64 nonce;
        uint256 amount;
        uint64 deadline;
        bytes signature;
    }

    // Banker 结构体保持不变
    struct Banker {
        uint256 shares;
        uint256 lastActionTime;
    }

    // 事件保持不变
    event Claimed(
        uint64 indexed nonce,
        address indexed reciver,
        address indexed token,
        uint256 amount
    );
    event TransferFunds(address reciver, address token, uint256 amount);
    event Deposit(
        address indexed depositor,
        address indexed receiver,
        uint256 assetsDeposited,
        uint256 sharesMinted,
        uint256 blockTimestamp
    );
    event Withdraw(
        address indexed owner,
        address indexed receiver,
        uint256 assetsWithdrawn,
        uint256 sharesBurned,
        uint256 blockTimestamp
    );
    event Upgraded(address indexed implementation); // UUPS 事件

    function initialize(
        address _tokenAddr,
        address _factoryAddr
    ) public initializer {
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        require(_factoryAddr != address(0), "PVP: Invalid authorizer");
        factory = ITokenVaultFactory(_factoryAddr);

        require(_tokenAddr != address(0), "PVP: Invalid token");
        token = _tokenAddr;
    }

    function _authorizeUpgrade(
        address /* _newImplementation */
    ) internal override {
        require(
            msg.sender == factory.getOwner() || msg.sender == address(factory),
            "PVP: Only factory can upgrade"
        );
    }

    function _verifySign(
        VerifySignData memory sign,
        address _expectReciver
    ) internal view {
        bytes32 msgHash = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this), // 验证的是代理合约地址
                sign.nonce,
                _expectReciver,
                token, // 使用状态变量 token
                sign.amount,
                sign.deadline
            )
        );
        VerifySignLib.requireValidSignature(
            factory.getAuthorizer(),
            msgHash,
            sign.signature
        );
    }

    // nonReentrant modifier 来自 ReentrancyGuardUpgradeable
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

        IERC20(token).safeTransfer(msg.sender, data.amount);

        emit Claimed(data.nonce, msg.sender, token, data.amount);
    }

    function batchClaimReward(
        VerifySignData[] memory list
    ) public nonReentrant {
        for (uint256 i = 0; i < list.length; i++) {
            _claimReward(list[i]);
        }
    }

    function transferFunds(
        address _receiver,
        uint256 amount
    ) public nonReentrant {
        require(
            msg.sender == factory.getOwner(),
            "PVP: Only owner can transfer"
        );
        require(amount > 0, "PVP: Amount must be positive");
        uint256 balance = currentAssets();
        require(balance >= amount, "PVP: Insufficient balance for transfer");
        IERC20(token).safeTransfer(_receiver, amount);
        emit TransferFunds(_receiver, token, amount);
    }

    function deposit(
        address _receiver,
        uint256 _assets
    ) external nonReentrant returns (uint256 sharesMinted) {
        require(_assets > 0, "PVP: Deposit amount must be positive");
        require(
            _receiver != address(0),
            "PVP: Receiver cannot be zero address"
        );
        require(factory.depositEnable(), "PVP: Deposit not enabled");

        uint256 currentTotalShares = totalShares;
        uint256 currentTotalAssets = currentAssets(); // 读取转账前的余额

        if (currentTotalShares == 0 || currentTotalAssets == 0) {
            sharesMinted = _assets;
        } else {
            sharesMinted = _assets.rawMul(currentTotalShares).rawDiv(
                currentTotalAssets
            );
        }
        require(sharesMinted > 0, "PVP: Shares calculated to zero");

        IERC20(token).safeTransferFrom(msg.sender, address(this), _assets);

        totalShares = currentTotalShares.rawAdd(sharesMinted);
        Banker storage banker = bankers[_receiver];
        banker.shares = banker.shares.rawAdd(sharesMinted);
        banker.lastActionTime = uint64(block.timestamp);

        emit Deposit(
            msg.sender,
            _receiver,
            _assets,
            sharesMinted,
            block.timestamp
        );
    }

    function withdrawAll(
        address _receiver
    ) external nonReentrant returns (uint256 assetsWithdrawn) {
        require(factory.withdrawEnable(), "PVP: Withdraw not enabled");
        uint256 sharesToWithdraw = bankers[msg.sender].shares;
        require(sharesToWithdraw > 0, "PVP: No shares to withdraw");
        assetsWithdrawn = _withdraw(msg.sender, _receiver, sharesToWithdraw);
    }

    function withdraw(
        address _receiver,
        uint256 _shares
    ) external nonReentrant returns (uint256 assetsWithdrawn) {
        require(factory.withdrawEnable(), "PVP: Withdraw not enabled");
        require(_shares > 0, "PVP: Shares must be positive");
        assetsWithdrawn = _withdraw(msg.sender, _receiver, _shares);
    }

    function _withdraw(
        address _owner,
        address _receiver,
        uint256 _shares
    ) internal returns (uint256 assetsToWithdraw) {
        Banker storage banker = bankers[_owner];
        require(banker.shares >= _shares, "PVP: Insufficient shares");

        uint256 currentTotalAssets = currentAssets();
        assetsToWithdraw = _shares.rawMul(currentTotalAssets).rawDiv(
            totalShares
        );

        uint256 feeRate = factory.getFeeRate();
        if (feeRate != 0) {
            uint64 lockPeriod = factory.getLockPeriod();
            uint256 endTime = uint256(banker.lastActionTime).rawAdd(lockPeriod); // 显式转换
            if (endTime > block.timestamp) {
                uint256 fee = assetsToWithdraw.rawMul(feeRate).rawDiv(
                    DENOMINATOR
                );
                assetsToWithdraw = assetsToWithdraw.rawSub(fee);
            }
        }
        require(
            assetsToWithdraw > 0,
            "PVP: Calculated withdraw amount is zero"
        );

        banker.shares = banker.shares.rawSub(_shares);
        totalShares = totalShares.rawSub(_shares);

        IERC20(token).safeTransfer(_receiver, assetsToWithdraw);

        emit Withdraw(
            _owner,
            _receiver,
            assetsToWithdraw,
            _shares,
            block.timestamp
        );
    }

    function currentAssets() public view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    uint256[40] private __gap;

    function VERSION() external pure returns (uint8) {
        return 2;
    }
}
