const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const networks = require("../config/networks.json");

async function main() {
  const networkName = process.env.HARDHAT_NETWORK || "sepolia";
  const networkConfig = networks[networkName];
  
  if (!networkConfig) {
    throw new Error(`Network ${networkName} not found in config`);
  }

  console.log(`🚀 Deploying to ${networkConfig.name}...`);

  // Get the contract factory
  const FlashloanArbitrage = await ethers.getContractFactory("FlashloanArbitrage");
  
  // Get Aave address provider
  const aaveProvider = networkConfig.aaveAddressProvider;
  if (!aaveProvider) {
    throw new Error(`No Aave V3 support on ${networkName}`);
  }

  console.log(`Using Aave Address Provider: ${aaveProvider}`);

  // Deploy the contract
  console.log("Deploying contract...");
  const contract = await FlashloanArbitrage.deploy(aaveProvider);
  await contract.deployed();

  console.log(`✅ Contract deployed to: ${contract.address}`);
  console.log(`📊 Transaction hash: ${contract.deployTransaction.hash}`);
  console.log(`🔗 Explorer: ${networkConfig.explorerUrl}/address/${contract.address}`);

  // Save deployment info
  const configDir = path.join(__dirname, "../config");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const deploymentsFile = path.join(configDir, "deployments.json");
  let deployments = {};
  
  // Load existing deployments
  if (fs.existsSync(deploymentsFile)) {
    try {
      deployments = JSON.parse(fs.readFileSync(deploymentsFile, 'utf8'));
    } catch (error) {
      console.warn("Failed to load existing deployments:", error.message);
    }
  }

  // Update with new deployment
  deployments[networkName] = {
    address: contract.address,
    network: networkConfig.name,
    chainId: networkConfig.chainId,
    deployedAt: new Date().toISOString(),
    explorerUrl: `${networkConfig.explorerUrl}/address/${contract.address}`,
    aaveProvider: aaveProvider,
    txHash: contract.deployTransaction.hash
  };

  deployments.lastUpdated = new Date().toISOString();
  deployments.totalNetworks = Object.keys(deployments).filter(key => key !== 'lastUpdated' && key !== 'totalNetworks').length;

  // Save updated deployments
  fs.writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2));
  console.log(`💾 Deployment info saved to: ${deploymentsFile}`);

  // Verify deployment
  const code = await ethers.provider.getCode(contract.address);
  if (code === "0x") {
    throw new Error("Contract deployment failed - no code at address");
  }

  console.log("\n🎉 Deployment completed successfully!");
  console.log("\n📋 Next Steps:");
  console.log(`1. Fund the contract: Send ETH to ${contract.address}`);
  console.log(`2. Start the bot: npm run start --network=${networkName}`);
  console.log(`3. Monitor logs: tail -f logs/combined.log`);

  return contract.address;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Deployment failed:", error);
      process.exit(1);
    });
}

module.exports = { main };
