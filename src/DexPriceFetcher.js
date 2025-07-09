const { ethers } = require("ethers");

// DEX Router ABIs
const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function factory() external pure returns (address)",
];

const UNISWAP_V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const UNISWAP_V2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function balanceOf(address account) external view returns (uint256)",
];

class DexPriceFetcher {
  constructor(provider, logger) {
    this.provider = provider;
    this.logger = logger;
    this.priceCache = new Map();
    this.cacheTimeout = 5000; // 5 seconds cache
  }

  async fetchUniswapV2Price(routerAddress, tokenA, tokenB, amountIn) {
    try {
      const router = new ethers.Contract(
        routerAddress,
        UNISWAP_V2_ROUTER_ABI,
        this.provider
      );
      const factory = new ethers.Contract(
        await router.factory(),
        UNISWAP_V2_FACTORY_ABI,
        this.provider
      );

      // Check if pair exists
      const pairAddress = await factory.getPair(tokenA, tokenB);
      if (pairAddress === ethers.constants.AddressZero) {
        return null; // Pair doesn't exist
      }

      // Get pair reserves to check liquidity
      const pair = new ethers.Contract(
        pairAddress,
        UNISWAP_V2_PAIR_ABI,
        this.provider
      );
      const [reserve0, reserve1] = await pair.getReserves();

      // Check if there's sufficient liquidity (at least $1000 worth)
      const minLiquidity = ethers.utils.parseEther("0.5"); // 0.5 ETH worth
      if (reserve0.lt(minLiquidity) && reserve1.lt(minLiquidity)) {
        return null; // Insufficient liquidity
      }

      // Get price using getAmountsOut
      const path = [tokenA, tokenB];
      const amounts = await router.getAmountsOut(amountIn, path);

      if (amounts && amounts.length >= 2 && amounts[1].gt(0)) {
        const amountOut = amounts[1];
        const price =
          parseFloat(ethers.utils.formatEther(amountOut)) /
          parseFloat(ethers.utils.formatEther(amountIn));

        return {
          price,
          amountIn: amountIn.toString(),
          amountOut: amountOut.toString(),
          liquidity: reserve0.add(reserve1).toString(),
          pairAddress,
          dexType: "UNISWAP_V2",
        };
      }

      return null;
    } catch (error) {
      this.logger.debug(`UniswapV2 price fetch failed: ${error.message}`);
      return null;
    }
  }

  async fetchUniswapV3Price(
    quoterAddress,
    tokenA,
    tokenB,
    amountIn,
    fee = 3000
  ) {
    try {
      const quoter = new ethers.Contract(
        quoterAddress,
        UNISWAP_V3_QUOTER_ABI,
        this.provider
      );

      // Try different fee tiers (remove duplicates)
      const feeTiers = [...new Set([fee, 500, 3000, 10000])]; // 0.05%, 0.3%, 1%

      for (const currentFee of feeTiers) {
        try {
          const amountOut = await quoter.callStatic.quoteExactInputSingle(
            tokenA,
            tokenB,
            currentFee,
            amountIn,
            0 // sqrtPriceLimitX96 = 0 (no limit)
          );

          if (amountOut.gt(0)) {
            const price =
              parseFloat(ethers.utils.formatEther(amountOut)) /
              parseFloat(ethers.utils.formatEther(amountIn));

            return {
              price,
              amountIn: amountIn.toString(),
              amountOut: amountOut.toString(),
              fee: currentFee,
              dexType: "UNISWAP_V3",
            };
          }
        } catch (error) {
          // Log the error and try next fee tier
          this.logger.debug(
            `Fee tier ${currentFee} failed for ${tokenA}-${tokenB}`,
            {
              error: error.message,
            }
          );
          continue;
        }
      }

      return null;
    } catch (error) {
      this.logger.debug(`UniswapV3 price fetch failed: ${error.message}`);
      return null;
    }
  }

  async fetchSushiswapPrice(routerAddress, tokenA, tokenB, amountIn) {
    // Sushiswap uses same interface as Uniswap V2
    return await this.fetchUniswapV2Price(
      routerAddress,
      tokenA,
      tokenB,
      amountIn
    );
  }

  async fetchPancakeSwapPrice(routerAddress, tokenA, tokenB, amountIn) {
    // PancakeSwap uses same interface as Uniswap V2
    return await this.fetchUniswapV2Price(
      routerAddress,
      tokenA,
      tokenB,
      amountIn
    );
  }

  async fetchPrice(dexConfig, tokenA, tokenB, amountIn) {
    const cacheKey = `${
      dexConfig.router
    }-${tokenA}-${tokenB}-${amountIn.toString()}`;

    // Check cache
    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    let priceData = null;

    try {
      switch (dexConfig.type) {
        case "UNISWAP_V2":
          priceData = await this.fetchUniswapV2Price(
            dexConfig.router,
            tokenA,
            tokenB,
            amountIn
          );
          break;

        case "UNISWAP_V3":
          priceData = await this.fetchUniswapV3Price(
            dexConfig.quoter,
            tokenA,
            tokenB,
            amountIn
          );
          break;

        case "SUSHISWAP":
          priceData = await this.fetchSushiswapPrice(
            dexConfig.router,
            tokenA,
            tokenB,
            amountIn
          );
          break;

        case "PANCAKESWAP":
          priceData = await this.fetchPancakeSwapPrice(
            dexConfig.router,
            tokenA,
            tokenB,
            amountIn
          );
          break;

        default:
          this.logger.warn(`Unknown DEX type: ${dexConfig.type}`);
          return null;
      }

      // Cache the result
      if (priceData) {
        this.priceCache.set(cacheKey, {
          data: priceData,
          timestamp: Date.now(),
        });
      }

      return priceData;
    } catch (error) {
      this.logger.error(
        `Error fetching price from ${dexConfig.type}:`,
        error.message
      );
      return null;
    }
  }

  async getTokenDecimals(tokenAddress) {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      return await token.decimals();
    } catch (error) {
      this.logger.warn(`Failed to get decimals for token ${tokenAddress}`, {
        error: error.message,
      });
      return 18; // Default to 18 decimals
    }
  }

  async getTokenSymbol(tokenAddress) {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      return await token.symbol();
    } catch (error) {
      this.logger.warn(`Failed to get symbol for token ${tokenAddress}`, {
        error: error.message,
      });
      return "UNKNOWN";
    }
  }

  // Get multiple prices for comparison
  async fetchMultiplePrices(dexConfigs, tokenA, tokenB, amountIn) {
    const promises = dexConfigs.map(async (dexConfig) => {
      const price = await this.fetchPrice(dexConfig, tokenA, tokenB, amountIn);
      return {
        dex: dexConfig.name,
        type: dexConfig.type,
        router: dexConfig.router,
        price: price,
      };
    });

    const results = await Promise.allSettled(promises);
    return results
      .filter(
        (result) => result.status === "fulfilled" && result.value.price !== null
      )
      .map((result) => result.value);
  }

  // Find best arbitrage opportunity
  async findArbitrageOpportunity(dexConfigs, tokenA, tokenB, amountIn) {
    const prices = await this.fetchMultiplePrices(
      dexConfigs,
      tokenA,
      tokenB,
      amountIn
    );

    if (prices.length < 2) {
      return null; // Need at least 2 DEXs for arbitrage
    }

    // Sort by price
    prices.sort((a, b) => a.price.price - b.price.price);

    const cheapest = prices[0];
    const mostExpensive = prices[prices.length - 1];

    const priceDifference = mostExpensive.price.price - cheapest.price.price;
    const profitPercentage = (priceDifference / cheapest.price.price) * 100;

    // Only return if profit is significant (> 0.5%)
    if (profitPercentage > 0.5) {
      return {
        tokenA,
        tokenB,
        buyDex: cheapest.dex,
        sellDex: mostExpensive.dex,
        buyPrice: cheapest.price.price,
        sellPrice: mostExpensive.price.price,
        profitPercentage,
        amountIn: amountIn.toString(),
        buyAmountOut: cheapest.price.amountOut,
        sellAmountOut: mostExpensive.price.amountOut,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  clearCache() {
    this.priceCache.clear();
  }
}

module.exports = DexPriceFetcher;
