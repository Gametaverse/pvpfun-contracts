import "dotenv/config"; // 如果使用 .env 管理私钥
import { ethers, upgrades } from "hardhat";
async function main() {
    const [deployer, authorizerSigner] = await ethers.getSigners();
    const ownerAddress = deployer.address;
    const authorizerAddress = authorizerSigner.address;

    console.log("部署 TokenVault 合约...");
    console.log(`   Owner (部署者): ${ownerAddress}`);
    console.log(`   Authorizer: ${authorizerAddress}`);

    const TokenVault = await ethers.getContractFactory("TokenVaultWithNoLP", deployer);

    const vault = await upgrades.deployProxy(TokenVault, [], {
        initializer: 'initialize',
        kind: 'uups'
    });

    await vault.waitForDeployment();

    console.log("Proxy (代理合约) 地址:", await vault.getAddress());
    console.log("Implementation (逻辑合约) 地址:", await upgrades.erc1967.getImplementationAddress(await vault.getAddress()));

    const tx = await vault.setAuthorizer(authorizerAddress);
    await tx.wait();
    console.log("setAuthorizer: ", tx.hash);

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("部署失败:", error);
        process.exit(1);
    });
