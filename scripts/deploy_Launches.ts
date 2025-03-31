import 'dotenv/config';
import { ethers } from "hardhat"; // 从 hardhat 导入 ethers

// --- 获取环境变量中的私钥 ---
const deployerPrivateKey = process.env.PRIVATE_KEY_DEPLOYER;
const playerPrivateKey = process.env.PRIVATE_KEY_PLAYER;
const authorizerPrivateKey = process.env.PRIVATE_KEY_AUTHORIZER;

if (!deployerPrivateKey || !playerPrivateKey || !authorizerPrivateKey) {
    throw new Error("Please set PRIVATE_KEY_DEPLOYER, PRIVATE_KEY_PLAYER, and PRIVATE_KEY_AUTHORIZER in your .env file");
}

// --- 创建 Wallet Signer 实例 ---
// 使用 Hardhat 提供的 provider 连接到当前网络
const deployerWallet = new ethers.Wallet(deployerPrivateKey, ethers.provider);
const playerWallet = new ethers.Wallet(playerPrivateKey, ethers.provider);
const authorizerWallet = new ethers.Wallet(authorizerPrivateKey, ethers.provider);

console.log("使用自定义 Deployer 地址:", deployerWallet.address);
console.log("使用自定义 Player 地址:", playerWallet.address);
console.log("使用自定义 Authorizer 地址:", authorizerWallet.address);

async function airdrop() {

    console.log("为自定义账户提供资金...");
    const [funder] = await ethers.getSigners();
    const amountToSend = ethers.parseEther("10.0");

    // 检查并发送给 Deployer
    const deployerBalance = await ethers.provider.getBalance(deployerWallet.address);
    if (deployerBalance < amountToSend) {
        console.log(`为 Deployer (${deployerWallet.address}) 发送 ${ethers.formatEther(amountToSend)} ETH...`);
        const tx1 = await funder.sendTransaction({
            to: deployerWallet.address,
            value: amountToSend,
        });
        await tx1.wait();
    } else {
        console.log(`Deployer (${deployerWallet.address}) 余额充足.`);
    }

    // 检查并发送给 Player
    const playerBalance = await ethers.provider.getBalance(playerWallet.address);
    if (playerBalance < amountToSend) {
        console.log(`为 Player (${playerWallet.address}) 发送 ${ethers.formatEther(amountToSend)} ETH...`);
        const tx2 = await funder.sendTransaction({
            to: playerWallet.address,
            value: amountToSend,
        });
        await tx2.wait();
    } else {
        console.log(`Player (${playerWallet.address}) 余额充足.`);
    }

    const authorizerBalance = await ethers.provider.getBalance(authorizerWallet.address);
    if (authorizerBalance < amountToSend / 10n) {
        console.log(`为 Authorizer (${authorizerWallet.address}) 发送 ${ethers.formatEther(amountToSend / 10n)} ETH...`);
        const tx3 = await funder.sendTransaction({
            to: authorizerWallet.address,
            value: amountToSend / 10n, // 发送少量 ETH
        });
        await tx3.wait();
    } else {
        console.log(`Authorizer (${authorizerWallet.address}) 余额充足.`);
    }
    console.log("资金提供完成.");


}

async function main() {
    const [deployer] = await ethers.getSigners();
    // const [deployer, authorizerSigner, vaultAccount] = await ethers.getSigners();

    console.log("使用账户进行部署:", deployer.address);
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("账户余额:", ethers.formatEther(balance));


    const authorizerAddress = deployer.address;

    const initialOwnerAddress = deployer.address;

    const initialVaultAddress = deployer.address;

    console.log(`设置初始 Owner: ${initialOwnerAddress}`);
    console.log(`设置 Authorizer: ${authorizerAddress}`);


    const Launches = await ethers.getContractFactory("Launches");
    console.log("正在部署 Launches 合约...");
    const launches = await Launches.deploy(authorizerAddress);
    await launches.waitForDeployment();
    const launchesAddress = await launches.getAddress();
    console.log(`Launches 合约已部署到: ${launchesAddress}`);

    // --- 部署 Mock ERC20 代币 
    const tokenName = "模拟游戏代币";
    const tokenSymbol = "MGT";
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    console.log(`正在部署 ${tokenName} (${tokenSymbol})...`);
    // 部署 MockERC20
    const mockToken = await MockERC20.deploy(tokenName, tokenSymbol, deployer.address);
    await mockToken.waitForDeployment();
    const mockTokenAddress = await mockToken.getAddress();
    console.log(`${tokenName} 已部署到: ${mockTokenAddress}`);

    // --- 部署后设置：将代币添加到白名单 (设置 Vault) ---
    console.log(`为代币 ${mockTokenAddress} 设置 Vault 为 ${initialVaultAddress}...`);

    const tx = await launches.connect(deployer).setTokenVault(mockTokenAddress, initialVaultAddress);
    await tx.wait();
    const actualVault = await launches.tokenVault(mockTokenAddress);
    console.log(`代币 ${mockTokenAddress} 的 Vault 已成功设置为: ${actualVault}`);


    console.log("\n--- 部署摘要 ---");
    console.log(`Launches 合约地址: ${launchesAddress}`);
    console.log(`模拟代币 (${tokenSymbol}) 地址: ${mockTokenAddress}`);
    console.log(`Launches 合约 Owner: ${await launches.owner()}`);
    console.log(`Launches 合约 Authorizer: ${await launches.authorizer()}`);
    console.log(`${tokenSymbol} 的 Vault 地址: ${actualVault}`);
    console.log("------------------\n");
}


main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("部署失败:", error);
        process.exit(1);
    });