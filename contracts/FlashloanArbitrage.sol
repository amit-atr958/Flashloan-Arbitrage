// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import "@aave/core-v3/contracts/interfaces/IPool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

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
    
    uint256 public constant MAX_SLIPPAGE = 300; // 3%
    uint256 public constant SLIPPAGE_BASE = 10000;
    
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
        // Initialize with major DEX routers on Ethereum mainnet
        _addDEX(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D, 0); // Uniswap V2
        _addDEX(0xE592427A0AEce92De3Edee1F18E0157C05861564, 1); // Uniswap V3
        _addDEX(0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F, 0); // Sushiswap
        _addDEX(0xBA12222222228d8Ba445958a75a0704d566BF2C8, 3); // Balancer V2
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

            // Calculate minimum amount out with 3% slippage tolerance
            uint256 minAmountOut = amountIn * 97 / 100; // 3% slippage

            uint256[] memory amounts = IUniswapV2Router(router).swapExactTokensForTokens(
                amountIn,
                minAmountOut,
                path,
                address(this),
                block.timestamp + 300
            );
            amountOut = amounts[amounts.length - 1];

        } else if (dex.dexType == 1) { // UniswapV3
            // Calculate minimum amount out with 3% slippage tolerance
            uint256 minAmountOut = amountIn * 97 / 100; // 3% slippage

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
        } else {
            // For other DEXs, use low-level call with provided swap data
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
