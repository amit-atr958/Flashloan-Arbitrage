const { ethers } = require("ethers");
const PriceOracle = require("./PriceOracle");

class ProfitCalculator {
  constructor(provider, logger, networkConfig) {
    this.provider = provider;
    this.logger = logger;
    this.networkConfig = networkConfig;
    this.priceOracle = new PriceOracle(provider, logger, networkConfig);

    // Fee constants
    this.AAVE_FLASHLOAN_FEE = 0.0009; // 0.09%
    this.UNISWAP_V2_FEE = 0.003; // 0.3%
    this.UNISWAP_V3_FEE = 0.003; // 0.3% (varies by pool)
    this.SUSHISWAP_FEE = 0.003; // 0.3%

    // Gas estimates
    this.GAS_ESTIMATES = {
      FLASHLOAN_BASE: 150000,
      UNISWAP_V2_SWAP: 120000,
      UNISWAP_V3_SWAP: 150000,
      SUSHISWAP_SWAP: 120000,
      TOKEN_TRANSFER: 21000,
      BUFFER: 50000, // Safety buffer
    };
  }

  async calculateGasCost(gasEstimate, gasPriceGwei) {
    const gasPrice = ethers.utils.parseUnits(gasPriceGwei.toString(), "gwei");
    const gasCost = gasPrice.mul(gasEstimate);
    return gasCost;
  }

  async getCurrentGasPrice() {
    try {
      const gasPrice = await this.provider.getGasPrice();
      return parseFloat(ethers.utils.formatUnits(gasPrice, "gwei"));
    } catch (error) {
      this.logger.error("Failed to get gas price:", error.message);
      return 20; // Default 20 gwei
    }
  }

  calculateDexFee(amountIn, dexType) {
    let feeRate;
    switch (dexType) {
      case "UNISWAP_V2":
        feeRate = this.UNISWAP_V2_FEE;
        break;
      case "UNISWAP_V3":
        feeRate = this.UNISWAP_V3_FEE;
        break;
      case "SUSHISWAP":
        feeRate = this.SUSHISWAP_FEE;
        break;
      default:
        feeRate = 0.003; // Default 0.3%
    }

    return parseFloat(ethers.utils.formatEther(amountIn)) * feeRate;
  }

  async calculateArbitrageProfitability(opportunity) {
    try {
      const amountIn = ethers.BigNumber.from(opportunity.amountIn);
      const buyAmountOut = ethers.BigNumber.from(opportunity.buyAmountOut);
      const sellAmountOut = ethers.BigNumber.from(opportunity.sellAmountOut);

      // Get real-time ETH price from oracle
      const ethPriceUSD = await this.priceOracle.getPrice("ETH");

      // Calculate amounts in ETH terms
      const amountInETH = parseFloat(ethers.utils.formatEther(amountIn));
      const sellAmountOutETH = parseFloat(
        ethers.utils.formatEther(sellAmountOut)
      );

      // Calculate gross profit (before fees and gas)
      const grossProfitETH = sellAmountOutETH - amountInETH;
      const grossProfitUSD = grossProfitETH * ethPriceUSD;

      // Calculate DEX fees
      const buyDexFee = this.calculateDexFee(amountIn, opportunity.buyDex);
      const sellDexFee = this.calculateDexFee(
        buyAmountOut,
        opportunity.sellDex
      );
      const totalDexFeesETH = buyDexFee + sellDexFee;
      const totalDexFeesUSD = totalDexFeesETH * ethPriceUSD;

      // Calculate Aave flashloan fee
      const flashloanFeeETH = amountInETH * this.AAVE_FLASHLOAN_FEE;
      const flashloanFeeUSD = flashloanFeeETH * ethPriceUSD;

      // Calculate gas costs
      const currentGasPrice = await this.getCurrentGasPrice();
      const totalGasEstimate =
        this.GAS_ESTIMATES.FLASHLOAN_BASE +
        this.GAS_ESTIMATES.UNISWAP_V2_SWAP * 2 + // Buy and sell
        this.GAS_ESTIMATES.TOKEN_TRANSFER * 2 +
        this.GAS_ESTIMATES.BUFFER;

      const gasCostWei = await this.calculateGasCost(
        totalGasEstimate,
        currentGasPrice
      );
      const gasCostETH = parseFloat(ethers.utils.formatEther(gasCostWei));
      const gasCostUSD = gasCostETH * ethPriceUSD;

      // Calculate net profit
      const totalCostsETH = totalDexFeesETH + flashloanFeeETH + gasCostETH;
      const totalCostsUSD = totalDexFeesUSD + flashloanFeeUSD + gasCostUSD;

      const netProfitETH = grossProfitETH - totalCostsETH;
      const netProfitUSD = grossProfitUSD - totalCostsUSD;

      // Calculate profit margin
      const profitMargin = (netProfitETH / amountInETH) * 100;

      // Calculate minimum profitable amount
      const breakEvenAmountETH =
        totalCostsETH / (opportunity.profitPercentage / 100);

      return {
        // Input amounts
        amountInETH,
        amountInUSD: amountInETH * ethPriceUSD,

        // Gross profit
        grossProfitETH,
        grossProfitUSD,
        grossProfitPercentage: opportunity.profitPercentage,

        // Costs breakdown
        costs: {
          dexFeesETH: totalDexFeesETH,
          dexFeesUSD: totalDexFeesUSD,
          flashloanFeeETH,
          flashloanFeeUSD,
          gasCostETH,
          gasCostUSD,
          totalCostsETH,
          totalCostsUSD,
        },

        // Net profit
        netProfitETH,
        netProfitUSD,
        profitMargin,

        // Gas info
        gasPrice: currentGasPrice,
        gasEstimate: totalGasEstimate,

        // Profitability analysis
        isProfitable: netProfitETH > 0,
        breakEvenAmountETH,
        breakEvenAmountUSD: breakEvenAmountETH * ethPriceUSD,

        // Risk metrics
        riskScore: this.calculateRiskScore(
          opportunity,
          netProfitETH,
          totalCostsETH
        ),

        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error("Error calculating profitability:", error.message);
      return null;
    }
  }

  calculateRiskScore(opportunity, netProfitETH, totalCostsETH) {
    let riskScore = 0;

    // Risk factor 1: Profit margin (lower margin = higher risk)
    const profitMargin = opportunity.profitPercentage;
    if (profitMargin < 1) riskScore += 30;
    else if (profitMargin < 2) riskScore += 20;
    else if (profitMargin < 5) riskScore += 10;

    // Risk factor 2: Profit to cost ratio
    const profitToCostRatio = Math.abs(netProfitETH / totalCostsETH);
    if (profitToCostRatio < 0.1) riskScore += 25;
    else if (profitToCostRatio < 0.2) riskScore += 15;
    else if (profitToCostRatio < 0.5) riskScore += 10;

    // Risk factor 3: Gas price volatility
    // (This would need historical gas price data in production)
    riskScore += 5; // Base gas risk

    // Risk factor 4: DEX liquidity (would need real liquidity data)
    riskScore += 10; // Base liquidity risk

    return Math.min(riskScore, 100); // Cap at 100
  }

  async getOptimalTradeSize(
    opportunity,
    maxAmountETH = 10,
    ethPriceUSD = 2000
  ) {
    const testAmounts = [];
    const step = maxAmountETH / 20; // Test 20 different amounts

    for (let i = 1; i <= 20; i++) {
      testAmounts.push(ethers.utils.parseEther((step * i).toString()));
    }

    let bestAmount = null;
    let bestProfitUSD = 0;

    for (const amount of testAmounts) {
      // Create test opportunity with this amount
      const testOpportunity = {
        ...opportunity,
        amountIn: amount.toString(),
        buyAmountOut: amount
          .mul(Math.floor(opportunity.buyPrice * 1000))
          .div(1000)
          .toString(),
        sellAmountOut: amount
          .mul(Math.floor(opportunity.sellPrice * 1000))
          .div(1000)
          .toString(),
      };

      const profitability = await this.calculateArbitrageProfitability(
        testOpportunity,
        ethPriceUSD
      );

      if (
        profitability &&
        profitability.isProfitable &&
        profitability.netProfitUSD > bestProfitUSD
      ) {
        bestProfitUSD = profitability.netProfitUSD;
        bestAmount = amount;
      }
    }

    return bestAmount;
  }

  // Validate if opportunity is worth executing
  isOpportunityViable(profitability, minProfitUSD = 5, maxRiskScore = 70) {
    if (!profitability) return false;

    return (
      profitability.isProfitable &&
      profitability.netProfitUSD >= minProfitUSD &&
      profitability.riskScore <= maxRiskScore &&
      profitability.profitMargin > 0.5 // At least 0.5% margin
    );
  }

  // Get current ETH price using price oracle
  async getETHPriceUSD() {
    try {
      return await this.priceOracle.getPrice("ETH");
    } catch (error) {
      this.logger.error("Failed to get ETH price:", error.message);
      return this.priceOracle.getFallbackPrice("ETH");
    }
  }

  // Get token price in USD
  async getTokenPriceUSD(tokenAddress, amount) {
    return await this.priceOracle.getTokenPriceInUSD(tokenAddress, amount);
  }
}

module.exports = ProfitCalculator;
