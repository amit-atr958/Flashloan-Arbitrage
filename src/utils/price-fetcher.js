const axios = require("axios");
const { ethers } = require("ethers");
const { DEXHelper } = require("./dex-helpers");

class PriceFetcher {
  constructor(provider, dexConfig) {
    this.provider = provider;
    this.dexConfig = dexConfig;
    this.dexHelper = new DEXHelper(provider);
    this.priceCache = new Map();
    this.lastUpdate = 0;
    this.updateInterval = 5000; // 5 seconds
  }

  /**
   * Fetch prices from all configured DEXs
   */
  async fetchAllPrices(tokenPairs) {
    const promises = [];
    const network = this.dexConfig.networks.mainnet;

    for (const pair of tokenPairs) {
      for (const [dexName, dexInfo] of Object.entries(network.dexRouters)) {
        if (!dexInfo.active) continue;

        promises.push(
          this.fetchPriceFromDEX(
            pair.tokenA,
            pair.tokenB,
            dexInfo.address,
            dexName,
            dexInfo.type
          )
        );
      }
    }

    const results = await Promise.allSettled(promises);
    const prices = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        prices.push(result.value);
        
        // Update cache
        const key = this.getPriceCacheKey(
          result.value.tokenA,
          result.value.tokenB,
          result.value.dex
        );
        this.priceCache.set(key, {
          ...result.value,
          timestamp: Date.now()
        });
      }
    });

    this.lastUpdate = Date.now();
    return prices;
  }

  /**
   * Fetch price from specific DEX
   */
  async fetchPriceFromDEX(tokenA, tokenB, routerAddress, dexName, dexType) {
    try {
      const amountIn = ethers.parseEther("1"); // 1 token as base amount
      let amountOut = null;

      switch (dexType) {
        case "UniswapV2":
          amountOut = await this.dexHelper.getUniswapV2Quote(
            routerAddress,
            tokenA,
            tokenB,
            amountIn
          );
          break;
        
        case "UniswapV3":
          // For V3, we'd need to specify fee tier and use quoter contract
          // Simplified for this example
          amountOut = await this.dexHelper.getUniswapV2Quote(
            routerAddress,
            tokenA,
            tokenB,
            amountIn
          );
          break;
        
        default:
          // For other DEXs, implement specific logic
          amountOut = await this.fetchGenericPrice(
            routerAddress,
            tokenA,
            tokenB,
            amountIn
          );
      }

      if (!amountOut || amountOut === 0n) {
        return null;
      }

      // Calculate price (tokenB per tokenA)
      const price = parseFloat(ethers.formatEther(amountOut));

      return {
        tokenA,
        tokenB,
        dex: dexName,
        router: routerAddress,
        price,
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
        timestamp: Date.now(),
        dexType
      };

    } catch (error) {
      console.debug(`Failed to fetch price from ${dexName}:`, error.message);
      return null;
    }
  }

  /**
   * Generic price fetching for unsupported DEXs
   */
  async fetchGenericPrice(routerAddress, tokenA, tokenB, amountIn) {
    // Implement specific logic for each DEX type
    // This is a placeholder that returns null
    return null;
  }

  /**
   * Get cached price
   */
  getCachedPrice(tokenA, tokenB, dex) {
    const key = this.getPriceCacheKey(tokenA, tokenB, dex);
    const cached = this.priceCache.get(key);
    
    if (!cached) return null;
    
    // Check if price is still fresh (within 30 seconds)
    if (Date.now() - cached.timestamp > 30000) {
      this.priceCache.delete(key);
      return null;
    }
    
    return cached;
  }

  /**
   * Get all cached prices for a token pair
   */
  getAllCachedPrices(tokenA, tokenB) {
    const prices = [];
    
    for (const [key, price] of this.priceCache.entries()) {
      if (price.tokenA === tokenA && price.tokenB === tokenB) {
        // Check freshness
        if (Date.now() - price.timestamp <= 30000) {
          prices.push(price);
        } else {
          this.priceCache.delete(key);
        }
      }
    }
    
    return prices;
  }

  /**
   * Generate cache key
   */
  getPriceCacheKey(tokenA, tokenB, dex) {
    return `${tokenA.toLowerCase()}-${tokenB.toLowerCase()}-${dex}`;
  }

  /**
   * Fetch external price data (for reference)
   */
  async fetchExternalPrices(tokens) {
    try {
      // Using CoinGecko API as example
      const tokenIds = this.mapTokensToCoingeckoIds(tokens);
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${tokenIds.join(',')}&vs_currencies=usd`,
        { timeout: 5000 }
      );
      
      return response.data;
    } catch (error) {
      console.debug("Failed to fetch external prices:", error.message);
      return {};
    }
  }

  /**
   * Map token addresses to CoinGecko IDs
   */
  mapTokensToCoingeckoIds(tokens) {
    const mapping = {
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": "ethereum", // WETH
      "0xA0b86a33E6417c4c4c4c4c4c4c4c4c4c4c4c4c4c": "usd-coin", // USDC
      "0xdAC17F958D2ee523a2206206994597C13D831ec7": "tether", // USDT
      "0x6B175474E89094C44Da98b954EedeAC495271d0F": "dai", // DAI
      "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": "wrapped-bitcoin" // WBTC
    };
    
    return tokens
      .map(token => mapping[token])
      .filter(id => id !== undefined);
  }

  /**
   * Calculate price difference percentage
   */
  calculatePriceDifference(price1, price2) {
    if (price1 === 0 || price2 === 0) return 0;
    return Math.abs((price2 - price1) / price1) * 100;
  }

  /**
   * Find best buy and sell prices
   */
  findBestPrices(prices) {
    if (prices.length < 2) return null;
    
    let bestBuy = prices[0]; // Lowest price (best to buy)
    let bestSell = prices[0]; // Highest price (best to sell)
    
    for (const price of prices) {
      if (price.price < bestBuy.price) {
        bestBuy = price;
      }
      if (price.price > bestSell.price) {
        bestSell = price;
      }
    }
    
    return { bestBuy, bestSell };
  }

  /**
   * Clean expired cache entries
   */
  cleanCache() {
    const now = Date.now();
    const expiredKeys = [];
    
    for (const [key, price] of this.priceCache.entries()) {
      if (now - price.timestamp > 60000) { // 1 minute expiry
        expiredKeys.push(key);
      }
    }
    
    expiredKeys.forEach(key => this.priceCache.delete(key));
    
    if (expiredKeys.length > 0) {
      console.debug(`Cleaned ${expiredKeys.length} expired price entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let fresh = 0;
    let stale = 0;
    
    for (const price of this.priceCache.values()) {
      if (now - price.timestamp <= 30000) {
        fresh++;
      } else {
        stale++;
      }
    }
    
    return {
      total: this.priceCache.size,
      fresh,
      stale,
      lastUpdate: this.lastUpdate
    };
  }
}

module.exports = { PriceFetcher };
