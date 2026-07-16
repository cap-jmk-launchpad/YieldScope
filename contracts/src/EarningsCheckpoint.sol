// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title EarningsCheckpoint
/// @notice Stores a commitment (Merkle / content root) for a YieldScope sync window.
/// @dev Phase 1 attestation surface on Monad — portable proof that a ledger snapshot existed.
contract EarningsCheckpoint is Ownable {
    struct Checkpoint {
        bytes32 root;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 attestedAt;
        string uri;
    }

    /// @dev subject => sequence => checkpoint
    mapping(address => mapping(uint256 => Checkpoint)) public checkpoints;
    mapping(address => uint256) public checkpointCount;

    event CheckpointAttested(
        address indexed subject,
        uint256 indexed sequence,
        bytes32 root,
        uint64 windowStart,
        uint64 windowEnd,
        string uri
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Attest a root for `msg.sender` (self-attestation).
    function attest(
        bytes32 root,
        uint64 windowStart,
        uint64 windowEnd,
        string calldata uri
    ) external returns (uint256 sequence) {
        return _attest(msg.sender, root, windowStart, windowEnd, uri);
    }

    /// @notice Owner can attest on behalf of a subject (server / relayer path).
    function attestFor(
        address subject,
        bytes32 root,
        uint64 windowStart,
        uint64 windowEnd,
        string calldata uri
    ) external onlyOwner returns (uint256 sequence) {
        require(subject != address(0), "EarningsCheckpoint: zero subject");
        return _attest(subject, root, windowStart, windowEnd, uri);
    }

    function latest(address subject) external view returns (Checkpoint memory) {
        uint256 count = checkpointCount[subject];
        require(count > 0, "EarningsCheckpoint: none");
        return checkpoints[subject][count - 1];
    }

    function _attest(
        address subject,
        bytes32 root,
        uint64 windowStart,
        uint64 windowEnd,
        string calldata uri
    ) internal returns (uint256 sequence) {
        require(root != bytes32(0), "EarningsCheckpoint: empty root");
        require(windowEnd >= windowStart, "EarningsCheckpoint: bad window");

        sequence = checkpointCount[subject];
        checkpoints[subject][sequence] = Checkpoint({
            root: root,
            windowStart: windowStart,
            windowEnd: windowEnd,
            attestedAt: uint64(block.timestamp),
            uri: uri
        });
        checkpointCount[subject] = sequence + 1;

        emit CheckpointAttested(subject, sequence, root, windowStart, windowEnd, uri);
    }
}
