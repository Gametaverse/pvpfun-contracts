import "dotenv/config"; // 如果使用 .env 管理私钥
import hre from "hardhat";
const { ethers } = hre;
async function main() {
  const [deployer, authorizerSigner] = await ethers.getSigners();
  const ownerAddress = deployer.address;
  const authorizerAddress = authorizerSigner.address;

  console.log("部署 TokenVault 合约...");
  console.log(`   Owner (部署者): ${ownerAddress}`);
  console.log(`   Authorizer: ${authorizerAddress}`);

  const TokenVault = await ethers.getContractFactory("BscAlphaVault", deployer);
  const tokenVault = await TokenVault.deploy(authorizerAddress);
  await tokenVault.waitForDeployment();
  const tokenVaultAddress = await tokenVault.getAddress();
  console.log(`TokenVault 合约已部署到: ${tokenVaultAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("部署失败:", error);
    process.exit(1);
  });
