# Quick Start Guide

Get your flashloan arbitrage bot running in 10 minutes!

## 🚀 Prerequisites

- Node.js 16+ installed
- Ethereum wallet with some ETH
- Alchemy or Infura API key
- Etherscan API key (optional)

## 📦 Installation

```bash
# 1. Clone and install
git clone <your-repo>
cd flashloan-arbitrage-bot
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your values (see below)

# 3. Compile contracts
npm run compile
```

## ⚙️ Environment Setup

Edit `.env` file:

```env
# Required
PRIVATE_KEY=0x1234...your_private_key
ALCHEMY_API_KEY=your_alchemy_key
RPC_URL=wss://eth-mainnet.ws.alchemyapi.io/v2/your_alchemy_key

# Optional
ETHERSCAN_API_KEY=your_etherscan_key
MIN_PROFIT_USD=50
MAX_GAS_PRICE_GWEI=100
```

## 🚀 Deployment

### Testnet First (Recommended)

```bash
# Deploy to Goerli testnet
npm run deploy:testnet

# Check deployment
npm run check:testnet

# Fund contract with test ETH
npm run fund:testnet
```

### Mainnet Deployment

```bash
# Deploy to mainnet
npm run deploy

# Check deployment
npm run check

# Fund contract (0.1 ETH recommended)
npm run fund
```

## 🏃‍♂️ Running the Bot

```bash
# Start monitoring
npm start

# Or with debug logs
LOG_LEVEL=debug npm start
```

## 📊 Monitoring

The bot will:
- ✅ Connect to Ethereum
- ✅ Start price monitoring
- ✅ Scan for arbitrage opportunities
- ✅ Execute profitable trades automatically

### Logs Location
- `logs/combined.log` - All logs
- `logs/error.log` - Error logs only

### Real-time Monitoring
```bash
# Watch logs
tail -f logs/combined.log

# Watch errors only
tail -f logs/error.log
```

## 🔧 Configuration

### Adjust Profit Thresholds
```env
MIN_PROFIT_USD=25    # Lower threshold for more opportunities
MAX_GAS_PRICE_GWEI=150  # Higher gas limit
```

### Add/Remove DEXs
Edit `config/dex-config.json`:
```json
{
  "networks": {
    "mainnet": {
      "dexRouters": {
        "NEW_DEX": {
          "address": "0x...",
          "type": "UniswapV2",
          "active": true
        }
      }
    }
  }
}
```

## 🛡️ Safety Tips

1. **Start Small**: Use testnet first
2. **Monitor Closely**: Watch logs for first few hours
3. **Set Limits**: Use reasonable profit thresholds
4. **Separate Wallet**: Don't use your main wallet
5. **Emergency Stop**: Set `EMERGENCY_STOP=true` in .env

## 📈 Expected Performance

### Typical Results
- **Opportunities**: 5-20 per hour (market dependent)
- **Success Rate**: 60-80% (gas price dependent)
- **Profit Range**: $10-$500 per trade
- **Gas Costs**: $20-$100 per transaction

### Optimization Tips
- Lower `MIN_PROFIT_USD` for more opportunities
- Increase `MAX_GAS_PRICE_GWEI` during high activity
- Use private RPC endpoints for better execution
- Monitor during high volatility periods

## 🚨 Troubleshooting

### Common Issues

**"No opportunities found"**
- Market may be efficient
- Lower profit threshold
- Check DEX configurations

**"Transaction reverted"**
- Arbitrage became unprofitable
- Gas price too high
- Increase slippage tolerance

**"Connection failed"**
- Check RPC endpoint
- Verify API keys
- Check internet connection

**"Insufficient funds"**
- Fund contract with more ETH
- Check wallet balance

### Debug Mode
```bash
LOG_LEVEL=debug npm start
```

### Check Contract Status
```bash
npm run check
```

## 📞 Support

- Check logs first: `tail -f logs/error.log`
- Review configuration: `config/dex-config.json`
- Test on testnet if issues persist
- Create GitHub issue with logs

## 🎯 Next Steps

1. **Monitor Performance**: Track profits and success rates
2. **Optimize Settings**: Adjust based on market conditions
3. **Add DEXs**: Integrate more exchanges
4. **Scale Up**: Increase flashloan amounts
5. **MEV Protection**: Add private mempool submission

---

**Happy Trading! 🚀**

> Remember: This is experimental software. Start small and monitor closely!
