// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "solady/src/utils/SafeTransferLib.sol";
import "solady/src/utils/FixedPointMathLib.sol";

interface IRewards {
    function stake(address, uint256) external;

    function stakeFor(address, uint256) external;

    function withdraw(address, uint256) external;

    function exit(address) external;

    function getReward(address) external;

    function queueNewRewards(uint256) external;

    function notifyRewardAmount(uint256) external;

    function addExtraReward(address) external;

    function stakingToken() external returns (address);
}

interface ITokenLocker {
    function lockToken(
        address _reciver,
        uint256 _amount,
        uint256 _lockTime
    ) external;

    function releaseToken() external;

    function balanceOf(address account) external view returns (uint256);

    function releasableBalanceOf(
        address account
    ) external view returns (uint256);
}

contract BaseRewardPool {
    using SafeERC20 for IERC20;
    using SafeTransferLib for address;
    using FixedPointMathLib for uint256;

    IERC20 public rewardToken;
    IERC20 public stakingToken;
    address public tokenLocker;
    uint256 public _lockTime;
    uint256 public constant duration = 7 days;
    // uint256 public constant duration = 1 hours;

    // address public operator;
    address public rewardManager;

    // uint256 public pid;
    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public queuedRewards = 0;
    uint256 public currentRewards = 0;
    uint256 public historicalRewards = 0;
    uint256 public constant newRewardRatio = 830;
    uint256 private _totalSupply;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) private _balances;

    address[] public extraRewards;

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    constructor(
        address stakingToken_,
        address rewardToken_,
        address rewardManager_,
        address tokenLocker_,
        uint256 lockTime_
    ) {
        if (tokenLocker_ != address(0)) {
            require(lockTime_ > 0, "lockTime must be >= 0");
        }
        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
        rewardManager = rewardManager_;
        tokenLocker = tokenLocker_;
        _lockTime = lockTime_;
    }

    modifier onlyManger() {
        require(msg.sender == rewardManager, "!authorized");
        _;
    }

    //set approvals for lock rewardToken
    function setApprovals() public {
        if (tokenLocker != address(0)) {
            rewardToken.approve(tokenLocker, 0);
            rewardToken.approve(tokenLocker, type(uint256).max);
        }
    }

    function setTokenLocker(
        address _tokenLocker,
        uint256 lockTime
    ) external onlyManger {
        require(_tokenLocker != tokenLocker, "token locker not change");
        if (tokenLocker != address(0)) {
            rewardToken.approve(tokenLocker, 0);
        }
        tokenLocker = _tokenLocker;
        _lockTime = lockTime;
        setApprovals();
    }

    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function extraRewardsLength() external view returns (uint256) {
        return extraRewards.length;
    }

    function addExtraReward(
        address _reward
    ) external onlyManger returns (bool) {
        require(_reward != address(0), "!reward setting");

        extraRewards.push(_reward);
        return true;
    }

    function clearExtraRewards() external onlyManger {
        delete extraRewards;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return FixedPointMathLib.min(block.timestamp, periodFinish);
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply() == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored.rawAdd(
                lastTimeRewardApplicable()
                    .rawSub(lastUpdateTime)
                    .rawMul(rewardRate)
                    .rawMul(1e18)
                    .rawDiv(totalSupply())
            );
    }

    function earned(address account) public view returns (uint256) {
        return
            balanceOf(account)
                .rawMul(
                    rewardPerToken().rawSub(userRewardPerTokenPaid[account])
                )
                .rawDiv(1e18)
                .rawAdd(rewards[account]);
    }

    function stake(
        uint256 _amount
    ) public updateReward(msg.sender) returns (bool) {
        require(_amount > 0, "RewardPool : Cannot stake 0");

        //also stake to linked rewards
        for (uint i = 0; i < extraRewards.length; i++) {
            IRewards(extraRewards[i]).stake(msg.sender, _amount);
        }

        _totalSupply = _totalSupply.rawAdd(_amount);
        _balances[msg.sender] = _balances[msg.sender].rawAdd(_amount);

        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Staked(msg.sender, _amount);

        return true;
    }

    function stakeAll() external returns (bool) {
        uint256 balance = stakingToken.balanceOf(msg.sender);
        stake(balance);
        return true;
    }

    function stakeFor(
        address _for,
        uint256 _amount
    ) public updateReward(_for) returns (bool) {
        require(_amount > 0, "RewardPool : Cannot stake 0");

        //also stake to linked rewards
        for (uint i = 0; i < extraRewards.length; i++) {
            IRewards(extraRewards[i]).stake(_for, _amount);
        }

        //give to _for
        _totalSupply = _totalSupply.rawAdd(_amount);
        _balances[_for] = _balances[_for].rawAdd(_amount);

        //take away from sender
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Staked(_for, _amount);

        return true;
    }

    function withdraw(
        uint256 amount,
        bool claim
    ) public updateReward(msg.sender) returns (bool) {
        require(amount > 0, "RewardPool : Cannot withdraw 0");

        //also withdraw from linked rewards
        for (uint i = 0; i < extraRewards.length; i++) {
            IRewards(extraRewards[i]).withdraw(msg.sender, amount);
        }

        _totalSupply = _totalSupply.rawSub(amount);
        _balances[msg.sender] = _balances[msg.sender].rawSub(amount);

        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);

        if (claim) {
            getReward(msg.sender, true);
        }

        return true;
    }

    function withdrawAll(bool claim) external {
        withdraw(_balances[msg.sender], claim);
    }

    function getReward(
        address _account,
        bool _claimExtras
    ) public updateReward(_account) returns (bool) {
        uint256 reward = earned(_account);
        if (reward > 0) {
            rewards[_account] = 0;
            if (tokenLocker == address(0)) {
                rewardToken.safeTransfer(_account, reward);
            } else {
                ITokenLocker(tokenLocker).lockToken(
                    _account,
                    reward,
                    _lockTime
                );
            }
            emit RewardPaid(_account, reward);
        }

        //also get rewards from linked rewards
        if (_claimExtras) {
            for (uint i = 0; i < extraRewards.length; i++) {
                IRewards(extraRewards[i]).getReward(_account);
            }
        }
        return true;
    }

    function getReward() external returns (bool) {
        getReward(msg.sender, true);
        return true;
    }

    function donate(uint256 _amount) external returns (bool) {
        IERC20(rewardToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );
        queuedRewards = queuedRewards.rawAdd(_amount);
        return true;
    }

    function queueNewRewards(
        uint256 _rewards
    ) external onlyManger returns (bool) {
        _rewards = _rewards.rawAdd(queuedRewards);

        if (block.timestamp >= periodFinish) {
            notifyRewardAmount(_rewards);
            queuedRewards = 0;
            return true;
        }

        //et = now - (finish-duration)
        uint256 elapsedTime = block.timestamp.rawSub(
            periodFinish.rawSub(duration)
        );
        // current at now: rewardRate * elapsedTime
        uint256 currentAtNow = rewardRate * elapsedTime;
        uint256 queuedRatio = currentAtNow.rawMul(1000).rawDiv(_rewards);

        //uint256 queuedRatio = currentRewards.mul(1000).div(_rewards);
        if (queuedRatio < newRewardRatio) {
            notifyRewardAmount(_rewards);
            queuedRewards = 0;
        } else {
            queuedRewards = _rewards;
        }
        return true;
    }

    function notifyRewardAmount(
        uint256 reward
    ) internal updateReward(address(0)) {
        historicalRewards = historicalRewards.rawAdd(reward);
        if (block.timestamp >= periodFinish) {
            rewardRate = reward.rawDiv(duration);
        } else {
            uint256 remaining = periodFinish.rawSub(block.timestamp);
            uint256 leftover = remaining.rawMul(rewardRate);
            reward = reward.rawAdd(leftover);
            rewardRate = reward.rawDiv(duration);
        }
        currentRewards = reward;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp.rawAdd(duration);
        emit RewardAdded(reward);
    }
}
