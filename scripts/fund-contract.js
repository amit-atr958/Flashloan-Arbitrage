const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log(`Funding contract on ${network.name}...`);
  console.log("Deployer address:", deployer.address);

  // Get deployment info
  const deploymentPath = path.join(
    __dirname,
    "..",
    "deployments",
    `${network.name}.json`
  );

  if (!fs.existsSync(deploymentPath)) {
    console.log("❌ No deployment found for this network");
    return;
  }

  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const contractAddress = deploymentInfo.contractAddress;

  console.log("Contract address:", contractAddress);

  // Check current balances
  const deployerBalance = await deployer.getBalance();
  const contractBalance = await deployer.provider.getBalance(contractAddress);

  console.log("\n=== CURRENT BALANCES ===");
  console.log(
    "Deployer balance:",
    ethers.utils.formatEther(deployerBalance),
    "ETH"
  );
  console.log(
    "Contract balance:",
    ethers.utils.formatEther(contractBalance),
    "ETH"
  );

  // Determine funding amount
  const targetBalance = ethers.utils.parseEther("0.1"); // 0.1 ETH target
  const currentBalance = contractBalance;

  if (currentBalance >= targetBalance) {
    console.log("✅ Contract already has sufficient balance");
    return;
  }

  const fundingAmount = targetBalance.sub(currentBalance);
  console.log(
    "\nFunding amount needed:",
    ethers.utils.formatEther(fundingAmount),
    "ETH"
  );

  // Check if deployer has enough balance
  const minDeployerBalance = ethers.utils.parseEther("0.05"); // Keep 0.05 ETH for deployer
  if (deployerBalance.lt(fundingAmount.add(minDeployerBalance))) {
    console.log("❌ Insufficient deployer balance");
    console.log(
      "Required:",
      ethers.utils.formatEther(fundingAmount.add(minDeployerBalance)),
      "ETH"
    );
    console.log("Available:", ethers.utils.formatEther(deployerBalance), "ETH");
    return;
  }

  // Send funding transaction
  try {
    console.log("\n💰 Sending funding transaction...");

    const tx = await deployer.sendTransaction({
      to: contractAddress,
      value: fundingAmount,
      gasLimit: 21000,
    });

    console.log("Transaction hash:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();

    if (receipt.status === 1) {
      console.log("✅ Funding successful!");

      // Check new balance
      const newBalance = await deployer.provider.getBalance(contractAddress);
      console.log(
        "New contract balance:",
        ethers.utils.formatEther(newBalance),
        "ETH"
      );
    } else {
      console.log("❌ Funding transaction failed");
    }
  } catch (error) {
    console.log("❌ Error sending funding transaction:", error.message);
  }
}

// Allow command line arguments for custom amount
if (process.argv.length > 2) {
  const customAmount = process.argv[2];
  console.log("Custom funding amount:", customAmount, "ETH");
  // You can modify the script to use custom amount
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
