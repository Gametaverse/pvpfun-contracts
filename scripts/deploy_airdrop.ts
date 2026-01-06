import "dotenv/config"; // 如果使用 .env 管理私钥
import { ethers } from "hardhat";
async function main() {
    const signers = await ethers.getSigners();
    const deployer = signers[3];

    console.log(`   Owner (部署者): ${deployer.address}`);
    // return
    const airdropToken = "0x009C69B994Ae68e90F20a63CE1659AB949547073";

    const airdrop = await ethers.getContractFactory("Airdrop", deployer);
    const airdropContract = await airdrop.deploy(airdropToken);
    await airdropContract.waitForDeployment();
    const airdropAddress = await airdropContract.getAddress();
    console.log(`airdropAddress 合约已部署到: ${airdropAddress}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("部署失败:", error);
        process.exit(1);
    });
