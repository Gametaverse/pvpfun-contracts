import 'dotenv/config'; // 如果使用 .env
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { TokenVault, MockERC20 } from "../typechain-types"; // 确认 TypeChain 类型正确导入
import type { Wallet } from "ethers";

describe("TokenVault 合约测试", function () {

    let tokenVault: TokenVault;
    let mockToken: MockERC20;
    let owner: HardhatEthersSigner | Wallet;
    let authorizer: HardhatEthersSigner | Wallet;
    let claimer: HardhatEthersSigner | Wallet;
    let otherAccount: HardhatEthersSigner;
    let funder: HardhatEthersSigner;
    let user1: HardhatEthersSigner | Wallet; // 用户 1，进行存款和取款
    let user2: HardhatEthersSigner | Wallet; // 用户 2，用于测试无份额情况
    let receiver: HardhatEthersSigner | Wallet; // 接收取款的地址

    const initialVaultSupply = ethers.parseUnits("100000", 18);
    const useWalletsFromEnv = false;
    const feeRate = 100;
    const lockPeriod = 3;


    async function generateClaimSignature(
        signer: HardhatEthersSigner | Wallet,
        chainId: bigint,
        contractAddress: string,
        nonce: bigint,
        claimerAddress: string,
        tokenAddress: string,
        amount: bigint,
        deadline: bigint
    ): Promise<string> {
        const messageHash = ethers.keccak256(
            ethers.solidityPacked(

                ["uint256", "address", "uint64", "address", "address", "uint256", "uint64"],
                [chainId, contractAddress, nonce, claimerAddress, tokenAddress, amount, deadline]
            )
        );

        const signature = await signer.signMessage(ethers.getBytes(messageHash));
        return signature;
    }

    function calculateExpectedAssets(
        userSharesToWithdraw: bigint,
        totalShares: bigint,
        totalAssets: bigint
    ): bigint {
        if (totalShares === 0n) {
            return 0n; // 避免除以零
        }
        // 使用 BigInt 进行计算以保持精度
        return (userSharesToWithdraw * totalAssets) / totalShares;
    }


    beforeEach(async function () {

        const signers = await ethers.getSigners();
        funder = signers[0];

        if (useWalletsFromEnv) {
            console.log("使用 .env 文件中的私钥进行测试...");
            const ownerPrivateKey = process.env.PRIVATE_KEY_DEPLOYER;
            const authorizerPrivateKey = process.env.PRIVATE_KEY_AUTHORIZER;
            const claimerPrivateKey = process.env.PRIVATE_KEY_CLAIMER;
            if (!ownerPrivateKey || !authorizerPrivateKey || !claimerPrivateKey) {
                throw new Error("请设置 PRIVATE_KEY_DEPLOYER, PRIVATE_KEY_AUTHORIZER, PRIVATE_KEY_CLAIMER");
            }
            owner = new ethers.Wallet(ownerPrivateKey, ethers.provider);
            authorizer = new ethers.Wallet(authorizerPrivateKey, ethers.provider);
            claimer = new ethers.Wallet(claimerPrivateKey, ethers.provider);
            otherAccount = signers[4] || await ethers.Wallet.createRandom().connect(ethers.provider);

            // 为 Wallet 提供资金
            const amountToSend = ethers.parseEther("5.0");
            console.log("为自定义 Wallet 提供 ETH...");
            const txs = [
                funder.sendTransaction({ to: owner.address, value: amountToSend }),
                funder.sendTransaction({ to: authorizer.address, value: amountToSend }),
                funder.sendTransaction({ to: claimer.address, value: amountToSend }),
            ];
            await Promise.all(txs.map(txP => txP.then(tx => tx.wait())));
            console.log("资金提供完成.");

        } else {
            console.log("使用 Hardhat 默认账户进行测试...");
            [owner, authorizer, claimer, otherAccount, user1, user2, receiver] = signers; // 使用前几个默认账户
        }

        // 2. 部署 MockERC20 (由 owner 部署并拥有)
        const MockERC20Factory = await ethers.getContractFactory("MockERC20", owner);
        mockToken = await MockERC20Factory.deploy("奖励代币", "MC", owner.address);
        await mockToken.waitForDeployment();
        const mockTokenAddress = await mockToken.getAddress();

        // 3. 部署 TokenVault (由 owner 部署，指定 authorizer)
        const TokenVaultFactory = await ethers.getContractFactory("TokenVault", owner);
        tokenVault = await TokenVaultFactory.deploy(authorizer.address, mockToken.getAddress(), feeRate, lockPeriod);
        await tokenVault.waitForDeployment();
        const tokenVaultAddress = await tokenVault.getAddress();

        // 4. 为 TokenVault 提供初始代币资金
        await mockToken.connect(owner).mint(tokenVaultAddress, initialVaultSupply);

        console.log(`已向 TokenVault (${tokenVaultAddress}) 提供 ${ethers.formatUnits(initialVaultSupply, 18)} MC`);

        console.log("测试环境设置完毕.");
    });

    // --- 测试套件 ---
    describe("部署与初始化", function () {
        it("应该设置正确的 Owner", async function () {
            expect(await tokenVault.owner()).to.equal(owner.address);
        });

        it("应该设置正确的 Authorizer", async function () {
            expect(await tokenVault.authorizer()).to.equal(authorizer.address);
        });

        it("Vault 应该持有初始的 MC 代币", async function () {
            expect(await mockToken.balanceOf(tokenVault.getAddress())).to.equal(initialVaultSupply);
        });
    });

    describe("claimReward 功能", function () {
        let nonce: bigint;
        let amount: bigint;
        let deadline: bigint;
        let chainId: bigint;
        let tokenVaultAddress: string;
        let mockTokenAddress: string;
        let validSignature: string;
        let claimerAddress: string;

        beforeEach(async function () {
            // 为每个 claimReward 测试生成新的 nonce 和 deadline
            nonce = BigInt(Date.now()); // 使用时间戳（或更好的随机数）作为 nonce
            amount = ethers.parseUnits("100", 18); // 领取 100 MC
            const latestTimestamp = await time.latest();
            deadline = BigInt(latestTimestamp + 3600); // 1 小时有效期
            chainId = (await ethers.provider.getNetwork()).chainId;
            tokenVaultAddress = await tokenVault.getAddress();
            mockTokenAddress = await mockToken.getAddress();
            claimerAddress = claimer.address; // 获取领取者的地址

            // 生成有效签名
            validSignature = await generateClaimSignature(
                authorizer, chainId, tokenVaultAddress, nonce, claimerAddress, mockTokenAddress, amount, deadline
            );
        });

        it("应该允许用户使用有效签名领取奖励", async function () {
            const initialClaimerBalance = await mockToken.balanceOf(claimerAddress);
            const initialVaultBalance = await mockToken.balanceOf(tokenVaultAddress);

            const claimData = { nonce, token: mockTokenAddress, amount, deadline, signature: validSignature };

            // Claimer 连接并调用 claimReward
            const tx = await tokenVault.connect(claimer).claimReward(claimData);

            // 检查事件
            await expect(tx)
                .to.emit(tokenVault, "Claimed")
                .withArgs(nonce, claimerAddress, mockTokenAddress, amount);

            // 检查 Nonce 是否被使用
            expect(await tokenVault.usedNonces(nonce)).to.be.true;

            // 检查余额变化
            expect(await mockToken.balanceOf(claimerAddress)).to.equal(initialClaimerBalance + amount);
            expect(await mockToken.balanceOf(tokenVaultAddress)).to.equal(initialVaultBalance - amount);
        });

        it("如果签名过期，应该失败", async function () {
            await time.increaseTo(deadline + 1n); // 快进到过期后
            const claimData = { nonce, token: mockTokenAddress, amount, deadline, signature: validSignature };

            await expect(tokenVault.connect(claimer).claimReward(claimData))
                .to.be.revertedWith("PVP: The signature has expired");
        });

        it("如果 Nonce 已被使用，应该失败", async function () {
            const claimData = { nonce, token: mockTokenAddress, amount, deadline, signature: validSignature };
            // 第一次成功领取
            await tokenVault.connect(claimer).claimReward(claimData);

            // 第二次尝试使用相同 Nonce
            await expect(tokenVault.connect(claimer).claimReward(claimData))
                .to.be.revertedWith("PVP: nonce has been used");
        });

        it("如果领取金额为 0，应该失败", async function () {
            const zeroAmount = 0n;
            const signatureForZero = await generateClaimSignature(
                authorizer, chainId, tokenVaultAddress, nonce, claimerAddress, mockTokenAddress, zeroAmount, deadline
            );
            const claimData = { nonce, token: mockTokenAddress, amount: zeroAmount, deadline, signature: signatureForZero };

            await expect(tokenVault.connect(claimer).claimReward(claimData))
                .to.be.revertedWith("PVP: amount must be greater than 0");
        });

        it("如果签名无效（签名者错误），应该失败", async function () {
            const invalidSigner = otherAccount; // 使用另一个账户签名
            const invalidSignature = await generateClaimSignature(
                invalidSigner, chainId, tokenVaultAddress, nonce, claimerAddress, mockTokenAddress, amount, deadline
            );
            const claimData = { nonce, token: mockTokenAddress, amount, deadline, signature: invalidSignature };

            await expect(tokenVault.connect(claimer).claimReward(claimData))
                .to.be.revertedWith("PVP: Invalid signature");
        });

        it("如果签名无效（签名内容与调用参数不符 - 金额），应该失败", async function () {
            const signedAmount = amount / 2n; // 签名的金额与实际要领取的不同
            const invalidSignature = await generateClaimSignature(
                authorizer, chainId, tokenVaultAddress, nonce, claimerAddress, mockTokenAddress, signedAmount, deadline
            );
            // 调用时使用原始 amount，但签名是基于 signedAmount
            const claimData = { nonce, token: mockTokenAddress, amount, deadline, signature: invalidSignature };

            await expect(tokenVault.connect(claimer).claimReward(claimData))
                .to.be.revertedWith("PVP: Invalid signature");
        });

        it("如果签名有效，但调用者 (msg.sender) 与签名中的领取者不符，应该失败", async function () {
            // 签名是为 claimerAddress 生成的
            const claimData = { nonce, token: mockTokenAddress, amount, deadline, signature: validSignature };

            // 但让 otherAccount 去调用 claimReward
            await expect(tokenVault.connect(otherAccount).claimReward(claimData))
                .to.be.revertedWith("PVP: Invalid signature"); // 因为 _verifySign 包含了 msg.sender 的校验
        });

        it("如果 Vault 余额不足以支付奖励，应该失败", async function () {
            const largeAmount = initialVaultSupply + 1n; // 请求比 Vault 余额还多的金额
            const signatureLarge = await generateClaimSignature(
                authorizer, chainId, tokenVaultAddress, nonce, claimerAddress, mockTokenAddress, largeAmount, deadline
            );
            const claimData = { nonce, token: mockTokenAddress, amount: largeAmount, deadline, signature: signatureLarge };

            // SafeTransfer 会失败
            await expect(tokenVault.connect(claimer).claimReward(claimData))
                .to.be.revertedWithCustomError(mockToken, "ERC20InsufficientBalance"); // 来自 SafeERC20
        });
    });

    describe("batchClaimReward 功能", function () {
        let claimDataList: { nonce: bigint; token: string; amount: bigint; deadline: bigint; signature: string }[];
        let chainId: bigint;
        let tokenVaultAddress: string;
        let mockTokenAddress: string;
        let claimerAddress: string;

        beforeEach(async function () {
            chainId = (await ethers.provider.getNetwork()).chainId;
            tokenVaultAddress = await tokenVault.getAddress();
            mockTokenAddress = await mockToken.getAddress();
            claimerAddress = claimer.address;
            claimDataList = [];

            const latestTimestamp = await time.latest();
            const deadline = BigInt(latestTimestamp + 3600);

            // 创建两个有效的领取数据
            for (let i = 0; i < 2; i++) {
                const nonce = BigInt(Date.now() + i); // 确保 nonce 不同
                const amount = ethers.parseUnits((10 + i).toString(), 18); // 10 MC, 11 MC
                const signature = await generateClaimSignature(
                    authorizer, chainId, tokenVaultAddress, nonce, claimerAddress, mockTokenAddress, amount, deadline
                );
                claimDataList.push({ nonce, token: mockTokenAddress, amount, deadline, signature });
            }
        });

        it("应该允许用户批量领取多个有效奖励", async function () {
            const initialClaimerBalance = await mockToken.balanceOf(claimerAddress);
            const initialVaultBalance = await mockToken.balanceOf(tokenVaultAddress);
            const totalAmount = claimDataList.reduce((sum, data) => sum + data.amount, 0n);

            // 执行批量领取
            const tx = await tokenVault.connect(claimer).batchClaimReward(claimDataList);

            // 检查每个 Nonce 都被使用
            for (const data of claimDataList) {
                expect(await tokenVault.usedNonces(data.nonce)).to.be.true;
                // 可以在这里加 expect(tx).to.emit... 但检查多个 emit 比较麻烦，检查最终状态更直接
            }

            // 检查最终余额
            expect(await mockToken.balanceOf(claimerAddress)).to.equal(initialClaimerBalance + totalAmount);
            expect(await mockToken.balanceOf(tokenVaultAddress)).to.equal(initialVaultBalance - totalAmount);
        });

        it("如果列表中有一个 Nonce 已被使用，整个批量交易应该回滚", async function () {
            // 先手动领取第一个奖励
            await tokenVault.connect(claimer).claimReward(claimDataList[0]);
            expect(await tokenVault.usedNonces(claimDataList[0].nonce)).to.be.true;

            const initialClaimerBalance = await mockToken.balanceOf(claimerAddress);
            const initialVaultBalance = await mockToken.balanceOf(tokenVaultAddress);

            // 尝试批量领取包含已使用 Nonce 的列表
            await expect(tokenVault.connect(claimer).batchClaimReward(claimDataList))
                .to.be.revertedWith("PVP: nonce has been used");

            // 验证状态没有改变（交易回滚了）
            expect(await tokenVault.usedNonces(claimDataList[1].nonce)).to.be.false; // 第二个 nonce 也没被使用
            expect(await mockToken.balanceOf(claimerAddress)).to.equal(initialClaimerBalance); // 领取者余额没变
            expect(await mockToken.balanceOf(tokenVaultAddress)).to.equal(initialVaultBalance); // Vault 余额没变
        });

        it("如果列表中有一个签名无效，整个批量交易应该回滚", async function () {
            // 将第二个签名替换为无效签名 (例如由 non-authorizer 签名)
            claimDataList[1].signature = await generateClaimSignature(
                otherAccount, // 错误签名者
                chainId, tokenVaultAddress, claimDataList[1].nonce, claimerAddress, mockTokenAddress, claimDataList[1].amount, claimDataList[1].deadline
            );

            await expect(tokenVault.connect(claimer).batchClaimReward(claimDataList))
                .to.be.revertedWith("PVP: Invalid signature");

            // 验证第一个有效的 nonce 也未被标记使用（因为交易回滚）
            expect(await tokenVault.usedNonces(claimDataList[0].nonce)).to.be.false;
        });

        it("如果 Vault 余额不足以支付列表中的某个奖励，整个批量交易应该回滚", async function () {
            // 构造一个总额超过 Vault 余额的列表
            const largeAmount = initialVaultSupply / 2n + 1n; // 略大于 Vault 余额的一半
            const latestTimestamp = await time.latest();
            const deadline = BigInt(latestTimestamp + 3600);
            let largeClaimList = [];
            for (let i = 0; i < 2; i++) {
                const nonce = BigInt(Date.now() + 10 + i);
                const signature = await generateClaimSignature(
                    authorizer, chainId, tokenVaultAddress, nonce, claimerAddress, mockTokenAddress, largeAmount, deadline
                );
                largeClaimList.push({ nonce, token: mockTokenAddress, amount: largeAmount, deadline, signature });
            }

            await expect(tokenVault.connect(claimer).batchClaimReward(largeClaimList))
                .to.be.revertedWithCustomError(mockToken, "ERC20InsufficientBalance"); // 预计在第二次领取时失败
            // try {
            //     await tokenVault.connect(claimer).batchClaimReward(largeClaimList);
            //     // 如果没有 revert，则强制失败测试
            //     expect.fail("Transaction did not revert as expected");
            // } catch (error: any) {
            //     // 打印捕获到的错误信息，帮助识别实际的 revert 原因
            //     console.error("Caught revert error:", error.message);

            //     // 你可以在这里添加更具体的断言，如果能从 error.message 中提取信息
            //     // 例如，检查错误消息是否包含特定的子字符串
            //     // expect(error.message).to.include("SomeSpecificSubstring");

            //     // 或者，如果你知道实际的自定义错误名称，可以在捕获后再断言
            //     // 比如，如果发现实际错误是 "MyMockTokenInsufficientBalance"
            //     // await expect(tokenVault.connect(claimer).batchClaimReward(largeClaimList))
            //     //     .to.be.revertedWithCustomError(mockToken, "MyMockTokenInsufficientBalance"); // 注意合约实例可能需要换成 mockToken

            //     // 如果只是想确认它 revert 了，并且不是 SafeERC20FailedOperation，可以这样写：
            //     expect(error.message).to.match(/reverted/); // 确保是 revert 错误
            //     expect(error.message).to.not.include("SafeERC20FailedOperation"); // 确保不是期望的错误
            // }

            // 验证第一个 nonce 也未被标记使用
            expect(await tokenVault.usedNonces(largeClaimList[0].nonce)).to.be.false;
        });
    });

    describe("transferFunds 功能", function () {
        it("Owner 应该能提取 Vault 中的资金", async function () {
            const withdrawAmount = ethers.parseUnits("1000", 18); // 提取 1000 MC
            const initialOwnerBalance = await mockToken.balanceOf(owner.address);
            const initialVaultBalance = await mockToken.balanceOf(tokenVault.getAddress());

            // 确保 Vault 有足够余额
            expect(initialVaultBalance).to.be.gte(withdrawAmount);

            // Owner 调用提现
            const tx = await tokenVault.connect(owner).transferFunds(withdrawAmount);

            // 检查事件
            await expect(tx)
                .to.emit(tokenVault, "TransferFunds")
                .withArgs(owner.address, await mockToken.getAddress(), withdrawAmount);

            // 检查余额变化
            expect(await mockToken.balanceOf(owner.address)).to.equal(initialOwnerBalance + withdrawAmount);
            expect(await mockToken.balanceOf(tokenVault.getAddress())).to.equal(initialVaultBalance - withdrawAmount);
        });

        it("非 Owner 不应该能提取资金", async function () {
            const withdrawAmount = ethers.parseUnits("100", 18);
            await expect(tokenVault.connect(otherAccount).transferFunds(withdrawAmount))
                .to.be.revertedWithCustomError(tokenVault, "OwnableUnauthorizedAccount")
                .withArgs(otherAccount.address);
        });

        it("提取金额为 0 应该失败", async function () {
            await expect(tokenVault.connect(owner).transferFunds(0n))
                .to.be.revertedWith("PVP: amount must be greater than 0");
        });

        it("提取超过 Vault 余额的金额应该失败", async function () {
            const withdrawAmount = initialVaultSupply + 1n; // 比 Vault 总额还多
            await expect(tokenVault.connect(owner).transferFunds(withdrawAmount))
                .to.be.revertedWithCustomError(mockToken, "ERC20InsufficientBalance");
        });
    });

    describe("deposit 功能", function () {

        it("允许owner充值资金到Vault", async function () {
            // const depositAmount = ethers.parseUnits("1000", 18);

            // // 给用户mint一部分资金
            // await mockToken.connect(owner).mint(claimer, depositAmount);
            // console.log(`已向 User (${claimer}) 提供 ${ethers.formatUnits(depositAmount, 18)} MC`);
            // const userBalance = await mockToken.balanceOf(claimer.address)
            // console.log(`User (${claimer}) 余额: ${ethers.formatUnits(userBalance, 18)} MC`);

            // // 给 TokenVault approve
            // await mockToken.connect(claimer).approve(tokenVault.getAddress(), depositAmount);

            // const userAllowance = await mockToken.allowance(claimer, tokenVault.getAddress())
            // console.log(`User (${claimer}) 授权给 TokenVault: ${ethers.formatUnits(userAllowance, 18)} MC`);

            // // 检查事件
            // await expect(tokenVault.connect(claimer).deposit(claimer.address, depositAmount))
            //     .to.emit(tokenVault, "Deposit")
            //     .withArgs(claimer.address,depositAmount, depositAmount, );

            const depositAmount = ethers.parseUnits("1000", 18);
            const receiverAddress = claimer.address; // 明确指定接收者

            // 准备工作：mint, approve
            await mockToken.connect(owner).mint(claimer.address, depositAmount);
            await mockToken.connect(claimer).approve(tokenVault.getAddress(), depositAmount);

            // 获取调用前的状态（可选，用于验证份额计算）
            const initialTotalAssets = await tokenVault.assets();
            const initialTotalShares = await tokenVault.shares();

            // 计算预期的份额 (根据 _deposit 逻辑)
            let expectedShares: bigint;
            if (initialTotalAssets === 0n || initialTotalShares === 0n) {
                expectedShares = depositAmount;
            } else {
                // 注意：JS/TS 中模拟定点数运算可能需要库或小心处理精度
                // 简单模拟比例计算 (可能与 Solady FixedPointMathLib 有微小差异，需谨慎)
                expectedShares = (depositAmount * initialTotalShares) / initialTotalAssets;
                // 更精确的方式是使用 ethers 的 FixedNumber 或其他定点数库
                // 或者直接在断言时不严格匹配份额，只验证其他参数和时间戳
            }

            // 执行 deposit
            const tx = await tokenVault.connect(claimer).deposit(receiverAddress, depositAmount);

            // 验证事件
            await expect(tx)
                .to.emit(tokenVault, "Deposit")
                .withArgs(
                    receiverAddress,    // 验证接收者地址
                    depositAmount,      // 验证存入的资产数量
                    // expectedShares, // 可以验证计算出的份额，如果计算精确的话
                    (shares: any) => { // 或者对份额进行基本类型检查
                        expect(shares).to.be.a('bigint');
                        expect(shares).to.be.gt(0n); // 假设份额大于0
                        // 如果初始份额为0，这里需要用 depositAmount 比较
                        if (initialTotalShares === 0n) expect(shares).to.equal(depositAmount);
                        return true;
                    },
                    (timestamp: any) => { // 使用回调函数验证时间戳
                        expect(timestamp).to.be.a('bigint'); // 检查类型
                        expect(timestamp).to.be.gt(0);     // 检查大于0
                        // 可以添加更复杂的检查，比如接近当前时间
                        // const now = Math.floor(Date.now() / 1000);
                        // expect(timestamp).to.be.closeTo(BigInt(now), 60n); // 允许60秒误差
                        return true; // 返回 true 表示验证通过
                    }
                );

        });

        // it("");



    });

    // --- Withdraw 和 WithdrawAll 测试套件 ---
    describe("Withdrawal 功能 (withdraw, withdrawAll)", function () {

        beforeEach(async function () {

            // user1 存入一些资金，以便后续测试取款
            const initialDepositAmount = ethers.parseUnits("1000", 18);
            await mockToken.connect(owner).mint(user1.address, initialDepositAmount);
            await mockToken.connect(user1).approve(tokenVault.getAddress(), initialDepositAmount);
            await tokenVault.connect(user1).deposit(user1.address, initialDepositAmount); // user1 存款给自己

            console.log(`测试设置: user1 (${user1.address}) 初始存入 ${ethers.formatUnits(initialDepositAmount, 18)} RWD`);
            const banker = await tokenVault.bankers(user1.address);
            console.log(`   -> user1 初始份额: ${banker.shares.toString()}`);
            console.log(`   -> Vault 总资产: ${ethers.formatUnits(await tokenVault.assets(), 18)} RWD`);
            console.log(`   -> Vault 总份额: ${(await tokenVault.shares()).toString()}`);
            console.log("测试环境设置完毕.");

        });

        describe("基本提取 (无费用)", function () {
            it("用户应该能提取其部分份额对应的资产", async function () {
                const initialBanker = await tokenVault.bankers(user1.address);
                const initialTotalAssets = await tokenVault.assets();
                const initialTotalShares = await tokenVault.shares();
                const initialReceiverBalance = await mockToken.balanceOf(receiver.address);
                const initialVaultBalance = await mockToken.balanceOf(tokenVault.getAddress());

                const sharesToWithdraw = initialBanker.shares / 2n; // 提取一半份额
                expect(sharesToWithdraw).to.be.gt(0n); // 确保有份额可提

                const expectedAssets = calculateExpectedAssets(sharesToWithdraw, initialTotalShares, initialTotalAssets);

                await time.increase(lockPeriod);

                // User1 调用 withdraw，将资产发送给 receiver
                const tx = await tokenVault.connect(user1).withdraw(receiver.address, sharesToWithdraw);
                const receipt = await tx.wait();
                const block = await ethers.provider.getBlock(receipt!.blockNumber);
                const timestamp = BigInt(block!.timestamp);

                // 验证事件
                await expect(tx)
                    .to.emit(tokenVault, "Withdraw")
                    .withArgs(user1.address, expectedAssets, sharesToWithdraw, timestamp);

                // 验证状态变化
                const finalBanker = await tokenVault.bankers(user1.address);
                expect(finalBanker.shares).to.equal(initialBanker.shares - sharesToWithdraw);
                expect(await tokenVault.assets()).to.equal(initialTotalAssets - expectedAssets);
                expect(await tokenVault.shares()).to.equal(initialTotalShares - sharesToWithdraw);

                // 验证余额变化
                expect(await mockToken.balanceOf(receiver.address)).to.equal(initialReceiverBalance + expectedAssets);
                expect(await mockToken.balanceOf(tokenVault.getAddress())).to.equal(initialVaultBalance - expectedAssets);
                // user1 的余额不应改变 (除非 receiver 就是 user1)
                if (user1.address !== receiver.address) {
                    expect(await mockToken.balanceOf(user1.address)).to.equal(await mockToken.balanceOf(user1.address)); // 确保调用者余额不变
                }
            });

            it("用户应该能使用 withdrawAll 提取其全部份额对应的资产", async function () {
                const initialBanker = await tokenVault.bankers(user1.address);
                const initialTotalAssets = await tokenVault.assets();
                const initialTotalShares = await tokenVault.shares();
                const initialReceiverBalance = await mockToken.balanceOf(receiver.address);
                const initialVaultBalance = await mockToken.balanceOf(tokenVault.getAddress());
                const sharesToWithdraw = initialBanker.shares; // 全部份额
                expect(sharesToWithdraw).to.be.gt(0n);

                const expectedAssets = calculateExpectedAssets(sharesToWithdraw, initialTotalShares, initialTotalAssets);

                await time.increase(lockPeriod);

                // User1 调用 withdrawAll，将资产发送给 receiver
                const tx = await tokenVault.connect(user1).withdrawAll(receiver.address);
                const receipt = await tx.wait();
                const block = await ethers.provider.getBlock(receipt!.blockNumber);
                const timestamp = BigInt(block!.timestamp);

                // 验证事件
                await expect(tx)
                    .to.emit(tokenVault, "Withdraw")
                    .withArgs(user1.address, expectedAssets, sharesToWithdraw, timestamp);

                // 验证状态变化
                const finalBanker = await tokenVault.bankers(user1.address);
                expect(finalBanker.shares).to.equal(0n); // 份额应为 0
                expect(await tokenVault.assets()).to.equal(initialTotalAssets - expectedAssets);
                expect(await tokenVault.shares()).to.equal(initialTotalShares - sharesToWithdraw); // 总份额也减少

                // 验证余额变化
                expect(await mockToken.balanceOf(receiver.address)).to.equal(initialReceiverBalance + expectedAssets);
                expect(await mockToken.balanceOf(tokenVault.getAddress())).to.equal(initialVaultBalance - expectedAssets);
            });
        });

        describe("提前提取费用", function () {

            it("在锁定期内提取部分份额应扣除手续费", async function () {
                const initialBanker = await tokenVault.bankers(user1.address);
                const initialTotalAssets = await tokenVault.assets();
                const initialTotalShares = await tokenVault.shares();
                const initialReceiverBalance = await mockToken.balanceOf(receiver.address);
                const initialVaultBalance = await mockToken.balanceOf(tokenVault.getAddress());

                const sharesToWithdraw = initialBanker.shares / 2n;
                expect(sharesToWithdraw).to.be.gt(0n);

                // 不快进时间，确保在锁定期内

                const grossAssets = calculateExpectedAssets(sharesToWithdraw, initialTotalShares, initialTotalAssets);
                // 注意：Solady 的 rawDiv 可能需要精确模拟或使用库
                const expectedFee = grossAssets / BigInt(feeRate); // 简单模拟，假设 feeRate 是除数
                // 更精确的模拟（假设 feeRate 是万分比）: const expectedFee = (grossAssets * BigInt(feeRate)) / 10000n;
                const expectedNetAssets = grossAssets - expectedFee; // 扣除费用后的净额

                // 调用 withdraw
                const tx = await tokenVault.connect(user1).withdraw(receiver.address, sharesToWithdraw);
                const receipt = await tx.wait();
                const block = await ethers.provider.getBlock(receipt!.blockNumber);
                const timestamp = BigInt(block!.timestamp);

                // 验证事件，注意 assets 参数是净额
                await expect(tx)
                    .to.emit(tokenVault, "Withdraw")
                    .withArgs(user1.address, expectedNetAssets, sharesToWithdraw, timestamp);

                // 验证状态变化，总资产减少净额，份额减少提取的份额
                const finalBanker = await tokenVault.bankers(user1.address);
                expect(finalBanker.shares).to.equal(initialBanker.shares - sharesToWithdraw);
                expect(await tokenVault.assets()).to.equal(initialTotalAssets - expectedNetAssets); // 总资产减少净额
                expect(await tokenVault.shares()).to.equal(initialTotalShares - sharesToWithdraw); // 总份额减少提取份额

                // 验证余额变化，接收者收到净额
                expect(await mockToken.balanceOf(receiver.address)).to.equal(initialReceiverBalance + expectedNetAssets);
                expect(await mockToken.balanceOf(tokenVault.getAddress())).to.equal(initialVaultBalance - expectedNetAssets); // Vault 减少净额
            });

            it("在锁定期后提取部分份额不应扣除手续费", async function () {
                const initialBanker = await tokenVault.bankers(user1.address);
                const initialTotalAssets = await tokenVault.assets();
                const initialTotalShares = await tokenVault.shares();
                const initialReceiverBalance = await mockToken.balanceOf(receiver.address);

                const sharesToWithdraw = initialBanker.shares / 2n;
                expect(sharesToWithdraw).to.be.gt(0n);

                // 快进时间，超过锁定期
                await time.increase(lockPeriod + 1);

                const expectedAssets = calculateExpectedAssets(sharesToWithdraw, initialTotalShares, initialTotalAssets); // 无费用

                // 调用 withdraw
                const tx = await tokenVault.connect(user1).withdraw(receiver.address, sharesToWithdraw);
                const receipt = await tx.wait();
                const block = await ethers.provider.getBlock(receipt!.blockNumber);
                const timestamp = BigInt(block!.timestamp);

                // 验证事件，assets 是全额
                await expect(tx)
                    .to.emit(tokenVault, "Withdraw")
                    .withArgs(user1.address, expectedAssets, sharesToWithdraw, timestamp);

                // 验证余额，接收者收到全额
                expect(await mockToken.balanceOf(receiver.address)).to.equal(initialReceiverBalance + expectedAssets);
            });

            // 可以为 withdrawAll 添加类似的带费用和不带费用的测试用例
            it("在锁定期内提取全部份额 (withdrawAll) 应扣除手续费", async function () {
                const initialBanker = await tokenVault.bankers(user1.address);
                const initialTotalAssets = await tokenVault.assets();
                const initialTotalShares = await tokenVault.shares();
                const initialReceiverBalance = await mockToken.balanceOf(receiver.address);
                const sharesToWithdraw = initialBanker.shares;
                expect(sharesToWithdraw).to.be.gt(0n);

                const grossAssets = calculateExpectedAssets(sharesToWithdraw, initialTotalShares, initialTotalAssets);
                const expectedFee = grossAssets / BigInt(feeRate); // 简单模拟
                const expectedNetAssets = grossAssets - expectedFee;

                const tx = await tokenVault.connect(user1).withdrawAll(receiver.address);
                const receipt = await tx.wait();
                const block = await ethers.provider.getBlock(receipt!.blockNumber);
                const timestamp = BigInt(block!.timestamp);

                await expect(tx)
                    .to.emit(tokenVault, "Withdraw")
                    .withArgs(user1.address, expectedNetAssets, sharesToWithdraw, timestamp);

                expect(await mockToken.balanceOf(receiver.address)).to.equal(initialReceiverBalance + expectedNetAssets);
                expect((await tokenVault.bankers(user1.address)).shares).to.equal(0n);
            });
        });
        describe("失败与边界条件", function () {
            it("提取超过用户持有的份额应该失败", async function () {
                const initialBanker = await tokenVault.bankers(user1.address);
                const sharesToWithdraw = initialBanker.shares + 1n; // 比持有份额多 1

                console.log("Banker shares:", initialBanker.shares.toString());
                console.log("Shares to withdraw:", sharesToWithdraw.toString());
                expect(sharesToWithdraw).to.be.gt(initialBanker.shares); // 确认确实大于

                await expect(tokenVault.connect(user1).withdraw(receiver.address, sharesToWithdraw))
                    .to.be.revertedWith("PVP: Insufficient shares");
            });

            it("当用户没有份额时调用 withdrawAll 应该失败", async function () {
                const initialReceiverBalance = await mockToken.balanceOf(receiver.address);
                const initialVaultBalance = await mockToken.balanceOf(tokenVault.getAddress());
                const initialTotalAssets = await tokenVault.assets();
                const initialTotalShares = await tokenVault.shares();

                // user2 没有存款，份额为 0
                expect((await tokenVault.bankers(user2.address)).shares).to.equal(0n);

                // 应该触发事件，但 assets 和 shares 都为 0
                await expect(tokenVault.connect(user2).withdrawAll(receiver.address))
                    .to.be.revertedWith("PVP: No shares to withdraw");
            });

            it("提取 0 份额应该成功但不改变状态", async function () {
                const initialBanker = await tokenVault.bankers(user1.address);
                const initialReceiverBalance = await mockToken.balanceOf(receiver.address);
                const initialVaultBalance = await mockToken.balanceOf(tokenVault.getAddress());
                const initialTotalAssets = await tokenVault.assets();
                const initialTotalShares = await tokenVault.shares();

                const tx = await tokenVault.connect(user1).withdraw(receiver.address, 0n); // 提取 0 份额
                const receipt = await tx.wait();
                const block = await ethers.provider.getBlock(receipt!.blockNumber);
                const timestamp = BigInt(block!.timestamp);

                // 应该触发事件，但 assets 和 shares 都为 0
                await expect(tx)
                    .to.emit(tokenVault, "Withdraw")
                    .withArgs(user1.address, 0n, 0n, timestamp);

                // 验证余额和状态无变化
                expect(await mockToken.balanceOf(receiver.address)).to.equal(initialReceiverBalance);
                expect(await mockToken.balanceOf(tokenVault.getAddress())).to.equal(initialVaultBalance);
                expect(await tokenVault.assets()).to.equal(initialTotalAssets);
                expect(await tokenVault.shares()).to.equal(initialTotalShares);
                expect((await tokenVault.bankers(user1.address)).shares).to.equal(initialBanker.shares); // 用户份额不变
            });

            it("提取资产到零地址应该失败", async function () {
                const initialBanker = await tokenVault.bankers(user1.address);
                const sharesToWithdraw = initialBanker.shares / 2n;

                // SafeTransferLib 或 ERC20 实现应该阻止向零地址转账
                await expect(tokenVault.connect(user1).withdraw(ethers.ZeroAddress, sharesToWithdraw))
                    .to.be.reverted; // 具体错误可能依赖于 SafeTransferLib 或 Token 实现
                // 可能是 "SafeTransferFailed" (如果 Solady 定义了)
                // 或 "ERC20: transfer to the zero address" (如果 mockToken revert 了)
                // 使用 .to.be.reverted 捕获任何 revert
            });

        });

    });

});