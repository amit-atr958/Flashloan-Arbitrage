// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockAddressProvider {
    address public pool;
    
    constructor() {
        // Set a mock pool address
        pool = address(this);
    }
    
    function getPool() external view returns (address) {
        return pool;
    }
}
