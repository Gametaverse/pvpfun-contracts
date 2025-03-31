import 'dotenv/config';
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { Launches, MockERC20 } from "../typechain-types";
import type { Wallet } from "ethers";




describe("Launches 合约测试", function () {


    const deployerPrivateKey = process.env.PRIVATE_KEY_DEPLOYER;
    const playerPrivateKey = process.env.PRIVATE_KEY_PLAYER;
    const authorizerPrivateKey = process.env.PRIVATE_KEY_AUTHORIZER;
    const otherAccountPrivateKey = process.env.PRIVATE_KEY_OTHER_ACCOUNT;


    if (!deployerPrivateKey || !playerPrivateKey || !authorizerPrivateKey || !otherAccountPrivateKey) {
        throw new Error("Please set PRIVATE_KEY_DEPLOYER, PRIVATE_KEY_PLAYER, and PRIVATE_KEY_AUTHORIZER in your .env file");
    }


    let launches: Launches;
    let mockToken: MockERC20;
    let owner: Wallet;
    let authorizer: Wallet;
    let player: Wallet;
    let vault: Wallet;
    let otherAccount: Wallet;


    const MOCK_TOKEN_NAME = "模拟代币";
    const MOCK_TOKEN_SYMBOL = "MKT";
    let GAME_ID_1 = 12345n;
    const COMMITMENT_1 = ethers.keccak256(ethers.toUtf8Bytes("玩家1的秘密"));
    const AMOUNT_1 = ethers.parseEther("0.5");
    const RATE_1 = 100n;


    async function generateSignature(
        signer: Wallet,
        chainId: bigint,
        contractAddress: string,
        playerAddress: string,
        gameID: bigint,
        commitment: string,
        tokenAddress: string,
        amount: bigint,
        rate: bigint,
        deadline: bigint
    ): Promise<string> {



        const messageHash = ethers.keccak256(
            ethers.solidityPacked(
                ["uint256", "address", "address", "uint64", "bytes32", "address", "uint256", "uint64", "uint64"],
                [chainId, contractAddress, playerAddress, gameID, commitment, tokenAddress, amount, rate, deadline]
            )
        );

        const signature = await signer.signMessage(ethers.getBytes(messageHash));
        return signature;
    }

    async function airdrop() {


        console.log("为自定义账户提供资金...");
        const [funder] = await ethers.getSigners();
        const amountToSend = ethers.parseEther("10.0");


        console.log(`正在为自定义账户提供 ${ethers.formatEther(amountToSend)} ETH...`);
        const txs = [
            funder.sendTransaction({ to: owner.address, value: amountToSend }),
            funder.sendTransaction({ to: authorizer.address, value: amountToSend }),
            funder.sendTransaction({ to: player.address, value: amountToSend }),
            funder.sendTransaction({ to: vault.address, value: amountToSend }),
            funder.sendTransaction({ to: otherAccount.address, value: amountToSend })
        ];
        await Promise.all(txs.map(txPromise => txPromise.then(tx => tx.wait())));
        console.log("资金提供完成.");


    }



    before(async function () {

        owner = new ethers.Wallet(deployerPrivateKey, ethers.provider);
        authorizer = new ethers.Wallet(authorizerPrivateKey, ethers.provider);
        player = new ethers.Wallet(playerPrivateKey, ethers.provider);
        vault = new ethers.Wallet(deployerPrivateKey, ethers.provider);
        otherAccount = new ethers.Wallet(otherAccountPrivateKey, ethers.provider);

        console.log("deploy:", owner.address);
        console.log("authorizer:", authorizer.address);

        await airdrop();


        const MockERC20Factory = await ethers.getContractFactory("MockERC20", owner);
        mockToken = await MockERC20Factory.deploy(MOCK_TOKEN_NAME, MOCK_TOKEN_SYMBOL, owner.address);
        await mockToken.waitForDeployment();
        const mockTokenAddress = await mockToken.getAddress();


        const LaunchesFactory = await ethers.getContractFactory("Launches", owner);
        launches = await LaunchesFactory.deploy(authorizer.address);
        await launches.waitForDeployment();
        const launchesAddress = await launches.getAddress();


        await launches.connect(owner).setTokenVault(mockTokenAddress, vault.address);


        const initialPlayerBalance = AMOUNT_1 * 2000n;
        await mockToken.connect(owner).mint(player.address, initialPlayerBalance);

        await mockToken.connect(player).approve(launchesAddress, initialPlayerBalance);
    });

    // --- 测试套件 ---

    describe("部署与初始状态检查", function () {
        it("应该设置正确的 owner", async function () {
            expect(await launches.owner()).to.equal(owner.address);
        });

        it("应该设置正确的 authorizer", async function () {
            expect(await launches.authorizer()).to.equal(authorizer.address);
        });

        it("模拟代币的 Vault 地址应该设置正确", async function () {
            expect(await launches.tokenVault(mockToken.getAddress())).to.equal(vault.address);
        });
    });

    describe("Vault 管理功能 (setTokenVault, removeTokenVault)", function () {
        let newToken: MockERC20;
        let newTokenAddress: string;

        before(async function () {

            const NTFactory = await ethers.getContractFactory("MockERC20", owner);
            newToken = await NTFactory.deploy("新代币", "NTK", owner.address);
            await newToken.waitForDeployment();
            newTokenAddress = await newToken.getAddress();
        });

        it("Owner 应该能为新代币设置 Vault", async function () {
            const newVaultAddr = otherAccount.address;

            await expect(launches.connect(owner).setTokenVault(newTokenAddress, newVaultAddr))
                .to.emit(launches, "TokenVaultSet")
                .withArgs(newTokenAddress, ethers.ZeroAddress, newVaultAddr);

            expect(await launches.tokenVault(newTokenAddress)).to.equal(newVaultAddr);
        });

        it("Owner 应该能更新已存在的 Vault", async function () {
            const currentVault = await launches.tokenVault(newTokenAddress);
            const updatedVaultAddr = otherAccount.address;
            await expect(launches.connect(owner).setTokenVault(newTokenAddress, updatedVaultAddr))
                .to.emit(launches, "TokenVaultSet")
                .withArgs(newTokenAddress, currentVault, updatedVaultAddr);
            expect(await launches.tokenVault(newTokenAddress)).to.equal(updatedVaultAddr);
        });

        it("非 Owner 不应该能设置 Vault", async function () {

            await expect(launches.connect(otherAccount).setTokenVault(newTokenAddress, otherAccount.address))
                .to.be.revertedWithCustomError(launches, "OwnableUnauthorizedAccount")
                .withArgs(otherAccount.address);

        });

        it("Owner 应该能移除已存在的 Vault", async function () {
            const tokenAddr = await newToken.getAddress();
            const currentVault = await launches.tokenVault(tokenAddr);
            await expect(launches.connect(owner).removeTokenVault(tokenAddr))
                .to.emit(launches, "TokenVaultRemoved")
                .withArgs(tokenAddr, currentVault);

            expect(await launches.tokenVault(tokenAddr)).to.equal(ethers.ZeroAddress);
        });

        it("非 Owner 不应该能移除 Vault", async function () {
            await expect(launches.connect(otherAccount).removeTokenVault(await mockToken.getAddress()))
                .to.be.revertedWithCustomError(launches, "OwnableUnauthorizedAccount")
                .withArgs(otherAccount.address);
        });

        it("移除不存在的 Vault 应该失败", async function () {

            await expect(launches.connect(owner).removeTokenVault(newTokenAddress))
                .to.be.revertedWith("PVP: Vault for this token does not exist");
        });
    });

    describe("startGame 功能测试", function () {
        let deadline: bigint;
        let signature: string;
        let chainId: bigint;
        let launchesAddress: string;
        let mockTokenAddress: string;

        beforeEach(async function () {

            const latestTimestamp = await time.latest();
            deadline = BigInt(latestTimestamp + 3600);
            chainId = (await ethers.provider.getNetwork()).chainId;
            launchesAddress = await launches.getAddress();
            mockTokenAddress = await mockToken.getAddress();

            // 生成有效的签名
            signature = await generateSignature(
                authorizer, chainId, launchesAddress, player.address,
                GAME_ID_1, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline
            );
        });

        it("应该允许玩家使用有效签名成功开始游戏", async function () {
            const playerInitialBalance = await mockToken.balanceOf(player.address);
            const vaultInitialBalance = await mockToken.balanceOf(vault.address);

            // 玩家连接合约并调用 startGame
            const tx = await launches.connect(player).startGame(
                GAME_ID_1, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline, signature
            );

            // 1. 检查是否触发了 GameStarted 事件及参数
            await expect(tx)
                .to.emit(launches, "GameStarted")
                .withArgs(GAME_ID_1, COMMITMENT_1, player.address, mockTokenAddress, AMOUNT_1, RATE_1);

            // 2. 检查 gameData 状态是否正确更新
            const game = await launches.gameData(GAME_ID_1);
            expect(game.player).to.equal(player.address);
            expect(game.gameID).to.equal(GAME_ID_1);
            expect(game.commitment).to.equal(COMMITMENT_1);
            expect(game.token).to.equal(mockTokenAddress);
            expect(game.amount).to.equal(AMOUNT_1);
            expect(game.rate).to.equal(RATE_1);

            // 3. 检查代币是否从玩家转移到了 Vault
            expect(await mockToken.balanceOf(player.address)).to.equal(playerInitialBalance - AMOUNT_1);
            expect(await mockToken.balanceOf(vault.address)).to.equal(vaultInitialBalance + AMOUNT_1);
        });

        it("如果签名已过期，应该失败", async function () {
            // 使用 Hardhat 网络助手将时间快进到 deadline 之后
            await time.increaseTo(deadline + 1n); // 快进到过期时间点后 1 秒

            // 期望调用失败并返回特定错误信息
            await expect(
                launches.connect(player).startGame(
                    GAME_ID_1, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline, signature
                )
            ).to.be.revertedWith("PVP: The signature has expired");
        });

        it("如果 gameID 已被使用，应该失败", async function () {
            // 第一次成功调用
            const gameID = 2n;

            const sig = await generateSignature(
                authorizer, chainId, launchesAddress, player.address,
                gameID, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline
            );

            await launches.connect(player).startGame(
                gameID, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline, sig
            );

            // 第二次使用相同的 gameID 调用
            await expect(
                launches.connect(player).startGame(
                    gameID, // 相同的 Game ID
                    COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline, sig
                )
            ).to.be.revertedWith("PVP: orderID has been completed"); // 错误消息可能需要根据合约调整
        });

        it("如果代币未被添加到白名单（Vault 未设置），应该失败", async function () {
            // 部署一个新代币，但不为其设置 Vault
            const NTFactory = await ethers.getContractFactory("MockERC20", owner);
            const newToken = await NTFactory.deploy("未列出代币", "ULT", owner.address);
            await newToken.waitForDeployment();
            const newTokenAddress = await newToken.getAddress();

            // 为玩家准备代币和授权
            await newToken.connect(owner).mint(player.address, AMOUNT_1);
            await newToken.connect(player).approve(launchesAddress, AMOUNT_1);

            const gameID = deadline;

            // 为这个未列出的代币生成签名
            const unlistedSig = await generateSignature(
                authorizer, chainId, launchesAddress, player.address,
                gameID, COMMITMENT_1, newTokenAddress, AMOUNT_1, RATE_1, deadline // 关键：使用新代币地址
            );

            // 期望调用失败
            await expect(
                launches.connect(player).startGame(
                    gameID, COMMITMENT_1, newTokenAddress, AMOUNT_1, RATE_1, deadline, unlistedSig
                )
            ).to.be.revertedWith("PVP: Token not whitelisted");
        });

        it("如果签名无效（签名者错误），应该失败", async function () {
            // 让错误的账户 (otherAccount) 进行签名
            const gameID = 3n
            const invalidSignature = await generateSignature(
                otherAccount, // 错误的签名者
                chainId, launchesAddress, player.address,
                gameID, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline
            );

            await expect(
                launches.connect(player).startGame(
                    gameID, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline, invalidSignature
                )
            ).to.be.revertedWith("PVP: Invalid signature"); // 这是来自 _verifySign 的检查
        });

        it("如果签名数据与输入参数不匹配（例如金额被篡改），应该失败", async function () {
            const gameID = 4n;
            const tamperedAmount = AMOUNT_1 / 2n; // 篡改签名中的金额
            const invalidSignature = await generateSignature(
                authorizer, chainId, launchesAddress, player.address,
                gameID, COMMITMENT_1, mockTokenAddress,
                tamperedAmount, // 使用篡改后的金额生成签名
                RATE_1, deadline
            );

            // 调用 startGame 时使用原始的 AMOUNT_1，但这与签名的内容不符
            await expect(
                launches.connect(player).startGame(
                    gameID, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline, invalidSignature
                )
            ).to.be.revertedWith("PVP: Invalid signature"); // 签名验证会失败
        });

        it("如果玩家的代币授权额度不足，应该失败", async function () {

            const gameID = 5n;

            const sig = await generateSignature(
                authorizer,
                chainId, launchesAddress, player.address,
                gameID, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline
            );

            // 玩家将授权额度降低到低于所需金额
            await mockToken.connect(player).approve(launchesAddress, AMOUNT_1 / 2n);

            // SafeERC20 的 safeTransferFrom 会检查额度
            await expect(
                launches.connect(player).startGame(
                    gameID, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline, sig
                )
            ).to.be.revertedWith("ERC20: insufficient allowance"); // 来自 SafeERC20 的错误
        });

        it("如果玩家的代币余额不足，应该失败", async function () {

            const gameID = 5n;

            const sig = await generateSignature(
                authorizer,
                chainId, launchesAddress, player.address,
                gameID, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline
            );

            // 将玩家的代币全部转移走，使其余额不足
            const playerBalance = await mockToken.balanceOf(player.address);
            await mockToken.connect(player).transfer(otherAccount.address, playerBalance);

            // SafeERC20 的 safeTransferFrom 会检查余额
            await expect(
                launches.connect(player).startGame(
                    gameID, COMMITMENT_1, mockTokenAddress, AMOUNT_1, RATE_1, deadline, sig
                )
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance"); // 来自 SafeERC20 的错误
        });

    });
});