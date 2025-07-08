const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const MultiChainManager = require("../src/MultiChainManager");
const networks = require("../config/networks.json");

async function main() {
  console.log("🚀 Starting Multi-Chain Deployment...\n");

  // Get configuration
  const privateKey = process.env.PRIVATE_KEY;
  const alchemyApiKey = process.env.ALCHEMY_API_KEY;
  
  if (!privateKey || !alchemyApiKey) {
    throw new Error("Missing PRIVATE_KEY or ALCHEMY_API_KEY in environment variables");
  }

  // Initialize multi-chain manager
  const multiChain = new MultiChainManager(privateKey, alchemyApiKey);
  
  // Get contract factory
  const FlashloanArbitrage = await ethers.getContractFactory("FlashloanArbitrage");
  
  // Deployment results
  const deploymentResults = {};
  const errors = [];

  // Define priority chains (start with these)
  const priorityChains = [
    "ethereum",
    "polygon", 
    "arbitrum",
    "optimism",
    "bsc",
    "avalanche",
    "base",
    "fantom"
  ];

  // Define testnet chains
  const testnetChains = [
    "sepolia"
  ];

  // Define emerging chains
  const emergingChains = [
    "linea",
    "scroll", 
    "zksync",
    "mantle"
  ];

  console.log("📋 Deployment Plan:");
  console.log(`Priority Chains: ${priorityChains.length}`);
  console.log(`Testnet Chains: ${testnetChains.length}`);
  console.log(`Emerging Chains: ${emergingChains.length}`);
  console.log(`Total Networks: ${priorityChains.length + testnetChains.length + emergingChains.length}\n`);

  // Deploy to priority chains first
  console.log("🎯 Deploying to Priority Chains...");
  await deployToChains(multiChain, FlashloanArbitrage, priorityChains, deploymentResults, errors);

  // Deploy to testnets
  console.log("\n🧪 Deploying to Testnet Chains...");
  await deployToChains(multiChain, FlashloanArbitrage, testnetChains, deploymentResults, errors);

  // Deploy to emerging chains
  console.log("\n🌟 Deploying to Emerging Chains...");
  await deployToChains(multiChain, FlashloanArbitrage, emergingChains, deploymentResults, errors);

  // Generate deployment summary
  console.log("\n📊 Deployment Summary:");
  console.log("=".repeat(50));
  
  const successful = Object.keys(deploymentResults).length;
  const failed = errors.length;
  const total = successful + failed;
  
  console.log(`✅ Successful Deployments: ${successful}/${total}`);
  console.log(`❌ Failed Deployments: ${failed}/${total}`);
  console.log(`📈 Success Rate: ${((successful/total) * 100).toFixed(1)}%`);

  if (successful > 0) {
    console.log("\n🎉 Successfully Deployed Networks:");
    for (const [network, result] of Object.entries(deploymentResults)) {
      console.log(`  ${network}: ${result.address}`);
    }
  }

  if (failed > 0) {
    console.log("\n⚠️  Failed Deployments:");
    errors.forEach(error => {
      console.log(`  ${error.network}: ${error.reason}`);
    });
  }

  // Save deployment results
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const deploymentFile = path.join(deploymentsDir, `multichain-${Date.now()}.json`);
  
  const deploymentData = {
    timestamp,
    successful,
    failed,
    total,
    successRate: ((successful/total) * 100).toFixed(1),
    deployments: deploymentResults,
    errors: errors,
    networks: {
      priority: priorityChains,
      testnet: testnetChains,
      emerging: emergingChains
    }
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
  console.log(`\n💾 Deployment results saved to: ${deploymentFile}`);

  // Generate network configuration for the bot
  await generateBotConfig(deploymentResults);

  console.log("\n🎯 Next Steps:");
  console.log("1. Update your .env file with the desired network");
  console.log("2. Fund the contracts with native tokens for gas");
  console.log("3. Start the multi-chain arbitrage bot:");
  console.log("   npm run start:multichain");
  
  console.log("\n✨ Multi-Chain Deployment Complete!");
}

async function deployToChains(multiChain, contractFactory, chainList, results, errors) {
  for (const networkKey of chainList) {
    try {
      console.log(`\n📡 Deploying to ${networks[networkKey]?.name || networkKey}...`);
      
      // Activate the chain
      const activated = await multiChain.activateChain(networkKey);
      if (!activated) {
        throw new Error("Failed to activate chain");
      }

      // Get Aave address provider for the network
      const aaveProvider = networks[networkKey]?.aaveAddressProvider;
      if (!aaveProvider) {
        throw new Error("No Aave V3 support on this network");
      }

      // Deploy the contract
      const contract = await multiChain.deployContract(
        networkKey, 
        contractFactory, 
        [aaveProvider]
      );

      // Verify deployment
      const code = await contract.provider.getCode(contract.address);
      if (code === "0x") {
        throw new Error("Contract deployment failed - no code at address");
      }

      results[networkKey] = {
        address: contract.address,
        network: networks[networkKey].name,
        chainId: networks[networkKey].chainId,
        aaveProvider,
        deployedAt: new Date().toISOString(),
        explorerUrl: `${networks[networkKey].explorerUrl}/address/${contract.address}`
      };

      console.log(`✅ ${networks[networkKey].name}: ${contract.address}`);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      const errorInfo = {
        network: networkKey,
        networkName: networks[networkKey]?.name || networkKey,
        reason: error.message,
        timestamp: new Date().toISOString()
      };
      
      errors.push(errorInfo);
      console.log(`❌ ${networks[networkKey]?.name || networkKey}: ${error.message}`);
      
      // Continue with next network
      continue;
    }
  }
}

async function generateBotConfig(deploymentResults) {
  const configDir = path.join(__dirname, "../config");
  const configFile = path.join(configDir, "multichain-deployments.json");
  
  const config = {
    lastUpdated: new Date().toISOString(),
    totalNetworks: Object.keys(deploymentResults).length,
    deployments: deploymentResults,
    quickStart: {
      mainnet: deploymentResults.ethereum?.address || null,
      polygon: deploymentResults.polygon?.address || null,
      arbitrum: deploymentResults.arbitrum?.address || null,
      optimism: deploymentResults.optimism?.address || null,
      bsc: deploymentResults.bsc?.address || null,
      testnet: deploymentResults.sepolia?.address || null
    }
  };

  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log(`\n⚙️  Bot configuration saved to: ${configFile}`);
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Deployment failed:", error);
      process.exit(1);
    });
}

module.exports = { main };
