import "dotenv/config"; // 如果使用 .env 管理私钥
import { ethers } from "hardhat";
async function main() {
    const [deployer] = await ethers.getSigners();
    const ownerAddress = deployer.address;

    console.log(`   Owner (部署者): ${ownerAddress}`);


    const commitment = await ethers.getContractAt("GameCommitment", "0x4A5ec5A35e233719106DB8e43A6cD310B529b4DF", deployer);

    const owner = await commitment.owner();
    console.log("commitment owner: ", owner);

    const token = "0xb65b350CCcb5B13466E019142e56ef6556352C9E";
    const tokenVault = await commitment.tokenVault(token);
    console.log("tokenVault: ", tokenVault);

    const newTokenVault = "0xB7939cCE3dcb2Fc80A2Cc64CED870506d6d61EB0";
    const tx = await commitment.setTokenVault(token, newTokenVault);
    await tx.wait()
    console.log("set token vault tx: ", tx.hash);





}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("部署失败:", error);
        process.exit(1);
    });
