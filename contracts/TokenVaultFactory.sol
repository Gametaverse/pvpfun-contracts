// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./interface/ITokenVault.sol";
import "./interface/ITokenVaultUpgrader.sol";

contract TokenVaultFactory is Ownable {
    address public vaultImplementation;

    address public authorizer;
    uint256 public feeRate;
    uint64 public lockPeriod;
    bool public depositEnable;
    bool public withdrawEnable;
    mapping(address => address) public tokenVaults;

    event ImplementationUpdated(address indexed newImplementation);

    event VaultCreated(address indexed vaultProxy, address indexed token);

    event AuthorizerChanged(address indexed authorizer);
    event FeeRateUpdated(uint256 newFeeRate);
    event LockPeriodUpdated(uint64 newLockPeriod);
    event DepositStatusChanged(bool enabled);
    event WithdrawStatusChanged(bool enabled);
    event VaultsUpgraded(
        address indexed newImplementation,
        address[] upgradedVaults
    );

    constructor(
        address _initialOwner,
        address _implementationAddress,
        address _authorizer,
        uint256 _feeRate,
        uint64 _lockPeriod
    ) Ownable(_initialOwner) {
        require(
            _implementationAddress != address(0),
            "Factory: Zero implementation"
        );
        require(_authorizer != address(0), "Factory: Invalid authorizer");
        require(_feeRate < 10000, "Factory: Fee rate too high");
        vaultImplementation = _implementationAddress;
        authorizer = _authorizer;
        feeRate = _feeRate;
        lockPeriod = _lockPeriod;
        depositEnable = true;
        withdrawEnable = true;
    }

    function setImplementation(address _newImplementation) public onlyOwner {
        require(
            _newImplementation != address(0),
            "Factory: Zero implementation"
        );
        vaultImplementation = _newImplementation;
        emit ImplementationUpdated(_newImplementation);
    }

    /**
     * @notice Deploys and initializes a new TokenVault clone.
     * @param _token The ERC20 token the vault will manage.
     * @return vaultProxy The address of the newly created vault proxy.
     */
    function createVault(address _token) external returns (address vaultProxy) {
        require(_token != address(0), "Factory: Zero token address");
        require(
            tokenVaults[_token] == address(0),
            "Factory: Vault already exists"
        );

        // 1. Prepare the initialization calldata for the TokenVaultV2 logic contract
        // Use the ITokenVaultInitializer interface to encode the call
        bytes memory initializeData = abi.encodeWithSelector(
            ITokenVaultInitializer.initialize.selector,
            _token,
            address(this) // Pass factory address to the logic contract's initialize function
        );

        // 2. Deploy the ERC1967Proxy (standard UUPS proxy)
        // The proxy's constructor takes the initial implementation address and the initialization calldata.
        // It deploys the proxy and immediately calls initialize on the logic contract via DELEGATECALL.
        ERC1967Proxy proxy = new ERC1967Proxy(
            vaultImplementation, // Initial V1 implementation address
            initializeData // Calldata to initialize the vault
        );
        vaultProxy = address(proxy); // Get the deployed proxy address

        // --- Record the new vault ---

        tokenVaults[_token] = vaultProxy;

        emit VaultCreated(vaultProxy, _token);
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

    function getAuthorizer() external view returns (address) {
        return authorizer;
    }

    function setFeeRate(uint256 _feeRate) external onlyOwner {
        require(_feeRate < 10000, "Factory: Fee rate too high");
        feeRate = _feeRate;
        emit FeeRateUpdated(_feeRate);
    }

    function getFeeRate() external view returns (uint256) {
        return feeRate;
    }

    function setLockPeriod(uint64 _lockPeriod) external onlyOwner {
        lockPeriod = _lockPeriod;
        emit LockPeriodUpdated(_lockPeriod);
    }

    function getLockPeriod() external view returns (uint64) {
        return lockPeriod;
    }

    function getOwner() external view returns (address) {
        return owner();
    }

    function setDepositEnable(bool _enable) external onlyOwner {
        require(
            depositEnable != _enable,
            "Factory: No change in deposit status"
        );
        depositEnable = _enable;
        emit DepositStatusChanged(_enable);
    }

    function setWithdrawEnable(bool _enable) external onlyOwner {
        require(
            withdrawEnable != _enable,
            "Factory: No change in withdraw status"
        );
        withdrawEnable = _enable;
        emit WithdrawStatusChanged(_enable);
    }

    function batchUpgradeVaults(
        address[] calldata _vaultProxies,
        address _newImplementation,
        bytes memory data
    ) external onlyOwner {
        require(
            _newImplementation != address(0),
            "Factory: Zero new implementation"
        );

        for (uint i = 0; i < _vaultProxies.length; i++) {
            address vaultProxy = _vaultProxies[i];
            if (vaultProxy == address(0)) {
                revert("Factory: Zero vault proxy");
            }
            ITokenVaultUpgrader(vaultProxy).upgradeToAndCall(
                _newImplementation,
                data
            );
        }

        emit VaultsUpgraded(_newImplementation, _vaultProxies);
    }

    function getTokenVault(address _token) external view returns (address) {
        return tokenVaults[_token];
    }
}
