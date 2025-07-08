# Flashloan Arbitrage Bot

A complete, production-ready flashloan arbitrage bot for Ethereum that automatically detects and executes profitable arbitrage opportunities across multiple DEXs using Aave V3 flashloans.

## 🚀 Features

- **Multi-DEX Support**: Integrates with Uniswap V2/V3, SushiSwap, Balancer, Curve, and 1inch
- **Aave V3 Flashloans**: Uses Aave V3 for zero-collateral flashloans
- **Real-time Monitoring**: WebSocket connections for low-latency price monitoring
- **Atomic Transactions**: Guaranteed no-loss execution with automatic revert on failure
- **Gas Optimization**: Smart gas price management and execution timing
- **Configurable**: Fully configurable via environment variables
- **Production Ready**: Comprehensive logging, error handling, and monitoring

## 📋 Prerequisites

- Node.js >= 16.0.0
- npm or yarn
- Ethereum wallet with ETH for gas fees
- RPC provider (Alchemy/Infura recommended)
- Etherscan API key (for contract verification)

## 🛠 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd flashloan-arbitrage-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

4. **Compile contracts**
   ```bash
   npm run compile
   ```

## ⚙️ Configuration

### Environment Variables

Edit `.env` file with your configuration:

```env
# Blockchain Connection
PRIVATE_KEY=0x1234...  # Your wallet private key
ALCHEMY_API_KEY=your_alchemy_key
RPC_URL=wss://eth-mainnet.ws.alchemyapi.io/v2/your_alchemy_key

# Contract
CONTRACT_ADDRESS=0x1234...  # Deployed contract address

# Trading Parameters
MIN_PROFIT_USD=50           # Minimum profit to execute
MAX_GAS_PRICE_GWEI=100     # Maximum gas price
SLIPPAGE_TOLERANCE=0.5     # Slippage tolerance %

# API Keys
ETHERSCAN_API_KEY=your_etherscan_key
```

### DEX Configuration

Modify `config/dex-config.json` to:
- Add/remove DEX routers
- Configure token pairs
- Adjust trading parameters
- Set network-specific settings

## 🚀 Deployment

### 1. Deploy to Testnet (Recommended First)

```bash
# Deploy to Goerli testnet
npm run deploy:testnet
```

### 2. Deploy to Mainnet

```bash
# Deploy to Ethereum mainnet
npm run deploy
```

### 3. Verify Contract

```bash
npm run verify
```

The deployment script will:
- Deploy the FlashloanArbitrage contract
- Configure initial DEX routers
- Save deployment info to `deployments/` folder
- Verify contract on Etherscan

## 🏃‍♂️ Running the Bot

### Start Monitoring

```bash
npm start
# or
npm run monitor
```

The bot will:
1. Connect to Ethereum via WebSocket
2. Start monitoring prices across all configured DEXs
3. Scan for arbitrage opportunities every 2 seconds
4. Execute profitable trades automatically
5. Log all activities to console and files

### Monitor Logs

```bash
# View real-time logs
tail -f logs/combined.log

# View error logs
tail -f logs/error.log
```

## 📊 How It Works

### 1. Price Monitoring
- Connects to multiple DEXs via their router contracts
- Fetches real-time price data for all token pairs
- Updates price cache every 5 seconds
- Uses WebSocket for low-latency data

### 2. Arbitrage Detection
- Compares prices across all DEX pairs
- Calculates potential profit after gas costs
- Filters opportunities by minimum profit threshold
- Accounts for slippage and flashloan fees

### 3. Execution Process
- Requests flashloan from Aave V3
- Executes buy order on cheaper DEX
- Executes sell order on expensive DEX
- Repays flashloan + fees
- Keeps profit in contract

### 4. Safety Mechanisms
- Transaction reverts if unprofitable
- Gas price limits prevent high-cost execution
- Execution cooldown prevents spam
- Emergency stop functionality

## 🔧 Smart Contract Architecture

### FlashloanArbitrage.sol

The main contract inherits from:
- `FlashLoanSimpleReceiverBase` (Aave V3)
- `Ownable` (Access control)
- `ReentrancyGuard` (Security)

Key functions:
- `executeOperation()`: Flashloan callback
- `requestFlashLoan()`: Initiate arbitrage
- `addDEX()`/`removeDEX()`: Manage DEX routers
- `withdrawToken()`/`withdrawETH()`: Owner functions

## 📈 Monitoring & Analytics

### Bot Status
The bot logs status every 60 seconds:
- Wallet balance
- Active price data entries
- Last execution time
- Uptime statistics

### Profit Tracking
- All executions logged with profit/loss
- Gas costs tracked
- Success/failure rates
- Performance metrics

## 🛡️ Security Considerations

### Private Key Security
- Use a dedicated wallet for the bot
- Never commit private keys to version control
- Consider using hardware wallets for production
- Implement key rotation policies

### Smart Contract Security
- Contract is upgradeable by owner only
- Emergency withdrawal functions
- Reentrancy protection
- Input validation on all functions

### Operational Security
- Monitor for unusual activity
- Set reasonable profit thresholds
- Use private RPC endpoints if possible
- Implement alerting for failures

## 🧪 Testing

### Run Tests
```bash
npm test
```

### Test on Fork
```bash
# Test against mainnet fork
npx hardhat test --network hardhat
```

### Gas Analysis
```bash
REPORT_GAS=true npm test
```

## 🔍 Troubleshooting

### Common Issues

1. **"Insufficient funds" error**
   - Ensure wallet has enough ETH for gas
   - Check if contract has required token balances

2. **"Transaction reverted" error**
   - Arbitrage became unprofitable during execution
   - Gas price too high
   - DEX liquidity changed

3. **"Connection failed" error**
   - Check RPC endpoint status
   - Verify API keys
   - Check network connectivity

4. **"No opportunities found"**
   - Market conditions may not be favorable
   - Adjust profit thresholds
   - Check DEX configurations

### Debug Mode
```bash
LOG_LEVEL=debug npm start
```

## 📚 Advanced Configuration

### Custom DEX Integration
1. Add router address to `config/dex-config.json`
2. Implement swap logic in contract
3. Update monitoring system

### MEV Protection
```env
# Use private RPC endpoint
PRIVATE_RPC_URL=your_private_endpoint

# Enable Flashbots integration
FLASHBOTS_RELAY_URL=https://relay.flashbots.net
```

### Performance Optimization
- Use dedicated RPC endpoints
- Implement connection pooling
- Optimize gas estimation
- Use multicall for batch operations

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new features
4. Ensure all tests pass
5. Submit pull request

## ⚠️ Disclaimer

This software is for educational purposes only. Cryptocurrency trading involves substantial risk of loss. The authors are not responsible for any financial losses incurred through the use of this software.

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

- Create an issue for bugs or feature requests
- Join our Discord for community support
- Check documentation for common solutions

---

**Happy Arbitraging! 🚀**
# Flashloan-Arbitrage
