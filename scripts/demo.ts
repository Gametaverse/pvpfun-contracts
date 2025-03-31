const ethers = require("ethers");

// 创建一个新的随机钱包
const wallet = ethers.Wallet.createRandom();

console.log("生成新的钱包信息:");
console.log("地址 (Address):", wallet.address);
console.log("私钥 (Private Key):", wallet.privateKey); 
console.log("助记词 (Mnemonic Phrase):", wallet.mnemonic.phrase); 
console.log("助记词路径 (Mnemonic Path):", wallet.mnemonic.path); 