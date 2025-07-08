const { ethers, network } = require("hardhat");
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// Aave V3 Pool Address Provider addresses
const AAVE_ADDRESSES = {
  mainnet: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
  goerli: "0x5E52dEc931FFb32f609681B8438A51c675cc232d",
  sepolia: "0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A",
};

async function main() {
  console.log(`Deploying to ${network.name}...`);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const balance = await deployer.getBalance();
  console.log("Account balance:", ethers.utils.formatEther(balance), "ETH");

  // Get the Aave address for the current network
  const aaveAddressProvider = AAVE_ADDRESSES[network.name];
  if (!aaveAddressProvider) {
    throw new Error(`Aave address not configured for network: ${network.name}`);
  }

  console.log("Using Aave Address Provider:", aaveAddressProvider);

  // Deploy FlashloanArbitrage contract
  const FlashloanArbitrage = await ethers.getContractFactory(
    "FlashloanArbitrage"
  );

  console.log("Deploying FlashloanArbitrage...");
  const flashloanArbitrage = await FlashloanArbitrage.deploy(
    aaveAddressProvider
  );

  await flashloanArbitrage.deployed();
  const contractAddress = flashloanArbitrage.address;

  console.log("FlashloanArbitrage deployed to:", contractAddress);

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    contractAddress: contractAddress,
    aaveAddressProvider: aaveAddressProvider,
    deployer: deployer.address,
    deploymentTime: new Date().toISOString(),
    blockNumber: await deployer.provider.getBlockNumber(),
  };

  const deploymentPath = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentPath)) {
    fs.mkdirSync(deploymentPath, { recursive: true });
  }

  fs.writeFileSync(
    path.join(deploymentPath, `${network.name}.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(
    "Deployment info saved to:",
    path.join(deploymentPath, `${network.name}.json`)
  );

  // Verify contract on Etherscan (if not local network)
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("Waiting for block confirmations...");
    await flashloanArbitrage.deployTransaction.wait(6);

    try {
      console.log("Verifying contract on Etherscan...");
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [aaveAddressProvider],
      });
      console.log("Contract verified successfully!");
    } catch (error) {
      console.log("Verification failed:", error.message);
    }
  }

  // Display important information
  console.log("\n=== DEPLOYMENT SUMMARY ===");
  console.log("Network:", network.name);
  console.log("Contract Address:", contractAddress);
  console.log("Deployer:", deployer.address);
  console.log("Aave Address Provider:", aaveAddressProvider);
  console.log(
    "Gas Used:",
    flashloanArbitrage.deployTransaction.gasLimit.toString()
  );

  console.log("\n=== NEXT STEPS ===");
  console.log("1. Update your .env file with the contract address:");
  console.log(`   CONTRACT_ADDRESS=${contractAddress}`);
  console.log("2. Fund the contract with some ETH for gas fees");
  console.log("3. Start the monitoring bot with: npm run monitor");

  return {
    contractAddress,
    aaveAddressProvider,
    deployer: deployer.address,
  };
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
