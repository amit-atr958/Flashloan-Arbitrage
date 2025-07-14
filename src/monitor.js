const { ethers } = require("ethers");
const winston = require("winston");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Import enhanced arbitrage components
const DexPriceFetcher = require("./DexPriceFetcher");
const ProfitCalculator = require("./ProfitCalculator");
const ArbitrageExecutor = require("./ArbitrageExecutor");
const PriceOracle = require("./PriceOracle");
const GasOptimizer = require("./GasOptimizer");
const MEVProtection = require("./MEVProtection");
const ChainValidator = require("./ChainValidator");
const RiskManager = require("./RiskManager");
const PerformanceMonitor = require("./PerformanceMonitor");
const networks = require("../config/networks.json");
const FlashloanArbitrageABI =
  require("../artifacts/contracts/FlashloanArbitrage.sol/FlashloanArbitrage.json").abi;

// Parse command line arguments
const args = process.argv.slice(2);
const networkArg = args.find((arg) => arg.startsWith("--network="));
const multichainArg = args.includes("--multichain");
const targetNetwork = networkArg
  ? networkArg.split("=")[1]
  : process.env.NETWORK || "sepolia";

// Configuration
const CONFIG = {
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
  MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD) || 2, // Lower for testnet
  MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI) || 50, // Lower for Sepolia
  MAX_RISK_SCORE: parseFloat(process.env.MAX_RISK_SCORE) || 70,
  SLIPPAGE_TOLERANCE: parseFloat(process.env.SLIPPAGE_TOLERANCE) || 1.0, // Higher for testnet
  DEMO_MODE: process.env.DEMO_MODE === "true" || false,
  MULTICHAIN: multichainArg,
  TARGET_NETWORK: targetNetwork,
  SCAN_INTERVAL: 30000, // 30 seconds for Sepolia
  ORACLE_VALIDATION: true, // Enable Chainlink oracle validation
  FLASHLOAN_AMOUNT: ethers.utils.parseEther("1000"), // 1000 tokens for testing
};

console.log("🚀 Starting REAL Arbitrage Bot...");
console.log(
  "Mode:",
  CONFIG.MULTICHAIN ? "Multi-Chain" : `Single Chain (${CONFIG.TARGET_NETWORK})`
);
console.log("Demo Mode:", CONFIG.DEMO_MODE);
console.log("Min Profit USD:", CONFIG.MIN_PROFIT_USD);

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
      ),
    }),
  ],
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
      const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
      if (deployments[networkKey]?.address) {
        contractAddress = deployments[networkKey].address;
        logger.info(
          `Using deployed contract address for ${networkKey}: ${contractAddress}`
        );
      }
    } catch (error) {
      logger.warn("Failed to load deployments config", {
        error: error.message,
      });
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
      : networkConfig.rpcUrl,
  };
}

class RealArbitrageBot {
  constructor(networkConfig) {
    this.networkConfig = networkConfig;
    this.provider = null;
    this.wallet = null;
    this.contract = null;
    this.isRunning = false;

    // Enhanced arbitrage components
    this.priceFetcher = null;
    this.profitCalculator = null;
    this.executor = null;
    this.priceOracle = null;
    this.gasOptimizer = null;
    this.mevProtection = null;
    this.chainValidator = null;
    this.riskManager = null;
    this.performanceMonitor = null;

    // DEX configurations for the network
    this.dexConfigs = [];

    // Statistics
    this.stats = {
      opportunitiesFound: 0,
      opportunitiesExecuted: 0,
      totalProfitUSD: 0,
      averageProfitUSD: 0,
      lastScanTime: 0,
    };
  }

  async initialize() {
    logger.info("Initializing REAL Arbitrage Bot...", {
      network: this.networkConfig.name,
      chainId: this.networkConfig.chainId,
    });

    // Initialize provider and wallet
    this.provider = new ethers.providers.JsonRpcProvider(
      this.networkConfig.rpcUrl
    );
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);

    // Initialize contract
    this.contract = new ethers.Contract(
      this.networkConfig.contractAddress,
      FlashloanArbitrageABI,
      this.wallet
    );

    // Initialize enhanced arbitrage components
    this.priceFetcher = new DexPriceFetcher(
      this.provider,
      logger,
      this.networkConfig
    );
    this.profitCalculator = new ProfitCalculator(
      this.provider,
      logger,
      this.networkConfig
    );
    this.executor = new ArbitrageExecutor(
      this.contract,
      this.wallet,
      this.provider,
      logger
    );
    this.priceOracle = new PriceOracle(
      this.provider,
      logger,
      this.networkConfig
    );
    this.gasOptimizer = new GasOptimizer(
      this.provider,
      logger,
      this.networkConfig
    );
    this.mevProtection = new MEVProtection(
      this.provider,
      this.wallet,
      logger,
      this.networkConfig
    );
    this.chainValidator = new ChainValidator(logger);
    this.riskManager = new RiskManager(
      this.provider,
      logger,
      this.networkConfig
    );
    this.performanceMonitor = new PerformanceMonitor(
      logger,
      this.networkConfig
    );

    // Setup DEX configurations
    this.setupDexConfigs();

    // Verify connection and contract
    const balance = await this.wallet.getBalance();
    const blockNumber = await this.provider.getBlockNumber();
    const contractCode = await this.provider.getCode(
      this.networkConfig.contractAddress
    );

    if (contractCode === "0x") {
      throw new Error("Contract not deployed at specified address");
    }

    logger.info("REAL Arbitrage Bot initialized successfully", {
      address: this.wallet.address,
      balance: ethers.utils.formatEther(balance),
      blockNumber,
      contractAddress: this.networkConfig.contractAddress,
      dexCount: this.dexConfigs.length,
      tokenPairs: Object.keys(this.networkConfig.tokens).length,
    });
  }

  setupDexConfigs() {
    this.dexConfigs = [];

    for (const [dexName, routerAddress] of Object.entries(
      this.networkConfig.dexRouters
    )) {
      let dexType = "UNISWAP_V2"; // Default

      if (dexName.includes("UNISWAP_V3")) {
        dexType = "UNISWAP_V3";
      } else if (dexName.includes("SUSHISWAP")) {
        dexType = "SUSHISWAP";
      } else if (dexName.includes("PANCAKESWAP")) {
        dexType = "PANCAKESWAP";
      }

      this.dexConfigs.push({
        name: dexName,
        type: dexType,
        router: routerAddress,
        quoter: dexType === "UNISWAP_V3" ? routerAddress : null,
      });
    }

    logger.info(`Configured ${this.dexConfigs.length} DEXs for arbitrage`, {
      dexes: this.dexConfigs.map((d) => `${d.name} (${d.type})`),
    });
  }

  async start() {
    if (this.isRunning) return;

    this.isRunning = true;
    logger.info("Starting REAL arbitrage monitoring...");

    // Start real arbitrage scanning
    this.startRealArbitrageScanning();

    // Start status reporting
    this.startStatusReporting();
  }

  async stop() {
    this.isRunning = false;
    logger.info("Stopping REAL arbitrage bot...");
  }

  startRealArbitrageScanning() {
    logger.info("Starting real arbitrage opportunity scanning...");

    setInterval(async () => {
      if (!this.isRunning) return;

      try {
        await this.scanForRealArbitrageOpportunities();
      } catch (error) {
        logger.error("Error scanning for real arbitrage opportunities", {
          error: error.message,
        });
      }
    }, CONFIG.SCAN_INTERVAL);
  }

  startStatusReporting() {
    setInterval(() => {
      if (!this.isRunning) return;

      this.reportStatus();
    }, 60000); // Every minute
  }

  async scanForRealArbitrageOpportunities() {
    const tokens = Object.keys(this.networkConfig.tokens);
    let totalOpportunities = 0;
    this.stats.lastScanTime = Date.now();

    logger.debug(
      `Scanning ${tokens.length} tokens across ${this.dexConfigs.length} DEXs...`
    );

    // Scan all token pairs
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tokenA = this.networkConfig.tokens[tokens[i]];
        const tokenB = this.networkConfig.tokens[tokens[j]];
        const amountIn = ethers.utils.parseEther("0.1"); // Test with 0.1 ETH worth

        try {
          // Find arbitrage opportunity using oracle-validated price fetcher
          const opportunity = CONFIG.ORACLE_VALIDATION
            ? await this.priceFetcher.findValidatedArbitrageOpportunity(
                this.dexConfigs,
                tokenA,
                tokenB,
                amountIn
              )
            : await this.priceFetcher.findArbitrageOpportunity(
                this.dexConfigs,
                tokenA,
                tokenB,
                amountIn
              );

          if (opportunity) {
            totalOpportunities++;
            this.stats.opportunitiesFound++;

            logger.info("🎯 Real arbitrage opportunity detected!", {
              tokenPair: `${tokens[i]}-${tokens[j]}`,
              buyDex: opportunity.buyDex,
              sellDex: opportunity.sellDex,
              profitPercentage: opportunity.profitPercentage + "%",
              buyPrice: opportunity.buyPrice.toFixed(6),
              sellPrice: opportunity.sellPrice.toFixed(6),
              oracleValidated: opportunity.oracleValidated || false,
              buyDeviation: opportunity.buyDeviation
                ? opportunity.buyDeviation.toFixed(2) + "%"
                : "N/A",
              sellDeviation: opportunity.sellDeviation
                ? opportunity.sellDeviation.toFixed(2) + "%"
                : "N/A",
            });

            // Calculate real profitability
            const profitability =
              await this.profitCalculator.calculateArbitrageProfitability(
                opportunity
              );

            if (
              profitability &&
              this.profitCalculator.isOpportunityViable(
                profitability,
                CONFIG.MIN_PROFIT_USD,
                CONFIG.MAX_RISK_SCORE
              )
            ) {
              logger.info("✅ Opportunity is viable for execution!", {
                netProfitUSD: profitability.netProfitUSD.toFixed(4),
                profitMargin: profitability.profitMargin.toFixed(2) + "%",
                riskScore: profitability.riskScore,
                gasCostUSD: profitability.costs.gasCostUSD.toFixed(4),
              });

              // Execute the arbitrage if not in demo mode
              if (!CONFIG.DEMO_MODE) {
                await this.executeRealArbitrage(opportunity, profitability);
              } else {
                logger.info("🎭 DEMO MODE: Would execute arbitrage", {
                  expectedProfitUSD: profitability.netProfitUSD.toFixed(4),
                });
              }
            } else {
              logger.debug("❌ Opportunity not viable", {
                reason: profitability
                  ? "Risk/profit threshold not met"
                  : "Profitability calculation failed",
                netProfitUSD: profitability?.netProfitUSD?.toFixed(4) || "N/A",
                riskScore: profitability?.riskScore || "N/A",
              });
            }
          }
        } catch (error) {
          logger.debug(
            `Error scanning ${tokens[i]}-${tokens[j]}:`,
            error.message
          );
        }
      }
    }

    if (totalOpportunities === 0) {
      logger.debug("No arbitrage opportunities found in this scan");
    } else {
      logger.info(`Scan complete: Found ${totalOpportunities} opportunities`);
    }
  }

  async executeRealArbitrage(opportunity, profitability) {
    try {
      const result = await this.executor.executeArbitrage(
        opportunity,
        profitability,
        this.dexConfigs
      );

      if (result.success) {
        this.stats.opportunitiesExecuted++;
        this.stats.totalProfitUSD += profitability.netProfitUSD;
        this.stats.averageProfitUSD =
          this.stats.totalProfitUSD / this.stats.opportunitiesExecuted;

        logger.info("🎉 Arbitrage executed successfully!", {
          txHash: result.txHash,
          actualProfitUSD: profitability.netProfitUSD.toFixed(4),
          gasUsed: result.gasUsed,
        });
      } else {
        logger.error("❌ Arbitrage execution failed", {
          reason: result.reason,
          opportunity,
        });
      }
    } catch (error) {
      logger.error("❌ Error executing arbitrage", {
        error: error.message,
        opportunity,
      });
    }
  }

  reportStatus() {
    const executionStats = this.executor.getExecutionStats();

    logger.info("📊 REAL Arbitrage Bot Status", {
      isRunning: this.isRunning,
      network: this.networkConfig.name,
      opportunitiesFound: this.stats.opportunitiesFound,
      opportunitiesExecuted: this.stats.opportunitiesExecuted,
      totalProfitUSD: this.stats.totalProfitUSD.toFixed(2),
      averageProfitUSD: this.stats.averageProfitUSD.toFixed(2),
      successRate: executionStats.successRate,
      lastScanTime: new Date(this.stats.lastScanTime).toLocaleTimeString(),
    });
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
      // Single chain mode with REAL arbitrage
      const networkConfig = loadNetworkConfig(CONFIG.TARGET_NETWORK);
      const bot = new RealArbitrageBot(networkConfig);
      await bot.initialize();
      await bot.start();
    }

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      logger.info("Received SIGINT, shutting down...");
      process.exit(0);
    });
  } catch (error) {
    logger.error("Failed to start REAL arbitrage bot", {
      error: error.message,
    });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = RealArbitrageBot;
