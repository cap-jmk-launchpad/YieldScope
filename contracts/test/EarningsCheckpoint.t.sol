// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {EarningsCheckpoint} from "../src/EarningsCheckpoint.sol";

contract EarningsCheckpointTest is Test {
    EarningsCheckpoint internal checkpoint;
    address internal owner = address(0xA11CE);
    address internal alice = address(0xB0B);
    address internal bob = address(0xCAFE);

    bytes32 internal constant ROOT_1 = keccak256("root-1");
    bytes32 internal constant ROOT_2 = keccak256("root-2");

    function setUp() public {
        checkpoint = new EarningsCheckpoint(owner);
    }

    function test_attest_storesRootAndEmits() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit EarningsCheckpoint.CheckpointAttested(alice, 0, ROOT_1, 100, 200, "ipfs://meta");
        uint256 seq = checkpoint.attest(ROOT_1, 100, 200, "ipfs://meta");
        assertEq(seq, 0);

        (
            bytes32 root,
            uint64 windowStart,
            uint64 windowEnd,
            uint64 attestedAt,
            string memory uri
        ) = checkpoint.checkpoints(alice, 0);

        assertEq(root, ROOT_1);
        assertEq(windowStart, 100);
        assertEq(windowEnd, 200);
        assertGt(attestedAt, 0);
        assertEq(uri, "ipfs://meta");
        assertEq(checkpoint.checkpointCount(alice), 1);
    }

    function test_attest_incrementsSequence() public {
        vm.startPrank(alice);
        checkpoint.attest(ROOT_1, 1, 2, "");
        uint256 seq = checkpoint.attest(ROOT_2, 3, 4, "x");
        vm.stopPrank();
        assertEq(seq, 1);
        assertEq(checkpoint.checkpointCount(alice), 2);
    }

    function test_attest_revertsOnEmptyRoot() public {
        vm.prank(alice);
        vm.expectRevert("EarningsCheckpoint: empty root");
        checkpoint.attest(bytes32(0), 1, 2, "");
    }

    function test_attest_revertsOnBadWindow() public {
        vm.prank(alice);
        vm.expectRevert("EarningsCheckpoint: bad window");
        checkpoint.attest(ROOT_1, 10, 5, "");
    }

    function test_attestFor_onlyOwner() public {
        vm.prank(bob);
        vm.expectRevert();
        checkpoint.attestFor(alice, ROOT_1, 1, 2, "");
    }

    function test_attestFor_ownerOk() public {
        vm.prank(owner);
        uint256 seq = checkpoint.attestFor(alice, ROOT_1, 1, 2, "relayer");
        assertEq(seq, 0);
        (bytes32 root,,,,) = checkpoint.checkpoints(alice, 0);
        assertEq(root, ROOT_1);
    }

    function test_attestFor_revertsZeroSubject() public {
        vm.prank(owner);
        vm.expectRevert("EarningsCheckpoint: zero subject");
        checkpoint.attestFor(address(0), ROOT_1, 1, 2, "");
    }

    function test_latest_returnsNewest() public {
        vm.startPrank(alice);
        checkpoint.attest(ROOT_1, 1, 2, "a");
        checkpoint.attest(ROOT_2, 3, 4, "b");
        vm.stopPrank();

        EarningsCheckpoint.Checkpoint memory latest = checkpoint.latest(alice);
        assertEq(latest.root, ROOT_2);
        assertEq(latest.uri, "b");
    }

    function test_latest_revertsWhenNone() public {
        vm.expectRevert("EarningsCheckpoint: none");
        checkpoint.latest(alice);
    }
}
