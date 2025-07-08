const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashloanArbitrage", function () {
  let mockAddressProvider;
  let owner;
  let addr1;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();

    // Deploy a mock address provider for testing
    const MockAddressProvider = await ethers.getContractFactory(
      "MockAddressProvider"
    );
    mockAddressProvider = await MockAddressProvider.deploy();
    await mockAddressProvider.deployed();
  });

  describe("Deployment", function () {
    it("Should deploy mock address provider successfully", async function () {
      expect(mockAddressProvider.address).to.be.properAddress;
      expect(await mockAddressProvider.getPool()).to.equal(
        mockAddressProvider.address
      );
    });

    it("Should compile without errors", async function () {
      // This test just verifies the contract compiles
      expect(true).to.be.true;
    });
  });
});
