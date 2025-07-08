const { ethers } = require("ethers");
const winston = require("winston");
const MultiChainManager = require("./MultiChainManager");
const FlashloanArbitrageABI = require("../artifacts/contracts/FlashloanArbitrage.sol/FlashloanArbitrage.json").abi;

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "logs/multichain-arbitrage.log" }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

class MultiChainArbitrageBot {
  constructor() {
    this.multiChain = null;
    this.isRunning = false;
    this.opportunities = new Map();
    this.executionStats = {
      totalOpportunities: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalProfit: 0
    };
    
    this.config = {
      PRIVATE_KEY: process.env.PRIVATE_KEY,
      ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
      MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD) || 5,
      MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI) || 100,
      SCAN_INTERVAL: parseInt(process.env.SCAN_INTERVAL) || 10000, // 10 seconds
      DEMO_MODE: process.env.DEMO_MODE === "true" || false
    };
  }

  async initialize() {
    logger.info("🚀 Initializing Multi-Chain Arbitrage Bot...");
    
    if (!this.config.PRIVATE_KEY || !this.config.ALCHEMY_API_KEY) {
      throw new Error("Missing required environment variables: PRIVATE_KEY, ALCHEMY_API_KEY");
    }

    // Initialize multi-chain manager
    this.multiChain = new MultiChainManager(
      this.config.PRIVATE_KEY,
      this.config.ALCHEMY_API_KEY
    );

    // Load deployment configurations
    try {
      const deployments = require("../config/multichain-deployments.json");
      await this.loadContracts(deployments);
    } catch (error) {
      logger.warn("No multichain deployments found. Run deployment first.", {
        error: error.message
      });
    }

    logger.info("✅ Multi-Chain Arbitrage Bot initialized");
  }

  async loadContracts(deployments) {
    logger.info("📋 Loading deployed contracts...");
    
    for (const [networkKey, deployment] of Object.entries(deployments.deployments)) {
      try {
        await this.multiChain.activateChain(networkKey);
        
        const chain = this.multiChain.chains.get(networkKey);
        if (chain && chain.isActive) {
          const contract = new ethers.Contract(
            deployment.address,
            FlashloanArbitrageABI,
            chain.wallet
          );
          
          this.multiChain.contracts.set(`${networkKey}-arbitrage`, {
            address: deployment.address,
            contract,
            networkKey,
            deployedAt: deployment.deployedAt
          });
          
          logger.info(`✅ Loaded contract for ${deployment.network}`, {
            address: deployment.address,
            network: networkKey
          });
        }
      } catch (error) {
        logger.error(`❌ Failed to load contract for ${networkKey}`, {
          error: error.message
        });
      }
    }
  }

  async start() {
    if (this.isRunning) {
      logger.warn("Bot is already running");
      return;
    }

    this.isRunning = true;
    logger.info("🎯 Starting Multi-Chain Arbitrage Bot...", {
      demoMode: this.config.DEMO_MODE,
      activeChains: this.multiChain.activeChains.length,
      minProfitUSD: this.config.MIN_PROFIT_USD
    });

    // Start multi-chain monitoring
    await this.multiChain.startMultiChainMonitoring();

    // Start arbitrage scanning
    this.startArbitrageScanning();

    // Start status reporting
    this.startStatusReporting();

    logger.info("✨ Multi-Chain Arbitrage Bot is now running!");
  }

  async stop() {
    this.isRunning = false;
    logger.info("🛑 Stopping Multi-Chain Arbitrage Bot...");
    
    await this.multiChain.stopMultiChainMonitoring();
    
    logger.info("✅ Multi-Chain Arbitrage Bot stopped");
  }

  startArbitrageScanning() {
    logger.info("🔍 Starting cross-chain arbitrage scanning...");
    
    const scanInterval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(scanInterval);
        return;
      }

      try {
        await this.scanForArbitrageOpportunities();
      } catch (error) {
        logger.error("Error during arbitrage scanning", {
          error: error.message
        });
      }
    }, this.config.SCAN_INTERVAL);
  }

  async scanForArbitrageOpportunities() {
    const activeChains = this.multiChain.getActiveChains();
    
    if (activeChains.length < 2) {
      logger.debug("Need at least 2 active chains for arbitrage");
      return;
    }

    // Scan for opportunities across all chain pairs
    for (let i = 0; i < activeChains.length; i++) {
      for (let j = i + 1; j < activeChains.length; j++) {
        const chainA = activeChains[i];
        const chainB = activeChains[j];
        
        await this.findCrossChainOpportunities(chainA.key, chainB.key);
      }
    }
  }

  async findCrossChainOpportunities(chainA, chainB) {
    try {
      // Get token prices on both chains
      const pricesA = await this.getTokenPrices(chainA);
      const pricesB = await this.getTokenPrices(chainB);
      
      // Find arbitrage opportunities
      for (const [token, priceA] of Object.entries(pricesA)) {
        const priceB = pricesB[token];
        if (!priceB) continue;
        
        const priceDiff = Math.abs(priceA - priceB);
        const profitPercentage = (priceDiff / Math.min(priceA, priceB)) * 100;
        
        if (profitPercentage > 2) { // 2% minimum profit
          const opportunity = {
            tokenSymbol: token,
            chainA,
            chainB,
            priceA,
            priceB,
            profitPercentage,
            estimatedProfitUSD: this.calculateProfitUSD(priceDiff, token),
            timestamp: Date.now()
          };
          
          if (opportunity.estimatedProfitUSD >= this.config.MIN_PROFIT_USD) {
            await this.handleArbitrageOpportunity(opportunity);
          }
        }
      }
    } catch (error) {
      logger.debug(`Error finding opportunities between ${chainA} and ${chainB}`, {
        error: error.message
      });
    }
  }

  async getTokenPrices(chainKey) {
    // Simplified price fetching - in production, integrate with DEX APIs
    const mockPrices = {
      ETH: 2000 + Math.random() * 200,
      USDC: 1 + Math.random() * 0.01,
      USDT: 1 + Math.random() * 0.01,
      BTC: 45000 + Math.random() * 2000
    };
    
    return mockPrices;
  }

  calculateProfitUSD(priceDiff, token) {
    // Simplified profit calculation
    const tradeAmount = 1000; // $1000 trade size
    return (priceDiff / 100) * tradeAmount;
  }

  async handleArbitrageOpportunity(opportunity) {
    this.executionStats.totalOpportunities++;
    
    logger.info("🎯 Cross-chain arbitrage opportunity found!", {
      token: opportunity.tokenSymbol,
      chainA: opportunity.chainA,
      chainB: opportunity.chainB,
      profitPercentage: opportunity.profitPercentage.toFixed(2),
      estimatedProfitUSD: opportunity.estimatedProfitUSD.toFixed(2)
    });

    if (this.config.DEMO_MODE) {
      logger.info("🎭 DEMO MODE: Would execute cross-chain arbitrage", {
        opportunity
      });
      return;
    }

    try {
      // Find optimal chain for execution
      const optimalChain = await this.multiChain.getOptimalChainForArbitrage(opportunity);
      
      if (optimalChain) {
        await this.executeArbitrage(optimalChain, opportunity);
        this.executionStats.successfulExecutions++;
        this.executionStats.totalProfit += opportunity.estimatedProfitUSD;
      }
    } catch (error) {
      this.executionStats.failedExecutions++;
      logger.error("❌ Failed to execute arbitrage", {
        error: error.message,
        opportunity
      });
    }
  }

  async executeArbitrage(chainKey, opportunity) {
    logger.info(`⚡ Executing arbitrage on ${chainKey}...`, {
      opportunity
    });

    // This would implement the actual arbitrage execution
    // For now, we'll simulate it
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    logger.info("✅ Arbitrage executed successfully!", {
      chain: chainKey,
      profit: opportunity.estimatedProfitUSD
    });
  }

  startStatusReporting() {
    setInterval(() => {
      if (!this.isRunning) return;
      
      this.reportStatus();
    }, 60000); // Every minute
  }

  async reportStatus() {
    const chainStatuses = await this.multiChain.getAllChainStatuses();
    
    logger.info("📊 Multi-Chain Bot Status", {
      isRunning: this.isRunning,
      activeChains: Object.keys(chainStatuses).length,
      totalOpportunities: this.executionStats.totalOpportunities,
      successfulExecutions: this.executionStats.successfulExecutions,
      failedExecutions: this.executionStats.failedExecutions,
      totalProfit: this.executionStats.totalProfit.toFixed(2),
      successRate: this.executionStats.totalOpportunities > 0 
        ? ((this.executionStats.successfulExecutions / this.executionStats.totalOpportunities) * 100).toFixed(1)
        : 0
    });

    // Log individual chain statuses
    for (const [chainKey, status] of Object.entries(chainStatuses)) {
      logger.debug(`Chain Status: ${status.network}`, {
        balance: status.balance,
        gasPrice: status.gasPrice,
        opportunities: status.arbitrageOpportunities
      });
    }
  }
}

// Main execution
async function main() {
  const bot = new MultiChainArbitrageBot();
  
  try {
    await bot.initialize();
    await bot.start();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info("Received SIGINT, shutting down gracefully...");
      await bot.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info("Received SIGTERM, shutting down gracefully...");
      await bot.stop();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error("Failed to start multi-chain bot", {
      error: error.message
    });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = MultiChainArbitrageBot;
