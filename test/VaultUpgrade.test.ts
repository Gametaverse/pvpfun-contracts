import 'dotenv/config'; // 如果使用 .env
import { expect, version } from "chai";
import { ethers, network } from "hardhat";
import { getAddress, dataSlice, parseEther, ZeroAddress } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type {
    TokenVaultFactory, TokenVaultV2, MockERC20, MockERC20__factory,
    TokenVaultV2__factory, TokenVaultFactory__factory, TokenVaultV3__factory,
    TokenVaultV3
} from "../typechain-types"; // 确认 TypeChain 类型正确导入
import type { Wallet, ContractFactory, Contract } from "ethers";

const UUPS_UPGRADE_ABI = ["function upgradeToAndCall(address newImplementation, bytes memory data)"];

describe("TokenVaultV2 Deployment and Upgrade (TypeScript)", function () {
    // Contract Factories
    let TokenVaultV2Factory: TokenVaultV2__factory;
    let TokenVaultV3Factory: TokenVaultV3__factory; // For V2 logic
    let FactoryContractFactory: TokenVaultFactory__factory;
    let MockERC20Factory: MockERC20__factory;

    // Deployed Contract Instances
    let factory: TokenVaultFactory;
    let implementationV1: TokenVaultV2; // Use generic Contract or specific type if V1 isn't upgraded itself
    let implementationV2: TokenVaultV3; // Use generic Contract or specific type
    let vaultProxy1: TokenVaultV2; // Attach V1 type initially
    let vaultProxy2: TokenVaultV2;
    let mockToken: MockERC20;
    let mockToken2: MockERC20;

    // Signers
    let owner: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;
    let authorizer: HardhatEthersSigner;

    // --- Helper function to get proxy implementation address ---
    async function getMinimalProxyImplementationFromBytecode(proxyAddress: string): Promise<string | null> {
        const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
        const implementation = await ethers.provider.getStorage(proxyAddress, implSlot);
        return getAddress(dataSlice(implementation, 12));

        // const runtimeBytecode = await ethers.provider.getCode(proxyAddress);

        // // --- Use the ACTUAL bytecode pattern observed from Solady/your compiler ---
        // const expectedPrefix = "0x3d3d3d3d363d3d37363d73"; // UPDATE prefix based on observation
        // const expectedSuffix = "5af43d3d93803e602a57fd5bf3"; // UPDATE suffix based on observation

        // if (runtimeBytecode.startsWith(expectedPrefix) && runtimeBytecode.endsWith(expectedSuffix)) {
        //     // Extract the 20-byte address (40 hex chars) between the prefix and suffix
        //     const addressHex = runtimeBytecode.substring(expectedPrefix.length, runtimeBytecode.length - expectedSuffix.length);

        //     if (addressHex.length === 40) {
        //         const recoveredAddress = getAddress(`0x${addressHex}`);
        //         return recoveredAddress;
        //     } else {
        //         console.error(`Extracted address hex length is not 40: ${addressHex.length}`);
        //     }
        // }
        // return null;
    }

    // --- Helper function to get proxy admin address ---
    async function getProxyAdmin(proxyAddress: string): Promise<string> {
        const adminSlot = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
        const admin = await ethers.provider.getStorage(proxyAddress, adminSlot);
        return getAddress(dataSlice(admin, 12));
    }

    beforeEach(async function () {
        // Get signers
        [owner, user1, user2, authorizer] = await ethers.getSigners();

        // Get Contract Factories
        MockERC20Factory = await ethers.getContractFactory("MockERC20", owner);
        TokenVaultV2Factory = await ethers.getContractFactory("TokenVaultV2", owner);
        TokenVaultV3Factory = await ethers.getContractFactory("TokenVaultV3", owner); // Get V2 factory
        FactoryContractFactory = await ethers.getContractFactory("TokenVaultFactory", owner);

        // Deploy Mock ERC20 Token
        mockToken = await MockERC20Factory.deploy("奖励代币", "MC", owner.address);
        await mockToken.waitForDeployment();
        const mockTokenAddress = await mockToken.getAddress();
        // console.log("Mock ERC20 Token deployed to:", mockTokenAddress);

        await mockToken.mint(owner.address, parseEther("10000000"));

        mockToken2 = await MockERC20Factory.deploy("奖励代币2", "MC2", owner.address);
        await mockToken2.waitForDeployment();
        const mockToken2Address = await mockToken2.getAddress();
        // console.log("Mock ERC20 Token 2 deployed to:", mockToken2Address);
        await mockToken2.mint(owner.address, parseEther("10000000"));

        // --- 1. Deploy Logic Contract V1 ---
        implementationV1 = await TokenVaultV2Factory.deploy();
        await implementationV1.waitForDeployment();
        // console.log("Implementation V1 deployed to:", await implementationV1.getAddress());

        // --- 2. Deploy Factory ---
        const initialFeeRate = 100; // 1%
        const initialLockPeriod = 60 * 60 * 24; // 1 day
        factory = (await FactoryContractFactory.deploy(
            owner.address,
            implementationV1.getAddress(),
            authorizer.address,
            initialFeeRate,
            initialLockPeriod
        )) as TokenVaultFactory;
        await factory.waitForDeployment();
        // console.log("Factory deployed to:", await factory.getAddress());
        // console.log("Factory owner:", await factory.owner());
        // console.log("Factory initial implementation:", await factory.vaultImplementation());

        // --- 3. Create Clone Instances via Factory ---
        const tx1 = await factory.connect(owner).createVault(mockToken.getAddress());
        const receipt1 = await tx1.wait();
        expect(receipt1).to.not.be.null;
        // Use queryFilter to find the event emitted by the factory in that block
        const filter1 = factory.filters.VaultCreated(); // Get the event filter object
        const events1 = await factory.queryFilter(filter1, receipt1!.blockNumber, receipt1!.blockNumber); // Query within the block
        // Find the event matching our specific transaction hash
        const event1 = events1.find(e => e.transactionHash === tx1.hash);
        expect(event1, `VaultCreated event not found for tx ${tx1.hash}`).to.not.be.undefined;
        const proxyAddress1 = event1?.args?.vaultProxy;
        expect(proxyAddress1).to.not.be.undefined;

        // Attach V1 ABI/Type to the proxy address for interaction
        vaultProxy1 = TokenVaultV2Factory.attach(proxyAddress1!) as TokenVaultV2;
        // console.log("Vault Proxy 1 created at:", await vaultProxy1.getAddress());

        const tx2 = await factory.connect(owner).createVault(mockToken2.getAddress());
        const receipt2 = await tx2.wait();
        expect(receipt2).to.not.be.null;
        const filter2 = factory.filters.VaultCreated(); // Get the event filter object
        const events2 = await factory.queryFilter(filter2, receipt2!.blockNumber, receipt2!.blockNumber); // Query within the block
        // Find the event matching our specific transaction hash
        const event2 = events2.find(e => e.transactionHash === tx2.hash);
        expect(event2, `VaultCreated event not found for tx ${tx2.hash}`).to.not.be.undefined;
        const proxyAddress2 = event2?.args?.vaultProxy;
        expect(proxyAddress2).to.not.be.undefined;
        vaultProxy2 = TokenVaultV2Factory.attach(proxyAddress2!) as TokenVaultV2;
        // console.log("Vault Proxy 2 created at:", await vaultProxy2.getAddress());

        // Verify initialization
        expect(await vaultProxy1.token()).to.equal(await mockToken.getAddress());
        expect(await vaultProxy1.factory()).to.equal(await factory.getAddress());
        expect(await vaultProxy2.token()).to.equal(await mockToken2.getAddress());
        expect(await vaultProxy2.factory()).to.equal(await factory.getAddress());

        // console.log("proxy version: ", await vaultProxy1.VERSION());

        // Verify proxy points to implementation V1
        expect(await getMinimalProxyImplementationFromBytecode(await vaultProxy1.getAddress())).to.equal(await implementationV1.getAddress());
        expect(await getMinimalProxyImplementationFromBytecode(await vaultProxy2.getAddress())).to.equal(await implementationV1.getAddress());

        // --- 4. (Optional) Initial Interaction ---
        await mockToken.transfer(user1.address, parseEther("1000"));
        await mockToken.connect(user1).approve(vaultProxy1.getAddress(), parseEther("100"));
        await vaultProxy1.connect(user1).deposit(user1.address, parseEther("100"));
        // Check shares (assuming Banker struct is accessible or use getter)
        expect((await vaultProxy1.bankers(user1.address)).shares).to.equal(parseEther("100"));

        await mockToken2.transfer(user1.address, parseEther("1000"))


        // --- 5. Deploy Logic Contract V2 ---
        implementationV2 = await TokenVaultV3Factory.deploy();
        await implementationV2.waitForDeployment();
        // console.log("Implementation V2 deployed to:", await implementationV2.getAddress());
        const v3Version = await implementationV2.VERSION();
        // console.log("v3 version:", v3Version);
    });

    it("Should allow factory owner to upgrade a single vault via factory", async function () {
        // --- 6. Execute Single Upgrade via Factory ---

        // const proxyContract1 = new ethers.Contract(await vaultProxy1.getAddress(), UUPS_ABI, owner);
        // const vault1Addr = await vaultProxy1.getAddress();
        // // const vault2Addr = await vaultProxy2.getAddress();
        // const implV2Addr = await implementationV2.getAddress();
        // const emptyCallData = "0x";

        // // --- Upgrade vault 1 directly ---
        // const proxyUpgrader1 = new ethers.Contract(vault1Addr, UUPS_UPGRADE_ABI, owner);
        // await expect(proxyUpgrader1.upgradeToAndCall(implV2Addr, emptyCallData))
        //     .to.emit(vaultProxy1, "Upgraded").withArgs(implV2Addr);

        const versionBefore = await vaultProxy1.VERSION();
        // console.log("version before: ", versionBefore);

        await expect(factory.connect(owner).batchUpgradeVaults([vaultProxy1.getAddress()], implementationV2.getAddress(), "0x"))
            .to.emit(factory, "VaultsUpgraded"); // Check factory event

        const versionAfter = await vaultProxy1.VERSION();
        // console.log("version after: ", versionAfter);

        // It's harder to directly check the proxy's "Upgraded" event here without specific listeners/matchers

        // --- 7. Verify Upgrade ---
        expect(await getMinimalProxyImplementationFromBytecode(await vaultProxy1.getAddress())).to.equal(await implementationV2.getAddress());

        // --- 8. Interact with Upgraded Proxy ---
        // Attach V2 ABI/Type to the proxy address
        const upgradedVaultProxy1 = TokenVaultV3Factory.attach(await vaultProxy1.getAddress()) as TokenVaultV3;

        // Check state preservation
        expect((await upgradedVaultProxy1.bankers(user1.address)).shares).to.equal(parseEther("100"));

        // Call a new V2 function (replace with your actual V2 function)
        // await expect(upgradedVaultProxy1.connect(user1).newV2Function()).to.not.be.reverted;

        // Interact with non-upgraded proxy
        await mockToken.connect(user1).approve(vaultProxy1.getAddress(), parseEther("50"));
        await expect(vaultProxy1.connect(user1).deposit(user1.address, parseEther("50"))).to.not.be.reverted;
    });

    it("Should allow factory owner to upgrade vaults in batch via factory", async function () {

        // --- 6. Execute Batch Upgrade via Factory ---
        const proxiesToUpgrade = [await vaultProxy1.getAddress(), await vaultProxy2.getAddress()];
        await expect(factory.connect(owner).batchUpgradeVaults(proxiesToUpgrade, implementationV2.getAddress(), "0x"))
            .to.emit(factory, "VaultsUpgraded")
            .withArgs(await implementationV2.getAddress(), proxiesToUpgrade);

        // --- 7. Verify Upgrade ---
        expect(await getMinimalProxyImplementationFromBytecode(await vaultProxy1.getAddress())).to.equal(await implementationV2.getAddress());
        expect(await getMinimalProxyImplementationFromBytecode(await vaultProxy2.getAddress())).to.equal(await implementationV2.getAddress());

        // --- 8. Interact with Upgraded Proxies ---
        const upgradedVaultProxy1 = TokenVaultV3Factory.attach(await vaultProxy1.getAddress()) as TokenVaultV3;
        const upgradedVaultProxy2 = TokenVaultV3Factory.attach(await vaultProxy2.getAddress()) as TokenVaultV3;

        expect((await upgradedVaultProxy1.bankers(user1.address)).shares).to.equal(parseEther("100"));

        await mockToken2.connect(user1).approve(upgradedVaultProxy2.getAddress(), parseEther("10"));
        await expect(upgradedVaultProxy2.connect(user1).deposit(user1.address, parseEther("10")))
            .to.emit(upgradedVaultProxy2, "Deposit");
    });

    it("Should reverted upgrades when proxy address invalid", async function () {
        const invalidAddress = ethers.ZeroAddress;
        const proxiesToUpgrade = [vaultProxy1.getAddress(), invalidAddress, vaultProxy2.getAddress()];

        // const tx = await factory.connect(owner).batchUpgradeVaults(proxiesToUpgrade, implementationV2.getAddress(), "0x");

        await expect(factory.connect(owner).batchUpgradeVaults(proxiesToUpgrade, implementationV2.getAddress(), "0x"))
            .to.be.revertedWith("Factory: Zero vault proxy");
    });


    it("Should allow factory owner to change implementation for future clones", async function () {

        const mockToken3 = await MockERC20Factory.deploy("奖励代币V3", "MC3", owner.address);
        await mockToken3.waitForDeployment();
        const mockTokenAddress = await mockToken3.getAddress();
        // console.log("Mock ERC20 Token deployed to:", mockTokenAddress);

        await mockToken3.mint(owner.address, parseEther("10000000"));

        const v1Version = await vaultProxy1.VERSION();
        // console.log("v1 version:", v1Version);

        await expect(factory.connect(owner).setImplementation(await implementationV2.getAddress()))
            .to.emit(factory, "ImplementationUpdated").withArgs(await implementationV2.getAddress());
        expect(await factory.vaultImplementation()).to.equal(await implementationV2.getAddress());

        const tx3 = await factory.connect(owner).createVault(mockTokenAddress);
        const receipt3 = await tx3.wait();
        await expect(receipt3).to.emit(factory, "VaultCreated");

        // Use queryFilter to find the event emitted by the factory in that block
        const filter1 = factory.filters.VaultCreated(); // Get the event filter object
        const events1 = await factory.queryFilter(filter1, receipt3!.blockNumber, receipt3!.blockNumber); // Query within the block
        // Find the event matching our specific transaction hash
        const event1 = events1.find(e => e.transactionHash === tx3.hash);
        expect(event1, `VaultCreated event not found for tx ${tx3.hash}`).to.not.be.undefined;
        const proxyAddress3 = event1?.args?.vaultProxy;
        expect(proxyAddress3).to.not.be.undefined;

        const vaultProxy3 = TokenVaultV2Factory.attach(proxyAddress3!) as TokenVaultV3; // Attach V1 type initially

        const version3 = await vaultProxy3.VERSION();
        // console.log("v3 version:", version3);

        await mockToken3.connect(owner).approve(vaultProxy3.getAddress(), parseEther("100"));
        await expect(vaultProxy3.connect(owner).deposit(owner.address, parseEther("100")))
            .to.emit(vaultProxy3, "Deposit");

        expect(await getMinimalProxyImplementationFromBytecode(await vaultProxy3.getAddress())).to.equal(await implementationV2.getAddress());
    });

    it("Should only allow factory owner to upgrade vaults", async function () {

        await expect(
            factory.connect(user1).batchUpgradeVaults([await vaultProxy1.getAddress()], await implementationV2.getAddress(), "0x")
        ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");

        // Type assertion needed for calling upgradeTo directly on proxy via interface
        const vaultProxyAsUser1 = vaultProxy1.connect(user1) as unknown as Contract; // Use generic Contract for direct call
        await expect(
            vaultProxyAsUser1.upgradeToAndCall(implementationV2.getAddress(), "0x")
        ).to.be.revertedWith("PVP: Only factory can upgrade");

        // Factory owner should be able to call upgradeTo directly
        const vaultProxyAsOwner = vaultProxy1.connect(owner) as unknown as Contract;
        await expect(
            vaultProxyAsOwner.upgradeToAndCall(implementationV2.getAddress(), "0x")
        ).to.not.be.reverted;
        expect(await getMinimalProxyImplementationFromBytecode(await vaultProxy1.getAddress())).to.equal(await implementationV2.getAddress());
    });
});