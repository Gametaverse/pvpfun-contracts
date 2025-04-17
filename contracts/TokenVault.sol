// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "solady/src/utils/LibClone.sol";
import "solady/src/utils/SafeTransferLib.sol";
import "solady/src/utils/FixedPointMathLib.sol";
import "./VerifySignLib.sol";

contract TokenVault is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using SafeTransferLib for address;
    using FixedPointMathLib for uint256;

    mapping(uint256 => bool) public usedNonces;

    uint256 public feeRate;
    uint64 public lockPeriod;
    uint256 public constant DENOMINATOR = 10000;
    address public authorizer;

    uint256 public totalShares;
    address public immutable token;

    mapping(address => Banker) public bankers;

    struct VerifySignData {
        uint64 nonce;
        uint256 amount;
        uint64 deadline;
        bytes signature;
    }

    struct Banker {
        uint256 shares;
        uint256 lastActionTime;
    }

    event Claimed(
        uint64 indexed nonce,
        address indexed reciver,
        address indexed token,
        uint256 amount
    );

    event TransferFunds(address reciver, address token, uint256 amount);
    event AuthorizerChanged(address indexed authorizer);

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

    constructor(
        address _initialOwner,
        address _authorizer,
        address _token,
        uint256 _feeRate,
        uint64 _lockPeriod
    ) Ownable(_initialOwner) {
        require(_authorizer != address(0), "PVP: Invalid authorizer");
        require(_token != address(0), "PVP: Invalid token");
        require(_feeRate < DENOMINATOR, "PVP: Fee rate too high");
        authorizer = _authorizer;
        token = _token;
        feeRate = _feeRate;
        lockPeriod = _lockPeriod;
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
                token,
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

    function transferFunds(address _receiver, uint256 amount) public onlyOwner {
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

        // --- [审计修复 MEV & 精度 & 除零] ---
        // 1. 获取操作前的状态
        uint256 currentTotalShares = totalShares; // 读取当前总份额
        uint256 currentTotalAssets = currentAssets(); // 读取当前总资产 (在转账前)

        // 2. 计算应铸造的份额
        if (currentTotalShares == 0 || currentTotalAssets == 0) {
            // 如果是首次存款，或者由于某种原因资产为0，则份额等于资产 (1:1)
            sharesMinted = _assets;
        } else {
            // 基于操作前的总资产和总份额计算新份额，避免被操纵
            sharesMinted = _assets.rawMul(currentTotalShares).rawDiv(
                currentTotalAssets
            );
        }
        // 确保计算结果大于0，防止精度损失导致的问题
        require(sharesMinted > 0, "PVP: Shares calculated to zero");
        // --- 修复结束 ---

        // 3. 执行代币转账 (先完成外部调用)
        IERC20(token).safeTransferFrom(msg.sender, address(this), _assets);

        // 4. 更新合约状态 (在外部调用之后)
        totalShares = currentTotalShares.rawAdd(sharesMinted); // 更新总份额 (使用计算前的值)

        Banker storage banker = bankers[_receiver];
        banker.shares = banker.shares.rawAdd(sharesMinted);
        banker.lastActionTime = block.timestamp; // 更新最后操作时间

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
    ) external nonReentrant returns (uint256 _assets) {
        uint256 _shares = bankers[msg.sender].shares;
        _assets = _withdraw(msg.sender, _shares);
        IERC20(token).safeTransfer(_receiver, _assets);
    }

    function withdraw(
        address _receiver,
        uint256 _shares
    ) external nonReentrant returns (uint256 _assets) {
        _assets = _withdraw(msg.sender, _shares);
        IERC20(token).safeTransfer(_receiver, _assets);
    }

    function _withdraw(
        address _receiver,
        uint256 _shares
    ) internal returns (uint256 _assets) {
        Banker storage banker = bankers[_receiver];
        require(banker.shares > 0, "PVP: No shares to withdraw");
        require(banker.shares >= _shares, "PVP: Insufficient shares");
        banker.shares = banker.shares.rawSub(_shares);
        _assets = _shares.rawMul(currentAssets()).rawDiv(totalShares);

        if (feeRate != 0) {
            uint256 end_time = banker.lastActionTime.rawAdd(lockPeriod);
            if (end_time > block.timestamp) {
                uint256 _fee = _assets.rawMul(feeRate).rawDiv(DENOMINATOR);
                _assets = _assets.rawSub(_fee);
            }
        }

        totalShares = totalShares.rawSub(_shares);
        emit Withdraw(msg.sender, _receiver, _assets, _shares, block.timestamp);
    }

    function currentAssets() public view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
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
