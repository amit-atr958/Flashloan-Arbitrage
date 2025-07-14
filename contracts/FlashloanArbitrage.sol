// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import "@aave/core-v3/contracts/interfaces/IPool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// Chainlink Price Feed Interface
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 price,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

interface IERC20Extended is IERC20 {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
    
    function getAmountsOut(uint amountIn, address[] calldata path)
        external view returns (uint[] memory amounts);
}

interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable returns (uint256 amountOut);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );
}

interface IBalancerVault {
    struct SingleSwap {
        bytes32 poolId;
        uint8 kind;
        address assetIn;
        address assetOut;
        uint256 amount;
        bytes userData;
    }

    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address payable recipient;
        bool toInternalBalance;
    }

    function swap(
        SingleSwap memory singleSwap,
        FundManagement memory funds,
        uint256 limit,
        uint256 deadline
    ) external payable returns (uint256);

    function getPoolTokens(bytes32 poolId)
        external
        view
        returns (
            address[] memory tokens,
            uint256[] memory balances,
            uint256 lastChangeBlock
        );
}

contract FlashloanArbitrage is FlashLoanSimpleReceiverBase, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20Extended;

    struct ArbitrageParams {
        address tokenA;
        address tokenB;
        uint256 amount;
        address[] dexRouters;
        bytes[] swapData;
        uint256 minProfit;
    }

    struct DEXInfo {
        address router;
        uint8 dexType; // 0: UniV2, 1: UniV3, 2: Sushi, 3: Balancer, 4: Curve, 5: 1inch
        bool isActive;
    }

    mapping(address => DEXInfo) public dexInfo;
    address[] public activeDEXs;
    mapping(address => address) public priceFeeds; // token => Chainlink price feed

    uint256 public constant MAX_SLIPPAGE = 300; // 3%
    uint256 public constant SLIPPAGE_BASE = 10000;
    uint256 public constant PRICE_TOLERANCE = 200; // 2% price tolerance for oracle checks

    // Sepolia testnet addresses
    address public constant UNISWAP_V3_FACTORY = 0x0227628f3F023bb0B980b67D528571c95c6DaC1c;
    address public constant UNISWAP_V2_FACTORY = 0xF62c03E08ada871A0bEb309762E260a7a6a880E6;
    address public constant SUSHISWAP_FACTORY = 0x734583f62Bb6ACe3c9bA9bd5A53143CA2Ce8C55A;
    address public constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    
    event ArbitrageExecuted(
        address indexed tokenA,
        address indexed tokenB,
        uint256 amount,
        uint256 profit,
        address[] dexUsed
    );
    
    event ArbitrageFailed(
        address indexed tokenA,
        address indexed tokenB,
        uint256 amount,
        string reason
    );
    
    event DEXAdded(address indexed router, uint8 dexType);
    event DEXRemoved(address indexed router);
    
    constructor(address _addressProvider)
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider))
    {
        // Initialize with Sepolia testnet DEX routers
        _addDEX(0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3, 0); // Uniswap V2 Router02
        _addDEX(0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E, 1); // Uniswap V3 SwapRouter02
        _addDEX(0xeaBcE3E74EF41FB40024a21Cc2ee2F5dDc615791, 0); // Sushiswap Router02
        _addDEX(0xBA12222222228d8Ba445958a75a0704d566BF2C8, 3); // Balancer V2 Vault

        // Initialize Chainlink price feeds for Sepolia
        priceFeeds[0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14] = 0x694AA1769357215DE4FAC081bf1f309aDC325306; // WETH/USD
        priceFeeds[0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8] = 0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E; // USDC/USD
        priceFeeds[0x68194a729C2450ad26072b3D33ADaCbcef39D574] = 0x14866185B1962B63C3Ea9E03Bc1da838bab34C19; // DAI/USD
    }
    
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Caller must be Pool");
        require(initiator == address(this), "Initiator must be this contract");
        
        ArbitrageParams memory arbParams = abi.decode(params, (ArbitrageParams));
        
        try this._executeArbitrage(arbParams, amount, premium) {
            emit ArbitrageExecuted(
                arbParams.tokenA,
                arbParams.tokenB,
                amount,
                IERC20Extended(asset).balanceOf(address(this)) - amount - premium,
                arbParams.dexRouters
            );
        } catch Error(string memory reason) {
            emit ArbitrageFailed(arbParams.tokenA, arbParams.tokenB, amount, reason);
            revert(string(abi.encodePacked("Arbitrage failed: ", reason)));
        }
        
        // Approve the Pool contract to pull the owed amount
        uint256 amountOwed = amount + premium;
        IERC20Extended(asset).safeApprove(address(POOL), amountOwed);
        
        return true;
    }
    
    function _executeArbitrage(
        ArbitrageParams memory params,
        uint256 flashAmount,
        uint256 premium
    ) external {
        require(msg.sender == address(this), "Internal function");
        require(params.dexRouters.length >= 2, "Need at least 2 DEXs");
        require(params.dexRouters.length == params.swapData.length, "Mismatched arrays");

        // Validate prices against Chainlink oracles before executing
        _validatePricesWithOracle(params.tokenA, params.tokenB);

        uint256 initialBalance = IERC20Extended(params.tokenA).balanceOf(address(this));
        uint256 currentAmount = flashAmount;

        // Execute trades across different DEXs
        for (uint i = 0; i < params.dexRouters.length; i++) {
            require(dexInfo[params.dexRouters[i]].isActive, "DEX not active");
            require(params.dexRouters[i] != address(0), "Invalid router address");

            address tokenIn = (i == 0) ? params.tokenA : params.tokenB;
            address tokenOut = (i == 0) ? params.tokenB : params.tokenA;

            // Ensure we have tokens to trade
            require(currentAmount > 0, "No tokens to trade");

            uint256 balanceBeforeTrade = IERC20Extended(tokenIn).balanceOf(address(this));
            require(balanceBeforeTrade >= currentAmount, "Insufficient balance for trade");

            currentAmount = _executeTrade(
                params.dexRouters[i],
                tokenIn,
                tokenOut,
                currentAmount,
                params.swapData[i]
            );

            require(currentAmount > 0, "Trade returned zero tokens");
        }

        uint256 finalBalance = IERC20Extended(params.tokenA).balanceOf(address(this));
        require(finalBalance > initialBalance, "No profit generated");

        uint256 profit = finalBalance - initialBalance;
        uint256 totalCost = flashAmount + premium;

        require(profit >= params.minProfit, "Insufficient profit");
        require(finalBalance >= totalCost, "Insufficient funds to repay loan");
    }

    function _validatePricesWithOracle(address tokenA, address tokenB) internal view {
        address feedA = priceFeeds[tokenA];
        address feedB = priceFeeds[tokenB];

        // Skip validation if price feeds are not available
        if (feedA == address(0) || feedB == address(0)) {
            return;
        }

        try AggregatorV3Interface(feedA).latestRoundData() returns (
            uint80,
            int256 priceA,
            uint256,
            uint256 updatedAtA,
            uint80
        ) {
            try AggregatorV3Interface(feedB).latestRoundData() returns (
                uint80,
                int256 priceB,
                uint256,
                uint256 updatedAtB,
                uint80
            ) {
                // Check if prices are recent (within 1 hour)
                require(block.timestamp - updatedAtA < 3600, "Price feed A stale");
                require(block.timestamp - updatedAtB < 3600, "Price feed B stale");
                require(priceA > 0 && priceB > 0, "Invalid oracle prices");

                // Additional price sanity checks can be added here
                // For now, we just ensure the feeds are working and recent
            } catch {
                // If oracle B fails, skip validation
                return;
            }
        } catch {
            // If oracle A fails, skip validation
            return;
        }
    }

    function _executeTrade(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes memory swapData
    ) internal returns (uint256 amountOut) {
        require(amountIn > 0, "Invalid amount");
        require(tokenIn != tokenOut, "Same token swap");

        // Check token balance before swap
        uint256 balanceBefore = IERC20Extended(tokenIn).balanceOf(address(this));
        require(balanceBefore >= amountIn, "Insufficient token balance");

        // Reset approval first, then approve
        IERC20Extended(tokenIn).safeApprove(router, 0);
        IERC20Extended(tokenIn).safeApprove(router, amountIn);

        DEXInfo memory dex = dexInfo[router];
        uint256 tokenOutBalanceBefore = IERC20Extended(tokenOut).balanceOf(address(this));

        if (dex.dexType == 0) { // UniswapV2 / Sushiswap
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;

            // Get expected amounts first to calculate realistic slippage
            uint256[] memory expectedAmounts;
            try IUniswapV2Router(router).getAmountsOut(amountIn, path) returns (uint256[] memory estimatedAmounts) {
                expectedAmounts = estimatedAmounts;
            } catch {
                // If getAmountsOut fails, use conservative slippage
                expectedAmounts = new uint256[](2);
                expectedAmounts[0] = amountIn;
                expectedAmounts[1] = amountIn * 90 / 100; // 10% slippage fallback
            }

            // Use 5% slippage for testnet (more realistic)
            uint256 minAmountOut = expectedAmounts[expectedAmounts.length - 1] * 95 / 100;

            uint256[] memory amounts = IUniswapV2Router(router).swapExactTokensForTokens(
                amountIn,
                minAmountOut,
                path,
                address(this),
                block.timestamp + 300
            );
            amountOut = amounts[amounts.length - 1];

        } else if (dex.dexType == 1) { // UniswapV3
            // Use 5% slippage for testnet (more realistic than 3%)
            uint256 minAmountOut = amountIn * 95 / 100;

            IUniswapV3Router.ExactInputSingleParams memory params =
                IUniswapV3Router.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: 3000, // 0.3% fee tier
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: amountIn,
                    amountOutMinimum: minAmountOut,
                    sqrtPriceLimitX96: 0
                });

            amountOut = IUniswapV3Router(router).exactInputSingle(params);
        } else if (dex.dexType == 3) { // Balancer V2
            // For Balancer, we need a pool ID - this is a simplified implementation
            // In practice, you would need to find the appropriate pool ID for the token pair
            bytes32 poolId = 0x0000000000000000000000000000000000000000000000000000000000000000; // Placeholder

            // Use 5% slippage for testnet
            uint256 minAmountOut = amountIn * 95 / 100;

            IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
                poolId: poolId,
                kind: 0, // GIVEN_IN
                assetIn: tokenIn,
                assetOut: tokenOut,
                amount: amountIn,
                userData: ""
            });

            IBalancerVault.FundManagement memory funds = IBalancerVault.FundManagement({
                sender: address(this),
                fromInternalBalance: false,
                recipient: payable(address(this)),
                toInternalBalance: false
            });

            // Note: This will fail without a valid pool ID
            // In production, you would query for available pools first
            try IBalancerVault(router).swap(singleSwap, funds, minAmountOut, block.timestamp + 300) returns (uint256 result) {
                amountOut = result;
            } catch {
                revert("Balancer swap failed - no valid pool");
            }
        } else {
            // For other DEXs, use low-level call with provided swap data
            require(swapData.length > 0, "Empty swap data");
            (bool success,) = router.call(swapData);
            require(success, "DEX swap failed");

            // Verify we received tokens
            uint256 tokenOutBalanceAfterCall = IERC20Extended(tokenOut).balanceOf(address(this));
            amountOut = tokenOutBalanceAfterCall - tokenOutBalanceBefore;
        }

        require(amountOut > 0, "No tokens received from swap");

        // Verify the actual balance change
        uint256 tokenOutBalanceAfter = IERC20Extended(tokenOut).balanceOf(address(this));
        uint256 actualAmountOut = tokenOutBalanceAfter - tokenOutBalanceBefore;
        require(actualAmountOut > 0, "No actual tokens received");

        return actualAmountOut;
    }

    function requestFlashLoan(
        address asset,
        uint256 amount,
        ArbitrageParams memory params
    ) external onlyOwner nonReentrant {
        bytes memory data = abi.encode(params);

        POOL.flashLoanSimple(
            address(this),
            asset,
            amount,
            data,
            0 // referralCode
        );
    }

    function addDEX(address router, uint8 dexType) external onlyOwner {
        _addDEX(router, dexType);
    }

    function _addDEX(address router, uint8 dexType) internal {
        require(router != address(0), "Invalid router address");
        require(!dexInfo[router].isActive, "DEX already exists");

        dexInfo[router] = DEXInfo({
            router: router,
            dexType: dexType,
            isActive: true
        });

        activeDEXs.push(router);
        emit DEXAdded(router, dexType);
    }

    function removeDEX(address router) external onlyOwner {
        require(dexInfo[router].isActive, "DEX not active");

        dexInfo[router].isActive = false;

        // Remove from activeDEXs array
        for (uint i = 0; i < activeDEXs.length; i++) {
            if (activeDEXs[i] == router) {
                activeDEXs[i] = activeDEXs[activeDEXs.length - 1];
                activeDEXs.pop();
                break;
            }
        }

        emit DEXRemoved(router);
    }

    function getActiveDEXs() external view returns (address[] memory) {
        return activeDEXs;
    }

    function setPriceFeed(address token, address priceFeed) external onlyOwner {
        require(token != address(0), "Invalid token address");
        require(priceFeed != address(0), "Invalid price feed address");
        priceFeeds[token] = priceFeed;
    }

    function getPriceFeed(address token) external view returns (address) {
        return priceFeeds[token];
    }

    function getLatestPrice(address token) external view returns (int256, uint256) {
        address priceFeed = priceFeeds[token];
        require(priceFeed != address(0), "Price feed not set");

        (, int256 price, , uint256 updatedAt, ) = AggregatorV3Interface(priceFeed).latestRoundData();
        return (price, updatedAt);
    }

    function estimateGas(
        address asset,
        uint256 amount,
        ArbitrageParams memory params
    ) external view returns (uint256) {
        // This is a rough estimation - actual gas usage may vary
        uint256 baseGas = 200000; // Base flashloan gas
        uint256 swapGas = params.dexRouters.length * 150000; // Per swap gas
        return baseGas + swapGas;
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "Invalid token address");
        IERC20Extended(token).safeTransfer(owner(), amount);
    }

    function withdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    receive() external payable {}
}
