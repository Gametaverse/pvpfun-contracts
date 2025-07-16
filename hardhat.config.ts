import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// --- 获取环境变量中的私钥 ---
const deployerPrivateKey = process.env.PRIVATE_KEY_DEPLOYER;
const authorizerPrivateKey = process.env.PRIVATE_KEY_AUTHORIZER;

if (!deployerPrivateKey || !authorizerPrivateKey) {
  throw new Error(
    "Please set PRIVATE_KEY_DEPLOYER, and PRIVATE_KEY_AUTHORIZER in your .env file"
  );
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28", // 确保这个版本与你合约中的 pragma 匹配
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      // 这是 Hardhat 默认启动的内存网络
      chainId: 31337, // Hardhat 网络使用 31337 作为默认链 ID
      // 可以配置初始账户和余额等
      // accounts: [...]
    },
    bscTestnet: {
      url: "https://bsc-testnet-rpc.publicnode.com", // 使用环境变量中的 RPC URL
      chainId: 97, // BSC 测试网的 Chain ID
      accounts: [deployerPrivateKey, authorizerPrivateKey], // 使用你的钱包私钥
      gasPrice: "auto",
    },
    // 如果需要，可以添加其他网络配置，例如 Rinkeby, Mainnet 等
    // localhost: {
    //   url: "http://127.0.0.1:8545",
    //   chainId: 31337, // 通常本地运行的 Hardhat node 也是这个 chainId
    // },
  },
  paths: {
    sources: "./contracts", // Solidity 源文件目录
    tests: "./test", // 测试文件目录
    cache: "./cache", // Hardhat 缓存目录
    artifacts: "./artifacts", // 编译产物目录
  },
  typechain: {
    outDir: "typechain-types", // TypeScript 类型定义输出目录
    target: "ethers-v6", // 指定生成的类型适配 ethers v6
  },
  mocha: {
    timeout: 40000, // 增加测试超时时间（如果需要）
  },
};

export default config;
