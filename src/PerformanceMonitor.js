const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

class PerformanceMonitor {
  constructor(logger, networkConfig) {
    this.logger = logger;
    this.networkConfig = networkConfig;
    
    // Performance metrics
    this.metrics = {
      startTime: Date.now(),
      totalOpportunities: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalProfitETH: 0,
      totalGasCostETH: 0,
      averageExecutionTime: 0,
      priceUpdateCount: 0,
      errorCount: 0,
      lastUpdateTime: Date.now()
    };

    // Performance history
    this.performanceHistory = [];
    this.maxHistorySize = 1000;
    
    // Alert thresholds
    this.alertThresholds = {
      maxErrorRate: 0.1, // 10%
      minSuccessRate: 0.7, // 70%
      maxExecutionTime: 30000, // 30 seconds
      minProfitMargin: 0.5 // 0.5%
    };

    // Monitoring intervals
    this.monitoringInterval = null;
    this.reportingInterval = null;
    
    this.initializeMonitoring();
  }

  initializeMonitoring() {
    // Start performance monitoring
    this.monitoringInterval = setInterval(() => {
      this.collectPerformanceMetrics();
    }, 60000); // Every minute

    // Start periodic reporting
    this.reportingInterval = setInterval(() => {
      this.generatePerformanceReport();
    }, 300000); // Every 5 minutes

    this.logger.info("Performance monitoring initialized", {
      network: this.networkConfig.name,
      monitoringInterval: "1 minute",
      reportingInterval: "5 minutes"
    });
  }

  recordOpportunity(opportunity, profitability, executionTime) {
    this.metrics.totalOpportunities++;
    
    const record = {
      timestamp: Date.now(),
      opportunity,
      profitability,
      executionTime,
      network: this.networkConfig.name
    };

    this.performanceHistory.push(record);
    
    // Keep history size manageable
    if (this.performanceHistory.length > this.maxHistorySize) {
      this.performanceHistory = this.performanceHistory.slice(-this.maxHistorySize);
    }

    // Update average execution time
    this.updateAverageExecutionTime(executionTime);
    
    this.logger.debug("Opportunity recorded", {
      totalOpportunities: this.metrics.totalOpportunities,
      executionTime: executionTime + "ms"
    });
  }

  recordTradeExecution(result, profitability, gasUsed) {
    if (result.success) {
      this.metrics.successfulTrades++;
      this.metrics.totalProfitETH += profitability.netProfitETH;
      
      if (gasUsed) {
        this.metrics.totalGasCostETH += parseFloat(ethers.utils.formatEther(gasUsed));
      }
    } else {
      this.metrics.failedTrades++;
      this.recordError('trade_execution_failed', result.reason);
    }

    this.metrics.lastUpdateTime = Date.now();
    
    // Check for alerts
    this.checkAlertConditions();
  }

  recordPriceUpdate(dexName, tokenPair, price) {
    this.metrics.priceUpdateCount++;
    
    this.logger.debug("Price update recorded", {
      dex: dexName,
      pair: tokenPair,
      price: price.toFixed(6),
      totalUpdates: this.metrics.priceUpdateCount
    });
  }

  recordError(errorType, errorMessage) {
    this.metrics.errorCount++;
    
    const errorRecord = {
      timestamp: Date.now(),
      type: errorType,
      message: errorMessage,
      network: this.networkConfig.name
    };

    this.logger.error("Error recorded in performance monitor", errorRecord);
    
    // Check error rate
    this.checkErrorRate();
  }

  updateAverageExecutionTime(executionTime) {
    const totalTrades = this.metrics.successfulTrades + this.metrics.failedTrades;
    if (totalTrades === 1) {
      this.metrics.averageExecutionTime = executionTime;
    } else {
      this.metrics.averageExecutionTime = 
        (this.metrics.averageExecutionTime * (totalTrades - 1) + executionTime) / totalTrades;
    }
  }

  collectPerformanceMetrics() {
    const now = Date.now();
    const uptime = now - this.metrics.startTime;
    const totalTrades = this.metrics.successfulTrades + this.metrics.failedTrades;
    
    const currentMetrics = {
      timestamp: now,
      uptime,
      totalOpportunities: this.metrics.totalOpportunities,
      totalTrades,
      successRate: totalTrades > 0 ? this.metrics.successfulTrades / totalTrades : 0,
      errorRate: this.metrics.totalOpportunities > 0 ? this.metrics.errorCount / this.metrics.totalOpportunities : 0,
      totalProfitETH: this.metrics.totalProfitETH,
      totalGasCostETH: this.metrics.totalGasCostETH,
      netProfitETH: this.metrics.totalProfitETH - this.metrics.totalGasCostETH,
      averageExecutionTime: this.metrics.averageExecutionTime,
      priceUpdateCount: this.metrics.priceUpdateCount,
      opportunitiesPerHour: this.calculateOpportunitiesPerHour(uptime),
      profitPerHour: this.calculateProfitPerHour(uptime),
      network: this.networkConfig.name
    };

    this.logger.debug("Performance metrics collected", currentMetrics);
    return currentMetrics;
  }

  calculateOpportunitiesPerHour(uptime) {
    const hours = uptime / (1000 * 60 * 60);
    return hours > 0 ? this.metrics.totalOpportunities / hours : 0;
  }

  calculateProfitPerHour(uptime) {
    const hours = uptime / (1000 * 60 * 60);
    return hours > 0 ? this.metrics.totalProfitETH / hours : 0;
  }

  generatePerformanceReport() {
    const metrics = this.collectPerformanceMetrics();
    const report = {
      timestamp: new Date().toISOString(),
      network: this.networkConfig.name,
      uptime: this.formatUptime(metrics.uptime),
      summary: {
        totalOpportunities: metrics.totalOpportunities,
        totalTrades: metrics.totalTrades,
        successRate: (metrics.successRate * 100).toFixed(2) + "%",
        errorRate: (metrics.errorRate * 100).toFixed(2) + "%",
        netProfitETH: metrics.netProfitETH.toFixed(6),
        averageExecutionTime: metrics.averageExecutionTime.toFixed(0) + "ms"
      },
      performance: {
        opportunitiesPerHour: metrics.opportunitiesPerHour.toFixed(2),
        profitPerHour: metrics.profitPerHour.toFixed(6) + " ETH",
        priceUpdatesPerMinute: (metrics.priceUpdateCount / (metrics.uptime / 60000)).toFixed(2)
      },
      alerts: this.getActiveAlerts()
    };

    this.logger.info("📊 Performance Report", report);
    
    // Save report to file
    this.savePerformanceReport(report);
    
    return report;
  }

  formatUptime(uptime) {
    const hours = Math.floor(uptime / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptime % (1000 * 60)) / 1000);
    
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  checkAlertConditions() {
    const metrics = this.collectPerformanceMetrics();
    
    // Check success rate
    if (metrics.successRate < this.alertThresholds.minSuccessRate && metrics.totalTrades > 10) {
      this.triggerAlert('low_success_rate', {
        current: (metrics.successRate * 100).toFixed(2) + "%",
        threshold: (this.alertThresholds.minSuccessRate * 100) + "%"
      });
    }

    // Check execution time
    if (metrics.averageExecutionTime > this.alertThresholds.maxExecutionTime) {
      this.triggerAlert('high_execution_time', {
        current: metrics.averageExecutionTime.toFixed(0) + "ms",
        threshold: this.alertThresholds.maxExecutionTime + "ms"
      });
    }

    // Check profit margin
    const profitMargin = metrics.totalTrades > 0 ? 
      (metrics.netProfitETH / metrics.totalTrades) * 100 : 0;
    
    if (profitMargin < this.alertThresholds.minProfitMargin && metrics.totalTrades > 5) {
      this.triggerAlert('low_profit_margin', {
        current: profitMargin.toFixed(4) + "%",
        threshold: this.alertThresholds.minProfitMargin + "%"
      });
    }
  }

  checkErrorRate() {
    const errorRate = this.metrics.totalOpportunities > 0 ? 
      this.metrics.errorCount / this.metrics.totalOpportunities : 0;
    
    if (errorRate > this.alertThresholds.maxErrorRate && this.metrics.totalOpportunities > 10) {
      this.triggerAlert('high_error_rate', {
        current: (errorRate * 100).toFixed(2) + "%",
        threshold: (this.alertThresholds.maxErrorRate * 100) + "%"
      });
    }
  }

  triggerAlert(alertType, data) {
    const alert = {
      timestamp: new Date().toISOString(),
      type: alertType,
      severity: this.getAlertSeverity(alertType),
      data,
      network: this.networkConfig.name
    };

    this.logger.warn(`🚨 PERFORMANCE ALERT: ${alertType}`, alert);
    
    // In production, you would send this to monitoring systems
    // like Slack, Discord, email, or monitoring dashboards
    this.sendAlert(alert);
  }

  getAlertSeverity(alertType) {
    const severityMap = {
      'low_success_rate': 'high',
      'high_error_rate': 'high',
      'high_execution_time': 'medium',
      'low_profit_margin': 'medium'
    };
    
    return severityMap[alertType] || 'low';
  }

  sendAlert(alert) {
    // Placeholder for alert sending logic
    // In production, integrate with:
    // - Slack webhooks
    // - Discord webhooks
    // - Email notifications
    // - SMS alerts
    // - Monitoring dashboards (Grafana, DataDog, etc.)
    
    this.logger.info("Alert would be sent to monitoring systems", {
      type: alert.type,
      severity: alert.severity
    });
  }

  getActiveAlerts() {
    // Return current alert conditions
    const metrics = this.collectPerformanceMetrics();
    const alerts = [];

    if (metrics.successRate < this.alertThresholds.minSuccessRate && metrics.totalTrades > 10) {
      alerts.push({
        type: 'low_success_rate',
        value: (metrics.successRate * 100).toFixed(2) + "%"
      });
    }

    if (metrics.errorRate > this.alertThresholds.maxErrorRate && metrics.totalOpportunities > 10) {
      alerts.push({
        type: 'high_error_rate',
        value: (metrics.errorRate * 100).toFixed(2) + "%"
      });
    }

    return alerts;
  }

  savePerformanceReport(report) {
    try {
      const reportsDir = path.join(__dirname, "../reports");
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const filename = `performance_${this.networkConfig.name}_${Date.now()}.json`;
      const filepath = path.join(reportsDir, filename);
      
      fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
      
      this.logger.debug("Performance report saved", {
        filepath,
        size: JSON.stringify(report).length
      });
    } catch (error) {
      this.logger.error("Failed to save performance report", {
        error: error.message
      });
    }
  }

  getHealthStatus() {
    const metrics = this.collectPerformanceMetrics();
    const alerts = this.getActiveAlerts();
    
    let status = 'healthy';
    if (alerts.length > 0) {
      const hasHighSeverity = alerts.some(alert => 
        this.getAlertSeverity(alert.type) === 'high'
      );
      status = hasHighSeverity ? 'unhealthy' : 'warning';
    }

    return {
      status,
      uptime: this.formatUptime(metrics.uptime),
      successRate: (metrics.successRate * 100).toFixed(2) + "%",
      netProfitETH: metrics.netProfitETH.toFixed(6),
      alertCount: alerts.length,
      lastUpdate: new Date(this.metrics.lastUpdateTime).toISOString()
    };
  }

  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
    }

    // Generate final report
    const finalReport = this.generatePerformanceReport();
    
    this.logger.info("Performance monitoring stopped", {
      finalReport: finalReport.summary
    });
  }
}

module.exports = PerformanceMonitor;
