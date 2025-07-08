const { ethers } = require("ethers");

// Uniswap V2 Router ABI (minimal)
const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

// Uniswap V3 Router ABI (minimal)
const UNISWAP_V3_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)"
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

class DEXHelper {
  constructor(provider) {
    this.provider = provider;
  }

  /**
   * Get price quote from Uniswap V2 compatible DEX
   */
  async getUniswapV2Quote(routerAddress, tokenIn, tokenOut, amountIn) {
    try {
      const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, this.provider);
      const path = [tokenIn, tokenOut];
      const amounts = await router.getAmountsOut(amountIn, path);
      return amounts[amounts.length - 1];
    } catch (error) {
      console.error(`Error getting Uniswap V2 quote from ${routerAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Get token information
   */
  async getTokenInfo(tokenAddress) {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const [symbol, decimals] = await Promise.all([
        token.symbol(),
        token.decimals()
      ]);
      return { symbol, decimals };
    } catch (error) {
      console.error(`Error getting token info for ${tokenAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Get token balance
   */
  async getTokenBalance(tokenAddress, walletAddress) {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      return await token.balanceOf(walletAddress);
    } catch (error) {
      console.error(`Error getting token balance:`, error.message);
      return BigInt(0);
    }
  }

  /**
   * Check token allowance
   */
  async getTokenAllowance(tokenAddress, owner, spender) {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      return await token.allowance(owner, spender);
    } catch (error) {
      console.error(`Error getting token allowance:`, error.message);
      return BigInt(0);
    }
  }

  /**
   * Calculate price impact
   */
  calculatePriceImpact(amountIn, amountOut, expectedOut) {
    if (expectedOut === 0n) return 0;
    const impact = ((expectedOut - amountOut) * 10000n) / expectedOut;
    return Number(impact) / 100; // Return as percentage
  }

  /**
   * Format token amount for display
   */
  formatTokenAmount(amount, decimals) {
    return ethers.formatUnits(amount, decimals);
  }

  /**
   * Parse token amount from string
   */
  parseTokenAmount(amount, decimals) {
    return ethers.parseUnits(amount, decimals);
  }

  /**
   * Calculate optimal arbitrage amount
   */
  calculateOptimalAmount(price1, price2, liquidity1, liquidity2) {
    // Simplified calculation - in production, use more sophisticated algorithms
    const priceDiff = Math.abs(price2 - price1);
    const avgPrice = (price1 + price2) / 2;
    const priceImpact = priceDiff / avgPrice;
    
    // Use smaller liquidity pool as limiting factor
    const maxAmount = Math.min(liquidity1, liquidity2) * 0.1; // 10% of smaller pool
    
    // Adjust based on price impact
    return Math.floor(maxAmount * Math.min(priceImpact * 10, 1));
  }

  /**
   * Estimate gas for DEX swap
   */
  estimateSwapGas(dexType) {
    const gasEstimates = {
      'UniswapV2': 150000,
      'UniswapV3': 180000,
      'Balancer': 200000,
      'Curve': 250000,
      '1inch': 300000
    };
    return gasEstimates[dexType] || 200000;
  }

  /**
   * Check if token pair exists on DEX
   */
  async checkPairExists(routerAddress, tokenA, tokenB) {
    try {
      const quote = await this.getUniswapV2Quote(
        routerAddress, 
        tokenA, 
        tokenB, 
        ethers.parseEther("0.001")
      );
      return quote !== null && quote > 0n;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get current gas price with priority fee
   */
  async getOptimalGasPrice() {
    try {
      const feeData = await this.provider.getFeeData();
      return {
        gasPrice: feeData.gasPrice,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
      };
    } catch (error) {
      console.error("Error getting gas price:", error.message);
      return null;
    }
  }

  /**
   * Convert gas price to USD estimate
   */
  async estimateGasCostUSD(gasLimit, ethPriceUSD = 2000) {
    try {
      const feeData = await this.getOptimalGasPrice();
      if (!feeData) return 0;
      
      const gasCostWei = feeData.gasPrice * BigInt(gasLimit);
      const gasCostETH = parseFloat(ethers.formatEther(gasCostWei));
      return gasCostETH * ethPriceUSD;
    } catch (error) {
      console.error("Error estimating gas cost:", error.message);
      return 0;
    }
  }
}

module.exports = {
  DEXHelper,
  UNISWAP_V2_ROUTER_ABI,
  UNISWAP_V3_ROUTER_ABI,
  ERC20_ABI
};
