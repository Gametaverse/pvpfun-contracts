import hre from "hardhat";
import { ethers } from "hardhat"; 

async function main() {
 
  const vaultContractAddress = "0x924097608d8bc3bAc30FA04D017e24dF028E87C1"; 
  // 替换成你要领取的 ERC20 代币地址
  const tokenAddress = "0x24EC52c5c6462b483d671f4CF00602ecb20fe316"; 
  const claimAmount = 840000000000000000n; 
  const nonce = 1;

  // 从 .env 文件中获取私钥并创建 Wallet 实例
  const authorizerPrivateKey = process.env.PRIVATE_KEY_AUTHORIZER;
  const claimerPrivateKey = process.env.CLAIMER_PRIVATE_KEY;

  if (!authorizerPrivateKey || !claimerPrivateKey) {
    throw new Error("请在 .env 文件中设置 AUTHORIZER_PRIVATE_KEY 和 CLAIMER_PRIVATE_KEY");
  }

  // Authorizer: 负责签名，但不出 Gas
  const authorizerWallet = new ethers.Wallet(authorizerPrivateKey, ethers.provider);
  
  // Claimer: 负责提交交易和支付 Gas，并接收奖励
  const claimerWallet = new ethers.Wallet(claimerPrivateKey, ethers.provider);
  const user = claimerWallet.address;

  console.log(`🔑 Authorizer 地址: ${authorizerWallet.address}`);
  console.log(`👤 Claimer 地址:    ${claimerWallet.address}`);

  // Deadline: 签名有效期，例如设置为 1 小时后
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  // 创建消息哈希 (必须与合约中的哈希方式完全一致)
  const { chainId } = await ethers.provider.getNetwork();
  
  const messageHash = ethers.solidityPackedKeccak256(
    ["uint256", "address", "uint64", "address", "address", "uint256", "uint64"],
    [
      chainId,
      vaultContractAddress,
      nonce,
      user, // 奖励的接收者地址
      tokenAddress,
      claimAmount,
      deadline,
    ]
  );
  
  console.log(`\n📄 准备签名的哈希: ${messageHash}`);

  // 需要对二进制哈希（bytes array）进行签名，而不是十六进制字符串
  const signature = await authorizerWallet.signMessage(ethers.getBytes(messageHash));
  console.log(`✍️ 生成的签名: ${signature}`);

//   return;


  // Claimer 连接到合约并发起交易
  const tokenVault = await ethers.getContractAt("BscAlphaVault", vaultContractAddress);
  
  const claimData = {
    nonce: nonce,
    token: tokenAddress,
    amount: claimAmount,
    deadline: deadline,
    signature: signature,
  };

  console.log("\n🚀 Claimer 正在提交 claimReward 交易...");
  // 必须使用 claimerWallet 连接合约，因为它才是交易的发送方 (msg.sender)
  const tx = await tokenVault.connect(claimerWallet).claimReward(claimData);
  
  console.log(`⏳ 等待交易被打包，交易哈希: ${tx.hash}`);
  await tx.wait();

  console.log("\n✅ 奖励领取成功!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 脚本执行失败:", error);
    process.exit(1);
  });