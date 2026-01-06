import "dotenv/config"; // 如果使用 .env 管理私钥
import { ethers } from "hardhat";
async function main() {
    const signers = await ethers.getSigners();
    const deployer = signers[3];

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("owner: ", deployer.address, " balance: ", ethers.formatEther(balance));

    // return
    const airdropContract = "0x04435BBa2C77594B0074a069f4D41D17347fFDc2";
    const phase = 1;
    const merkleRoot = "0x0901ac035c87576d4bd0eaf5f761ed3e58221602fb94847e69898d29b0ca5185";

    const airdrop = await ethers.getContractAt("Airdrop", airdropContract, deployer);

    const tx = await airdrop.setMerkleRoot(phase, merkleRoot);

    await tx.wait();

    console.log("tx hash: ", tx.hash);

    const root = await airdrop.merkleRoot(phase);
    console.log ("merkle root for phase ", phase, ": ", root);

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("部署失败:", error);
        process.exit(1);
    });
