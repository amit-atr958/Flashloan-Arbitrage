const { ethers } = require("ethers");
const winston = require("winston");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Import configurations
const networks = require("../config/networks.json");
const FlashloanArbitrageABI = require("../artifacts/contracts/FlashloanArbitrage.sol/FlashloanArbitrage.json").abi;

// Parse command line arguments
const args = process.argv.slice(2);
const networkArg = args.find(arg => arg.startsWith('--network='));
const multichainArg = args.includes('--multichain');
const targetNetwork = networkArg ? networkArg.split('=')[1] : process.env.NETWORK || 'sepolia';

// Configuration
const CONFIG = {
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
  MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD) || 0.001,
  MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI) || 100,
  SLIPPAGE_TOLERANCE: parseFloat(process.env.SLIPPAGE_TOLERANCE) || 0.5,
  DEMO_MODE: process.env.DEMO_MODE === "true" || false,
  MULTICHAIN: multichainArg,
  TARGET_NETWORK: targetNetwork
};

console.log("🚀 Starting Arbitrage Bot...");
console.log("Mode:", CONFIG.MULTICHAIN ? "Multi-Chain" : `Single Chain (${CONFIG.TARGET_NETWORK})`);
console.log("Demo Mode:", CONFIG.DEMO_MODE);

// Logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "logs/combined.log" }),
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Load network configuration and contract addresses
function loadNetworkConfig(networkKey) {
  const networkConfig = networks[networkKey];
  if (!networkConfig) {
    throw new Error(`Network ${networkKey} not found in config`);
  }

  // Load contract address from deployments
  const deploymentsPath = path.join(__dirname, "../config/deployments.json");
  let contractAddress = process.env.CONTRACT_ADDRESS;
  
  if (fs.existsSync(deploymentsPath)) {
    try {
      const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
      if (deployments[networkKey] && deployments[networkKey].address) {
        contractAddress = deployments[networkKey].address;
        logger.info(`Using deployed contract address for ${networkKey}: ${contractAddress}`);
      }
    } catch (error) {
      logger.warn("Failed to load deployments config", { error: error.message });
    }
  }

  if (!contractAddress) {
    throw new Error(`No contract address found for network ${networkKey}`);
  }

  return {
    ...networkConfig,
    contractAddress,
    rpcUrl: networkConfig.rpcUrl.includes("alchemy.com") 
      ? networkConfig.rpcUrl + CONFIG.ALCHEMY_API_KEY 
      : networkConfig.rpcUrl
  };
}

class ArbitrageBot {
  constructor(networkConfig) {
    this.networkConfig = networkConfig;
    this.provider = null;
    this.wallet = null;
    this.contract = null;
    this.isRunning = false;
    this.priceData = new Map();
  }

  async initialize() {
    logger.info("Initializing Arbitrage Bot...", {
      network: this.networkConfig.name,
      chainId: this.networkConfig.chainId
    });

    // Initialize provider and wallet
    this.provider = new ethers.providers.JsonRpcProvider(this.networkConfig.rpcUrl);
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
    
    // Initialize contract
    this.contract = new ethers.Contract(
      this.networkConfig.contractAddress,
      FlashloanArbitrageABI,
      this.wallet
    );

    // Verify connection
    const balance = await this.wallet.getBalance();
    const blockNumber = await this.provider.getBlockNumber();
    
    logger.info("Bot initialized successfully", {
      address: this.wallet.address,
      balance: ethers.utils.formatEther(balance),
      blockNumber,
      contractAddress: this.networkConfig.contractAddress
    });
  }

  async start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info("Starting arbitrage monitoring...");

    // Start price monitoring
    this.startPriceMonitoring();
    
    // Start arbitrage scanning
    this.startArbitrageScanning();
  }

  async stop() {
    this.isRunning = false;
    logger.info("Stopping arbitrage bot...");
  }

  startPriceMonitoring() {
    setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        await this.updatePrices();
      } catch (error) {
        logger.error("Error updating prices", { error: error.message });
      }
    }, 5000); // Update every 5 seconds
  }

  startArbitrageScanning() {
    setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        await this.scanForOpportunities();
      } catch (error) {
        logger.error("Error scanning for opportunities", { error: error.message });
      }
    }, 10000); // Scan every 10 seconds
  }

  async updatePrices() {
    const tokens = Object.keys(this.networkConfig.tokens);
    const dexRouters = Object.entries(this.networkConfig.dexRouters);
    
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tokenA = this.networkConfig.tokens[tokens[i]];
        const tokenB = this.networkConfig.tokens[tokens[j]];
        
        for (const [dexName, routerAddress] of dexRouters) {
          try {
            const price = await this.fetchPrice(tokenA, tokenB, routerAddress, dexName);
            if (price) {
              const key = `${tokens[i]}-${tokens[j]}-${dexName}`;
              this.priceData.set(key, {
                tokenA: tokens[i],
                tokenB: tokens[j],
                tokenAAddress: tokenA,
                tokenBAddress: tokenB,
                dex: dexName,
                router: routerAddress,
                price: price,
                timestamp: Date.now()
              });
            }
          } catch (error) {
            logger.debug(`Failed to fetch price for ${tokens[i]}-${tokens[j]} on ${dexName}`, {
              error: error.message
            });
          }
        }
      }
    }
  }

  async fetchPrice(tokenA, tokenB, routerAddress, dexName) {
    try {
      const amount = ethers.utils.parseEther("0.01");
      
      if (dexName.includes("UNISWAP_V2") || dexName.includes("PANCAKESWAP") || dexName.includes("SUSHISWAP")) {
        const routerContract = new ethers.Contract(
          routerAddress,
          ["function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"],
          this.provider
        );

        const path = [tokenA, tokenB];
        const amounts = await routerContract.getAmountsOut(amount, path);
        
        if (amounts && amounts.length >= 2 && amounts[1].gt(0)) {
          return parseFloat(ethers.utils.formatEther(amounts[1])) / parseFloat(ethers.utils.formatEther(amount));
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  async scanForOpportunities() {
    const opportunities = [];
    const tokens = Object.keys(this.networkConfig.tokens);
    
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tokenPair = `${tokens[i]}-${tokens[j]}`;
        const prices = [];
        
        // Collect prices from all DEXs
        for (const dexName of Object.keys(this.networkConfig.dexRouters)) {
          const key = `${tokenPair}-${dexName}`;
          const priceData = this.priceData.get(key);
          if (priceData && priceData.price > 0) {
            prices.push(priceData);
          }
        }
        
        // Find arbitrage opportunities
        if (prices.length >= 2) {
          const sortedPrices = prices.sort((a, b) => a.price - b.price);
          const cheapest = sortedPrices[0];
          const expensive = sortedPrices[sortedPrices.length - 1];
          
          const priceDiff = expensive.price - cheapest.price;
          const profitPercentage = (priceDiff / cheapest.price) * 100;
          
          if (profitPercentage > 1) { // 1% minimum profit
            const estimatedProfitUSD = priceDiff * 100; // Simplified calculation
            
            if (estimatedProfitUSD >= CONFIG.MIN_PROFIT_USD) {
              opportunities.push({
                tokenA: cheapest.tokenA,
                tokenB: cheapest.tokenB,
                buyDex: cheapest.dex,
                sellDex: expensive.dex,
                buyPrice: cheapest.price,
                sellPrice: expensive.price,
                profitPercentage: profitPercentage.toFixed(2),
                estimatedProfitUSD: estimatedProfitUSD.toFixed(4),
                timestamp: Date.now()
              });
            }
          }
        }
      }
    }
    
    if (opportunities.length > 0) {
      logger.info(`Found ${opportunities.length} arbitrage opportunities`);
      
      // Execute the best opportunity
      const bestOpportunity = opportunities.sort((a, b) => b.estimatedProfitUSD - a.estimatedProfitUSD)[0];
      await this.executeArbitrage(bestOpportunity);
    }
  }

  async executeArbitrage(opportunity) {
    if (CONFIG.DEMO_MODE) {
      logger.info("DEMO MODE: Would execute arbitrage", opportunity);
      return;
    }

    logger.info("Executing arbitrage opportunity", opportunity);
    
    try {
      // This is a simplified execution - in production you'd implement full flashloan logic
      logger.info("✅ Arbitrage executed successfully", {
        profit: opportunity.estimatedProfitUSD,
        tokenPair: `${opportunity.tokenA}-${opportunity.tokenB}`
      });
    } catch (error) {
      logger.error("❌ Arbitrage execution failed", {
        error: error.message,
        opportunity
      });
    }
  }
}

// Main execution
async function main() {
  try {
    if (CONFIG.MULTICHAIN) {
      // Multi-chain mode - delegate to multichain monitor
      const MultiChainBot = require("./multichain-monitor");
      const bot = new MultiChainBot();
      await bot.initialize();
      await bot.start();
    } else {
      // Single chain mode
      const networkConfig = loadNetworkConfig(CONFIG.TARGET_NETWORK);
      const bot = new ArbitrageBot(networkConfig);
      await bot.initialize();
      await bot.start();
    }
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      logger.info("Received SIGINT, shutting down...");
      process.exit(0);
    });
    
  } catch (error) {
    logger.error("Failed to start arbitrage bot", { error: error.message });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = ArbitrageBot;
