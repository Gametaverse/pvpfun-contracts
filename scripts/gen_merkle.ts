import { MerkleTree } from "merkletreejs";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import Decimal from "decimal.js";
import keccak256 from "keccak256";

const tokenDecimals = 18;

export function readAirdropCsv(csvFile: string): Record<string, number> {
  const data = fs.readFileSync(path.join(__dirname, csvFile), "utf8");
  const userTotals = new Map<string, number>();
  data
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(","))
    .filter(([addr, amt]) => {
      return ethers.isAddress(addr) && !isNaN(parseFloat(amt));
    })
    .forEach(([addr, amt]) => {
      const amount = parseFloat(amt);
      if (userTotals.has(addr)) {
        const existingAmount = userTotals.get(addr)!;
        userTotals.set(addr, existingAmount + amount);
      } else {
        userTotals.set(addr, amount);
      }
    })
  return Object.fromEntries(userTotals.entries());
}

export function leavesData(
  phase: number,
  address: string,
  amount: bigint
): Buffer {
  return Buffer.from(
    ethers
      .solidityPackedKeccak256(
        ["uint8", "address", "uint256"],
        [phase, address, amount]
      )
      .slice(2),
    "hex"
  );
}

// export function sha256(input: Buffer): Buffer {
//   const wordArray = CryptoJS.lib.WordArray.create(input);
//   const hash = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
//   const hashBuffer = Buffer.from(hash, "hex");
//   return hashBuffer;
// }

async function main() {
  const phase = 1;
  const network = "bsc_testnet";
  const csvFile = "../data_airdrop_list.csv"

  const userData = readAirdropCsv(csvFile);

  interface userDataBO {
    amount: BigInt
    leaves: Buffer
  }

  var total = new Decimal(0);
  const userAmountsBN: Record<string, userDataBO> = Object.fromEntries(
    Object.entries(userData).map(([key, value]) => {
      const wei = new Decimal(value).mul(new Decimal(10).pow(tokenDecimals));
      const leaves = leavesData(
        phase,
        key,
        BigInt(wei.toFixed())
      );
      console.log(leaves);
      total = total.add(new Decimal(value));
      return [key, {
        amount: BigInt(wei.toFixed()),
        leaves: leaves,
      }];
    })
  );

  console.log(
    "total users: ",
    Object.keys(userAmountsBN).length,
    "total amount: ",
    total.toString()
  );

  const leaves_hash = Object.values(userAmountsBN).map(v => v.leaves);

  // Create Merkle Tree
  const tree = new MerkleTree(leaves_hash, keccak256, { sortPairs: true });

  // Get the root of the tree

  const root = tree.getHexRoot();
  // console.log("merkle root", [...tree.getRoot()]);
  console.log("Merkle Root:", root);

  const userProofs = Object.fromEntries(Object.entries(userAmountsBN).map(([address, data]) => {
    const proof = tree
      .getHexProof(data.leaves);
      // .map((x) => x.data.toString("hex"));

    return [address, {
      amount: data.amount.toString(),
      proof: proof,
    }];

  }));

  const JSON_OUTPUT_PATH = path.join(
    __dirname,
    "../data_merkle_proofs_" + network + ".json"
  );

  fs.writeFileSync(
    JSON_OUTPUT_PATH,
    JSON.stringify(
      {
        merkle_root: root,
        leaves: userProofs,
      },
      null,
      2
    )
  );
}

main().then(() => process.exit());
