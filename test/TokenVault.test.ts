import "dotenv/config"; // 如果使用 .env
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type {
  TokenVaultV2,
  MockERC20,
  TokenVaultFactory,
} from "../typechain-types"; // 确认 TypeChain 类型正确导入
import type { Wallet } from "ethers";

export async function generateClaimSignature(
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
      [
        "uint256",
        "address",
        "uint64",
        "address",
        "address",
        "uint256",
        "uint64",
      ],
      [
        chainId,
        contractAddress,
        nonce,
        claimerAddress,
        tokenAddress,
        amount,
        deadline,
      ]
    )
  );

  const signature = await signer.signMessage(ethers.getBytes(messageHash));
  return signature;
}

describe("TokenVault 合约测试", function () {
  let toeknVaultImpl: TokenVaultV2;
  let tokenVault: TokenVaultV2;
  let tokenVaultFactory: TokenVaultFactory;
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

  // async function generateClaimSignature(
  //     signer: HardhatEthersSigner | Wallet,
  //     chainId: bigint,
  //     contractAddress: string,
  //     nonce: bigint,
  //     claimerAddress: string,
  //     tokenAddress: string,
  //     amount: bigint,
  //     deadline: bigint
  // ): Promise<string> {
  //     const messageHash = ethers.keccak256(
  //         ethers.solidityPacked(

  //             ["uint256", "address", "uint64", "address", "address", "uint256", "uint64"],
  //             [chainId, contractAddress, nonce, claimerAddress, tokenAddress, amount, deadline]
  //         )
  //     );

  //     const signature = await signer.signMessage(ethers.getBytes(messageHash));
  //     return signature;
  // }

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
        throw new Error(
          "请设置 PRIVATE_KEY_DEPLOYER, PRIVATE_KEY_AUTHORIZER, PRIVATE_KEY_CLAIMER"
        );
      }
      owner = new ethers.Wallet(ownerPrivateKey, ethers.provider);
      authorizer = new ethers.Wallet(authorizerPrivateKey, ethers.provider);
      claimer = new ethers.Wallet(claimerPrivateKey, ethers.provider);
      otherAccount =
        signers[4] ||
        (await ethers.Wallet.createRandom().connect(ethers.provider));

      // 为 Wallet 提供资金
      const amountToSend = ethers.parseEther("5.0");
      // console.log("为自定义 Wallet 提供 ETH...");
      const txs = [
        funder.sendTransaction({ to: owner.address, value: amountToSend }),
        funder.sendTransaction({ to: authorizer.address, value: amountToSend }),
        funder.sendTransaction({ to: claimer.address, value: amountToSend }),
      ];
      await Promise.all(txs.map((txP) => txP.then((tx) => tx.wait())));
      // console.log("资金提供完成.");
    } else {
      // console.log("使用 Hardhat 默认账户进行测试...");
      [owner, authorizer, claimer, otherAccount, user1, user2, receiver] =
        signers; // 使用前几个默认账户
    }

    // 2. 部署 MockERC20 (由 owner 部署并拥有)
    const MockERC20Factory = await ethers.getContractFactory(
      "MockERC20",
      owner
    );
    mockToken = await MockERC20Factory.deploy("奖励代币", "MC", owner.address);
    await mockToken.waitForDeployment();
    const mockTokenAddress = await mockToken.getAddress();

    // 3. 部署 TokenVault (由 owner 部署，指定 authorizer)
    const TokenVaultFactory = await ethers.getContractFactory(
      "TokenVaultV2",
      owner
    );
    toeknVaultImpl = await TokenVaultFactory.deploy();
    await toeknVaultImpl.waitForDeployment();
    const tokenVaultImplAddress = await toeknVaultImpl.getAddress();
    const FactoryContractFactory = await ethers.getContractFactory(
      "TokenVaultFactory",
      owner
    );
    tokenVaultFactory = (await FactoryContractFactory.deploy(
      owner.address,
      tokenVaultImplAddress,
      authorizer.address,
      feeRate,
      lockPeriod
    )) as TokenVaultFactory;
    await tokenVaultFactory.waitForDeployment();

    // 创建一个新的Vault示例
    const tx = await tokenVaultFactory
      .connect(owner)
      .createVault(mockToken.getAddress());
    const receipt = await tx.wait();
    expect(receipt).to.not.be.null;
    // Use queryFilter to find the event emitted by the factory in that block
    const filter = tokenVaultFactory.filters.VaultCreated(); // Get the event filter object
    const events = await tokenVaultFactory.queryFilter(
      filter,
      receipt!.blockNumber,
      receipt!.blockNumber
    ); // Query within the block
    // Find the event matching our specific transaction hash
    const event = events.find((e) => e.transactionHash === tx.hash);
    expect(
      event,
      `VaultCreated event not found for tx ${tx.hash}`
    ).to.not.be.undefined;
    const proxyAddress = event?.args?.vaultProxy;
    expect(proxyAddress).to.not.be.undefined;

    // Attach V1 ABI/Type to the proxy address for interaction
    tokenVault = TokenVaultFactory.attach(proxyAddress!) as TokenVaultV2;
    // console.log("Vault Proxy 1 created at:", await tokenVault.getAddress());

    // 4. 为 TokenVault 提供初始代币资金
    await mockToken
      .connect(owner)
      .mint(tokenVault.getAddress(), initialVaultSupply);

    // console.log(`已向 TokenVault (${proxyAddress}) 提供 ${ethers.formatUnits(initialVaultSupply, 18)} MC`);

    // console.log("测试环境设置完毕.");
  });

  // --- 测试套件 ---
  describe("部署与初始化", function () {
    it("应该设置正确的 Owner", async function () {
      expect(await tokenVaultFactory.owner()).to.equal(owner.address);
    });

    it("应该设置正确的 Authorizer", async function () {
      expect(await tokenVaultFactory.authorizer()).to.equal(authorizer.address);
    });

    it("Vault 应该持有初始的 MC 代币", async function () {
      expect(await mockToken.balanceOf(tokenVault.getAddress())).to.equal(
        initialVaultSupply
      );
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
        authorizer,
        chainId,
        tokenVaultAddress,
        nonce,
        claimerAddress,
        mockTokenAddress,
        amount,
        deadline
      );
    });

    it("应该允许用户使用有效签名领取奖励", async function () {
      const initialClaimerBalance = await mockToken.balanceOf(claimerAddress);
      const initialVaultBalance = await mockToken.balanceOf(tokenVaultAddress);

      const claimData = {
        nonce,
        token: mockTokenAddress,
        amount,
        deadline,
        signature: validSignature,
      };

      // Claimer 连接并调用 claimReward
      const tx = await tokenVault
        .connect(claimer)
        .claimReward(claimData, claimer);

      // 检查事件
      await expect(tx)
        .to.emit(tokenVault, "Claimed")
        .withArgs(nonce, claimerAddress, mockTokenAddress, amount);

      // 检查 Nonce 是否被使用
      expect(await tokenVault.usedNonces(nonce)).to.be.true;

      // 检查余额变化
      expect(await mockToken.balanceOf(claimerAddress)).to.equal(
        initialClaimerBalance + amount
      );
      expect(await mockToken.balanceOf(tokenVaultAddress)).to.equal(
        initialVaultBalance - amount
      );
    });

    it("如果签名过期，应该失败", async function () {
      await time.increaseTo(deadline + 1n); // 快进到过期后
      const claimData = {
        nonce,
        token: mockTokenAddress,
        amount,
        deadline,
        signature: validSignature,
      };

      await expect(
        tokenVault.connect(claimer).claimReward(claimData, claimer)
      ).to.be.revertedWith("PVP: The signature has expired");
    });

    it("如果 Nonce 已被使用，应该失败", async function () {
      const claimData = {
        nonce,
        token: mockTokenAddress,
        amount,
        deadline,
        signature: validSignature,
      };
      // 第一次成功领取
      await tokenVault.connect(claimer).claimReward(claimData, claimer);

      // 第二次尝试使用相同 Nonce
      await expect(
        tokenVault.connect(claimer).claimReward(claimData, claimer)
      ).to.be.revertedWith("PVP: nonce has been used");
    });

    it("如果领取金额为 0，应该失败", async function () {
      const zeroAmount = 0n;
      const signatureForZero = await generateClaimSignature(
        authorizer,
        chainId,
        tokenVaultAddress,
        nonce,
        claimerAddress,
        mockTokenAddress,
        zeroAmount,
        deadline
      );
      const claimData = {
        nonce,
        token: mockTokenAddress,
        amount: zeroAmount,
        deadline,
        signature: signatureForZero,
      };

      await expect(
        tokenVault.connect(claimer).claimReward(claimData, claimer)
      ).to.be.revertedWith("PVP: amount must be greater than 0");
    });

    it("如果签名无效（签名者错误），应该失败", async function () {
      const invalidSigner = otherAccount; // 使用另一个账户签名
      const invalidSignature = await generateClaimSignature(
        invalidSigner,
        chainId,
        tokenVaultAddress,
        nonce,
        claimerAddress,
        mockTokenAddress,
        amount,
        deadline
      );
      const claimData = {
        nonce,
        token: mockTokenAddress,
        amount,
        deadline,
        signature: invalidSignature,
      };

      await expect(
        tokenVault.connect(claimer).claimReward(claimData, claimer)
      ).to.be.revertedWith("VerifySignLib: Invalid signature");
    });

    it("如果签名无效（签名内容与调用参数不符 - 金额），应该失败", async function () {
      const signedAmount = amount / 2n; // 签名的金额与实际要领取的不同
      const invalidSignature = await generateClaimSignature(
        authorizer,
        chainId,
        tokenVaultAddress,
        nonce,
        claimerAddress,
        mockTokenAddress,
        signedAmount,
        deadline
      );
      // 调用时使用原始 amount，但签名是基于 signedAmount
      const claimData = {
        nonce,
        token: mockTokenAddress,
        amount,
        deadline,
        signature: invalidSignature,
      };

      await expect(
        tokenVault.connect(claimer).claimReward(claimData, claimer)
      ).to.be.revertedWith("VerifySignLib: Invalid signature");
    });

    it("如果签名有效，但调用者 (msg.sender) 与签名中的领取者不符，应该失败", async function () {
      // 签名是为 claimerAddress 生成的
      const claimData = {
        nonce,
        token: mockTokenAddress,
        amount,
        deadline,
        signature: validSignature,
      };

      // 但让 otherAccount 去调用 claimReward
      await expect(
        tokenVault.connect(otherAccount).claimReward(claimData, otherAccount)
      ).to.be.revertedWith("VerifySignLib: Invalid signature"); // 因为 _verifySign 包含了 msg.sender 的校验
    });

    it("如果 Vault 余额不足以支付奖励，应该失败", async function () {
      const largeAmount = initialVaultSupply + 1n; // 请求比 Vault 余额还多的金额
      const signatureLarge = await generateClaimSignature(
        authorizer,
        chainId,
        tokenVaultAddress,
        nonce,
        claimerAddress,
        mockTokenAddress,
        largeAmount,
        deadline
      );
      const claimData = {
        nonce,
        token: mockTokenAddress,
        amount: largeAmount,
        deadline,
        signature: signatureLarge,
      };

      // SafeTransfer 会失败
      await expect(
        tokenVault.connect(claimer).claimReward(claimData, claimer)
      ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientBalance"); // 来自 SafeERC20
    });
  });

  describe("batchClaimReward 功能", function () {
    let claimDataList: {
      nonce: bigint;
      token: string;
      amount: bigint;
      deadline: bigint;
      signature: string;
    }[];
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
          authorizer,
          chainId,
          tokenVaultAddress,
          nonce,
          claimerAddress,
          mockTokenAddress,
          amount,
          deadline
        );
        claimDataList.push({
          nonce,
          token: mockTokenAddress,
          amount,
          deadline,
          signature,
        });
      }
    });

    it("应该允许用户批量领取多个有效奖励", async function () {
      const initialClaimerBalance = await mockToken.balanceOf(claimerAddress);
      const initialVaultBalance = await mockToken.balanceOf(tokenVaultAddress);
      const totalAmount = claimDataList.reduce(
        (sum, data) => sum + data.amount,
        0n
      );

      // 执行批量领取
      const tx = await tokenVault
        .connect(claimer)
        .batchClaimReward(claimDataList, claimer);

      // 检查每个 Nonce 都被使用
      for (const data of claimDataList) {
        expect(await tokenVault.usedNonces(data.nonce)).to.be.true;
        // 可以在这里加 expect(tx).to.emit... 但检查多个 emit 比较麻烦，检查最终状态更直接
      }

      // 检查最终余额
      expect(await mockToken.balanceOf(claimerAddress)).to.equal(
        initialClaimerBalance + totalAmount
      );
      expect(await mockToken.balanceOf(tokenVaultAddress)).to.equal(
        initialVaultBalance - totalAmount
      );
    });

    it("如果列表中有一个 Nonce 已被使用，整个批量交易应该回滚", async function () {
      // 先手动领取第一个奖励
      await tokenVault.connect(claimer).claimReward(claimDataList[0], claimer);
      expect(await tokenVault.usedNonces(claimDataList[0].nonce)).to.be.true;

      const initialClaimerBalance = await mockToken.balanceOf(claimerAddress);
      const initialVaultBalance = await mockToken.balanceOf(tokenVaultAddress);

      // 尝试批量领取包含已使用 Nonce 的列表
      await expect(
        tokenVault.connect(claimer).batchClaimReward(claimDataList, claimer)
      ).to.be.revertedWith("PVP: nonce has been used");

      // 验证状态没有改变（交易回滚了）
      expect(await tokenVault.usedNonces(claimDataList[1].nonce)).to.be.false; // 第二个 nonce 也没被使用
      expect(await mockToken.balanceOf(claimerAddress)).to.equal(
        initialClaimerBalance
      ); // 领取者余额没变
      expect(await mockToken.balanceOf(tokenVaultAddress)).to.equal(
        initialVaultBalance
      ); // Vault 余额没变
    });

    it("如果列表中有一个签名无效，整个批量交易应该回滚", async function () {
      // 将第二个签名替换为无效签名 (例如由 non-authorizer 签名)
      claimDataList[1].signature = await generateClaimSignature(
        otherAccount, // 错误签名者
        chainId,
        tokenVaultAddress,
        claimDataList[1].nonce,
        claimerAddress,
        mockTokenAddress,
        claimDataList[1].amount,
        claimDataList[1].deadline
      );

      await expect(
        tokenVault.connect(claimer).batchClaimReward(claimDataList, claimer)
      ).to.be.revertedWith("VerifySignLib: Invalid signature");

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
          authorizer,
          chainId,
          tokenVaultAddress,
          nonce,
          claimerAddress,
          mockTokenAddress,
          largeAmount,
          deadline
        );
        largeClaimList.push({
          nonce,
          token: mockTokenAddress,
          amount: largeAmount,
          deadline,
          signature,
        });
      }

      await expect(
        tokenVault.connect(claimer).batchClaimReward(largeClaimList, claimer)
      ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientBalance"); // 预计在第二次领取时失败
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
      const initialVaultBalance = await mockToken.balanceOf(
        tokenVault.getAddress()
      );

      // 确保 Vault 有足够余额
      expect(initialVaultBalance).to.be.gte(withdrawAmount);

      // Owner 调用提现
      const tx = await tokenVault
        .connect(owner)
        .transferFunds(owner.address, withdrawAmount);

      // 检查事件
      await expect(tx)
        .to.emit(tokenVault, "TransferFunds")
        .withArgs(owner.address, await mockToken.getAddress(), withdrawAmount);

      // 检查余额变化
      expect(await mockToken.balanceOf(owner.address)).to.equal(
        initialOwnerBalance + withdrawAmount
      );
      expect(await mockToken.balanceOf(tokenVault.getAddress())).to.equal(
        initialVaultBalance - withdrawAmount
      );
    });

    it("非 Owner 不应该能提取资金", async function () {
      const withdrawAmount = ethers.parseUnits("100", 18);
      await expect(
        tokenVault
          .connect(otherAccount)
          .transferFunds(otherAccount.address, withdrawAmount)
      ).to.be.revertedWith("PVP: Only owner can transfer");
    });

    it("提取金额为 0 应该失败", async function () {
      await expect(
        tokenVault.connect(owner).transferFunds(owner.address, 0n)
      ).to.be.revertedWith("PVP: Amount must be positive");
    });

    it("提取超过 Vault 余额的金额应该失败", async function () {
      const withdrawAmount = initialVaultSupply + 1n; // 比 Vault 总额还多
      await expect(
        tokenVault.connect(owner).transferFunds(owner.address, withdrawAmount)
      ).to.be.revertedWith("PVP: Insufficient balance for transfer");
    });
  });

  describe("deposit 功能", function () {
    it("允许owner充值资金到Vault", async function () {
      const depositAmount = ethers.parseUnits("1000", 18);
      const receiverAddress = claimer.address; // 明确指定接收者

      // 准备工作：mint, approve
      await mockToken.connect(owner).mint(claimer.address, depositAmount);
      await mockToken
        .connect(claimer)
        .approve(tokenVault.getAddress(), depositAmount);

      // 获取调用前的状态（可选，用于验证份额计算）
      const initialTotalAssets = await tokenVault.currentAssets();
      const initialTotalShares = await tokenVault.totalSupply();

      // 计算预期的份额 (根据 _deposit 逻辑)
      let expectedShares: bigint;
      if (initialTotalAssets === 0n || initialTotalShares === 0n) {
        expectedShares = depositAmount;
      } else {
        // 注意：JS/TS 中模拟定点数运算可能需要库或小心处理精度
        // 简单模拟比例计算 (可能与 Solady FixedPointMathLib 有微小差异，需谨慎)
        expectedShares =
          (depositAmount * initialTotalShares) / initialTotalAssets;
        // 更精确的方式是使用 ethers 的 FixedNumber 或其他定点数库
        // 或者直接在断言时不严格匹配份额，只验证其他参数和时间戳
      }

      // 执行 deposit
      const tx = await tokenVault
        .connect(claimer)
        .deposit(receiverAddress, depositAmount);

      // 验证事件
      await expect(tx)
        .to.emit(tokenVault, "Deposit")
        .withArgs(
          claimer,
          receiverAddress, // 验证接收者地址
          depositAmount, // 验证存入的资产数量
          // expectedShares, // 可以验证计算出的份额，如果计算精确的话
          (shares: any) => {
            // 或者对份额进行基本类型检查
            expect(shares).to.be.a("bigint");
            expect(shares).to.be.gt(0n); // 假设份额大于0
            // 如果初始份额为0，这里需要用 depositAmount 比较
            if (initialTotalShares === 0n)
              expect(shares).to.equal(depositAmount);
            return true;
          },
          (timestamp: any) => {
            // 使用回调函数验证时间戳
            expect(timestamp).to.be.a("bigint"); // 检查类型
            expect(timestamp).to.be.gt(0); // 检查大于0
            // 可以添加更复杂的检查，比如接近当前时间
            // const now = Math.floor(Date.now() / 1000);
            // expect(timestamp).to.be.closeTo(BigInt(now), 60n); // 允许60秒误差
            return true; // 返回 true 表示验证通过
          }
        );
    });
  });

  // --- Withdraw 和 WithdrawAll 测试套件 ---
  describe("Withdrawal 功能 (requestWithdrawal, completeWithdrawal)", function () {
    beforeEach(async function () {
      // user1 存入一些资金，以便后续测试取款
      const initialDepositAmount = ethers.parseUnits("1000", 18);
      await mockToken.connect(owner).mint(user1.address, initialDepositAmount);
      await mockToken
        .connect(user1)
        .approve(tokenVault.getAddress(), initialDepositAmount);
      await tokenVault
        .connect(user1)
        .deposit(user1.address, initialDepositAmount); // user1 存款给自己

      // console.log(`测试设置: user1 (${user1.address}) 初始存入 ${ethers.formatUnits(initialDepositAmount, 18)} RWD`);
      // const banker = await tokenVault.bankers(user1.address);
      // console.log(`   -> user1 初始份额: ${banker.shares.toString()}`);
      // console.log(`   -> Vault 总资产: ${ethers.formatUnits(await tokenVault.currentAssets(), 18)} RWD`);
      // console.log(`   -> Vault 总份额: ${(await tokenVault.totalShares()).toString()}`);
      // console.log("测试环境设置完毕.");
    });

    describe("用户发起提现", function () {
      it("用户余额充足时正常发起提现", async function () {
        const lpTokenBalance = await tokenVault.balanceOf(user1.address);
        // console.log("user1 lptoken balance: ", lpTokenBalance);

        expect(lpTokenBalance).to.be.gt(0n);

        const initialTotalShares = await tokenVault.totalSupply();
        const initialTotalAssets = await tokenVault.currentAssets();
        const initialUserBalance = await mockToken.balanceOf(user1.address);
        const requestID = await tokenVault.withdrawalIndex();

        const sharesToWithdraw = lpTokenBalance / 2n; // 提取一半份额
        expect(sharesToWithdraw).to.be.gt(0n); // 确保有份额可提

        // set approve
        await tokenVault.connect(user1).approve(tokenVault, lpTokenBalance);

        // User1 调用 withdraw
        const tx = await tokenVault
          .connect(user1)
          .requestWithdrawal(sharesToWithdraw);
        const receipt = await tx.wait();
        const block = await ethers.provider.getBlock(receipt!.blockNumber);
        const timestamp = BigInt(block!.timestamp);

        // 验证事件
        await expect(tx)
          .to.emit(tokenVault, "WithdrawalRequested")
          .withArgs(user1.address, requestID, sharesToWithdraw, timestamp);

        // 验证状态变化
        const finalUserLpBalance = await tokenVault.balanceOf(user1.address);
        expect(finalUserLpBalance).to.equal(lpTokenBalance - sharesToWithdraw);

        // just request withdraw, valut will not transfer token to user.
        expect(await tokenVault.currentAssets()).to.equal(initialTotalAssets);
        expect(await tokenVault.totalSupply()).to.equal(initialTotalShares);
        expect(await mockToken.balanceOf(user1.address)).to.equal(
          initialUserBalance
        );
      });
    });

    describe("提前提取费用", function () {
      let requestID = 0n;

      this.beforeEach(async function () {
        const lpTokenBalance = await tokenVault.balanceOf(user1.address);

        requestID = await tokenVault.withdrawalIndex();
        // set approve
        await tokenVault.connect(user1).approve(tokenVault, lpTokenBalance);

        // User1 调用 withdraw
        const tx = await tokenVault
          .connect(user1)
          .requestWithdrawal(lpTokenBalance);
        const receipt = await tx.wait();
        const block = await ethers.provider.getBlock(receipt!.blockNumber);
        const timestamp = BigInt(block!.timestamp);

        // 验证事件
        await expect(tx)
          .to.emit(tokenVault, "WithdrawalRequested")
          .withArgs(user1.address, requestID, lpTokenBalance, timestamp);
      });

      it("在锁定期内提取部分份额应扣除手续费", async function () {
        const requestInfo = await tokenVault.withdrawalRequests(requestID);
        expect(requestInfo.user).to.equal(user1.address);
        const userPendingRequest = await tokenVault.getPendingWithdrawalIds(
          requestInfo.user
        );
        console.log("userPendingRequestIds: ", userPendingRequest);

        const feeRate = await tokenVaultFactory.getFeeRate();
        const fOwner = await tokenVaultFactory.getOwner();

        const initialAssets = await tokenVault.currentAssets();
        const initialShares = await tokenVault.totalSupply();
        const initialUserAssets = await mockToken.balanceOf(user1.address);
        const initialfOwnerAssets = await mockToken.balanceOf(fOwner);

        const expectedAssets = calculateExpectedAssets(
          requestInfo.lpAmount,
          initialShares,
          initialAssets
        );

        const fee = (expectedAssets * feeRate) / 10000n;

        const tx = await tokenVault
          .connect(user1)
          .completeWithdrawal(requestID);
        await tx.wait();

        // 验证事件
        await expect(tx)
          .to.emit(tokenVault, "WithdrawalFinalized")
          .withArgs(user1.address, requestID, expectedAssets - fee, fee);

        // 验证状态变化
        expect(await tokenVault.totalSupply()).to.equal(
          initialShares - requestInfo.lpAmount
        );
        expect(await tokenVault.currentAssets()).to.equal(
          initialAssets - expectedAssets
        );
        expect(await mockToken.balanceOf(user1.address)).to.equal(
          initialUserAssets + (expectedAssets - fee)
        );
        expect(await mockToken.balanceOf(fOwner)).to.equal(
          initialfOwnerAssets + fee
        );
      });

      it("在锁定期后提取部分份额不应扣除手续费", async function () {
        // 快进时间，超过锁定期
        await time.increase(lockPeriod + 1);

        const requestInfo = await tokenVault.withdrawalRequests(requestID);
        expect(requestInfo.user).to.equal(user1.address);

        const fOwner = await tokenVaultFactory.getOwner();

        const initialAssets = await tokenVault.currentAssets();
        const initialShares = await tokenVault.totalSupply();
        const initialUserAssets = await mockToken.balanceOf(user1.address);
        const initialfOwnerAssets = await mockToken.balanceOf(fOwner);

        const expectedAssets = calculateExpectedAssets(
          requestInfo.lpAmount,
          initialShares,
          initialAssets
        );

        const fee = 0n;

        const tx = await tokenVault
          .connect(user1)
          .completeWithdrawal(requestID);
        await tx.wait();

        // 验证事件
        await expect(tx)
          .to.emit(tokenVault, "WithdrawalFinalized")
          .withArgs(user1.address, requestID, expectedAssets - fee, fee);

        // 验证状态变化
        expect(await tokenVault.totalSupply()).to.equal(
          initialShares - requestInfo.lpAmount
        );
        expect(await tokenVault.currentAssets()).to.equal(
          initialAssets - expectedAssets
        );
        expect(await mockToken.balanceOf(user1.address)).to.equal(
          initialUserAssets + (expectedAssets - fee)
        );
        expect(await mockToken.balanceOf(fOwner)).to.equal(
          initialfOwnerAssets + fee
        );
      });
    });
    describe("失败与边界条件", function () {
      it("提取超过用户持有的份额应该失败", async function () {
        const userActualShares = await tokenVault.balanceOf(user1.address);

        const sharesToWithdraw = userActualShares + 1n; // 比持有份额多 1

        expect(sharesToWithdraw).to.be.gt(userActualShares); // 确认确实大于

        await tokenVault.connect(user1).approve(tokenVault, sharesToWithdraw);

        await expect(
          tokenVault.connect(user1).requestWithdrawal(sharesToWithdraw)
        ).to.be.revertedWith("PVP: Insufficient LP token balance");
      });

      it("提取 0 份额应该失败", async function () {
        await expect(
          tokenVault.connect(user1).requestWithdrawal(0n)
        ).to.revertedWith("PVP: Amount must be positive");
      });
    });
  });
});
