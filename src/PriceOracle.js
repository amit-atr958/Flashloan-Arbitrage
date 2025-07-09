const { ethers } = require("ethers");

// Chainlink Price Feed ABI
const PRICE_FEED_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
  "function description() external view returns (string memory)"
];

class PriceOracle {
  constructor(provider, logger, networkConfig) {
    this.provider = provider;
    this.logger = logger;
    this.networkConfig = networkConfig;
    this.priceCache = new Map();
    this.cacheTimeout = 30000; // 30 seconds cache
    this.priceFeeds = new Map();
    
    // Initialize price feeds
    this.initializePriceFeeds();
  }

  initializePriceFeeds() {
    if (!this.networkConfig.priceFeeds) {
      this.logger.warn("No price feeds configured for network", {
        network: this.networkConfig.name
      });
      return;
    }

    for (const [symbol, feedAddress] of Object.entries(this.networkConfig.priceFeeds)) {
      try {
        const priceFeed = new ethers.Contract(feedAddress, PRICE_FEED_ABI, this.provider);
        this.priceFeeds.set(symbol, {
          contract: priceFeed,
          address: feedAddress,
          symbol
        });
        
        this.logger.debug(`Initialized price feed for ${symbol}`, {
          address: feedAddress
        });
      } catch (error) {
        this.logger.error(`Failed to initialize price feed for ${symbol}`, {
          error: error.message,
          address: feedAddress
        });
      }
    }

    this.logger.info(`Initialized ${this.priceFeeds.size} price feeds`, {
      feeds: Array.from(this.priceFeeds.keys())
    });
  }

  async getPrice(symbol) {
    const cacheKey = `${symbol}_USD`;
    
    // Check cache first
    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.price;
    }

    try {
      const priceFeed = this.priceFeeds.get(`${symbol}_USD`);
      if (!priceFeed) {
        // Fallback to hardcoded prices for unsupported tokens
        return this.getFallbackPrice(symbol);
      }

      const roundData = await priceFeed.contract.latestRoundData();
      const decimals = await priceFeed.contract.decimals();
      
      // Validate price data
      if (roundData.answer.lte(0)) {
        throw new Error(`Invalid price data for ${symbol}: ${roundData.answer.toString()}`);
      }

      // Check if price is stale (older than 1 hour)
      const now = Math.floor(Date.now() / 1000);
      const priceAge = now - roundData.updatedAt.toNumber();
      if (priceAge > 3600) {
        this.logger.warn(`Stale price data for ${symbol}`, {
          age: priceAge,
          lastUpdate: new Date(roundData.updatedAt.toNumber() * 1000).toISOString()
        });
      }

      const price = parseFloat(ethers.utils.formatUnits(roundData.answer, decimals));
      
      // Cache the price
      this.priceCache.set(cacheKey, {
        price,
        timestamp: Date.now(),
        roundId: roundData.roundId.toString(),
        updatedAt: roundData.updatedAt.toNumber()
      });

      this.logger.debug(`Fetched price for ${symbol}`, {
        price: price.toFixed(4),
        roundId: roundData.roundId.toString()
      });

      return price;
    } catch (error) {
      this.logger.error(`Failed to fetch price for ${symbol}`, {
        error: error.message
      });
      
      // Return fallback price on error
      return this.getFallbackPrice(symbol);
    }
  }

  getFallbackPrice(symbol) {
    // Fallback prices (updated regularly in production)
    const fallbackPrices = {
      ETH: 2000,
      BTC: 35000,
      BNB: 300,
      MATIC: 0.8,
      AVAX: 25,
      FTM: 0.3,
      USDC: 1.0,
      USDT: 1.0,
      DAI: 1.0,
      BUSD: 1.0
    };

    const price = fallbackPrices[symbol] || 1.0;
    
    this.logger.warn(`Using fallback price for ${symbol}`, {
      price,
      reason: "Price feed unavailable"
    });

    return price;
  }

  async getMultiplePrices(symbols) {
    const promises = symbols.map(symbol => 
      this.getPrice(symbol).catch(error => {
        this.logger.error(`Failed to get price for ${symbol}`, { error: error.message });
        return this.getFallbackPrice(symbol);
      })
    );

    const prices = await Promise.all(promises);
    const result = {};
    
    symbols.forEach((symbol, index) => {
      result[symbol] = prices[index];
    });

    return result;
  }

  async getTokenPriceInUSD(tokenAddress, amount) {
    try {
      // Find token symbol from network config
      const tokenSymbol = this.findTokenSymbol(tokenAddress);
      if (!tokenSymbol) {
        throw new Error(`Unknown token address: ${tokenAddress}`);
      }

      const price = await this.getPrice(tokenSymbol);
      const amountInEther = parseFloat(ethers.utils.formatEther(amount));
      
      return amountInEther * price;
    } catch (error) {
      this.logger.error("Failed to get token price in USD", {
        error: error.message,
        tokenAddress,
        amount: amount.toString()
      });
      return 0;
    }
  }

  findTokenSymbol(tokenAddress) {
    if (!this.networkConfig.tokens) return null;
    
    for (const [symbol, address] of Object.entries(this.networkConfig.tokens)) {
      if (address.toLowerCase() === tokenAddress.toLowerCase()) {
        return symbol.replace('W', ''); // Remove 'W' prefix (WETH -> ETH)
      }
    }
    return null;
  }

  async validatePriceFeeds() {
    const results = [];
    
    for (const [symbol, feed] of this.priceFeeds) {
      try {
        const price = await this.getPrice(symbol.replace('_USD', ''));
        results.push({
          symbol,
          address: feed.address,
          price,
          status: 'active'
        });
      } catch (error) {
        results.push({
          symbol,
          address: feed.address,
          error: error.message,
          status: 'failed'
        });
      }
    }

    return results;
  }

  clearCache() {
    this.priceCache.clear();
    this.logger.debug("Price cache cleared");
  }

  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const [key, data] of this.priceCache) {
      if (now - data.timestamp < this.cacheTimeout) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.priceCache.size,
      validEntries,
      expiredEntries,
      cacheTimeout: this.cacheTimeout
    };
  }
}

module.exports = PriceOracle;
