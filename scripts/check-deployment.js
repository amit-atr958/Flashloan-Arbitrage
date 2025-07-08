const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log(`Checking deployment on ${network.name}...`);

  const deploymentPath = path.join(
    __dirname,
    "..",
    "deployments",
    `${network.name}.json`
  );

  if (!fs.existsSync(deploymentPath)) {
    console.log("❌ No deployment found for this network");
    console.log(`Expected file: ${deploymentPath}`);
    return;
  }

  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  console.log("\n=== DEPLOYMENT INFO ===");
  console.log("Network:", deploymentInfo.network);
  console.log("Contract Address:", deploymentInfo.contractAddress);
  console.log("Deployer:", deploymentInfo.deployer);
  console.log("Deployment Time:", deploymentInfo.deploymentTime);
  console.log("Block Number:", deploymentInfo.blockNumber);

  // Check if contract exists
  try {
    const code = await ethers.provider.getCode(deploymentInfo.contractAddress);
    if (code === "0x") {
      console.log("❌ Contract not found at address");
      return;
    }
    console.log("✅ Contract exists on blockchain");

    // Try to interact with contract
    const FlashloanArbitrage = await ethers.getContractFactory(
      "FlashloanArbitrage"
    );
    const contract = FlashloanArbitrage.attach(deploymentInfo.contractAddress);

    // Check owner
    const owner = await contract.owner();
    console.log("Contract Owner:", owner);

    // Check active DEXs
    const activeDEXs = await contract.getActiveDEXs();
    console.log("Active DEXs:", activeDEXs.length);

    // Check contract balance
    const balance = await ethers.provider.getBalance(
      deploymentInfo.contractAddress
    );
    console.log(
      "Contract ETH Balance:",
      ethers.utils.formatEther(balance),
      "ETH"
    );

    console.log("\n✅ Contract is deployed and functional");
  } catch (error) {
    console.log("❌ Error checking contract:", error.message);
  }

  // Check deployer balance
  try {
    const deployerBalance = await ethers.provider.getBalance(
      deploymentInfo.deployer
    );
    console.log(
      "Deployer Balance:",
      ethers.utils.formatEther(deployerBalance),
      "ETH"
    );
  } catch (error) {
    console.log("Could not check deployer balance:", error.message);
  }

  console.log("\n=== NEXT STEPS ===");
  console.log("1. Update your .env file:");
  console.log(`   CONTRACT_ADDRESS=${deploymentInfo.contractAddress}`);
  console.log("2. Fund the contract with ETH for gas fees");
  console.log("3. Start the monitoring bot:");
  console.log("   npm run monitor");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
