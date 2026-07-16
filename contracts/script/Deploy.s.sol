// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {EarningsCheckpoint} from "../src/EarningsCheckpoint.sol";

/// @notice Deploy EarningsCheckpoint to Monad testnet (chain id 10143).
/// @dev forge script script/Deploy.s.sol:Deploy --rpc-url $MONAD_RPC_URL --broadcast --private-key $DEPLOYER_PK
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address initialOwner = vm.envOr("CHECKPOINT_OWNER", vm.addr(pk));

        vm.startBroadcast(pk);
        EarningsCheckpoint checkpoint = new EarningsCheckpoint(initialOwner);
        vm.stopBroadcast();

        console2.log("EarningsCheckpoint:", address(checkpoint));
        console2.log("owner:", initialOwner);
        console2.log("chainid:", block.chainid);
    }
}
