const { ethers } = require("ethers");

class ArbitrageExecutor {
  constructor(contract, wallet, provider, logger) {
    this.contract = contract;
    this.wallet = wallet;
    this.provider = provider;
    this.logger = logger;
    
    this.executionHistory = [];
    this.isExecuting = false;
    this.lastExecutionTime = 0;
    this.executionCooldown = 30000; // 30 seconds between executions
  }

  async executeArbitrage(opportunity, profitability, dexConfigs) {
    if (this.isExecuting) {
      this.logger.warn("Arbitrage execution already in progress");
      return { success: false, reason: "Execution in progress" };
    }

    // Check cooldown
    const now = Date.now();
    if (now - this.lastExecutionTime < this.executionCooldown) {
      this.logger.debug("Execution cooldown active");
      return { success: false, reason: "Cooldown active" };
    }

    this.isExecuting = true;
    this.lastExecutionTime = now;

    try {
      this.logger.info("🚀 Executing arbitrage opportunity", {
        tokenA: opportunity.tokenA,
        tokenB: opportunity.tokenB,
        buyDex: opportunity.buyDex,
        sellDex: opportunity.sellDex,
        expectedProfitUSD: profitability.netProfitUSD.toFixed(4),
        profitMargin: profitability.profitMargin.toFixed(2) + "%",
        riskScore: profitability.riskScore
      });

      // Step 1: Validate opportunity is still profitable
      const isStillValid = await this.validateOpportunity(opportunity, profitability);
      if (!isStillValid) {
        return { success: false, reason: "Opportunity no longer valid" };
      }

      // Step 2: Check wallet balance
      const hasBalance = await this.checkWalletBalance(profitability.costs.gasCostETH);
      if (!hasBalance) {
        return { success: false, reason: "Insufficient ETH for gas" };
      }

      // Step 3: Prepare arbitrage parameters
      const arbParams = await this.prepareArbitrageParams(opportunity, dexConfigs);
      if (!arbParams) {
        return { success: false, reason: "Failed to prepare arbitrage parameters" };
      }

      // Step 4: Execute flashloan
      const result = await this.executeFlashloan(opportunity, arbParams, profitability);
      
      // Step 5: Record execution
      this.recordExecution(opportunity, profitability, result);
      
      return result;

    } catch (error) {
      this.logger.error("❌ Arbitrage execution failed", {
        error: error.message,
        opportunity: opportunity
      });
      
      return { 
        success: false, 
        reason: error.message,
        error: error
      };
    } finally {
      this.isExecuting = false;
    }
  }

  async validateOpportunity(opportunity, profitability) {
    try {
      // Check if gas price hasn't increased significantly
      const currentGasPrice = await this.provider.getGasPrice();
      const currentGasPriceGwei = parseFloat(ethers.utils.formatUnits(currentGasPrice, "gwei"));
      
      if (currentGasPriceGwei > profitability.gasPrice * 1.2) {
        this.logger.warn("Gas price increased significantly", {
          original: profitability.gasPrice,
          current: currentGasPriceGwei
        });
        return false;
      }

      // Check if we still have enough profit margin
      if (profitability.profitMargin < 0.5) {
        this.logger.warn("Profit margin too low", {
          margin: profitability.profitMargin
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error("Error validating opportunity:", error.message);
      return false;
    }
  }

  async checkWalletBalance(requiredETH) {
    try {
      const balance = await this.wallet.getBalance();
      const balanceETH = parseFloat(ethers.utils.formatEther(balance));
      
      // Need at least 2x the gas cost for safety
      const requiredBalance = requiredETH * 2;
      
      if (balanceETH < requiredBalance) {
        this.logger.error("Insufficient ETH balance", {
          required: requiredBalance,
          available: balanceETH
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error("Error checking wallet balance:", error.message);
      return false;
    }
  }

  async prepareArbitrageParams(opportunity, dexConfigs) {
    try {
      // Find DEX configurations
      const buyDexConfig = dexConfigs.find(dex => dex.name === opportunity.buyDex);
      const sellDexConfig = dexConfigs.find(dex => dex.name === opportunity.sellDex);
      
      if (!buyDexConfig || !sellDexConfig) {
        this.logger.error("DEX configuration not found", {
          buyDex: opportunity.buyDex,
          sellDex: opportunity.sellDex
        });
        return null;
      }

      // Prepare swap data for each DEX
      const buySwapData = await this.prepareSwapData(buyDexConfig, opportunity.tokenA, opportunity.tokenB, opportunity.amountIn);
      const sellSwapData = await this.prepareSwapData(sellDexConfig, opportunity.tokenB, opportunity.tokenA, opportunity.buyAmountOut);

      return {
        tokenA: opportunity.tokenA,
        tokenB: opportunity.tokenB,
        amount: opportunity.amountIn,
        dexRouters: [buyDexConfig.router, sellDexConfig.router],
        swapData: [buySwapData, sellSwapData],
        minProfit: ethers.utils.parseEther("0.001") // Minimum 0.001 ETH profit
      };
    } catch (error) {
      this.logger.error("Error preparing arbitrage params:", error.message);
      return null;
    }
  }

  async prepareSwapData(dexConfig, tokenIn, tokenOut, amountIn) {
    try {
      if (dexConfig.type === "UNISWAP_V2" || dexConfig.type === "SUSHISWAP") {
        // For Uniswap V2 style DEXs, we encode the swap parameters
        const path = [tokenIn, tokenOut];
        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
        const minAmountOut = ethers.BigNumber.from(amountIn).mul(95).div(100); // 5% slippage
        
        // Encode function call data
        const iface = new ethers.utils.Interface([
          "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
        ]);
        
        return iface.encodeFunctionData("swapExactTokensForTokens", [
          amountIn,
          minAmountOut,
          path,
          this.contract.address, // Send tokens to contract
          deadline
        ]);
      } else if (dexConfig.type === "UNISWAP_V3") {
        // For Uniswap V3, encode exactInputSingle
        const deadline = Math.floor(Date.now() / 1000) + 300;
        const minAmountOut = ethers.BigNumber.from(amountIn).mul(95).div(100);
        
        const iface = new ethers.utils.Interface([
          "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)"
        ]);
        
        const params = {
          tokenIn,
          tokenOut,
          fee: 3000, // 0.3%
          recipient: this.contract.address,
          deadline,
          amountIn,
          amountOutMinimum: minAmountOut,
          sqrtPriceLimitX96: 0
        };
        
        return iface.encodeFunctionData("exactInputSingle", [params]);
      }
      
      return "0x"; // Fallback
    } catch (error) {
      this.logger.error("Error preparing swap data:", error.message);
      return "0x";
    }
  }

  async executeFlashloan(opportunity, arbParams, profitability) {
    try {
      // Estimate gas for the transaction
      const gasEstimate = await this.contract.estimateGas.requestFlashLoan(
        arbParams.tokenA,
        arbParams.amount,
        arbParams
      );

      // Add 20% buffer to gas estimate
      const gasLimit = gasEstimate.mul(120).div(100);
      
      // Get current gas price
      const gasPrice = await this.provider.getGasPrice();
      
      this.logger.info("Sending flashloan transaction", {
        gasLimit: gasLimit.toString(),
        gasPrice: ethers.utils.formatUnits(gasPrice, "gwei") + " gwei",
        estimatedCost: ethers.utils.formatEther(gasLimit.mul(gasPrice)) + " ETH"
      });

      // Execute the flashloan
      const tx = await this.contract.requestFlashLoan(
        arbParams.tokenA,
        arbParams.amount,
        arbParams,
        {
          gasLimit,
          gasPrice
        }
      );

      this.logger.info("Transaction sent", {
        hash: tx.hash,
        nonce: tx.nonce
      });

      // Wait for confirmation
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        const actualGasUsed = receipt.gasUsed;
        const actualGasCost = actualGasUsed.mul(gasPrice);
        const actualGasCostETH = parseFloat(ethers.utils.formatEther(actualGasCost));
        
        this.logger.info("✅ Arbitrage executed successfully!", {
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: actualGasUsed.toString(),
          gasCost: actualGasCostETH.toFixed(6) + " ETH",
          expectedProfitUSD: profitability.netProfitUSD.toFixed(4)
        });

        return {
          success: true,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: actualGasUsed.toString(),
          gasCost: actualGasCostETH,
          expectedProfitUSD: profitability.netProfitUSD,
          receipt
        };
      } else {
        this.logger.error("❌ Transaction failed", {
          txHash: tx.hash,
          status: receipt.status
        });
        
        return {
          success: false,
          reason: "Transaction failed",
          txHash: tx.hash,
          receipt
        };
      }
    } catch (error) {
      this.logger.error("❌ Flashloan execution failed", {
        error: error.message,
        code: error.code
      });
      
      return {
        success: false,
        reason: error.message,
        error
      };
    }
  }

  recordExecution(opportunity, profitability, result) {
    const execution = {
      timestamp: Date.now(),
      opportunity,
      profitability,
      result,
      success: result.success
    };
    
    this.executionHistory.push(execution);
    
    // Keep only last 100 executions
    if (this.executionHistory.length > 100) {
      this.executionHistory = this.executionHistory.slice(-100);
    }
  }

  getExecutionStats() {
    const total = this.executionHistory.length;
    const successful = this.executionHistory.filter(e => e.success).length;
    const failed = total - successful;
    
    const totalProfitUSD = this.executionHistory
      .filter(e => e.success)
      .reduce((sum, e) => sum + (e.profitability.netProfitUSD || 0), 0);
    
    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total * 100).toFixed(2) + "%" : "0%",
      totalProfitUSD: totalProfitUSD.toFixed(2),
      averageProfitUSD: successful > 0 ? (totalProfitUSD / successful).toFixed(2) : "0",
      isExecuting: this.isExecuting,
      lastExecutionTime: this.lastExecutionTime
    };
  }
}

module.exports = ArbitrageExecutor;
