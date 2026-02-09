// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @notice Minimal local stub for the EIP-7212 P-256 verifier predeploy interface.
/// @dev Expects calldata layout used by p256-verifier and returns 1 for 160-byte inputs.
contract P256VerifierStub {
    fallback(bytes calldata input) external payable returns (bytes memory) {
        if (input.length != 160) {
            return abi.encodePacked(uint256(0));
        }
        return abi.encodePacked(uint256(1));
    }
}
