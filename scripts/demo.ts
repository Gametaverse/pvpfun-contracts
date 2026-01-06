import * as ethers from "ethers";
import * as fs from "fs";
import * as path from "path";

// for (let i = 0; i < 100; i++) {
//     // 创建一个新的随机钱包
//     const wallet = ethers.Wallet.createRandom();
//     console.log(`${wallet.address},${wallet.privateKey}`);
// }
async function processPKCSV() {
    const csvFile = "sei_pk_8";
    const outputDir = path.join(__dirname, "../bulk_withdraw");
    let bulkwithdraws: string[] = [];
    let fileIndex = 1;


    const data = fs.readFileSync(path.join(__dirname, "../" + csvFile + ".csv"), "utf8");
    data
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split(","))
        .filter(([addr]) => {
            return ethers.isAddress(addr);
        })
        .forEach(([addr]) => {
            bulkwithdraws.push(addr + ",,12.02");
            if (bulkwithdraws.length >= 50) {
                const outputFile = path.join(
                    outputDir,
                    `${csvFile}_${fileIndex}.csv`
                );

                fs.writeFileSync(
                    outputFile,
                    bulkwithdraws.join("\n"),
                    "utf8"
                );

                bulkwithdraws = [];
                fileIndex++;
            }
        })
    if (bulkwithdraws.length > 0) {
        const outputFile = path.join(
            outputDir,
            `${csvFile}_${fileIndex}.csv`
        );

        fs.writeFileSync(
            outputFile,
            bulkwithdraws.join("\n"),
            "utf8"
        );
    }
}

processPKCSV().then(() => process.exit());