const { ethers } = require("ethers");

class GasOptimizer {
  constructor(provider, logger, networkConfig) {
    this.provider = provider;
    this.logger = logger;
    this.networkConfig = networkConfig;
    this.gasHistory = [];
    this.maxHistorySize = 100;
    
    // EIP-1559 support detection
    this.supportsEIP1559 = this.networkConfig.chainId === 1 || // Ethereum
                          this.networkConfig.chainId === 137 || // Polygon
                          this.networkConfig.chainId === 42161 || // Arbitrum
                          this.networkConfig.chainId === 10; // Optimism
  }

  async getOptimalGasSettings(urgency = 'standard') {
    try {
      if (this.supportsEIP1559) {
        return await this.getEIP1559GasSettings(urgency);
      } else {
        return await this.getLegacyGasSettings(urgency);
      }
    } catch (error) {
      this.logger.error("Failed to get optimal gas settings", {
        error: error.message
      });
      return this.getFallbackGasSettings();
    }
  }

  async getEIP1559GasSettings(urgency = 'standard') {
    try {
      const feeData = await this.provider.getFeeData();
      const block = await this.provider.getBlock('latest');
      
      if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
        throw new Error("EIP-1559 fee data not available");
      }

      // Base fee from the latest block
      const baseFee = block.baseFeePerGas || ethers.BigNumber.from(0);
      
      // Calculate priority fee based on urgency
      let priorityFeeMultiplier;
      let maxFeeMultiplier;
      
      switch (urgency) {
        case 'slow':
          priorityFeeMultiplier = 1.0;
          maxFeeMultiplier = 1.1;
          break;
        case 'standard':
          priorityFeeMultiplier = 1.2;
          maxFeeMultiplier = 1.3;
          break;
        case 'fast':
          priorityFeeMultiplier = 1.5;
          maxFeeMultiplier = 1.6;
          break;
        case 'urgent':
          priorityFeeMultiplier = 2.0;
          maxFeeMultiplier = 2.2;
          break;
        default:
          priorityFeeMultiplier = 1.2;
          maxFeeMultiplier = 1.3;
      }

      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
        .mul(Math.floor(priorityFeeMultiplier * 100))
        .div(100);

      const maxFeePerGas = baseFee
        .add(maxPriorityFeePerGas)
        .mul(Math.floor(maxFeeMultiplier * 100))
        .div(100);

      // Ensure maxFeePerGas is not less than maxPriorityFeePerGas
      const finalMaxFeePerGas = maxFeePerGas.lt(maxPriorityFeePerGas) 
        ? maxPriorityFeePerGas.mul(110).div(100) 
        : maxFeePerGas;

      const gasSettings = {
        type: 2, // EIP-1559
        maxFeePerGas: finalMaxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        gasLimit: null, // To be set per transaction
        urgency,
        baseFee,
        estimatedCostETH: null // To be calculated with gas limit
      };

      this.logger.debug("EIP-1559 gas settings calculated", {
        urgency,
        maxFeePerGas: ethers.utils.formatUnits(finalMaxFeePerGas, 'gwei'),
        maxPriorityFeePerGas: ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei'),
        baseFee: ethers.utils.formatUnits(baseFee, 'gwei')
      });

      return gasSettings;
    } catch (error) {
      this.logger.warn("EIP-1559 gas calculation failed, falling back to legacy", {
        error: error.message
      });
      return await this.getLegacyGasSettings(urgency);
    }
  }

  async getLegacyGasSettings(urgency = 'standard') {
    try {
      const gasPrice = await this.provider.getGasPrice();
      
      let multiplier;
      switch (urgency) {
        case 'slow':
          multiplier = 1.0;
          break;
        case 'standard':
          multiplier = 1.2;
          break;
        case 'fast':
          multiplier = 1.5;
          break;
        case 'urgent':
          multiplier = 2.0;
          break;
        default:
          multiplier = 1.2;
      }

      const adjustedGasPrice = gasPrice.mul(Math.floor(multiplier * 100)).div(100);

      const gasSettings = {
        type: 0, // Legacy
        gasPrice: adjustedGasPrice,
        gasLimit: null, // To be set per transaction
        urgency,
        estimatedCostETH: null
      };

      this.logger.debug("Legacy gas settings calculated", {
        urgency,
        gasPrice: ethers.utils.formatUnits(adjustedGasPrice, 'gwei')
      });

      return gasSettings;
    } catch (error) {
      this.logger.error("Legacy gas calculation failed", {
        error: error.message
      });
      return this.getFallbackGasSettings();
    }
  }

  getFallbackGasSettings() {
    const fallbackGasPrice = ethers.utils.parseUnits('20', 'gwei'); // 20 gwei fallback
    
    return {
      type: 0,
      gasPrice: fallbackGasPrice,
      gasLimit: null,
      urgency: 'fallback',
      estimatedCostETH: null
    };
  }

  async estimateGasLimit(transaction, safetyMultiplier = 1.2) {
    try {
      const gasEstimate = await this.provider.estimateGas(transaction);
      const safeGasLimit = gasEstimate.mul(Math.floor(safetyMultiplier * 100)).div(100);
      
      this.logger.debug("Gas limit estimated", {
        estimate: gasEstimate.toString(),
        safeLimit: safeGasLimit.toString(),
        multiplier: safetyMultiplier
      });

      return safeGasLimit;
    } catch (error) {
      this.logger.error("Gas estimation failed", {
        error: error.message
      });
      
      // Return a reasonable default based on transaction type
      return ethers.BigNumber.from(500000); // 500k gas default
    }
  }

  async getCompleteGasSettings(transaction, urgency = 'standard') {
    const gasSettings = await this.getOptimalGasSettings(urgency);
    const gasLimit = await this.estimateGasLimit(transaction);
    
    gasSettings.gasLimit = gasLimit;
    
    // Calculate estimated cost
    if (gasSettings.type === 2) {
      // EIP-1559
      gasSettings.estimatedCostETH = parseFloat(
        ethers.utils.formatEther(gasSettings.maxFeePerGas.mul(gasLimit))
      );
    } else {
      // Legacy
      gasSettings.estimatedCostETH = parseFloat(
        ethers.utils.formatEther(gasSettings.gasPrice.mul(gasLimit))
      );
    }

    // Record gas data for analysis
    this.recordGasData(gasSettings);

    return gasSettings;
  }

  recordGasData(gasSettings) {
    const gasData = {
      timestamp: Date.now(),
      type: gasSettings.type,
      urgency: gasSettings.urgency,
      gasLimit: gasSettings.gasLimit?.toString(),
      estimatedCostETH: gasSettings.estimatedCostETH,
      network: this.networkConfig.name
    };

    if (gasSettings.type === 2) {
      gasData.maxFeePerGas = gasSettings.maxFeePerGas.toString();
      gasData.maxPriorityFeePerGas = gasSettings.maxPriorityFeePerGas.toString();
      gasData.baseFee = gasSettings.baseFee?.toString();
    } else {
      gasData.gasPrice = gasSettings.gasPrice.toString();
    }

    this.gasHistory.push(gasData);
    
    // Keep only recent history
    if (this.gasHistory.length > this.maxHistorySize) {
      this.gasHistory = this.gasHistory.slice(-this.maxHistorySize);
    }
  }

  getGasAnalytics() {
    if (this.gasHistory.length === 0) {
      return { message: "No gas data available" };
    }

    const recent = this.gasHistory.slice(-20); // Last 20 transactions
    const costs = recent.map(g => g.estimatedCostETH).filter(c => c > 0);
    
    if (costs.length === 0) {
      return { message: "No cost data available" };
    }

    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);

    return {
      totalTransactions: this.gasHistory.length,
      recentTransactions: recent.length,
      averageCostETH: avgCost.toFixed(6),
      minCostETH: minCost.toFixed(6),
      maxCostETH: maxCost.toFixed(6),
      supportsEIP1559: this.supportsEIP1559,
      network: this.networkConfig.name
    };
  }

  async isGasPriceAcceptable(maxGasPriceGwei) {
    try {
      const gasSettings = await this.getOptimalGasSettings('standard');
      let currentGasPriceGwei;

      if (gasSettings.type === 2) {
        currentGasPriceGwei = parseFloat(
          ethers.utils.formatUnits(gasSettings.maxFeePerGas, 'gwei')
        );
      } else {
        currentGasPriceGwei = parseFloat(
          ethers.utils.formatUnits(gasSettings.gasPrice, 'gwei')
        );
      }

      const acceptable = currentGasPriceGwei <= maxGasPriceGwei;
      
      this.logger.debug("Gas price acceptability check", {
        currentGwei: currentGasPriceGwei.toFixed(2),
        maxGwei: maxGasPriceGwei,
        acceptable
      });

      return {
        acceptable,
        currentGasPriceGwei,
        maxGasPriceGwei
      };
    } catch (error) {
      this.logger.error("Gas price check failed", {
        error: error.message
      });
      return { acceptable: false, error: error.message };
    }
  }
}

module.exports = GasOptimizer;
