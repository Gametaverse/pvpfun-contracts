import 'dotenv/config'; // 如果使用 .env 管理私钥
import { ethers } from "hardhat";

async function main() {

    const [deployer, authorizerSigner] = await ethers.getSigners();
    const ownerAddress = deployer.address;
    const authorizerAddress = authorizerSigner.address;

    console.log("部署 TokenVault 合约...");
    console.log(`   Owner (部署者): ${ownerAddress}`);
    console.log(`   Authorizer: ${authorizerAddress}`);


    const TokenVault = await ethers.getContractFactory("TokenVault", deployer);
    const tokenVault = await TokenVault.deploy(authorizerAddress);
    await tokenVault.waitForDeployment();
    const tokenVaultAddress = await tokenVault.getAddress();
    console.log(`TokenVault 合约已部署到: ${tokenVaultAddress}`);


    const tokenName = "奖励代币";
    const tokenSymbol = "RWD";
    const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
    const mockToken = await MockERC20.deploy(tokenName, tokenSymbol, deployer.address);
    await mockToken.waitForDeployment();
    const mockTokenAddress = await mockToken.getAddress();
    console.log(`${tokenName} (${tokenSymbol}) 代币已部署到: ${mockTokenAddress}`);


    const initialVaultSupply = ethers.parseUnits("1000000", 18);
    console.log(`向 TokenVault (${tokenVaultAddress}) 转入 ${ethers.formatUnits(initialVaultSupply, 18)} ${tokenSymbol}...`);

    await mockToken.connect(deployer).mint(deployer.address, initialVaultSupply);
    await mockToken.connect(deployer).transfer(tokenVaultAddress, initialVaultSupply);
    const vaultBalance = await mockToken.balanceOf(tokenVaultAddress);
    console.log(`TokenVault 中 ${tokenSymbol} 的当前余额: ${ethers.formatUnits(vaultBalance, 18)}`);


    console.log("\n--- 部署摘要 ---");
    console.log(`TokenVault 合约: ${tokenVaultAddress}`);
    console.log(`奖励代币 (${tokenSymbol}): ${mockTokenAddress}`);
    console.log(`TokenVault Owner: ${await tokenVault.owner()}`);
    console.log(`TokenVault Authorizer: ${await tokenVault.authorizer()}`);
    console.log("------------------\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("部署失败:", error);
        process.exit(1);
    });