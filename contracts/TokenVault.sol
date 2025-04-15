// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "solady/src/utils/LibClone.sol";
import "solady/src/utils/SafeTransferLib.sol";
import "solady/src/utils/FixedPointMathLib.sol";
import "./VerifySign.sol";

contract TokenVault is VerifySign, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeTransferLib for address;
    using FixedPointMathLib for uint256;

    mapping(uint256 => bool) public usedNonces;

    uint256 public feeRate;
    uint64 public lockPeriod;
    uint256 public constant denominator = 10000;

    uint256 public shares;
    address public token;

    mapping(address => Banker) public bankers;

    struct VerifySignData {
        uint64 nonce;
        uint256 amount;
        uint64 deadline;
        bytes signature;
    }

    struct Banker {
        uint256 shares;
        uint256 blocktime;
    }

    event Claimed(
        uint64 indexed nonce,
        address indexed reciver,
        address token,
        uint256 amount
    );

    event TransferFunds(address reciver, address token, uint256 amount);

    event Deposit(
        address user,
        uint256 assets,
        uint256 shares,
        uint256 tradeTime
    );
    event Withdraw(
        address user,
        uint256 assets,
        uint256 shares,
        uint256 tradeTime
    );

    constructor(
        address _authorizer,
        address _token,
        uint256 _feeRate,
        uint64 _lockPeriod
    ) VerifySign() {
        authorizer = _authorizer;
        token = _token;
        feeRate = _feeRate;
        lockPeriod = _lockPeriod;
    }

    function _verifySign(VerifySignData memory sign) internal view {
        address recoveredAddr = recoverAuthorizer(
            keccak256(
                abi.encodePacked(
                    block.chainid,
                    address(this),
                    sign.nonce,
                    msg.sender,
                    token,
                    sign.amount,
                    sign.deadline
                )
            ),
            sign.signature
        );
        require(recoveredAddr == authorizer, "PVP: Invalid signature");
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

        _verifySign(data);
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

    function transferFunds(uint256 amount) public onlyOwner {
        require(amount > 0, "PVP: amount must be greater than 0");
        IERC20(token).safeTransfer(msg.sender, amount);
        emit TransferFunds(msg.sender, token, amount);
    }

    function deposit(address _receiver, uint256 _assets) external nonReentrant {
        IERC20(token).safeTransferFrom(msg.sender, address(this), _assets);
        _deposit(_receiver, _assets);
    }

    function _deposit(
        address _receiver,
        uint256 _assets
    ) internal returns (uint256 _shares) {
        if (shares == 0) {
            _shares = _assets;
        } else {
            _shares = _assets.rawMul(shares).rawDiv(assets());
        }
        shares = shares.rawAdd(_shares);

        Banker storage banker = bankers[_receiver];
        banker.shares = banker.shares.rawAdd(_shares);
        banker.blocktime = block.timestamp;
        emit Deposit(_receiver, _assets, _shares, block.timestamp);
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
        _assets = _shares.rawMul(assets()).rawDiv(shares);

        if (feeRate != 0) {
            uint256 end_time = banker.blocktime.rawAdd(lockPeriod);
            if (end_time > block.timestamp) {
                uint256 _fee = _assets.rawMul(feeRate).rawDiv(denominator);
                _assets = _assets.rawSub(_fee);
            }
        }

        shares = shares.rawSub(_shares);
        emit Withdraw(_receiver, _assets, _shares, block.timestamp);
    }

    function assets() public view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
