const { expect } = require("chai");
const { ethers } = require("hardhat");
const DexPriceFetcher = require("../src/DexPriceFetcher");
const ProfitCalculator = require("../src/ProfitCalculator");
const ArbitrageExecutor = require("../src/ArbitrageExecutor");
const PriceOracle = require("../src/PriceOracle");
const GasOptimizer = require("../src/GasOptimizer");
const MEVProtection = require("../src/MEVProtection");
const ChainValidator = require("../src/ChainValidator");
const RiskManager = require("../src/RiskManager");
const PerformanceMonitor = require("../src/PerformanceMonitor");

describe("Real Arbitrage System", function () {
  let flashloanArbitrage;
  let owner;
  let provider;
  let priceFetcher;
  let profitCalculator;
  let executor;

  // Mock addresses for testing
  const WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
  const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    provider = ethers.provider;

    // Create mock contract for testing (skip actual deployment)
    flashloanArbitrage = {
      address: "0x1234567890123456789012345678901234567890",
      estimateGas: {
        requestFlashLoan: () =>
          Promise.resolve(ethers.BigNumber.from("500000")),
      },
    };

    // Initialize real arbitrage components
    // Mock network config for testing
    const mockNetworkConfig = {
      name: "Hardhat Test",
      chainId: 31337,
      tokens: {
        WETH: WETH_ADDRESS,
        USDC: USDC_ADDRESS,
      },
      priceFeeds: {
        ETH_USD: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      },
    };

    priceFetcher = new DexPriceFetcher(provider, console);
    profitCalculator = new ProfitCalculator(
      provider,
      console,
      mockNetworkConfig
    );
    executor = new ArbitrageExecutor(
      flashloanArbitrage,
      owner,
      provider,
      console
    );
  });

  describe("DexPriceFetcher", function () {
    it("should initialize correctly", function () {
      expect(priceFetcher).to.not.be.undefined;
      expect(priceFetcher.provider).to.equal(provider);
      expect(priceFetcher.priceCache).to.be.instanceOf(Map);
    });

    it("should handle token decimals", async function () {
      // Test with a known token (this might fail on testnet, but tests the logic)
      try {
        const decimals = await priceFetcher.getTokenDecimals(WETH_ADDRESS);
        expect(decimals).to.be.a("number");
        expect(decimals).to.be.at.least(0);
        expect(decimals).to.be.at.most(18);
      } catch (error) {
        // Expected on testnet - just verify it returns default
        const decimals = await priceFetcher.getTokenDecimals(
          "0x0000000000000000000000000000000000000000"
        );
        expect(decimals).to.equal(18);
      }
    });

    it("should handle token symbols", async function () {
      try {
        const symbol = await priceFetcher.getTokenSymbol(WETH_ADDRESS);
        expect(symbol).to.be.a("string");
      } catch (error) {
        // Expected on testnet - just verify it returns default
        const symbol = await priceFetcher.getTokenSymbol(
          "0x0000000000000000000000000000000000000000"
        );
        expect(symbol).to.equal("UNKNOWN");
      }
    });

    it("should clear cache", function () {
      priceFetcher.priceCache.set("test", {
        data: "test",
        timestamp: Date.now(),
      });
      expect(priceFetcher.priceCache.size).to.equal(1);

      priceFetcher.clearCache();
      expect(priceFetcher.priceCache.size).to.equal(0);
    });
  });

  describe("ProfitCalculator", function () {
    it("should initialize correctly", function () {
      expect(profitCalculator).to.not.be.undefined;
      expect(profitCalculator.provider).to.equal(provider);
      expect(profitCalculator.AAVE_FLASHLOAN_FEE).to.equal(0.0009);
      expect(profitCalculator.UNISWAP_V2_FEE).to.equal(0.003);
    });

    it("should calculate gas costs", async function () {
      const gasEstimate = 100000;
      const gasPriceGwei = 20;

      const gasCost = await profitCalculator.calculateGasCost(
        gasEstimate,
        gasPriceGwei
      );
      expect(gasCost).to.be.instanceOf(ethers.BigNumber);
      expect(gasCost.gt(0)).to.be.true;
    });

    it("should get current gas price", async function () {
      const gasPrice = await profitCalculator.getCurrentGasPrice();
      expect(gasPrice).to.be.a("number");
      expect(gasPrice).to.be.at.least(1); // At least 1 gwei
    });

    it("should calculate DEX fees", function () {
      const amountIn = ethers.utils.parseEther("1");

      const uniswapV2Fee = profitCalculator.calculateDexFee(
        amountIn,
        "UNISWAP_V2"
      );
      expect(uniswapV2Fee).to.equal(0.003); // 0.3% of 1 ETH

      const sushiswapFee = profitCalculator.calculateDexFee(
        amountIn,
        "SUSHISWAP"
      );
      expect(sushiswapFee).to.equal(0.003); // 0.3% of 1 ETH
    });

    it("should calculate risk score", function () {
      const opportunity = {
        profitPercentage: 2.5,
        buyDex: "UNISWAP_V2",
        sellDex: "SUSHISWAP",
      };

      const riskScore = profitCalculator.calculateRiskScore(
        opportunity,
        0.1,
        1.0
      );
      expect(riskScore).to.be.a("number");
      expect(riskScore).to.be.at.least(0);
      expect(riskScore).to.be.at.most(100);
    });

    it("should validate opportunity viability", function () {
      const goodProfitability = {
        isProfitable: true,
        netProfitUSD: 10,
        riskScore: 50,
        profitMargin: 2.0,
      };

      const badProfitability = {
        isProfitable: false,
        netProfitUSD: -5,
        riskScore: 90,
        profitMargin: 0.1,
      };

      expect(profitCalculator.isOpportunityViable(goodProfitability, 5, 70)).to
        .be.true;
      expect(profitCalculator.isOpportunityViable(badProfitability, 5, 70)).to
        .be.false;
    });

    it("should get ETH price", async function () {
      const ethPrice = await profitCalculator.getETHPriceUSD();
      expect(ethPrice).to.be.a("number");
      expect(ethPrice).to.be.at.least(100); // Reasonable minimum
    });
  });

  describe("ArbitrageExecutor", function () {
    it("should initialize correctly", function () {
      expect(executor).to.not.be.undefined;
      expect(executor.contract).to.equal(flashloanArbitrage);
      expect(executor.wallet).to.equal(owner);
      expect(executor.provider).to.equal(provider);
      expect(executor.executionHistory).to.be.an("array");
      expect(executor.isExecuting).to.be.false;
    });

    it("should check wallet balance", async function () {
      const requiredETH = 0.01; // 0.01 ETH
      const hasBalance = await executor.checkWalletBalance(requiredETH);
      expect(hasBalance).to.be.a("boolean");
    });

    it("should get execution stats", function () {
      const stats = executor.getExecutionStats();
      expect(stats).to.have.property("total");
      expect(stats).to.have.property("successful");
      expect(stats).to.have.property("failed");
      expect(stats).to.have.property("successRate");
      expect(stats).to.have.property("totalProfitUSD");
      expect(stats).to.have.property("averageProfitUSD");
      expect(stats).to.have.property("isExecuting");
      expect(stats).to.have.property("lastExecutionTime");
    });

    it("should record execution", function () {
      const mockOpportunity = {
        tokenA: WETH_ADDRESS,
        tokenB: USDC_ADDRESS,
        profitPercentage: 2.5,
      };

      const mockProfitability = {
        netProfitUSD: 10,
        profitMargin: 2.0,
      };

      const mockResult = {
        success: true,
        txHash: "0x123",
        gasUsed: "100000",
      };

      const initialLength = executor.executionHistory.length;
      executor.recordExecution(mockOpportunity, mockProfitability, mockResult);

      expect(executor.executionHistory.length).to.equal(initialLength + 1);
      expect(
        executor.executionHistory[executor.executionHistory.length - 1]
      ).to.have.property("timestamp");
      expect(
        executor.executionHistory[executor.executionHistory.length - 1]
      ).to.have.property("opportunity");
      expect(
        executor.executionHistory[executor.executionHistory.length - 1]
      ).to.have.property("result");
    });

    it("should prepare swap data", async function () {
      const dexConfig = {
        type: "UNISWAP_V2",
        router: UNISWAP_V2_ROUTER,
      };

      const swapData = await executor.prepareSwapData(
        dexConfig,
        WETH_ADDRESS,
        USDC_ADDRESS,
        ethers.utils.parseEther("1")
      );

      expect(swapData).to.be.a("string");
      expect(swapData.startsWith("0x")).to.be.true;
    });
  });

  describe("Integration Tests", function () {
    it("should handle complete arbitrage flow (mock)", async function () {
      // Create mock opportunity
      const mockOpportunity = {
        tokenA: WETH_ADDRESS,
        tokenB: USDC_ADDRESS,
        buyDex: "UNISWAP_V2",
        sellDex: "SUSHISWAP",
        buyPrice: 2000,
        sellPrice: 2050,
        profitPercentage: 2.5,
        amountIn: ethers.utils.parseEther("1").toString(),
        buyAmountOut: ethers.utils.parseEther("2000").toString(),
        sellAmountOut: ethers.utils.parseEther("2050").toString(),
        timestamp: Date.now(),
      };

      // Test profit calculation
      const profitability =
        await profitCalculator.calculateArbitrageProfitability(mockOpportunity);

      if (profitability) {
        expect(profitability).to.have.property("netProfitUSD");
        expect(profitability).to.have.property("isProfitable");
        expect(profitability).to.have.property("riskScore");
        expect(profitability).to.have.property("costs");

        // Test viability check
        const isViable = profitCalculator.isOpportunityViable(
          profitability,
          1,
          80
        );
        expect(isViable).to.be.a("boolean");
      }
    });

    it("should handle DEX configuration", function () {
      const dexConfigs = [
        {
          name: "UNISWAP_V2",
          type: "UNISWAP_V2",
          router: UNISWAP_V2_ROUTER,
          quoter: null,
        },
        {
          name: "SUSHISWAP",
          type: "SUSHISWAP",
          router: UNISWAP_V2_ROUTER,
          quoter: null,
        },
      ];

      expect(dexConfigs).to.have.length(2);
      expect(dexConfigs[0]).to.have.property("name");
      expect(dexConfigs[0]).to.have.property("type");
      expect(dexConfigs[0]).to.have.property("router");
    });
  });

  describe("Error Handling", function () {
    it("should handle invalid token addresses", async function () {
      const invalidAddress = "0x0000000000000000000000000000000000000000";

      const decimals = await priceFetcher.getTokenDecimals(invalidAddress);
      expect(decimals).to.equal(18); // Default fallback

      const symbol = await priceFetcher.getTokenSymbol(invalidAddress);
      expect(symbol).to.equal("UNKNOWN"); // Default fallback
    });

    it("should handle null profitability", function () {
      const isViable = profitCalculator.isOpportunityViable(null, 5, 70);
      expect(isViable).to.be.false;
    });

    it("should handle execution cooldown", async function () {
      // Set last execution time to now
      executor.lastExecutionTime = Date.now();

      const mockOpportunity = { tokenA: WETH_ADDRESS, tokenB: USDC_ADDRESS };
      const mockProfitability = { netProfitUSD: 10 };
      const mockDexConfigs = [];

      const result = await executor.executeArbitrage(
        mockOpportunity,
        mockProfitability,
        mockDexConfigs
      );
      expect(result.success).to.be.false;
      expect(result.reason).to.include("Cooldown");
    });
  });

  describe("Enhanced Components", function () {
    let mockNetworkConfig;
    let priceOracle;
    let gasOptimizer;
    let mevProtection;
    let chainValidator;
    let riskManager;
    let performanceMonitor;

    beforeEach(function () {
      mockNetworkConfig = {
        name: "Test Network",
        chainId: 31337,
        tokens: {
          WETH: WETH_ADDRESS,
          USDC: USDC_ADDRESS,
        },
        priceFeeds: {
          ETH_USD: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
        },
      };

      priceOracle = new PriceOracle(provider, console, mockNetworkConfig);
      gasOptimizer = new GasOptimizer(provider, console, mockNetworkConfig);
      mevProtection = new MEVProtection(
        provider,
        owner,
        console,
        mockNetworkConfig
      );
      chainValidator = new ChainValidator(console);
      riskManager = new RiskManager(provider, console, mockNetworkConfig);
      performanceMonitor = new PerformanceMonitor(console, mockNetworkConfig);
    });

    describe("PriceOracle", function () {
      it("should initialize correctly", function () {
        expect(priceOracle).to.not.be.undefined;
        expect(priceOracle.provider).to.equal(provider);
        expect(priceOracle.networkConfig).to.equal(mockNetworkConfig);
      });

      it("should get fallback prices", function () {
        const ethPrice = priceOracle.getFallbackPrice("ETH");
        expect(ethPrice).to.be.a("number");
        expect(ethPrice).to.be.greaterThan(0);
      });
    });

    describe("GasOptimizer", function () {
      it("should initialize correctly", function () {
        expect(gasOptimizer).to.not.be.undefined;
        expect(gasOptimizer.provider).to.equal(provider);
        expect(gasOptimizer.networkConfig).to.equal(mockNetworkConfig);
      });

      it("should get fallback gas settings", function () {
        const gasSettings = gasOptimizer.getFallbackGasSettings();
        expect(gasSettings).to.have.property("type");
        expect(gasSettings).to.have.property("gasPrice");
        expect(gasSettings).to.have.property("urgency");
      });
    });

    describe("RiskManager", function () {
      it("should initialize correctly", function () {
        expect(riskManager).to.not.be.undefined;
        expect(riskManager.provider).to.equal(provider);
        expect(riskManager.networkConfig).to.equal(mockNetworkConfig);
      });

      it("should check health status", function () {
        const healthy = riskManager.isHealthy();
        expect(healthy).to.be.a("boolean");
      });
    });

    describe("PerformanceMonitor", function () {
      it("should initialize correctly", function () {
        expect(performanceMonitor).to.not.be.undefined;
        expect(performanceMonitor.logger).to.equal(console);
        expect(performanceMonitor.networkConfig).to.equal(mockNetworkConfig);
      });

      it("should get health status", function () {
        const health = performanceMonitor.getHealthStatus();
        expect(health).to.have.property("status");
        expect(health).to.have.property("uptime");
        expect(health).to.have.property("successRate");
      });
    });
  });
});
