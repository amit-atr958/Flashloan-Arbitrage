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
  MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD) || 50,
  MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI) || 100,
  SLIPPAGE_TOLERANCE: parseFloat(process.env.SLIPPAGE_TOLERANCE) || 0.5, // 0.5%
  FLASHLOAN_AMOUNTS: {
    WETH: ethers.utils.parseEther("10"), // 10 ETH
    USDC: ethers.utils.parseUnits("50000", 6), // 50,000 USDC
    USDT: ethers.utils.parseUnits("50000", 6), // 50,000 USDT
    DAI: ethers.utils.parseEther("50000"), // 50,000 DAI
  },
};

console.log('CONFIG', CONFIG)

// DEX Router Addresses (Ethereum Mainnet)
const DEX_ROUTERS = {
  UNISWAP_V2: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  UNISWAP_V3: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  SUSHISWAP: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
  BALANCER: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
  CURVE: "0x99a58482BD75cbab83b27EC03CA68fF489b5788f", // Curve Router
  ONEINCH: "0x1111111254EEB25477B68fb85Ed929f73A960582", // 1inch V5 Router
};

// Token Addresses (Ethereum Mainnet)
const TOKENS = {
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  USDC: "0xA0b86a33E6417c4c4c4c4c4c4c4c4c4c4c4c4c4c", // USDC on Ethereum
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
};

// Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "flashloan-arbitrage" },
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
        network: "mainnet",
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
        await this.executeArbitrage(bestOpportunity);
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
          gasLimit: 800000,
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
  if (
    !process.env.PRIVATE_KEY.startsWith("0x") ||
    process.env.PRIVATE_KEY.length !== 66
  ) {
    logger.error("Invalid private key format");
    process.exit(1);
  }

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
