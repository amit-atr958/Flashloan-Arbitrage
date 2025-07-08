const { ethers } = require("ethers");
const winston = require("winston");
const networks = require("../config/networks.json");

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "logs/multichain.log" }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class MultiChainManager {
  constructor(privateKey, alchemyApiKey) {
    this.privateKey = privateKey;
    this.alchemyApiKey = alchemyApiKey;
    this.chains = new Map();
    this.activeChains = [];
    this.contracts = new Map();
    this.isRunning = false;
    
    this.initializeChains();
  }

  initializeChains() {
    logger.info("Initializing multi-chain support...");
    
    for (const [networkKey, networkConfig] of Object.entries(networks)) {
      try {
        const rpcUrl = this.buildRpcUrl(networkConfig.rpcUrl);
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(this.privateKey, provider);
        
        this.chains.set(networkKey, {
          config: networkConfig,
          provider,
          wallet,
          isActive: false,
          lastBlockNumber: 0,
          arbitrageOpportunities: 0,
          totalProfit: 0
        });
        
        logger.info(`Initialized chain: ${networkConfig.name}`, {
          chainId: networkConfig.chainId,
          network: networkKey
        });
      } catch (error) {
        logger.error(`Failed to initialize chain ${networkKey}`, {
          error: error.message
        });
      }
    }
  }

  buildRpcUrl(baseUrl) {
    if (baseUrl.includes("alchemy.com")) {
      return baseUrl + this.alchemyApiKey;
    }
    return baseUrl;
  }

  async activateChain(networkKey) {
    const chain = this.chains.get(networkKey);
    if (!chain) {
      throw new Error(`Chain ${networkKey} not found`);
    }

    try {
      // Test connection
      const blockNumber = await chain.provider.getBlockNumber();
      const balance = await chain.wallet.getBalance();
      
      chain.isActive = true;
      chain.lastBlockNumber = blockNumber;
      this.activeChains.push(networkKey);
      
      logger.info(`Activated chain: ${chain.config.name}`, {
        chainId: chain.config.chainId,
        blockNumber,
        balance: ethers.utils.formatEther(balance)
      });
      
      return true;
    } catch (error) {
      logger.error(`Failed to activate chain ${networkKey}`, {
        error: error.message
      });
      return false;
    }
  }

  async deactivateChain(networkKey) {
    const chain = this.chains.get(networkKey);
    if (!chain) return false;

    chain.isActive = false;
    this.activeChains = this.activeChains.filter(key => key !== networkKey);
    
    logger.info(`Deactivated chain: ${chain.config.name}`);
    return true;
  }

  async deployContract(networkKey, contractFactory, constructorArgs = []) {
    const chain = this.chains.get(networkKey);
    if (!chain || !chain.isActive) {
      throw new Error(`Chain ${networkKey} not active`);
    }

    try {
      logger.info(`Deploying contract to ${chain.config.name}...`);
      
      const contract = await contractFactory.connect(chain.wallet).deploy(...constructorArgs);
      await contract.deployed();
      
      this.contracts.set(`${networkKey}-arbitrage`, {
        address: contract.address,
        contract,
        networkKey,
        deployedAt: Date.now()
      });
      
      logger.info(`Contract deployed successfully`, {
        network: chain.config.name,
        address: contract.address,
        chainId: chain.config.chainId
      });
      
      return contract;
    } catch (error) {
      logger.error(`Contract deployment failed on ${networkKey}`, {
        error: error.message
      });
      throw error;
    }
  }

  async getChainStatus(networkKey) {
    const chain = this.chains.get(networkKey);
    if (!chain) return null;

    try {
      const blockNumber = await chain.provider.getBlockNumber();
      const balance = await chain.wallet.getBalance();
      const gasPrice = await chain.provider.getGasPrice();
      
      return {
        network: chain.config.name,
        chainId: chain.config.chainId,
        isActive: chain.isActive,
        blockNumber,
        balance: ethers.utils.formatEther(balance),
        gasPrice: ethers.utils.formatUnits(gasPrice, "gwei"),
        arbitrageOpportunities: chain.arbitrageOpportunities,
        totalProfit: chain.totalProfit
      };
    } catch (error) {
      logger.error(`Failed to get status for ${networkKey}`, {
        error: error.message
      });
      return null;
    }
  }

  async getAllChainStatuses() {
    const statuses = {};
    
    for (const networkKey of this.activeChains) {
      const status = await this.getChainStatus(networkKey);
      if (status) {
        statuses[networkKey] = status;
      }
    }
    
    return statuses;
  }

  async executeArbitrageOnChain(networkKey, opportunity) {
    const chain = this.chains.get(networkKey);
    const contractInfo = this.contracts.get(`${networkKey}-arbitrage`);
    
    if (!chain || !chain.isActive || !contractInfo) {
      throw new Error(`Chain ${networkKey} not ready for arbitrage`);
    }

    try {
      logger.info(`Executing arbitrage on ${chain.config.name}`, {
        tokenA: opportunity.tokenA,
        tokenB: opportunity.tokenB,
        expectedProfit: opportunity.profitUSD
      });

      // Execute the arbitrage transaction
      const tx = await contractInfo.contract.requestFlashLoan(
        opportunity.tokenA,
        opportunity.flashloanAmount,
        opportunity.arbParams,
        {
          gasLimit: 8000000,
          gasPrice: await chain.provider.getGasPrice()
        }
      );

      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        chain.arbitrageOpportunities++;
        chain.totalProfit += opportunity.profitUSD;
        
        logger.info(`Arbitrage executed successfully on ${chain.config.name}`, {
          txHash: tx.hash,
          gasUsed: receipt.gasUsed.toString(),
          profit: opportunity.profitUSD
        });
        
        return {
          success: true,
          txHash: tx.hash,
          gasUsed: receipt.gasUsed.toString(),
          profit: opportunity.profitUSD
        };
      } else {
        throw new Error("Transaction failed");
      }
    } catch (error) {
      logger.error(`Arbitrage failed on ${networkKey}`, {
        error: error.message,
        opportunity
      });
      throw error;
    }
  }

  async startMultiChainMonitoring() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info("Starting multi-chain monitoring...", {
      activeChains: this.activeChains.length,
      chains: this.activeChains
    });

    // Start monitoring each active chain
    for (const networkKey of this.activeChains) {
      this.startChainMonitoring(networkKey);
    }
  }

  async startChainMonitoring(networkKey) {
    const chain = this.chains.get(networkKey);
    if (!chain || !chain.isActive) return;

    logger.info(`Starting monitoring for ${chain.config.name}`);
    
    // Monitor new blocks
    chain.provider.on("block", async (blockNumber) => {
      chain.lastBlockNumber = blockNumber;
      
      // Log every 10 blocks to avoid spam
      if (blockNumber % 10 === 0) {
        logger.debug(`New block on ${chain.config.name}`, {
          blockNumber,
          chainId: chain.config.chainId
        });
      }
    });
  }

  async stopMultiChainMonitoring() {
    this.isRunning = false;
    logger.info("Stopping multi-chain monitoring...");
    
    // Remove all listeners
    for (const [networkKey, chain] of this.chains) {
      if (chain.provider) {
        chain.provider.removeAllListeners();
      }
    }
  }

  getActiveChains() {
    return this.activeChains.map(key => ({
      key,
      config: this.chains.get(key).config
    }));
  }

  getSupportedNetworks() {
    return Object.keys(networks);
  }

  async getOptimalChainForArbitrage(opportunity) {
    // Find the chain with lowest gas costs and highest liquidity
    let bestChain = null;
    let bestScore = 0;

    for (const networkKey of this.activeChains) {
      const chain = this.chains.get(networkKey);
      if (!chain || !chain.isActive) continue;

      try {
        const gasPrice = await chain.provider.getGasPrice();
        const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, "gwei"));
        
        // Score based on gas price (lower is better) and network activity
        const score = 1000 / gasPriceGwei + chain.arbitrageOpportunities;
        
        if (score > bestScore) {
          bestScore = score;
          bestChain = networkKey;
        }
      } catch (error) {
        logger.debug(`Failed to get gas price for ${networkKey}`, {
          error: error.message
        });
      }
    }

    return bestChain;
  }
}

module.exports = MultiChainManager;
