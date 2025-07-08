const { ethers } = require("ethers");
const WebSocket = require("ws");
const axios = require("axios");
const winston = require("winston");
const BigNumber = require("bignumber.js");
require("dotenv").config();

// Import contract ABI (will be generated after compilation)
const FlashloanArbitrageABI =
  require("../artifacts/contracts/FlashloanArbitrage.sol/FlashloanArbitrage.json").abi;

// Configuration
const CONFIG = {
  RPC_URL:
    process.env.RPC_URL ||
    "wss://eth-mainnet.ws.alchemyapi.io/v2/" + process.env.ALCHEMY_API_KEY,
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
  MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD) || 1,
  MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI) || 100,
  SLIPPAGE_TOLERANCE: parseFloat(process.env.SLIPPAGE_TOLERANCE) || 0.5, // 0.5%
  FLASHLOAN_AMOUNTS: {
    WETH: ethers.utils.parseEther("0.1"), // 0.1 ETH for testing
    USDC: ethers.utils.parseUnits("100", 6), // 100 USDC for testing
    USDT: ethers.utils.parseUnits("100", 6), // 100 USDT for testing
    DAI: ethers.utils.parseEther("100"), // 100 DAI for testing
    LINK: ethers.utils.parseEther("10"), // 10 LINK for testing
  },
  NETWORK: process.env.NETWORK,
  DEMO_MODE: process.env.DEMO_MODE === "true" || false, // Enable demo mode by default,
};

console.log("CONFIG", CONFIG);

// DEX Router Addresses - Updated for Sepolia testnet
const DEX_ROUTERS = {
  UNISWAP_V2: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Same on Sepolia
  UNISWAP_V3: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Same on Sepolia
  SUSHISWAP: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Use Uniswap V2 for testing
};

// Token Addresses - Real Sepolia testnet tokens
const TOKENS = {
  WETH: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", // WETH on Sepolia
  USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // USDC on Sepolia
  LINK: "0x779877A7B0D9E8603169DdbD7836e478b4624789", // LINK on Sepolia
};

// Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  // defaultMeta: { service: "flashloan-arbitrage" },
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

class FlashloanArbitrageBot {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.contract = null;
    this.isRunning = false;
    this.priceData = new Map();
    this.lastExecutionTime = 0;
    this.executionCooldown = 30000; // 30 seconds between executions

    this.initializeProvider();
    this.initializeContract();
  }

  initializeProvider() {
    try {
      if (CONFIG.RPC_URL.startsWith("wss://")) {
        this.provider = new ethers.providers.WebSocketProvider(CONFIG.RPC_URL);
      } else {
        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
      }

      this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
      logger.info("Provider and wallet initialized", {
        address: this.wallet.address,
        network: CONFIG.NETWORK,
      });
    } catch (error) {
      logger.error("Failed to initialize provider", { error: error.message });
      throw error;
    }
  }

  initializeContract() {
    try {
      this.contract = new ethers.Contract(
        CONFIG.CONTRACT_ADDRESS,
        FlashloanArbitrageABI,
        this.wallet
      );
      logger.info("Contract initialized", { address: CONFIG.CONTRACT_ADDRESS });
    } catch (error) {
      logger.error("Failed to initialize contract", { error: error.message });
      throw error;
    }
  }

  async start() {
    logger.info("Starting Flashloan Arbitrage Bot...");
    this.isRunning = true;

    // Start price monitoring
    await this.startPriceMonitoring();

    // Start arbitrage scanning loop
    this.startArbitrageScanning();

    // Setup graceful shutdown
    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());
  }

  async stop() {
    logger.info("Stopping Flashloan Arbitrage Bot...");
    this.isRunning = false;

    if (this.provider && this.provider.destroy) {
      await this.provider.destroy();
    }

    process.exit(0);
  }

  async startPriceMonitoring() {
    logger.info("Starting price monitoring...");

    // Monitor prices from multiple sources
    setInterval(() => this.updatePrices(), 5000); // Update every 5 seconds

    // Initial price fetch
    await this.updatePrices();
  }

  async updatePrices() {
    try {
      const tokenPairs = this.generateTokenPairs();
      const pricePromises = [];

      for (const pair of tokenPairs) {
        for (const [dexName, routerAddress] of Object.entries(DEX_ROUTERS)) {
          pricePromises.push(
            this.fetchPriceFromDEX(
              pair.tokenA,
              pair.tokenB,
              routerAddress,
              dexName
            )
          );
        }
      }

      const prices = await Promise.allSettled(pricePromises);

      prices.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value) {
          const key = `${result.value.tokenA}-${result.value.tokenB}-${result.value.dex}`;
          this.priceData.set(key, {
            ...result.value,
            timestamp: Date.now(),
          });
        }
      });

      logger.debug(`Updated ${this.priceData.size} price entries`);
    } catch (error) {
      logger.error("Error updating prices", { error: error.message });
    }
  }

  generateTokenPairs() {
    const tokenAddresses = Object.values(TOKENS);
    const pairs = [];

    for (let i = 0; i < tokenAddresses.length; i++) {
      for (let j = i + 1; j < tokenAddresses.length; j++) {
        pairs.push({
          tokenA: tokenAddresses[i],
          tokenB: tokenAddresses[j],
        });
      }
    }

    return pairs;
  }

  async fetchPriceFromDEX(tokenA, tokenB, routerAddress, dexName) {
    try {
      // This is a simplified price fetching - in production, you'd use specific DEX interfaces
      const amount = ethers.utils.parseEther("1"); // 1 token

      // For demonstration, we'll use a mock price calculation
      // In production, you'd call the actual DEX router contracts
      const mockPrice = Math.random() * 1000 + 1000; // Random price between 1000-2000

      return {
        tokenA,
        tokenB,
        dex: dexName,
        router: routerAddress,
        price: mockPrice,
        amountIn: amount.toString(),
        amountOut: ethers.utils.parseEther(mockPrice.toString()).toString(),
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.debug(`Failed to fetch price from ${dexName}`, {
        tokenA,
        tokenB,
        error: error.message,
      });
      return null;
    }
  }

  startArbitrageScanning() {
    logger.info("Starting arbitrage scanning...");

    setInterval(async () => {
      if (!this.isRunning) return;

      try {
        await this.scanForArbitrageOpportunities();
      } catch (error) {
        logger.error("Error in arbitrage scanning", { error: error.message });
      }
    }, 2000); // Scan every 2 seconds
  }

  async scanForArbitrageOpportunities() {
    const opportunities = [];
    const tokenPairs = this.generateTokenPairs();

    for (const pair of tokenPairs) {
      const pairOpportunities = await this.findArbitrageForPair(
        pair.tokenA,
        pair.tokenB
      );
      opportunities.push(...pairOpportunities);
    }

    if (opportunities.length > 0) {
      logger.info(`Found ${opportunities.length} arbitrage opportunities`);

      // Sort by profitability
      opportunities.sort((a, b) => b.profitUSD - a.profitUSD);

      // Execute the most profitable opportunity
      const bestOpportunity = opportunities[0];
      if (bestOpportunity.profitUSD >= CONFIG.MIN_PROFIT_USD) {
        if (CONFIG.DEMO_MODE) {
          logger.info("DEMO MODE: Would execute arbitrage", {
            tokenA: bestOpportunity.tokenA,
            tokenB: bestOpportunity.tokenB,
            buyDex: bestOpportunity.buyDex,
            sellDex: bestOpportunity.sellDex,
            expectedProfit: bestOpportunity.profitUSD,
            flashloanAmount: bestOpportunity.flashloanAmount,
          });
        } else {
          await this.executeArbitrage(bestOpportunity);
        }
      }
    }
  }

  async findArbitrageForPair(tokenA, tokenB) {
    const opportunities = [];
    const dexPrices = [];

    // Collect prices from all DEXs for this pair
    for (const [dexName, routerAddress] of Object.entries(DEX_ROUTERS)) {
      const key = `${tokenA}-${tokenB}-${dexName}`;
      const priceData = this.priceData.get(key);

      if (priceData && Date.now() - priceData.timestamp < 30000) {
        // Price not older than 30s
        dexPrices.push(priceData);
      }
    }

    if (dexPrices.length < 2) return opportunities;

    // Find arbitrage opportunities between DEX pairs
    for (let i = 0; i < dexPrices.length; i++) {
      for (let j = i + 1; j < dexPrices.length; j++) {
        const buyDex = dexPrices[i];
        const sellDex = dexPrices[j];

        const opportunity = await this.calculateArbitrageProfit(
          buyDex,
          sellDex,
          tokenA,
          tokenB
        );
        if (opportunity && opportunity.profitUSD > 0) {
          opportunities.push(opportunity);
        }
      }
    }

    return opportunities;
  }

  async calculateArbitrageProfit(buyDex, sellDex, tokenA, tokenB) {
    try {
      const buyPrice = parseFloat(buyDex.price);
      const sellPrice = parseFloat(sellDex.price);

      if (sellPrice <= buyPrice) return null; // No profit opportunity

      const priceDifference = sellPrice - buyPrice;
      const profitPercentage = (priceDifference / buyPrice) * 100;

      if (profitPercentage < CONFIG.SLIPPAGE_TOLERANCE * 2) return null; // Not profitable after slippage

      // Calculate optimal flashloan amount
      const flashloanAmount = this.calculateOptimalAmount(tokenA);

      // Estimate gas costs
      const gasPrice = await this.provider.getGasPrice();
      const estimatedGas = 500000; // Rough estimate
      const gasCostETH = gasPrice.mul(estimatedGas);
      const gasCostUSD =
        parseFloat(ethers.utils.formatEther(gasCostETH)) * 2000; // Assume ETH = $2000

      // Calculate profit in USD
      const flashloanAmountUSD =
        parseFloat(ethers.utils.formatEther(flashloanAmount)) * buyPrice;
      const grossProfitUSD = flashloanAmountUSD * (profitPercentage / 100);
      const netProfitUSD = grossProfitUSD - gasCostUSD - 10; // 10 USD buffer for flashloan fees

      if (netProfitUSD <= 0) return null;

      return {
        tokenA,
        tokenB,
        buyDex: buyDex.dex,
        sellDex: sellDex.dex,
        buyRouter: buyDex.router,
        sellRouter: sellDex.router,
        buyPrice,
        sellPrice,
        profitPercentage,
        flashloanAmount: flashloanAmount.toString(),
        grossProfitUSD,
        gasCostUSD,
        netProfitUSD,
        profitUSD: netProfitUSD,
      };
    } catch (error) {
      logger.error("Error calculating arbitrage profit", {
        error: error.message,
      });
      return null;
    }
  }

  calculateOptimalAmount(tokenAddress) {
    // Return predefined amounts based on token type
    const tokenSymbol = this.getTokenSymbol(tokenAddress);
    return (
      CONFIG.FLASHLOAN_AMOUNTS[tokenSymbol] || ethers.utils.parseEther("1")
    );
  }

  getTokenSymbol(tokenAddress) {
    for (const [symbol, address] of Object.entries(TOKENS)) {
      if (address.toLowerCase() === tokenAddress.toLowerCase()) {
        return symbol;
      }
    }
    return "UNKNOWN";
  }

  async executeArbitrage(opportunity) {
    const currentTime = Date.now();
    if (currentTime - this.lastExecutionTime < this.executionCooldown) {
      logger.info("Skipping execution due to cooldown", {
        remainingCooldown:
          this.executionCooldown - (currentTime - this.lastExecutionTime),
      });
      return;
    }

    logger.info("Executing arbitrage opportunity", {
      tokenA: opportunity.tokenA,
      tokenB: opportunity.tokenB,
      buyDex: opportunity.buyDex,
      sellDex: opportunity.sellDex,
      expectedProfit: opportunity.profitUSD,
    });

    try {
      // Check gas price
      const gasPrice = await this.provider.getGasPrice();
      const gasPriceGwei = parseFloat(
        ethers.utils.formatUnits(gasPrice, "gwei")
      );

      if (gasPriceGwei > CONFIG.MAX_GAS_PRICE_GWEI) {
        logger.warn("Gas price too high, skipping execution", {
          currentGasPrice: gasPriceGwei,
          maxGasPrice: CONFIG.MAX_GAS_PRICE_GWEI,
        });
        return;
      }

      // Prepare arbitrage parameters
      const arbParams = {
        tokenA: opportunity.tokenA,
        tokenB: opportunity.tokenB,
        amount: opportunity.flashloanAmount,
        dexRouters: [opportunity.buyRouter, opportunity.sellRouter],
        swapData: ["0x", "0x"], // Simplified - in production, encode actual swap data
        minProfit: ethers.utils.parseEther(
          (opportunity.profitUSD / 2000).toString()
        ), // Convert USD to ETH
      };

      // Execute flashloan
      const tx = await this.contract.requestFlashLoan(
        opportunity.tokenA,
        opportunity.flashloanAmount,
        arbParams,
        {
          gasLimit: 8000000,
          gasPrice: gasPrice,
        }
      );

      logger.info("Arbitrage transaction submitted", {
        txHash: tx.hash,
        gasPrice: ethers.utils.formatUnits(gasPrice, "gwei") + " gwei",
      });

      // Wait for confirmation
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        logger.info("Arbitrage executed successfully", {
          txHash: tx.hash,
          gasUsed: receipt.gasUsed.toString(),
          blockNumber: receipt.blockNumber,
        });
      } else {
        logger.error("Arbitrage transaction failed", { txHash: tx.hash });
      }

      this.lastExecutionTime = currentTime;
    } catch (error) {
      logger.error("Failed to execute arbitrage", {
        error: error.message,
        opportunity: opportunity,
      });
    }
  }

  async getAccountBalance() {
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      return ethers.utils.formatEther(balance);
    } catch (error) {
      logger.error("Failed to get account balance", { error: error.message });
      return "0";
    }
  }

  async logStatus() {
    const balance = await this.getAccountBalance();
    const priceDataSize = this.priceData.size;
    const uptime = process.uptime();

    logger.info("Bot Status", {
      isRunning: this.isRunning,
      walletAddress: this.wallet.address,
      ethBalance: balance,
      priceDataEntries: priceDataSize,
      uptimeSeconds: Math.floor(uptime),
      lastExecutionTime: this.lastExecutionTime,
    });
  }
}

// Utility functions
function validateEnvironment() {
  const required = ["PRIVATE_KEY", "CONTRACT_ADDRESS", "RPC_URL"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error("Missing required environment variables", { missing });
    process.exit(1);
  }

  // Validate private key format
  // if (
  //   !process.env.PRIVATE_KEY.startsWith("0x")
  //   // ||process.env.PRIVATE_KEY.length !== 66
  // ) {
  //   logger.error("Invalid private key format");
  //   process.exit(1);
  // }

  // Validate contract address format
  if (!ethers.utils.isAddress(process.env.CONTRACT_ADDRESS)) {
    logger.error("Invalid contract address format");
    process.exit(1);
  }
}

// Main execution
async function main() {
  try {
    // Create logs directory if it doesn't exist
    const fs = require("fs");
    if (!fs.existsSync("logs")) {
      fs.mkdirSync("logs");
    }

    logger.info("=== Flashloan Arbitrage Bot Starting ===");

    // Validate environment
    validateEnvironment();

    // Initialize and start bot
    const bot = new FlashloanArbitrageBot();

    // Log status every 60 seconds
    setInterval(() => bot.logStatus(), 60000);

    // Start the bot
    await bot.start();
  } catch (error) {
    logger.error("Failed to start bot", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", { promise, reason });
});

process.on("uncaughtException", (error) => {
  console.log(error, "Uncaught Exception:");
  logger.error("Uncaught Exception:", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

// Start the bot if this file is run directly
if (require.main === module) {
  main();
}

module.exports = { FlashloanArbitrageBot, CONFIG, DEX_ROUTERS, TOKENS };
