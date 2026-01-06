import "dotenv/config"; // 如果使用 .env 管理私钥
import { ethers } from "hardhat";
async function main() {
    const signers = await ethers.getSigners();
    const tokenOwner = signers[2];

    console.log("部署 PVP token 合约...");
    console.log(`   Owner (部署者): ${tokenOwner.address}`);

    const Token = await ethers.getContractFactory("PVPToken", tokenOwner);
    const tokenContract = await Token.deploy();
    await tokenContract.waitForDeployment();
    const tokenAddress = await tokenContract.getAddress();
    console.log(`tokenAddress 合约已部署到: ${tokenAddress}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("部署失败:", error);
        process.exit(1);
    });
