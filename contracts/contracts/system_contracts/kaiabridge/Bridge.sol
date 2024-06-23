// Copyright 2024 The klaytn Authors
// This file is part of the klaytn library.
//
// The klaytn library is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// The klaytn library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with the klaytn library. If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./IBridge.sol";
import "./IGuardian.sol";
import "./IOperator.sol";
import "./Bech32.sol";

contract KAIABridge is Initializable, ReentrancyGuardUpgradeable, UUPSUpgradeable, IERC165, IBridge, Bech32 {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    /// @dev Initialize the bridge contract state
    /// @param initOperator operator address
    /// @param initGuardian guardian address
    /// @param initJudge Judge contract address
    function initialize(address initOperator, address initGuardian, address initJudge, uint256 newMaxTryTransfer)
        public
        initializer
        notNull(initOperator)
        notNull(initGuardian)
        notNull(initJudge)
    {
        require(IERC165(initOperator).supportsInterface(type(IOperator).interfaceId), "KAIA::Bridger: Operator contract address does not implement IOperator");
        __ReentrancyGuard_init();
        bridgeServiceStarted = block.timestamp;
        bridgeServicePeriod = bridgeServiceStarted + 365 days;
        greatestConfirmedSeq = 0;
        nProvisioned = 0;
        judge = initJudge;
        addrValidationOn = true;
        minLockableKAIA = 5 * KAIA_UNIT;       // 5 KAIA
        maxLockableKAIA = 1000000 * KAIA_UNIT; // 1M KAIA
        seq = 1;
        nextProvisionSeq = 0;
        maxTryTransfer = newMaxTryTransfer;

        TRANSFERLOCK = 30 minutes;
        pause = false;
        operator = initOperator;
        guardian = initGuardian;
        transferFromKaiaOn = false;

        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyGuardian {}

    function supportsInterface(bytes4 interfaceId) external override pure returns (bool) {
        return interfaceId == type(IBridge).interfaceId;
    }

    function changeTransferEnable(bool set) external override onlyGuardian {
        emit TransferFromKaiaOnOffChanged(transferFromKaiaOn, set);
        transferFromKaiaOn = set;
    }

    /// @dev See {IBridge-provision}
    function provision(ProvisionData calldata prov)
        public
        override
        onlyOperator
        notPause
    {
        uint64 seq = prov.seq;
        require(!isProvisioned(seq), "KAIA::Bridge: A provision was submitted before");
        provisions[seq] = prov;
        nProvisioned += 1;
        updateGreatestConfirmedSeq(seq);
        updateNextSeq(seq, false);
        setTransferTimeLock(seq, TRANSFERLOCK);
        EnumerableSetUint64.setAdd(claimCandidates, seq);
        emit ProvisionConfirm(ProvisionConfirmedEvent({
            seq: seq,
            sender: prov.sender,
            receiver: prov.receiver,
            amount: prov.amount
        }));
        IOperator(operator).unmarkRevokeSeq(seq);
    }

    /// @dev request claim(mint) to KAIAPool contract
    /// @param seq Sequence number
    /// @param revertOnFail Make reverts if operations fails and the value is true, otherwise no make revert, but record its failure
    function doRequestClaim(uint64 seq, bool revertOnFail) internal returns (bool) {
        // `claim` may fail if the receiver is contract and has a heavy fallback
        bool success = claim(provisions[seq], revertOnFail);
        if (success) {
            claimed[seq] = true;
            nClaimed += 1;
            accumulatedClaimAmount += provisions[seq].amount;
            EnumerableSetUint64.setRemove(claimCandidates, seq);
            EnumerableSetUint64.setRemove(claimFailures, seq);
            return true;
        }
        return false;
    }

    /// @dev See {IBridge-requestClaim}
    function requestClaim(uint64 seq) public override returns (bool) {
        require(isProvisioned(seq), "KAIA::Bridge: No provisoned for corresponding sequence");
        require(!claimed[seq], "KAIA::Bridge: A provision corresponding the given sequence was already claimed");
        require(isPassedTimeLockDuration(seq), "KAIA::Bridge: TimeLock duration is not passed over");
        return doRequestClaim(seq, true);
    }

    /// @dev Same implementation with {IBridge-requestClaim}, but changed version of no reverted.
    function requestClaimNoRevert(uint64 seq, bool revertOnFail) internal returns (bool) {
        // Same condition with `requestClaim`
        if (!isProvisioned(seq) || claimed[seq] || !isPassedTimeLockDuration(seq)) {
            return false;
        }
        return doRequestClaim(seq, revertOnFail);
    }

    /// @dev See {IBridge-requestBatchClaim}
    function requestBatchClaim(uint64 range) public override {
        uint256 to = range;
        uint256 sl = EnumerableSetUint64.setLength(claimCandidates);
        if (range > sl) {
            to = sl;
        }
        uint64 idx = 0;
        for (uint64 i=0; i<to; i++) {
            if (!requestClaimNoRevert(EnumerableSetUint64.setAt(claimCandidates, idx), false)) {
                idx++;
            }
        }
    }

    /// @dev See {IBridge-removeProvision}
    function removeProvision(uint64 seq) public override onlyGuardian {
        require(isProvisioned(seq), "KAIA::Bridge: No provisoned for corresponding sequence");

        setTransferTimeLock(seq, 0);
        nProvisioned -= 1;
        updateGreatestConfirmedSeq(seq - 1);
        updateNextSeq(seq - 1, true);
        EnumerableSetUint64.setRemove(claimCandidates, seq);
        EnumerableSetUint64.setRemove(claimFailures, seq);
        transferFail[seq] = 0;
        emit RemoveProvision(provisions[seq]);
        delete provisions[seq];
        IOperator(operator).markRevokeSeq(seq);
    }

    /// @dev See {IBridge-resolveUnclaimabl}
    function resolveUnclaimable(uint64 seq, address newReceiver) public override onlyGuardian {
        require(isProvisioned(seq), "KAIA::Bridge: No provisoned for corresponding sequence");
        require(!claimed[seq], "KAIA::Bridge: A provision corresponding the given sequence was already claimed");
        require(isPassedTimeLockDuration(seq), "KAIA::Bridge: TimeLock duration is not passed over");
        require(EnumerableSetUint64.setContains(claimFailures, seq), "KAIA::Bridge: Must be in claim failure set");
        require(!isContract(newReceiver), "KAIA::Bridge: newReceiver must not be contract address");

        emit ProvisionReceiverChanged(provisions[seq].receiver, newReceiver);
        provisions[seq].receiver = newReceiver;
        doRequestClaim(seq, true);
    }

    /// @dev Update greatest sequence
    /// @param seq ProvisionData sequence
    function updateGreatestConfirmedSeq(uint256 seq) internal {
        if (greatestConfirmedSeq < seq) {
            greatestConfirmedSeq = seq;
        }
    }

    /// @dev Update next sequence per operator
    /// @param seq ProvisionData sequence number
    function updateNextSeq(uint64 seq, bool forceUpdate) internal {
        if (forceUpdate) {
            nextProvisionSeq = seq;
            return;
        }
        if (seq > 0 && nextProvisionSeq == seq - 1) {
            nextProvisionSeq = seq;
        }
    }

    /// @dev See {IBridge-changeMinLockableKAIA}
    function changeMinLockableKAIA(uint256 newMinLockableKAIA) public override onlyGuardian {
        emit MinLockableKAIAChange(minLockableKAIA, newMinLockableKAIA);
        minLockableKAIA = newMinLockableKAIA;
    }

    /// @dev See {IBridge-changeMaxLockableKAIA}
    function changeMaxLockableKAIA(uint256 newMaxLockableKAIA) public override onlyGuardian {
        emit MaxLockableKAIAChange(minLockableKAIA, newMaxLockableKAIA);
        maxLockableKAIA = newMaxLockableKAIA;
    }

    /// @dev See {IBridge-changeMaxTryTransfer}
    function changeMaxTryTransfer(uint256 newMaxTryTransfer) public override onlyGuardian {
        emit MaxTryTransferChange(maxTryTransfer, newMaxTryTransfer);
        maxTryTransfer = newMaxTryTransfer;
    }

    /// @dev See {IBridge-setAddrValidation}
    function setAddrValidation(bool onOff) public override onlyGuardian {
        emit ChangeAddrValidation(addrValidationOn, onOff);
        addrValidationOn = onOff;
    }

    /// @dev See {IBridge-changeBridgeServicePeriod}
    function changeBridgeServicePeriod(uint256 newPeriod) public override onlyGuardian {
        emit ChangeBridgeServicePeriod(bridgeServicePeriod, newPeriod);
        bridgeServicePeriod = newPeriod;
    }

    /// @dev See {IBridge-transfer}
    function transfer(string calldata receiver)
        public
        override
        payable
        nonReentrant
        notPause
        transferEnable
    {
        if (addrValidationOn) {
            require(verifyAddrFNSA(receiver, false), "KAIA::Bridge: Receiver address is invalid");
        }
        require(msg.value >= minLockableKAIA, "KAIA::Bridge: Locked KAIA must be larger than minimum");
        require(msg.value <= maxLockableKAIA, "KAIA::Bridge: Locked KAIA must be less than maximum");
        seq2BlockNum[seq] = block.number;
        SwapRequest memory swapReq = SwapRequest({
            seq: seq++,
            sender: msg.sender,
            receiver: receiver,
            amount: msg.value
        });
        locked.push(swapReq);
        emit Transfer(swapReq);
    }

    /// @dev record failed transfer history
    /// @param seq sequence number
    function recordTransferFailure(uint64 seq) internal {
        transferFail[seq]++;
        if (transferFail[seq] > maxTryTransfer) {
            EnumerableSetUint64.setRemove(claimCandidates, seq);
            EnumerableSetUint64.setAdd(claimFailures, seq);
        }
    }

    /// @dev Transfer KAIA to receiver with the specified amount in the provision
    /// @param prov ProvisionData
    /// @param revertOnFail Make reverts if operations fails and the value is true, otherwise no make revert, but record its failure
    function claim(ProvisionData memory prov, bool revertOnFail)
        internal
        nonReentrant
        returns (bool)
    {
        uint256 bridgeBalance = address(this).balance;
        bool isEnoughBalance = bridgeBalance > prov.amount;
        if (revertOnFail) {
            require(isEnoughBalance, "KAIA::Bridge: Bridge balance is not enough to transfer provision amount");
        } else {
            if (!isEnoughBalance) {
                recordTransferFailure(prov.seq);
                return false;
            }
        }

        // Allocate half of gas as available gas for the fallback code
        (bool sent, ) = prov.receiver.call{
            value: prov.amount,
            gas: gasleft() / 2
        }("");
        if (!sent) {
            if (revertOnFail) {
                revert("KAIA::Bridge: Failed to transfer amount of provision");
            }
            recordTransferFailure(prov.seq);
            return false;
        }
        emit Claim(prov);
        return true;
    }

    /// @dev See {IBridge-changeOperator}
    function changeOperator(address newOperator) public override onlyGuardian notNull(newOperator) {
        emit ChangeOperator(operator, newOperator);
        operator = newOperator;
    }

    /// @dev See {IBridge-changeGuardian}
    function changeGuardian(address newGuardian) public override onlyGuardian notNull(newGuardian) {
        emit ChangeGuardian(guardian, newGuardian);
        guardian = newGuardian;
    }

    /// @dev See {IBridge-changeJudge}
    function changeJudge(address newJudge) public override onlyGuardian notNull(newJudge) {
        emit ChangeJudge(judge, newJudge);
        judge = newJudge;
    }

    /// @dev See {IBridge-changeTransferTimeLock}
    function changeTransferTimeLock(uint256 duration) public override onlyGuardian {
        TRANSFERLOCK = duration;
        emit ChangeTransferTimeLock(TRANSFERLOCK);
    }

    /// @dev Set mintlock duration
    /// @param seq lcok sequence
    /// @param time to be assigned
    function setTransferTimeLock(uint256 seq, uint256 time) internal {
        timelocks[seq] = block.timestamp + time;
    }

    /// @dev See {IBridge-holdClaim}
    function holdClaim(uint256 seq) public override onlyJudge {
        setTransferTimeLock(seq, INFINITE);
        nTransferHolds += 1;
        emit HoldClaim(seq, INFINITE);
    }

    /// @dev See {IBridge-releaseClaim}
    function releaseClaim(uint256 seq) public override onlyGuardian {
        setTransferTimeLock(seq, 0);
        nTransferHolds -= 1;
        emit ReleaseClaim(seq, 0);
    }

    /// @dev See {IBridge-pauseBridge}
    function pauseBridge(string calldata pauseMsg) public override onlyGuardian notPause {
        pause = true;
        emit BridgePause(pauseMsg);
    }

    /// @dev See {IBridge-resumeBridge}
    function resumeBridge(string calldata resumeMsg) public override onlyGuardian inPause {
        pause = false;
        emit BridgeResume(resumeMsg);
    }

    /// @dev See {IBridge-isPassedTimeLockDuration}
    function isPassedTimeLockDuration(uint256 seq) public override view returns (bool) {
        return timelocks[seq] != 0 && timelocks[seq] < block.timestamp;
    }

    /// @dev Check if the address contains code
    /// @param addr address to be checked
    function isContract(address addr) internal view returns (bool) {
        uint32 size;
        assembly {
            size := extcodesize(addr)
        }
        return (size > 0);
    }

    /// @dev See {IBridge-isProvisioned}
    function isProvisioned(uint64 seq) public override view returns (bool) {
        return provisions[seq].seq > 0;
    }

    /// @dev See {IBridge-isProvisionedRange}
    function isProvisionedRange(uint64 from, uint64 to) public override view returns (uint64[] memory) {
        // Ignore the first dummy transaction
        if (from == 0) {
            from = 1;
        }
        if (to > nProvisioned) {
            to = uint64(nProvisioned) + 1;
        }
        uint64 n = uint64(to - from);
        uint64 cnt = 0;
        uint64[] memory temp = new uint64[](n);

        for (uint64 i=from; i<to; i++) {
            if (isProvisioned(i)) {
                temp[cnt++] = i;
            }
        }
        // fitting
        uint64[] memory provisionedRanges = new uint64[](cnt);
        for (uint64 i=0; i<cnt; i++) {
            provisionedRanges[i] = temp[i];
        }
        return provisionedRanges;
    }

    /// @dev See {IBridge-getAllSwapRequests}
    function getAllSwapRequests() public override view returns (SwapRequest[] memory) {
        return locked;
    }

    /// @dev See {IBridge-getSwapRequests}
    function getSwapRequests(uint256 from, uint256 to) public override view returns (SwapRequest[] memory) {
        require(to > from, "KAIA::Bridge: Invalid from and to");
        if (to > locked.length) {
            to = locked.length;
        }

        uint256 n = to - from;
        SwapRequest[] memory lockRange = new SwapRequest[](n);
        for (uint i=from; i<to; i++) {
            lockRange[i] = locked[i];
        }
        return lockRange;
    }

    /// @dev See {IBridge-bytes2Provision}
    function bytes2Provision(bytes calldata data) external override pure returns (ProvisionData memory) {
        return abi.decode(data[4:], (ProvisionData));
    }

    // @dev See {IBridge-getClaimCandidates}
    function getClaimCandidates() public override view returns (uint64[] memory) {
        return EnumerableSetUint64.getAll(claimCandidates);
    }

    // @dev See {IBridge-getClaimCandidates}
    function getClaimCandidatesSize() public override view returns (uint256) {
        return EnumerableSetUint64.setLength(claimCandidates);
    }

    // @dev See {IBridge-getClaimCandidatesRangePure}
    function getClaimCandidatesRangePure(uint64 range) public override view returns (uint64[] memory) {
        return EnumerableSetUint64.getRange(claimCandidates, range);
    }

    // @dev See {IBridge-getClaimCandidatesRange}
    function getClaimCandidatesRange(uint64 range) public override view returns (uint64[] memory) {
        uint64[] memory seqs = EnumerableSetUint64.getRange(claimCandidates, range);
        uint64[] memory candidates = new uint64[](range);
        uint256 cnt = 0;
        for (uint i=0; i<seqs.length; i++) {
            if (isPassedTimeLockDuration(seqs[i])) {
                candidates[cnt++] = seqs[i];
            }
        }
        assembly {
            mstore(candidates, cnt)
        }
        return candidates;
    }

    // @dev See {IBridge-getClaimFailures}
    function getClaimFailures() public override view returns (uint64[] memory) {
        return EnumerableSetUint64.getAll(claimFailures);
    }

    // @dev See {IBridge-getClaimFailuresRange}
    function getClaimFailuresRange(uint64 range) public override view returns (uint64[] memory) {
        return EnumerableSetUint64.getRange(claimFailures, range);
    }

    /// @dev Receive KAIA
    receive() external payable {
        emit KAIACharged(msg.sender, msg.value);
    }

    function burnBridgeBalance() public override onlyGuardian inPause nonReentrant {
        require(block.timestamp > bridgeServicePeriod, "KAIA::Bridge: Service period is not expired yet");
        uint256 bridgeBalance = address(this).balance;
        (bool sent, ) = BURN_TARGET.call{value: bridgeBalance}("");
        require(sent, "KAIA::Bridge: Failed to burn bridge balance");
        emit BridgeBalanceBurned(bridgeBalance);
    }

    /// @dev Return a contract version
    function getVersion() public pure returns (string memory) {
        return "0.0.1";
    }
}
