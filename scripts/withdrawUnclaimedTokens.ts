import "dotenv/config"; // 如果使用 .env 管理私钥
import { ethers } from "hardhat";
async function main() {
    const signers = await ethers.getSigners();
    const deployer = signers[3];

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("owner: ", deployer.address, " balance: ", ethers.formatEther(balance));

    const airdropContract = "0x04435BBa2C77594B0074a069f4D41D17347fFDc2";

    const airdrop = await ethers.getContractAt("Airdrop", airdropContract, deployer);

    const owner = await airdrop.owner();
    console.log("owner address: ", owner);
    // return;

    const tx = await airdrop.withdrawUnclaimedTokens();
    await tx.wait();
    console.log("tx hash: ", tx.hash);

    const token = await airdrop.TOKEN();

    const airdropToken = await ethers.getContractAt("PVPToken", token, deployer);

    const tokenBalance = await airdropToken.balanceOf(deployer.address);
    console.log("deployer token balance: ", ethers.formatEther(tokenBalance));

    const transferTx = await airdropToken.transfer(airdropContract, ethers.formatUnits("2000", 18));
    await transferTx.wait();
    console.log("transfer tx hash: ", transferTx.hash);

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("部署失败:", error);
        process.exit(1);
    });
