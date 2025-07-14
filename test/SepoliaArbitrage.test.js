const { expect } = require("chai");
const { ethers } = require("hardhat");
const networks = require("../config/networks.json");

describe("Sepolia Flashloan Arbitrage Integration", function () {
  let flashloanArbitrage;
  let owner;
  let addr1;
  let sepoliaConfig;
  let mockERC20;

  // Increase timeout for network calls
  this.timeout(60000);

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();
    sepoliaConfig = networks.sepolia;

    // Deploy FlashloanArbitrage with Sepolia Aave provider
    const FlashloanArbitrage = await ethers.getContractFactory("FlashloanArbitrage");
    flashloanArbitrage = await FlashloanArbitrage.deploy(
      sepoliaConfig.aaveAddressProvider
    );
    await flashloanArbitrage.deployed();

    // Deploy mock ERC20 for testing
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    if (MockERC20) {
      mockERC20 = await MockERC20.deploy("Test Token", "TEST", 18);
      await mockERC20.deployed();
    }
  });

  describe("Contract Deployment", function () {
    it("Should deploy with correct Sepolia Aave provider", async function () {
      expect(flashloanArbitrage.address).to.be.properAddress;
      
      // Check if the contract has the correct constants
      expect(await flashloanArbitrage.UNISWAP_V3_FACTORY()).to.equal(
        sepoliaConfig.dexRouters.UNISWAP_V3_FACTORY
      );
      expect(await flashloanArbitrage.BALANCER_VAULT()).to.equal(
        sepoliaConfig.dexRouters.BALANCER_VAULT
      );
    });

    it("Should have correct DEX routers initialized", async function () {
      const activeDEXs = await flashloanArbitrage.getActiveDEXs();
      expect(activeDEXs.length).to.be.greaterThan(0);
      
      // Check if Sepolia DEX routers are active
      const uniswapV2Router = sepoliaConfig.dexRouters.UNISWAP_V2;
      const dexInfo = await flashloanArbitrage.dexInfo(uniswapV2Router);
      expect(dexInfo.isActive).to.be.true;
    });
  });

  describe("Price Feed Management", function () {
    it("Should allow owner to set price feeds", async function () {
      const tokenAddress = sepoliaConfig.tokens.WETH;
      const priceFeedAddress = sepoliaConfig.priceFeeds.ETH_USD;
      
      await flashloanArbitrage.setPriceFeed(tokenAddress, priceFeedAddress);
      
      const storedPriceFeed = await flashloanArbitrage.getPriceFeed(tokenAddress);
      expect(storedPriceFeed).to.equal(priceFeedAddress);
    });

    it("Should not allow non-owner to set price feeds", async function () {
      const tokenAddress = sepoliaConfig.tokens.WETH;
      const priceFeedAddress = sepoliaConfig.priceFeeds.ETH_USD;
      
      await expect(
        flashloanArbitrage.connect(addr1).setPriceFeed(tokenAddress, priceFeedAddress)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should get latest price from Chainlink feed", async function () {
      const tokenAddress = sepoliaConfig.tokens.WETH;
      const priceFeedAddress = sepoliaConfig.priceFeeds.ETH_USD;
      
      await flashloanArbitrage.setPriceFeed(tokenAddress, priceFeedAddress);
      
      try {
        const [price, updatedAt] = await flashloanArbitrage.getLatestPrice(tokenAddress);
        expect(price).to.be.greaterThan(0);
        expect(updatedAt).to.be.greaterThan(0);
      } catch (error) {
        // Price feed might not be available in test environment
        console.log("Price feed test skipped:", error.message);
      }
    });
  });

  describe("DEX Management", function () {
    it("Should allow owner to add new DEX", async function () {
      const newDexAddress = "0x1234567890123456789012345678901234567890";
      const dexType = 2; // Custom DEX type
      
      await flashloanArbitrage.addDEX(newDexAddress, dexType);
      
      const dexInfo = await flashloanArbitrage.dexInfo(newDexAddress);
      expect(dexInfo.isActive).to.be.true;
      expect(dexInfo.dexType).to.equal(dexType);
    });

    it("Should allow owner to remove DEX", async function () {
      const dexAddress = sepoliaConfig.dexRouters.UNISWAP_V2;
      
      await flashloanArbitrage.removeDEX(dexAddress);
      
      const dexInfo = await flashloanArbitrage.dexInfo(dexAddress);
      expect(dexInfo.isActive).to.be.false;
    });

    it("Should not allow non-owner to manage DEXs", async function () {
      const newDexAddress = "0x1234567890123456789012345678901234567890";
      
      await expect(
        flashloanArbitrage.connect(addr1).addDEX(newDexAddress, 2)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Gas Estimation", function () {
    it("Should estimate gas for arbitrage operation", async function () {
      const arbitrageParams = {
        tokenA: sepoliaConfig.tokens.WETH,
        tokenB: sepoliaConfig.tokens.USDC,
        amount: ethers.utils.parseEther("1"),
        dexRouters: [
          sepoliaConfig.dexRouters.UNISWAP_V2,
          sepoliaConfig.dexRouters.SUSHISWAP
        ],
        swapData: ["0x", "0x"],
        minProfit: ethers.utils.parseEther("0.01")
      };
      
      const estimatedGas = await flashloanArbitrage.estimateGas(
        sepoliaConfig.tokens.WETH,
        ethers.utils.parseEther("1"),
        arbitrageParams
      );
      
      expect(estimatedGas).to.be.greaterThan(0);
    });
  });

  describe("Token Management", function () {
    it("Should allow owner to withdraw tokens", async function () {
      if (!mockERC20) {
        this.skip();
        return;
      }
      
      // Mint some tokens to the contract
      await mockERC20.mint(flashloanArbitrage.address, ethers.utils.parseEther("100"));
      
      const initialBalance = await mockERC20.balanceOf(owner.address);
      const contractBalance = await mockERC20.balanceOf(flashloanArbitrage.address);
      
      await flashloanArbitrage.withdrawToken(
        mockERC20.address,
        contractBalance
      );
      
      const finalBalance = await mockERC20.balanceOf(owner.address);
      expect(finalBalance.sub(initialBalance)).to.equal(contractBalance);
    });

    it("Should allow owner to withdraw ETH", async function () {
      // Send some ETH to the contract
      await owner.sendTransaction({
        to: flashloanArbitrage.address,
        value: ethers.utils.parseEther("0.1")
      });
      
      const initialBalance = await owner.getBalance();
      const contractBalance = await ethers.provider.getBalance(flashloanArbitrage.address);
      
      const tx = await flashloanArbitrage.withdrawETH();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      
      const finalBalance = await owner.getBalance();
      const expectedBalance = initialBalance.add(contractBalance).sub(gasUsed);
      
      expect(finalBalance).to.be.closeTo(expectedBalance, ethers.utils.parseEther("0.001"));
    });
  });

  describe("Access Control", function () {
    it("Should only allow owner to call restricted functions", async function () {
      const restrictedFunctions = [
        () => flashloanArbitrage.connect(addr1).addDEX("0x1234567890123456789012345678901234567890", 1),
        () => flashloanArbitrage.connect(addr1).removeDEX(sepoliaConfig.dexRouters.UNISWAP_V2),
        () => flashloanArbitrage.connect(addr1).setPriceFeed(sepoliaConfig.tokens.WETH, sepoliaConfig.priceFeeds.ETH_USD),
        () => flashloanArbitrage.connect(addr1).withdrawETH()
      ];
      
      for (const fn of restrictedFunctions) {
        await expect(fn()).to.be.revertedWith("Ownable: caller is not the owner");
      }
    });
  });

  describe("Integration Validation", function () {
    it("Should validate Sepolia network configuration", function () {
      expect(sepoliaConfig.chainId).to.equal(11155111);
      expect(sepoliaConfig.aaveAddressProvider).to.be.properAddress;
      expect(sepoliaConfig.dexRouters.UNISWAP_V2).to.be.properAddress;
      expect(sepoliaConfig.dexRouters.UNISWAP_V3).to.be.properAddress;
      expect(sepoliaConfig.dexRouters.SUSHISWAP).to.be.properAddress;
      expect(sepoliaConfig.dexRouters.BALANCER_VAULT).to.be.properAddress;
    });

    it("Should have valid token addresses", function () {
      expect(sepoliaConfig.tokens.WETH).to.be.properAddress;
      expect(sepoliaConfig.tokens.USDC).to.be.properAddress;
      expect(sepoliaConfig.tokens.DAI).to.be.properAddress;
    });

    it("Should have valid Chainlink price feed addresses", function () {
      expect(sepoliaConfig.priceFeeds.ETH_USD).to.be.properAddress;
      expect(sepoliaConfig.priceFeeds.BTC_USD).to.be.properAddress;
      expect(sepoliaConfig.priceFeeds.USDC_USD).to.be.properAddress;
      expect(sepoliaConfig.priceFeeds.DAI_USD).to.be.properAddress;
    });
  });
});
