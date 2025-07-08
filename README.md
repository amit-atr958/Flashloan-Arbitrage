# Flashloan Arbitrage Bot

An advanced Ethereum flashloan arbitrage bot that automatically detects and executes profitable arbitrage opportunities across multiple DEXs using Aave V3 flashloans.

## 🚀 Features

- **Multi-DEX Support**: Integrates with Uniswap V2/V3, Sushiswap, and other major DEXs
- **Real-time Monitoring**: Continuously monitors price differences across DEXs
- **Automated Execution**: Automatically executes profitable arbitrage opportunities
- **Risk Management**: Built-in slippage protection and profit thresholds
- **Gas Optimization**: Smart gas price monitoring and optimization
- **Comprehensive Logging**: Detailed logging for monitoring and debugging
- **Demo Mode**: Safe testing mode without actual transactions

## 🏗️ Architecture

The bot consists of several key components:

1. **FlashloanArbitrage Contract**: Smart contract that handles flashloan execution and DEX interactions
2. **Price Monitor**: Real-time price monitoring across multiple DEXs
3. **Arbitrage Engine**: Calculates profitability and executes trades
4. **Risk Management**: Monitors gas prices and implements safety checks

## 📋 Prerequisites

- Node.js v16 or higher
- Ethereum wallet with ETH for gas fees
- Alchemy API key
- Etherscan API key (for contract verification)
- Basic understanding of DeFi and arbitrage concepts

## 🛠️ Installation & Setup

### Step 1: Clone and Install

```bash
git clone <repository-url>
cd flashloan-arbitrage-bot
npm install
```

### Step 2: Environment Configuration

Create and configure your `.env` file:

```bash
# Copy the example file
cp .env.example .env
```

Update `.env` with your configuration:

```env
# Wallet Configuration
PRIVATE_KEY=your_wallet_private_key_without_0x

# API Keys
ALCHEMY_API_KEY=your_alchemy_api_key
ETHERSCAN_API_KEY=your_etherscan_api_key

# Network Configuration
NETWORK=sepolia
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Contract Configuration (will be set after deployment)
CONTRACT_ADDRESS=

# Bot Configuration
MIN_PROFIT_USD=1
MAX_GAS_PRICE_GWEI=100
SLIPPAGE_TOLERANCE=0.5
DEMO_MODE=true
```

### Step 3: Get Testnet ETH

For Sepolia testnet, get free ETH from faucets:

- [Sepolia Faucet](https://sepoliafaucet.com/)
- [Alchemy Sepolia Faucet](https://sepoliafaucet.com/)
- [Chainlink Sepolia Faucet](https://faucets.chain.link/sepolia)

## 🚀 Deployment Process

### Step 1: Compile Contracts

```bash
npm run compile
```

Expected output:

```
Compiled 13 Solidity files successfully
```

### Step 2: Deploy to Sepolia

```bash
npm run deploy:sepolia
```

Expected output:

```
Deploying to sepolia...
Deploying contracts with the account: 0x...
Account balance: X.X ETH
FlashloanArbitrage deployed to: 0x...
```

### Step 3: Verify Contract

```bash
npm run verify:sepolia
```

### Step 4: Check Deployment

```bash
npm run check:sepolia
```

Expected output:

```
✅ Contract exists on blockchain
Contract Owner: 0x...
Active DEXs: X
Contract ETH Balance: X.X ETH
```

### Step 5: Fund Contract (Optional)

```bash
npm run fund:sepolia
```

## 🎯 Running the Bot

### Demo Mode (Recommended for Testing)

```bash
npm run start
```

In demo mode, the bot will:

- ✅ Monitor real price data
- ✅ Detect arbitrage opportunities
- ✅ Calculate potential profits
- ❌ NOT execute actual transactions
- ✅ Log what it would do

Expected output:

```
info: === Flashloan Arbitrage Bot Starting ===
info: Provider and wallet initialized
info: Contract initialized
info: Starting price monitoring...
info: Found X arbitrage opportunities
info: DEMO MODE: Would execute arbitrage {
  tokenA: "0x...",
  tokenB: "0x...",
  expectedProfit: 50.25
}
```

### Production Mode (Real Trading)

⚠️ **WARNING**: Only use production mode after thorough testing!

1. Set `DEMO_MODE=false` in `.env`
2. Ensure contract has sufficient ETH for gas
3. Start the bot:

```bash
npm run start
```

## 🧪 Testing

### Run Test Suite

```bash
npm run dev
```

This will:

1. Compile contracts
2. Run all tests
3. Generate gas reports

Expected output:

```
✔ Should deploy mock address provider successfully
✔ Should compile without errors

2 passing (2s)
```

### Individual Commands

```bash
# Compile only
npm run compile

# Test only
npm run test

# Deploy to specific network
npm run deploy:sepolia
npm run deploy:mainnet

# Verify contracts
npm run verify:sepolia
npm run verify:mainnet

# Check deployment status
npm run check:sepolia
npm run check:mainnet

# Fund contracts
npm run fund:sepolia
npm run fund:mainnet
```

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

**Happy Trading! 🚀**
