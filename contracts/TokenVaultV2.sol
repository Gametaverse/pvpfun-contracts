// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "solady/src/utils/SafeTransferLib.sol";
import "solady/src/utils/FixedPointMathLib.sol";

import "./VerifySignLib.sol";
import "./interface/ITokenVaultFactory.sol";
import "./interface/ITokenVault.sol";

// import "hardhat/console.sol";

contract TokenVaultV2 is
    Initializable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC20Upgradeable
{
    using SafeERC20 for IERC20;
    using SafeTransferLib for address;
    using FixedPointMathLib for uint256;

    mapping(uint256 => bool) public usedNonces;

    ITokenVaultFactory public factory;
    uint256 public constant DENOMINATOR = 10000;

    address public token;

    uint256 public withdrawalIndex = 1;
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;
    mapping(address => uint256[]) public userPendingRequestIds;

    struct WithdrawalRequest {
        address user;
        uint256 lpAmount;
        uint256 requestTime;
    }

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

    event WithdrawalRequested(
        address indexed user,
        uint256 indexed requestId,
        uint256 lpAmount,
        uint256 requestTime
    );
    event WithdrawalFinalized(
        address indexed user,
        uint256 indexed requestId,
        uint256 assetsReceived,
        uint256 fee
    );

    event Upgraded(address indexed implementation);

    function initialize(
        address _tokenAddr,
        address _factoryAddr
    ) public initializer {
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        __ERC20_init("PVPFUN LP Token", "PVPFUN-LP");

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
                address(this),
                sign.nonce,
                _expectReciver,
                token,
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
        require(data.token == token, "PVP: token not match");
        require(!usedNonces[data.nonce], "PVP: nonce has been used");
        require(data.amount > 0, "PVP: amount must be greater than 0");

        _verifySign(data, receiver);
        usedNonces[data.nonce] = true;

        IERC20(token).safeTransfer(receiver, data.amount);

        emit Claimed(data.nonce, receiver, token, data.amount);
    }

    function batchClaimReward(
        VerifySignData[] memory list,
        address reciver
    ) public nonReentrant {
        for (uint256 i = 0; i < list.length; i++) {
            _claimReward(list[i], reciver);
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

        uint256 currentTotalShares = totalSupply();
        uint256 currentTotalAssets = currentAssets();

        if (currentTotalShares == 0 || currentTotalAssets == 0) {
            sharesMinted = _assets;
        } else {
            sharesMinted = _assets.rawMul(currentTotalShares).rawDiv(
                currentTotalAssets
            );
        }
        require(sharesMinted > 0, "PVP: Shares calculated to zero");

        IERC20(token).safeTransferFrom(msg.sender, address(this), _assets);

        _mint(_receiver, sharesMinted);

        emit Deposit(
            msg.sender,
            _receiver,
            _assets,
            sharesMinted,
            block.timestamp
        );
    }

    function requestWithdrawal(uint256 _lpAmount) external nonReentrant {
        require(_lpAmount > 0, "PVP: Amount must be positive");
        require(
            balanceOf(msg.sender) >= _lpAmount,
            "PVP: Insufficient LP token balance"
        );

        uint256 requestId = withdrawalIndex;
        unchecked {
            ++withdrawalIndex;
        }

        // lock lp token
        IERC20(address(this)).safeTransferFrom(
            msg.sender,
            address(this),
            _lpAmount
        );

        withdrawalRequests[requestId] = WithdrawalRequest({
            user: msg.sender,
            lpAmount: _lpAmount,
            requestTime: block.timestamp
        });

        userPendingRequestIds[msg.sender].push(requestId);

        emit WithdrawalRequested(
            msg.sender,
            requestId,
            _lpAmount,
            block.timestamp
        );
    }

    function completeWithdrawal(uint256 _requestId) external nonReentrant {
        WithdrawalRequest storage request = withdrawalRequests[_requestId];
        require(
            request.user == msg.sender,
            "PVP: Request not found or not owner"
        );

        uint256 currentTotalAssets = currentAssets();
        uint256 assetsToWithdraw = request
            .lpAmount
            .rawMul(currentTotalAssets)
            .rawDiv(totalSupply());

        uint256 feeRate = factory.getFeeRate();
        uint256 fee = 0;
        if (feeRate != 0) {
            uint64 lockPeriod = factory.getLockPeriod();
            uint256 endTime = request.requestTime.rawAdd(lockPeriod);
            if (endTime > block.timestamp) {
                fee = assetsToWithdraw.rawMul(feeRate).rawDiv(DENOMINATOR);
                assetsToWithdraw = assetsToWithdraw.rawSub(fee);
            }
        }
        require(
            assetsToWithdraw > 0,
            "PVP: Calculated withdraw amount is zero"
        );

        // delete withdraw request
        delete withdrawalRequests[_requestId];
        // remove request id from userPendingRequestIds
        _removeRequestIdForUser(request.user, _requestId);
        // burn lp token
        _burn(address(this), request.lpAmount);

        if (fee > 0) {
            IERC20(token).safeTransfer(factory.getOwner(), fee);
        }
        IERC20(token).safeTransfer(request.user, assetsToWithdraw);

        emit WithdrawalFinalized(
            request.user,
            _requestId,
            assetsToWithdraw,
            fee
        );
    }

    function _removeRequestIdForUser(
        address _user,
        uint256 _requestId
    ) private {
        uint256[] storage requestIds = userPendingRequestIds[_user];
        uint256 lastIndex = requestIds.length - 1;

        for (uint256 i = 0; i < requestIds.length; i++) {
            if (requestIds[i] == _requestId) {
                requestIds[i] = requestIds[lastIndex];
                requestIds.pop();
                return;
            }
        }
    }

    function currentAssets() public view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    uint256[40] private __gap;

    function VERSION() external pure returns (uint8) {
        return 2;
    }
}
