const { ethers } = require("ethers");

class ChainValidator {
  constructor(logger) {
    this.logger = logger;
    this.validationCache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
  }

  async validateChainSupport(networkKey, networkConfig) {
    const cacheKey = `chain_${networkKey}`;
    
    // Check cache first
    const cached = this.validationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.result;
    }

    try {
      const validation = await this.performChainValidation(networkKey, networkConfig);
      
      // Cache result
      this.validationCache.set(cacheKey, {
        result: validation,
        timestamp: Date.now()
      });

      return validation;
    } catch (error) {
      this.logger.error(`Chain validation failed for ${networkKey}`, {
        error: error.message
      });
      
      return {
        isSupported: false,
        errors: [error.message],
        warnings: [],
        features: {}
      };
    }
  }

  async performChainValidation(networkKey, networkConfig) {
    const validation = {
      networkKey,
      networkName: networkConfig.name,
      chainId: networkConfig.chainId,
      isSupported: true,
      errors: [],
      warnings: [],
      features: {
        aaveSupport: false,
        flashloanSupport: false,
        dexSupport: false,
        priceFeeds: false,
        eip1559: false
      },
      dexCount: 0,
      tokenCount: 0,
      rpcStatus: 'unknown'
    };

    // 1. Validate RPC connection
    await this.validateRPCConnection(networkConfig, validation);

    // 2. Validate Aave support
    await this.validateAaveSupport(networkConfig, validation);

    // 3. Validate DEX support
    await this.validateDEXSupport(networkConfig, validation);

    // 4. Validate token configuration
    await this.validateTokenConfiguration(networkConfig, validation);

    // 5. Validate price feeds
    await this.validatePriceFeeds(networkConfig, validation);

    // 6. Check EIP-1559 support
    await this.validateEIP1559Support(networkConfig, validation);

    // 7. Final assessment
    this.assessOverallSupport(validation);

    this.logger.info(`Chain validation completed for ${networkKey}`, {
      isSupported: validation.isSupported,
      features: validation.features,
      errors: validation.errors.length,
      warnings: validation.warnings.length
    });

    return validation;
  }

  async validateRPCConnection(networkConfig, validation) {
    try {
      const rpcUrl = this.buildRpcUrl(networkConfig.rpcUrl);
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      
      // Test basic connectivity
      const blockNumber = await provider.getBlockNumber();
      const network = await provider.getNetwork();
      
      if (network.chainId !== networkConfig.chainId) {
        validation.errors.push(`Chain ID mismatch: expected ${networkConfig.chainId}, got ${network.chainId}`);
        validation.rpcStatus = 'chain_mismatch';
        return;
      }

      // Test gas price fetching
      await provider.getGasPrice();
      
      validation.rpcStatus = 'connected';
      validation.currentBlock = blockNumber;
      
      this.logger.debug(`RPC connection validated for ${networkConfig.name}`, {
        blockNumber,
        chainId: network.chainId
      });
    } catch (error) {
      validation.errors.push(`RPC connection failed: ${error.message}`);
      validation.rpcStatus = 'failed';
      validation.isSupported = false;
    }
  }

  async validateAaveSupport(networkConfig, validation) {
    try {
      if (!networkConfig.aaveAddressProvider) {
        validation.warnings.push("No Aave address provider configured");
        return;
      }

      const rpcUrl = this.buildRpcUrl(networkConfig.rpcUrl);
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      
      // Check if Aave address provider exists
      const code = await provider.getCode(networkConfig.aaveAddressProvider);
      if (code === '0x') {
        validation.errors.push("Aave address provider contract not found");
        return;
      }

      // Try to get pool address
      const addressProviderABI = [
        "function getPool() external view returns (address)"
      ];
      
      const addressProvider = new ethers.Contract(
        networkConfig.aaveAddressProvider,
        addressProviderABI,
        provider
      );

      const poolAddress = await addressProvider.getPool();
      if (poolAddress === ethers.constants.AddressZero) {
        validation.errors.push("Aave pool address is zero");
        return;
      }

      validation.features.aaveSupport = true;
      validation.features.flashloanSupport = true;
      validation.aavePoolAddress = poolAddress;
      
      this.logger.debug(`Aave support validated for ${networkConfig.name}`, {
        addressProvider: networkConfig.aaveAddressProvider,
        poolAddress
      });
    } catch (error) {
      validation.warnings.push(`Aave validation failed: ${error.message}`);
    }
  }

  async validateDEXSupport(networkConfig, validation) {
    if (!networkConfig.dexRouters || Object.keys(networkConfig.dexRouters).length === 0) {
      validation.errors.push("No DEX routers configured");
      validation.isSupported = false;
      return;
    }

    const rpcUrl = this.buildRpcUrl(networkConfig.rpcUrl);
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    let validDexCount = 0;

    for (const [dexName, routerAddress] of Object.entries(networkConfig.dexRouters)) {
      try {
        // Check if router contract exists
        const code = await provider.getCode(routerAddress);
        if (code === '0x') {
          validation.warnings.push(`DEX router not found: ${dexName} at ${routerAddress}`);
          continue;
        }

        // Basic router validation (try to call a common method)
        const routerABI = ["function factory() external pure returns (address)"];
        const router = new ethers.Contract(routerAddress, routerABI, provider);
        
        try {
          await router.factory();
          validDexCount++;
        } catch (error) {
          validation.warnings.push(`DEX router validation failed: ${dexName} - ${error.message}`);
        }
      } catch (error) {
        validation.warnings.push(`DEX validation error for ${dexName}: ${error.message}`);
      }
    }

    validation.dexCount = validDexCount;
    validation.features.dexSupport = validDexCount > 0;

    if (validDexCount === 0) {
      validation.errors.push("No valid DEX routers found");
      validation.isSupported = false;
    } else if (validDexCount < 2) {
      validation.warnings.push("Less than 2 DEX routers available - arbitrage opportunities limited");
    }

    this.logger.debug(`DEX support validated for ${networkConfig.name}`, {
      totalConfigured: Object.keys(networkConfig.dexRouters).length,
      validDexCount
    });
  }

  async validateTokenConfiguration(networkConfig, validation) {
    if (!networkConfig.tokens || Object.keys(networkConfig.tokens).length === 0) {
      validation.errors.push("No tokens configured");
      validation.isSupported = false;
      return;
    }

    const tokenCount = Object.keys(networkConfig.tokens).length;
    validation.tokenCount = tokenCount;

    if (tokenCount < 2) {
      validation.errors.push("At least 2 tokens required for arbitrage");
      validation.isSupported = false;
    }

    // Check for essential tokens
    const essentialTokens = ['WETH', 'USDC', 'USDT'];
    const availableTokens = Object.keys(networkConfig.tokens);
    const missingEssential = essentialTokens.filter(token => !availableTokens.includes(token));

    if (missingEssential.length > 0) {
      validation.warnings.push(`Missing essential tokens: ${missingEssential.join(', ')}`);
    }

    this.logger.debug(`Token configuration validated for ${networkConfig.name}`, {
      tokenCount,
      tokens: availableTokens
    });
  }

  async validatePriceFeeds(networkConfig, validation) {
    if (!networkConfig.priceFeeds || Object.keys(networkConfig.priceFeeds).length === 0) {
      validation.warnings.push("No price feeds configured - using fallback prices");
      return;
    }

    const rpcUrl = this.buildRpcUrl(networkConfig.rpcUrl);
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    let validFeedCount = 0;

    for (const [symbol, feedAddress] of Object.entries(networkConfig.priceFeeds)) {
      try {
        const code = await provider.getCode(feedAddress);
        if (code !== '0x') {
          validFeedCount++;
        } else {
          validation.warnings.push(`Price feed not found: ${symbol} at ${feedAddress}`);
        }
      } catch (error) {
        validation.warnings.push(`Price feed validation error for ${symbol}: ${error.message}`);
      }
    }

    validation.features.priceFeeds = validFeedCount > 0;
    validation.priceFeedCount = validFeedCount;

    this.logger.debug(`Price feeds validated for ${networkConfig.name}`, {
      totalConfigured: Object.keys(networkConfig.priceFeeds).length,
      validFeedCount
    });
  }

  async validateEIP1559Support(networkConfig, validation) {
    try {
      const rpcUrl = this.buildRpcUrl(networkConfig.rpcUrl);
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      
      const feeData = await provider.getFeeData();
      validation.features.eip1559 = !!(feeData.maxFeePerGas && feeData.maxPriorityFeePerGas);
      
      this.logger.debug(`EIP-1559 support checked for ${networkConfig.name}`, {
        supported: validation.features.eip1559
      });
    } catch (error) {
      validation.warnings.push(`EIP-1559 check failed: ${error.message}`);
      validation.features.eip1559 = false;
    }
  }

  assessOverallSupport(validation) {
    // Critical requirements for arbitrage support
    const criticalRequirements = [
      validation.rpcStatus === 'connected',
      validation.features.dexSupport,
      validation.tokenCount >= 2
    ];

    // For flashloan arbitrage, Aave support is critical
    if (!validation.features.aaveSupport) {
      validation.errors.push("Aave support required for flashloan arbitrage");
      validation.isSupported = false;
    }

    // Check if all critical requirements are met
    const criticalMet = criticalRequirements.every(req => req);
    if (!criticalMet) {
      validation.isSupported = false;
    }

    // Calculate support score
    const featureScore = Object.values(validation.features).filter(Boolean).length;
    const totalFeatures = Object.keys(validation.features).length;
    validation.supportScore = (featureScore / totalFeatures) * 100;

    // Add recommendation
    if (validation.isSupported) {
      if (validation.supportScore >= 80) {
        validation.recommendation = "Fully supported - recommended for production";
      } else if (validation.supportScore >= 60) {
        validation.recommendation = "Supported with limitations - suitable for testing";
      } else {
        validation.recommendation = "Basic support - limited functionality";
      }
    } else {
      validation.recommendation = "Not supported - critical requirements missing";
    }
  }

  buildRpcUrl(baseUrl) {
    const alchemyApiKey = process.env.ALCHEMY_API_KEY;
    if (baseUrl.includes("alchemy.com") && alchemyApiKey) {
      return baseUrl + alchemyApiKey;
    }
    return baseUrl;
  }

  async validateMultipleChains(networks) {
    const validations = {};
    const promises = [];

    for (const [networkKey, networkConfig] of Object.entries(networks)) {
      promises.push(
        this.validateChainSupport(networkKey, networkConfig)
          .then(result => ({ networkKey, result }))
          .catch(error => ({ networkKey, error }))
      );
    }

    const results = await Promise.allSettled(promises);
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { networkKey, result: validation, error } = result.value;
        if (error) {
          validations[networkKey] = {
            isSupported: false,
            error: error.message
          };
        } else {
          validations[networkKey] = validation;
        }
      }
    }

    return validations;
  }

  getSupportedChains(validations) {
    return Object.entries(validations)
      .filter(([_, validation]) => validation.isSupported)
      .map(([networkKey, validation]) => ({
        networkKey,
        name: validation.networkName,
        chainId: validation.chainId,
        supportScore: validation.supportScore,
        features: validation.features
      }));
  }

  clearCache() {
    this.validationCache.clear();
    this.logger.debug("Chain validation cache cleared");
  }
}

module.exports = ChainValidator;
