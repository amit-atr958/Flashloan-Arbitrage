const { ethers } = require("ethers");

class RiskManager {
  constructor(provider, logger, networkConfig) {
    this.provider = provider;
    this.logger = logger;
    this.networkConfig = networkConfig;
    
    // Risk configuration
    this.config = {
      maxPositionSizeETH: parseFloat(process.env.MAX_POSITION_SIZE_ETH) || 10,
      maxDailyLossETH: parseFloat(process.env.MAX_DAILY_LOSS_ETH) || 5,
      maxSlippagePercent: parseFloat(process.env.MAX_SLIPPAGE_PERCENT) || 3,
      minProfitMargin: parseFloat(process.env.MIN_PROFIT_MARGIN) || 0.5,
      maxGasPriceGwei: parseFloat(process.env.MAX_GAS_PRICE_GWEI) || 100,
      circuitBreakerThreshold: parseFloat(process.env.CIRCUIT_BREAKER_THRESHOLD) || 3, // 3 consecutive failures
      cooldownPeriod: parseInt(process.env.COOLDOWN_PERIOD) || 300000, // 5 minutes
      emergencyStop: process.env.EMERGENCY_STOP === 'true'
    };

    // Risk tracking
    this.dailyStats = {
      date: new Date().toDateString(),
      totalProfitETH: 0,
      totalLossETH: 0,
      netProfitETH: 0,
      executedTrades: 0,
      failedTrades: 0,
      consecutiveFailures: 0,
      lastResetTime: Date.now()
    };

    this.circuitBreakerActive = false;
    this.circuitBreakerActivatedAt = null;
    this.positionHistory = [];
    this.maxHistorySize = 1000;

    // Initialize daily stats reset
    this.initializeDailyReset();
  }

  initializeDailyReset() {
    // Reset daily stats at midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      this.resetDailyStats();
      // Set up daily reset interval
      setInterval(() => this.resetDailyStats(), 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  resetDailyStats() {
    this.dailyStats = {
      date: new Date().toDateString(),
      totalProfitETH: 0,
      totalLossETH: 0,
      netProfitETH: 0,
      executedTrades: 0,
      failedTrades: 0,
      consecutiveFailures: 0,
      lastResetTime: Date.now()
    };

    this.logger.info("Daily risk stats reset", {
      date: this.dailyStats.date
    });
  }

  async assessOpportunityRisk(opportunity, profitability) {
    try {
      const riskAssessment = {
        opportunity,
        profitability,
        riskScore: 0,
        riskFactors: [],
        recommendations: [],
        approved: false,
        positionSize: 0,
        maxSlippage: 0,
        timestamp: Date.now()
      };

      // 1. Check emergency stop
      if (this.config.emergencyStop) {
        riskAssessment.riskFactors.push({
          factor: 'emergency_stop',
          severity: 'critical',
          description: 'Emergency stop activated'
        });
        riskAssessment.approved = false;
        return riskAssessment;
      }

      // 2. Check circuit breaker
      if (this.circuitBreakerActive) {
        const timeSinceActivation = Date.now() - this.circuitBreakerActivatedAt;
        if (timeSinceActivation < this.config.cooldownPeriod) {
          riskAssessment.riskFactors.push({
            factor: 'circuit_breaker',
            severity: 'critical',
            description: `Circuit breaker active for ${Math.round(timeSinceActivation / 1000)}s more`
          });
          riskAssessment.approved = false;
          return riskAssessment;
        } else {
          this.deactivateCircuitBreaker();
        }
      }

      // 3. Assess profit margin risk
      await this.assessProfitMarginRisk(riskAssessment);

      // 4. Assess position size risk
      await this.assessPositionSizeRisk(riskAssessment);

      // 5. Assess slippage risk
      await this.assessSlippageRisk(riskAssessment);

      // 6. Assess gas price risk
      await this.assessGasPriceRisk(riskAssessment);

      // 7. Assess daily loss limits
      await this.assessDailyLossRisk(riskAssessment);

      // 8. Assess market conditions
      await this.assessMarketConditions(riskAssessment);

      // 9. Calculate final risk score
      this.calculateFinalRiskScore(riskAssessment);

      // 10. Make final approval decision
      this.makeFinalApprovalDecision(riskAssessment);

      this.logger.debug("Risk assessment completed", {
        riskScore: riskAssessment.riskScore,
        approved: riskAssessment.approved,
        factorCount: riskAssessment.riskFactors.length
      });

      return riskAssessment;
    } catch (error) {
      this.logger.error("Risk assessment failed", {
        error: error.message
      });
      
      return {
        approved: false,
        riskScore: 100,
        riskFactors: [{
          factor: 'assessment_error',
          severity: 'critical',
          description: error.message
        }],
        error: error.message
      };
    }
  }

  async assessProfitMarginRisk(riskAssessment) {
    const profitMargin = riskAssessment.profitability.profitMargin;
    
    if (profitMargin < this.config.minProfitMargin) {
      riskAssessment.riskFactors.push({
        factor: 'low_profit_margin',
        severity: 'high',
        description: `Profit margin ${profitMargin.toFixed(2)}% below minimum ${this.config.minProfitMargin}%`,
        value: profitMargin,
        threshold: this.config.minProfitMargin
      });
      riskAssessment.riskScore += 30;
    } else if (profitMargin < this.config.minProfitMargin * 2) {
      riskAssessment.riskFactors.push({
        factor: 'marginal_profit',
        severity: 'medium',
        description: `Profit margin ${profitMargin.toFixed(2)}% is marginal`,
        value: profitMargin
      });
      riskAssessment.riskScore += 15;
    }
  }

  async assessPositionSizeRisk(riskAssessment) {
    const amountETH = riskAssessment.profitability.amountInETH;
    
    if (amountETH > this.config.maxPositionSizeETH) {
      riskAssessment.riskFactors.push({
        factor: 'position_too_large',
        severity: 'high',
        description: `Position size ${amountETH.toFixed(4)} ETH exceeds maximum ${this.config.maxPositionSizeETH} ETH`,
        value: amountETH,
        threshold: this.config.maxPositionSizeETH
      });
      riskAssessment.riskScore += 25;
      
      // Suggest reduced position size
      riskAssessment.positionSize = this.config.maxPositionSizeETH;
      riskAssessment.recommendations.push({
        type: 'reduce_position',
        description: `Reduce position size to ${this.config.maxPositionSizeETH} ETH`
      });
    } else {
      riskAssessment.positionSize = amountETH;
    }
  }

  async assessSlippageRisk(riskAssessment) {
    const opportunity = riskAssessment.opportunity;
    const priceImpact = this.calculatePriceImpact(opportunity);
    
    if (priceImpact > this.config.maxSlippagePercent) {
      riskAssessment.riskFactors.push({
        factor: 'high_slippage',
        severity: 'high',
        description: `Expected slippage ${priceImpact.toFixed(2)}% exceeds maximum ${this.config.maxSlippagePercent}%`,
        value: priceImpact,
        threshold: this.config.maxSlippagePercent
      });
      riskAssessment.riskScore += 20;
    }
    
    // Set dynamic slippage based on market conditions
    riskAssessment.maxSlippage = Math.min(
      Math.max(priceImpact * 1.5, 0.5), // At least 0.5%, max 1.5x price impact
      this.config.maxSlippagePercent
    );
  }

  async assessGasPriceRisk(riskAssessment) {
    try {
      const gasPrice = await this.provider.getGasPrice();
      const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
      
      if (gasPriceGwei > this.config.maxGasPriceGwei) {
        riskAssessment.riskFactors.push({
          factor: 'high_gas_price',
          severity: 'medium',
          description: `Gas price ${gasPriceGwei.toFixed(2)} gwei exceeds maximum ${this.config.maxGasPriceGwei} gwei`,
          value: gasPriceGwei,
          threshold: this.config.maxGasPriceGwei
        });
        riskAssessment.riskScore += 15;
      }
    } catch (error) {
      this.logger.warn("Failed to assess gas price risk", {
        error: error.message
      });
    }
  }

  async assessDailyLossRisk(riskAssessment) {
    const potentialLoss = Math.abs(Math.min(riskAssessment.profitability.netProfitETH, 0));
    const projectedDailyLoss = this.dailyStats.totalLossETH + potentialLoss;
    
    if (projectedDailyLoss > this.config.maxDailyLossETH) {
      riskAssessment.riskFactors.push({
        factor: 'daily_loss_limit',
        severity: 'critical',
        description: `Projected daily loss ${projectedDailyLoss.toFixed(4)} ETH exceeds limit ${this.config.maxDailyLossETH} ETH`,
        value: projectedDailyLoss,
        threshold: this.config.maxDailyLossETH
      });
      riskAssessment.riskScore += 40;
    }
  }

  async assessMarketConditions(riskAssessment) {
    // Check for unusual market conditions
    const recentFailures = this.dailyStats.consecutiveFailures;
    
    if (recentFailures >= this.config.circuitBreakerThreshold - 1) {
      riskAssessment.riskFactors.push({
        factor: 'high_failure_rate',
        severity: 'high',
        description: `${recentFailures} consecutive failures, approaching circuit breaker threshold`,
        value: recentFailures,
        threshold: this.config.circuitBreakerThreshold
      });
      riskAssessment.riskScore += 25;
    }
  }

  calculatePriceImpact(opportunity) {
    // Simplified price impact calculation
    // In production, this would analyze liquidity depth
    const profitPercentage = opportunity.profitPercentage;
    return Math.max(0.1, profitPercentage * 0.1); // Minimum 0.1% impact
  }

  calculateFinalRiskScore(riskAssessment) {
    // Risk score is already accumulated, apply any final adjustments
    const criticalFactors = riskAssessment.riskFactors.filter(f => f.severity === 'critical').length;
    const highFactors = riskAssessment.riskFactors.filter(f => f.severity === 'high').length;
    
    // Penalty for multiple high-severity factors
    if (criticalFactors > 0) {
      riskAssessment.riskScore += criticalFactors * 20;
    }
    if (highFactors > 1) {
      riskAssessment.riskScore += (highFactors - 1) * 10;
    }
    
    // Cap risk score at 100
    riskAssessment.riskScore = Math.min(riskAssessment.riskScore, 100);
  }

  makeFinalApprovalDecision(riskAssessment) {
    const criticalFactors = riskAssessment.riskFactors.filter(f => f.severity === 'critical');
    
    // Reject if any critical factors
    if (criticalFactors.length > 0) {
      riskAssessment.approved = false;
      return;
    }
    
    // Reject if risk score too high
    if (riskAssessment.riskScore > 70) {
      riskAssessment.approved = false;
      riskAssessment.riskFactors.push({
        factor: 'high_risk_score',
        severity: 'high',
        description: `Risk score ${riskAssessment.riskScore} exceeds threshold 70`
      });
      return;
    }
    
    // Approve if all checks pass
    riskAssessment.approved = true;
  }

  recordTradeResult(opportunity, profitability, result) {
    const tradeRecord = {
      timestamp: Date.now(),
      opportunity,
      profitability,
      result,
      success: result.success
    };

    // Update daily stats
    if (result.success) {
      this.dailyStats.executedTrades++;
      this.dailyStats.consecutiveFailures = 0;
      
      if (profitability.netProfitETH > 0) {
        this.dailyStats.totalProfitETH += profitability.netProfitETH;
      } else {
        this.dailyStats.totalLossETH += Math.abs(profitability.netProfitETH);
      }
    } else {
      this.dailyStats.failedTrades++;
      this.dailyStats.consecutiveFailures++;
      
      // Check circuit breaker
      if (this.dailyStats.consecutiveFailures >= this.config.circuitBreakerThreshold) {
        this.activateCircuitBreaker();
      }
    }

    this.dailyStats.netProfitETH = this.dailyStats.totalProfitETH - this.dailyStats.totalLossETH;

    // Store in history
    this.positionHistory.push(tradeRecord);
    if (this.positionHistory.length > this.maxHistorySize) {
      this.positionHistory = this.positionHistory.slice(-this.maxHistorySize);
    }

    this.logger.info("Trade result recorded", {
      success: result.success,
      netProfitETH: profitability.netProfitETH.toFixed(6),
      dailyNetProfit: this.dailyStats.netProfitETH.toFixed(6),
      consecutiveFailures: this.dailyStats.consecutiveFailures
    });
  }

  activateCircuitBreaker() {
    this.circuitBreakerActive = true;
    this.circuitBreakerActivatedAt = Date.now();
    
    this.logger.error("🚨 CIRCUIT BREAKER ACTIVATED", {
      consecutiveFailures: this.dailyStats.consecutiveFailures,
      threshold: this.config.circuitBreakerThreshold,
      cooldownPeriod: this.config.cooldownPeriod / 1000 + "s"
    });
  }

  deactivateCircuitBreaker() {
    this.circuitBreakerActive = false;
    this.circuitBreakerActivatedAt = null;
    this.dailyStats.consecutiveFailures = 0;
    
    this.logger.info("✅ Circuit breaker deactivated", {
      cooldownCompleted: true
    });
  }

  getRiskStats() {
    return {
      config: this.config,
      dailyStats: this.dailyStats,
      circuitBreaker: {
        active: this.circuitBreakerActive,
        activatedAt: this.circuitBreakerActivatedAt,
        cooldownRemaining: this.circuitBreakerActive 
          ? Math.max(0, this.config.cooldownPeriod - (Date.now() - this.circuitBreakerActivatedAt))
          : 0
      },
      positionHistory: this.positionHistory.length,
      network: this.networkConfig.name
    };
  }

  isHealthy() {
    return !this.config.emergencyStop && 
           !this.circuitBreakerActive && 
           this.dailyStats.netProfitETH > -this.config.maxDailyLossETH;
  }
}

module.exports = RiskManager;
