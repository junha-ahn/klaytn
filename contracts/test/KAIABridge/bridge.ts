import { expect } from "chai";
import { addTime, getBalance } from "../../test/common/helper";
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;
const YEAR = 365 * DAY;

describe("[Bridge Test]", function () {
  let bridge;
  let guardian;
  let operator;
  let judge;
  let minOperatorRequiredConfirm;
  let minGuardianRequiredConfirm;
  let operator1;
  let operator2;
  let operator3;
  let operator4;
  let guardian1;
  let guardian2;
  let guardian3;
  let guardian4;
  let judge1;
  let txID;
  let guardianTxID;

  let unknown;
  let sender;
  let receiver;
  let fnsaReceiver;
  let amount;
  let seq;
  let revertOnFail;
  let maxTryTransfer;

  beforeEach(async function () {
    upgrades.silenceWarnings()
    const [
      _operator1, _operator2, _operator3, _operator4, _unknown,
      _guardian1, _guardian2, _guardian3, _guardian4, _judge1
    ] = await ethers.getSigners();
    operator1 = _operator1;
    operator2 = _operator2;
    operator3 = _operator3;
    operator4 = _operator4;
    guardian1 = _guardian1;
    guardian2 = _guardian2;
    guardian3 = _guardian3;
    guardian4 = _guardian4;
    judge1 = _judge1;
    unknown = _unknown;
    minOperatorRequiredConfirm = 3;
    minGuardianRequiredConfirm = 3;
    revertOnFail = true;
    maxTryTransfer = 3;

    const accs = [operator1, operator2, operator3, operator4, guardian1, guardian2, guardian3, guardian4, judge1];
    for (let acc of accs) {
      await hre.network.provider.send("hardhat_setBalance", [
        acc.address,
        "0x1000000000000000000000000000000000000",
      ]);
    }

    const guardianFactory = await ethers.getContractFactory("Guardian");
    guardian = await upgrades.deployProxy(guardianFactory, [[
      guardian1.address,
      guardian2.address,
      guardian3.address,
      guardian4.address,
    ], minGuardianRequiredConfirm]);

    const operatorFactory = await ethers.getContractFactory("Operator");
    operator = await upgrades.deployProxy(operatorFactory, [[
      operator1.address,
      operator2.address,
      operator3.address,
      operator4.address,
    ], guardian.address, minOperatorRequiredConfirm]);

    const judgeFactory = await ethers.getContractFactory("Judge");
    judge = await upgrades.deployProxy(judgeFactory, [[
      judge1.address
    ], guardian.address, 1]);

    const bridgeFactory = await ethers.getContractFactory("KAIABridge");
    bridge = await upgrades.deployProxy(bridgeFactory, [
      operator.address, guardian.address, judge.address, maxTryTransfer
    ]);

    await hre.network.provider.send("hardhat_setBalance", [
      bridge.address,
      "0x1000000000000000000000000000000000000",
    ]);

    // contract initialization
    let rawTxData = (await operator.populateTransaction.changeBridge(bridge.address)).data;
    await guardian.connect(guardian1).submitTransaction(operator.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(1);
    await expect(guardian.connect(guardian3).confirmTransaction(1))
      .to.emit(operator, "ChangeBridge");

    rawTxData = (await bridge.populateTransaction.changeTransferEnable(true)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(2);
    await expect(guardian.connect(guardian3).confirmTransaction(2))
      .to.emit(bridge, "TransferFromKaiaOnOffChanged");
    guardianTxID = 3;

    sender = "0x0000000000000000000000000000000000000123";
    receiver = "0x0000000000000000000000000000000000000456";
    fnsaReceiver = "link1e9r6el8f9um7xcldd6ne8hglavetuq6tgfgeym";
    amount = 1;
    seq = 1;

    txID = 1;
  })

  it("#seq test", async function () {
    const provision = [seq, sender, receiver, amount];
    expect((await operator.getConfirmations(txID)).length).to.equal(0);
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID);
    await operator.connect(operator3).confirmTransaction(txID);
    expect((await operator.getConfirmations(txID)).length).to.equal(3);
    expect(await bridge.greatestConfirmedSeq()).to.equal(1);
  });

  it("#provision event emission", async function () {
    let provision = [seq, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;

    // 1. by ConfirmTransaction
    await expect(operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0))
      .to.emit(operator, "Provision")
    await expect(operator.connect(operator2).confirmTransaction(txID))
      .to.emit(operator, "Provision")
    await expect(operator.connect(operator3).confirmTransaction(txID))
      .to.emit(operator, "Provision")
      .to.emit(bridge, "ProvisionConfirm")

    // 2. by submitTransaction
    provision = [seq + 1, sender, receiver, amount];
    rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await expect(operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0))
      .to.emit(operator, "Provision")
    await expect(operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0))
      .to.emit(operator, "Provision")
    await expect(operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0))
      .to.emit(operator, "Provision")
      .to.emit(bridge, "ProvisionConfirm")

    const [nPending, nExecuted] = await operator.getTransactionCount(true, true);
    await expect(Number(nPending) + Number(nExecuted)).to.be.equal(2);
  });

  it("#operator per greatest submitted sequence lookup", async function () {
    async function sendProvision(op, prov) {
      let rawTxData = (await bridge.populateTransaction.provision(prov)).data;
      await operator.connect(op).submitTransaction(bridge.address, rawTxData, 0);
    }

    let provision = [seq, sender, receiver, amount];
    await sendProvision(operator1, provision);

    seq += 1;
    provision = [seq, sender, receiver, amount];
    await sendProvision(operator2, provision);

    seq += 1;
    provision = [seq, sender, receiver, amount];
    await sendProvision(operator3, provision);

    seq += 1;
    provision = [seq, sender, receiver, amount];
    await sendProvision(operator4, provision);

    expect(await operator.greatestSubmittedSeq(operator1.address)).to.be.equal(1);
    expect(await operator.greatestSubmittedSeq(operator2.address)).to.be.equal(2);
    expect(await operator.greatestSubmittedSeq(operator3.address)).to.be.equal(3);
    expect(await operator.greatestSubmittedSeq(operator4.address)).to.be.equal(4);

    seq += 1;
    provision = [seq, sender, receiver, amount];
    await sendProvision(operator1, provision);

    expect(await operator.greatestSubmittedSeq(operator1.address)).to.be.equal(5);
  });

  it("#mintlock test", async function () {
    expect(await bridge.timelocks(1)).to.equal(0);
    const provision = [seq, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID);
    await operator.connect(operator3).confirmTransaction(txID);
    expect(await bridge.timelocks(1)).to.not.equal(0);

    const mintLock = Number(await bridge.TRANSFERLOCK());
    let setTime = mintLock - 2;
    await addTime(setTime);
    await expect(bridge.requestClaim(seq))
      .to.be.revertedWith("KAIA::Bridge: TimeLock duration is not passed over")
    expect(await getBalance(receiver)).to.equal(0n);

    setTime = mintLock;
    await addTime(setTime);
    await bridge.requestClaim(seq);
    expect(await getBalance(receiver)).to.equal(BigInt(amount));
  });

  it("#authroization test - provision", async function () {
    const provision = [seq, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    expect(operator.connect(unknown).submitTransaction(bridge.address, rawTxData, 0))
      .to.be.revertedWith("KAIA::Operator: Not an operator");

    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await expect(operator.connect(unknown).confirmTransaction(txID))
      .to.be.revertedWith("KAIA::Operator: Not an operator");
  });

  it("#authroization test - requestClaim", async function () {
    expect(await bridge.TRANSFERLOCK()).to.equal(HOUR / 2);
    let rawTxData = (await bridge.populateTransaction.changeTransferTimeLock(
      DAY
    )).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await expect(guardian.connect(unknown).confirmTransaction(guardianTxID))
      .to.be.revertedWith("KAIA::Guardian: Not an guardian");
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);
    expect(await bridge.TRANSFERLOCK()).to.equal(DAY);
  });

  it("#verifiable test - is provisioned?", async function () {
    const provision = [seq, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    expect(await bridge.isProvisioned(seq)).to.equal(false);
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID);
    await operator.connect(operator3).confirmTransaction(txID);
    expect(await bridge.isProvisioned(seq)).to.equal(true);
  });

  it("#transfer test - trying double minting", async function () {
    const provision = [seq, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID);
    await operator.connect(operator3).confirmTransaction(txID);

    const mintLock = Number(await bridge.TRANSFERLOCK());
    await addTime(mintLock);
    await bridge.requestClaim(seq);
    await expect(bridge.requestClaim(seq))
      .to.be.revertedWith("KAIA::Bridge: A provision corresponding the given sequence was already claimed");
  });

  it("#transfer test - not verified provision", async function () {
    const mintLock = Number(await bridge.TRANSFERLOCK());
    await addTime(mintLock);
    await expect(bridge.requestClaim(seq))
      .to.be.revertedWith("KAIA::Bridge: No provisoned for corresponding sequence");
  });

  it("#transfer test - execution fail by fallback code(contract receiver)", async function () {
    revertOnFail = false;
    const C = await ethers.deployContract("C");

    const provision = [seq, sender, C.address, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID);
    await operator.connect(operator3).confirmTransaction(txID);

    const mintLock = Number(await bridge.TRANSFERLOCK());
    const setTime = mintLock;
    await addTime(setTime);

    const gasBig = 30000000;
    const gasSmall = 300000;

    expect(await bridge.transferFail(seq)).to.equal(0);
    // `revertOnFail` is fixed with `true` in `requestClaim`
    await expect(bridge.requestClaim(seq, {gasLimit: gasSmall}))
      .to.be.revertedWith("KAIA::Bridge: Failed to transfer amount of provision");

    // `revertOnFail` is fixed with `false` in `requestBatchClaim`
    await bridge.requestBatchClaim(1, {gasLimit: gasSmall})
    expect(await bridge.transferFail(seq)).to.equal(1);

    // success
    await bridge.requestClaim(seq, {gasLimit: gasBig})
  });

  it("#txid test - same sequence does not make another transaction", async function () {
    const provision = [seq, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    let [nPending, ] = await operator.getTransactionCount(true, true);
    expect(nPending).to.equal(0);

    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    [nPending, ] = await operator.getTransactionCount(true, true);
    expect(nPending).to.equal(1);
    expect(await operator.getConfirmationCount(txID)).to.equal(1);

    await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
    [nPending, ] = await operator.getTransactionCount(true, true);
    expect(nPending).to.equal(1);
    expect(await operator.getConfirmationCount(txID)).to.equal(2);
  });

  it("#A tx ID that has different provision (same sequence) is not voted by honest operators", async function () {
    const trueProvision = [seq, sender, receiver, amount];
    const forgedProvision = [seq, sender, receiver, 123];
    let trueTxData = (await bridge.populateTransaction.provision(trueProvision)).data;
    let forgedTxData = (await bridge.populateTransaction.provision(forgedProvision)).data;

    expect((await operator.getConfirmations(1)).length).to.equal(0);
    expect((await operator.getConfirmations(2)).length).to.equal(0);

    await operator.connect(operator1).submitTransaction(bridge.address, forgedTxData, 0);
    await operator.connect(operator2).submitTransaction(bridge.address, trueTxData, 0);

    expect((await operator.getConfirmations(1)).length).to.equal(1);
    expect((await operator.getConfirmations(2)).length).to.equal(1);

  });

  it("#exception: first transaction is occupied as dummy transaction", async function () {
    let [nPending, nExecuted] = await operator.getTransactionCount(true, true);
    expect(nPending).to.equal(0);
    expect(nExecuted).to.equal(0);

    const provision = [seq, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    expect((await operator.getConfirmations(0)).length).to.equal(0);
    expect((await operator.getConfirmations(1)).length).to.equal(1);
  });

  it("#error reasoning coverage - ilegal calldata", async function () {
    let rawTxData = "0x00";
    await expect(operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0))
    .to.be.revertedWith("Calldata length must be larger than 4bytes")
  });

  it("#error reasoning coverage - no specific error message", async function () {
    let rawTxData = "0x00000000";
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID);

    // If raw data is wrong (in this case the selector does not correspond any function)
    // Exception should be raised with empty reason string
    await expect(operator.connect(operator3).confirmTransaction(txID))
      .to.be.revertedWith("");
  });

  it("#claim hold", async function () {
    const provision = [seq, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(1);
    await operator.connect(operator3).confirmTransaction(1);

    expect(await bridge.timelocks(seq)).to.lte(await time.latest() + HOUR / 2);

    rawTxData = (await bridge.populateTransaction.holdClaim(seq)).data;
    await judge.connect(judge1).submitTransaction(bridge.address, rawTxData, 0);

    expect(await bridge.timelocks(seq)).to.gte(await time.latest() + YEAR * 1000);
  });

  it("#minting release", async function () {
    const provision = [seq, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(1);
    await operator.connect(operator3).confirmTransaction(1);

    expect(await bridge.timelocks(seq)).to.lte(await time.latest() + HOUR / 2);

    rawTxData = (await bridge.populateTransaction.holdClaim(seq)).data;
    await judge.connect(judge1).submitTransaction(bridge.address, rawTxData, 0);
    expect(await bridge.timelocks(seq)).to.gte(await time.latest() + YEAR * 1000);

    rawTxData = (await bridge.populateTransaction.releaseClaim(seq)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);
    expect(await bridge.timelocks(seq)).to.lte(await time.latest());
  });

  it("#bridge pause - transfer is not available", async function () {
    // `transfer()` is available before paused
    await expect(bridge.transfer(fnsaReceiver, {value: await bridge.minLockableKAIA()}))
      .to.emit(bridge, "Transfer");

    expect(await bridge.pause()).to.equal(false);

    let rawTxData = (await bridge.populateTransaction.pauseBridge("Bridge paused temporally")).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);

    expect(await bridge.pause()).to.equal(true);

    // `transfer()` is not available after paused
    await expect(bridge.transfer(fnsaReceiver, {value: await bridge.minLockableKAIA()}))
      .to.revertedWith("KAIA::Bridge: Bridge has been paused");
  });

  it("#bridge pause - provision is not available", async function () {
    let rawTxData = (await bridge.populateTransaction.pauseBridge("Bridge paused temporally")).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);

    const provision = [seq, sender, receiver, amount];
    rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(1);
    await expect(operator.connect(operator3).confirmTransaction(1))
      .to.revertedWith("KAIA::Bridge: Bridge has been paused");
  });

  it("#bridge pause - resume", async function () {
    // pause first
    let rawTxData = (await bridge.populateTransaction.pauseBridge("Bridge paused temporally")).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);
    expect(await bridge.pause()).to.equal(true);

    const provision = [seq, sender, receiver, amount];
    rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(1);
    await expect(operator.connect(operator3).confirmTransaction(1))
      .to.revertedWith("KAIA::Bridge: Bridge has been paused");

    // resume
    rawTxData = (await bridge.populateTransaction.resumeBridge("Bridge resumed")).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 1);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID + 1);
    expect(await bridge.pause()).to.equal(false);

    await expect(operator.connect(operator3).confirmTransaction(1))
      .to.emit(operator, "Execution");
  });

  it("#query unsubmitted sequence number", async function () {
    const seqs = [7, 8, 12];
    for (let seq of seqs) {
      let provision = [seq, sender, receiver, amount];
      let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    }

    let range = 6;
    let unprovisionedFromOp1 = await operator.getUnconfirmedProvisionSeqs(operator1.address, range);
    expect(unprovisionedFromOp1).to.deep.equal([1,2,3,4,5]);

    range = 11;
    unprovisionedFromOp1 = await operator.getUnconfirmedProvisionSeqs(operator1.address, range);
    expect(unprovisionedFromOp1).to.deep.equal([1,2,3,4,5,6,9,10]);

    range = 15;
    unprovisionedFromOp1 = await operator.getUnconfirmedProvisionSeqs(operator1.address, range);
    expect(unprovisionedFromOp1).to.deep.equal([1,2,3,4,5,6,9,10,11,13,14]);
  })

  it("#unsubmitted sequence search (case: the returned sequence list differs per operator)", async function () {
    const range = 10;
    let provisioned = [3, 5, 8];

    // operator1 and operator2 submitted all provision txs
    // operator3 lacks 6 provision txs.
    for (let i=range; i>=1; i--) { // == for (let i=1; i<=range; i++)
      const provision = [i, sender, receiver, amount];
      let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
      if (provisioned.indexOf(i) !== -1) {
        await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
      }
    }

    const unprovisionedFromOp1 = await operator.getUnconfirmedProvisionSeqs(operator1.address, range);
    const unprovisionedFromOp2 = await operator.getUnconfirmedProvisionSeqs(operator2.address, range);
    let unprovisionedFromOp3 = await operator.getUnconfirmedProvisionSeqs(operator3.address, range);
    let unprovisionedFromOp4 = await operator.getUnconfirmedProvisionSeqs(operator4.address, range);

    expect(unprovisionedFromOp1).to.deep.equal([]);
    expect(unprovisionedFromOp2).to.deep.equal([]);
    expect(unprovisionedFromOp3).to.deep.equal([1,2,4,6,7,9]);
    expect(unprovisionedFromOp4).to.deep.equal([1,2,4,6,7,9]);
    expect(await bridge.nProvisioned()).to.equal(provisioned.length);

    // operator3 sends provision txs against unsent before
    for (let i=0; i<unprovisionedFromOp3.length; i++) {
      const seq = unprovisionedFromOp3[i];
      const provision = [seq, sender, receiver, amount];
      let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
      await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
    }

    unprovisionedFromOp3 = await operator.getUnconfirmedProvisionSeqs(operator3.address, range);
    unprovisionedFromOp4 = await operator.getUnconfirmedProvisionSeqs(operator4.address, range);
    expect(unprovisionedFromOp1).to.deep.equal([]);
    expect(unprovisionedFromOp2).to.deep.equal([]);
    expect(unprovisionedFromOp3).to.deep.equal([]);
    expect(unprovisionedFromOp4).to.deep.equal([]);
    expect(await bridge.nProvisioned()).to.equal(range - 1);
  });

  it("#unsubmitted sequence search (case: fake provision confrimed -> remove(revoke) provision -> true provision confirmed", async function () {
    const maliciousOperators = [operator1, operator2, operator3];
    const fakeProvision = [seq, sender, receiver, amount * 2];

    // fake provision by single malicious operator
    let rawTxData = (await bridge.populateTransaction.provision(fakeProvision)).data;
    await operator.connect(maliciousOperators[0]).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(maliciousOperators[1]).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(maliciousOperators[2]).submitTransaction(bridge.address, rawTxData, 0);

    const range = seq + 1;
    // operator1 submitted the provision tx
    let unprovisionedFromOp1 = await operator.getUnconfirmedProvisionSeqs(operator1.address, range);
    // operator1 did not submit the provision tx
    let unprovisionedFromOp4 = await operator.getUnconfirmedProvisionSeqs(operator4.address, range);
    expect(unprovisionedFromOp1).to.deep.equal([])
    expect(unprovisionedFromOp1).to.deep.equal(unprovisionedFromOp4)

    // Remove fake provision by guardian
    const removeProvisionSeq = seq;
    const removeProvisionRawData = (await bridge.populateTransaction.removeProvision(removeProvisionSeq)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, removeProvisionRawData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);

    unprovisionedFromOp1 = await operator.getUnconfirmedProvisionSeqs(operator1.address, range);
    unprovisionedFromOp4 = await operator.getUnconfirmedProvisionSeqs(operator4.address, range);
    expect(unprovisionedFromOp1).to.deep.equal([1])
    expect(unprovisionedFromOp4).to.deep.equal([1])

    // Inject true provision
    const honestOperators = [operator1, operator2, operator3];
    const trueProvision = [seq, sender, receiver, amount];
    rawTxData = (await bridge.populateTransaction.provision(trueProvision)).data;
    await operator.connect(honestOperators[0]).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(honestOperators[1]).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(honestOperators[2]).submitTransaction(bridge.address, rawTxData, 0);

    unprovisionedFromOp1 = await operator.getUnconfirmedProvisionSeqs(operator1.address, range);
    unprovisionedFromOp4 = await operator.getUnconfirmedProvisionSeqs(operator4.address, range);
    expect(unprovisionedFromOp1).to.deep.equal([])
    expect(unprovisionedFromOp4).to.deep.equal([])

    // The above scanrio simulates the path
    //    fake provision confirm -> remove(revoke) the fake provision -> inject true provision
    // The reverse path cannot exist e.g.,
    //    true provision confirm -> remove(revoke) the true provision -> inject fake provision
    //    because the guardian does not remove the confirmed true provision
  });

  it("#unsubmitted sequence search (case: introduce a new operator)", async function () {
    const allSeqs = [1,4,8,2,5,3,9,6,10,7];
    let provisioned = [1,2,3,4,5];

    for (let i=0; i<allSeqs.length; i++) { // == for (let i=1; i<=range; i++)
      const provision = [allSeqs[i], sender, receiver, amount];
      let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
      if (provisioned.indexOf(allSeqs[i]) !== -1) {
        await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
      }
    }

    expect(await bridge.isProvisionedRange(0, 10)).to.deep.equals([1,2,3,4,5])
    const operatorCandidate = unknown;

    // add new operator
    let rawTxData = (await operator.populateTransaction.addOperator(operatorCandidate.address)).data;
    await guardian.connect(guardian1).submitTransaction(operator.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);

    expect(await operator.unsubmittedNextSeq(operatorCandidate.address)).to.be.equal(0);
    let unprovisionedFromNewOp = await operator.getUnconfirmedProvisionSeqs(operatorCandidate.address, allSeqs.length);
    expect(unprovisionedFromNewOp).to.deep.equal([6,7,8,9])

    const unsubmitted = allSeqs.filter(seq => !provisioned.includes(seq));
    for (let seq of unsubmitted) { // == for (let i=1; i<=range; i++)
      const provision = [seq, sender, receiver, amount];
      let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
      await operator.connect(operatorCandidate).submitTransaction(bridge.address, rawTxData, 0);
    }
    unprovisionedFromNewOp = await operator.getUnconfirmedProvisionSeqs(operatorCandidate.address, allSeqs.length);
    expect(unprovisionedFromNewOp).to.deep.equal([])
    expect(await bridge.isProvisionedRange(0, 10)).to.deep.equals([1,2,3,4,5,6,7,8,9])
  });

  it("#unprovision seqeunce search (inorder)", async function () {
    const inordered = [1,4,8,2,5,3,9,6,10,7];
    let provisioned = [3, 5, 8];

    for (let i=0; i<inordered.length; i++) { // == for (let i=1; i<=range; i++)
      const provision = [inordered[i], sender, receiver, amount];
      let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
      if (provisioned.indexOf(i) !== -1) {
        await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
      }
    }
    let unprovisionedFromOp3 = await operator.getUnconfirmedProvisionSeqs(operator3.address, inordered.length);
    expect(unprovisionedFromOp3).to.deep.equal([1,4,5,6,7,8,9])
  });

  it("#unprovisioned sequence search (case: range > # of txs)", async function () {
    const range = 10;
    const nTxs = 5;

    for (let i=1; i<=nTxs; i++) {
      const provision = [i, sender, receiver, amount];
      let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    }

    const unprovisionedFromOp1 = await operator.getUnconfirmedProvisionSeqs(operator1.address, range);
    expect(unprovisionedFromOp1).to.deep.equal([6,7,8,9]);
  })

  it("#unprovisioned next sequence update (case: normal scenario)", async function () {
    const rangeFrom = 1;
    const windowSize = 10;
    const rangeTo = 30;

    async function sendProvisionTx(op, seq) {
      const provision = [seq, sender, receiver, amount];
      let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
      await operator.connect(op).submitTransaction(bridge.address, rawTxData, 0);
    }

    // only two operators send provision txs initially.
    for (let i=rangeFrom; i<=rangeTo; i++) {
      await sendProvisionTx(operator1, i);
      await sendProvisionTx(operator2, i);
    }

    // initial state
    const operators = [operator1, operator2, operator3, operator4];
    let unsubmittedNextseq = [];
    for (let i=0; i<operators.length; i++) {
      unsubmittedNextseq[i] = await operator.unsubmittedNextSeq(operators[i].address);
      expect(unsubmittedNextseq[i]).to.be.equal(0);
    }

    let unprovisionedFromOp1 = await operator.getUnconfirmedProvisionSeqs(operators[0].address, windowSize);
    let unprovisionedFromOp2 = await operator.getUnconfirmedProvisionSeqs(operators[1].address, windowSize);
    let unprovisionedFromOp3 = await operator.getUnconfirmedProvisionSeqs(operators[2].address, windowSize);
    let unprovisionedFromOp4 = await operator.getUnconfirmedProvisionSeqs(operators[2].address, windowSize);
    expect(unprovisionedFromOp1).to.deep.equal([])
    expect(unprovisionedFromOp2).to.deep.equal([])
    expect(unprovisionedFromOp3).to.deep.equal([1,2,3,4,5,6,7,8,9])
    expect(unprovisionedFromOp4).to.deep.equal([1,2,3,4,5,6,7,8,9])

    async function searchAndUpdate(op) {
      let unprovisioned = await operator.getUnconfirmedProvisionSeqs(op.address, windowSize);
      expect(unprovisioned).to.deep.equal([]);
      const nextSeq = await operator.unsubmittedNextSeq(op.address);
      await operator.connect(op).updateNextUnsubmittedSeq(Number(nextSeq) + Number(windowSize));
    }

    // operator3 sends provision tx and now all this range of txs are executed
    for (let i=rangeFrom; i<=rangeTo; i++) {
      await sendProvisionTx(operator3, i);
    }
    unprovisionedFromOp3 = await operator.getUnconfirmedProvisionSeqs(operators[2].address, windowSize);
    unprovisionedFromOp4 = await operator.getUnconfirmedProvisionSeqs(operators[3].address, windowSize);
    expect(unprovisionedFromOp3).to.deep.equal([])
    expect(unprovisionedFromOp4).to.deep.equal([])

    expect(await operator.unsubmittedNextSeq(operator1.address)).to.be.equal(0);
    expect(await operator.unsubmittedNextSeq(operator2.address)).to.be.equal(0);
    expect(await operator.unsubmittedNextSeq(operator3.address)).to.be.equal(0);
    expect(await operator.unsubmittedNextSeq(operator4.address)).to.be.equal(0);

    await searchAndUpdate(operator1);
    await searchAndUpdate(operator2);
    await searchAndUpdate(operator3);
    // // operator4 did not send provision tx before, but they are already executed. Thus, no further sending is not required
    await searchAndUpdate(operator4);

    expect(await operator.unsubmittedNextSeq(operator1.address)).to.be.equal(10);
    expect(await operator.unsubmittedNextSeq(operator2.address)).to.be.equal(10);
    expect(await operator.unsubmittedNextSeq(operator3.address)).to.be.equal(10);
    expect(await operator.unsubmittedNextSeq(operator4.address)).to.be.equal(10);

    await searchAndUpdate(operator1);
    await searchAndUpdate(operator2);
    await searchAndUpdate(operator3);
    await searchAndUpdate(operator4);

    expect(await operator.unsubmittedNextSeq(operator1.address)).to.be.equal(20);
    expect(await operator.unsubmittedNextSeq(operator2.address)).to.be.equal(20);
    expect(await operator.unsubmittedNextSeq(operator3.address)).to.be.equal(20);
    expect(await operator.unsubmittedNextSeq(operator4.address)).to.be.equal(20);

    await searchAndUpdate(operator1, 30);
    await searchAndUpdate(operator2, 30);
    await searchAndUpdate(operator3, 30);
    await searchAndUpdate(operator4, 30);

    expect(await operator.unsubmittedNextSeq(operator1.address)).to.be.equal(30);
    expect(await operator.unsubmittedNextSeq(operator2.address)).to.be.equal(30);
    expect(await operator.unsubmittedNextSeq(operator3.address)).to.be.equal(30);
    expect(await operator.unsubmittedNextSeq(operator4.address)).to.be.equal(30);
  });


  it("#A couple of transaction may correspond to the same sequence number by malicious submission", async function () {
    const maliciousOperator = operator4;
    const honestOperators = [operator1, operator2, operator3];
    const provision     = [seq, sender, receiver, amount];
    const fakeProvision = [seq, sender, receiver, amount * 2];

    // fake provision by single malicious operator
    let rawTxData = (await bridge.populateTransaction.provision(fakeProvision)).data;
    await operator.connect(maliciousOperator).submitTransaction(bridge.address, rawTxData, 0);
    expect(await operator.txID2Seq(txID)).to.equal(1)

    rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(honestOperators[0]).submitTransaction(bridge.address, rawTxData, 0);
    expect(await operator.txID2Seq(txID + 1)).to.equal(1)
    expect(await operator.txID2Seq(txID + 2)).to.equal(0)
  });

  it("#single claim", async function () {
    async function sendProvision(prov) {
      let rawTxData = (await bridge.populateTransaction.provision(prov)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
    }

    for (let i=1; i<10; i++) {
      let provision = [i, sender, receiver, amount];
      await sendProvision(provision);
    }

    expect(await bridge.nClaimed()).to.be.equal(0);

    const mintLock = Number(await bridge.TRANSFERLOCK());
    await addTime(mintLock);

    for (let i=1; i<10; i++) {
      await bridge.requestClaim(i);
    }
    expect(await bridge.nClaimed()).to.gt(0);
  });

  it("#multiple claims", async function () {
    async function sendProvision(prov) {
      let rawTxData = (await bridge.populateTransaction.provision(prov)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
    }

    for (let i=1; i<10; i++) {
      let provision = [i, sender, receiver, amount];
      await sendProvision(provision);
    }

    expect(await bridge.nClaimed()).to.be.equal(0);

    const mintLock = Number(await bridge.TRANSFERLOCK());
    await addTime(mintLock);
    await bridge.requestBatchClaim(10);

    expect(await bridge.nClaimed()).to.gt(0);
  });

  it("#multiple claims (inorder)", async function () {
    const inordered = [1,4,8,2,5,3,9,6,10,7];
    let provisioned = [1,2,3,4,5,6,7];

    for (let i=0; i<inordered.length; i++) { // == for (let i=1; i<=range; i++)
      const provision = [inordered[i], sender, receiver, amount];
      let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
      if (provisioned.indexOf(inordered[i]) !== -1) {
        await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
      }
    }

    const mintLock = Number(await bridge.TRANSFERLOCK());
    await addTime(mintLock);

    expect(await bridge.getClaimCandidates()).to.deep.equal([1, 4, 2, 5, 3, 6, 7])
    await bridge.requestBatchClaim(3);
    expect(await bridge.getClaimCandidates()).to.deep.equal([3, 4, 2, 5])
    await bridge.requestBatchClaim(2);
    expect(await bridge.getClaimCandidates()).to.deep.equal([2, 4]);
    await bridge.requestBatchClaim(2);
    expect(await bridge.getClaimCandidates()).to.deep.equal([]);
  });

  it("#multiple claims (case: holding exists in the middle)", async function () {
    async function sendProvision(prov) {
      let rawTxData = (await bridge.populateTransaction.provision(prov)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
    }

    const n = 20;
    for (let i=n-1; i>0; i--) { // == for (let i=1; i<n; i++)
      let provision = [i, sender, receiver, amount];
      await sendProvision(provision);
    }

    const mintLock = Number(await bridge.TRANSFERLOCK());
    await addTime(mintLock);

    // hold seq 15
    const holdSeq = 15;
    let rawTxData = (await bridge.populateTransaction.holdClaim(holdSeq)).data;
    await judge.connect(judge1).submitTransaction(bridge.address, rawTxData, 0);

    expect(await bridge.nTransferHolds()).to.be.equal(1)

    const N = 100;
    await bridge.requestBatchClaim(N);
    expect(await bridge.getClaimCandidates()).to.deep.equal([holdSeq]);
    expect(await bridge.getClaimCandidatesRangePure(100)).to.deep.equal([holdSeq]);
    expect(await bridge.getClaimCandidatesRangePure(1)).to.deep.equal([holdSeq]);
    expect(await bridge.getClaimCandidatesRange(100)).to.deep.equal([])

    // release seq 15
    rawTxData = (await bridge.populateTransaction.releaseClaim(holdSeq)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);
    expect(await bridge.nTransferHolds()).to.be.equal(0)
    expect(await bridge.nClaimed()).to.equal(n - 2);

    expect(await bridge.getClaimCandidatesRange(100)).to.deep.equal([])
    await addTime(1);
    expect(await bridge.getClaimCandidatesRange(100)).to.deep.equal([BigInt(holdSeq)])

    expect(await bridge.nClaimed()).to.equal(n - 2);

    await bridge.requestBatchClaim(N);
    expect(await bridge.nClaimed()).to.equal(n - 1);
    await bridge.requestBatchClaim(N);
    expect(await bridge.nClaimed()).to.equal(n - 1);
    expect(await bridge.getClaimCandidates()).to.deep.equal([]);
  });

  it("#multiple claims may fail by the parameter range or allowed gas limit", async function () {
    async function sendProvision(prov) {
      let rawTxData = (await bridge.populateTransaction.provision(prov)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
    }

    const n = 50;
    for (let i=1; i<n; i++) {
      let provision = [i, sender, receiver, amount];
      await sendProvision(provision);
    }

    const mintLock = Number(await bridge.TRANSFERLOCK());
    await addTime(mintLock);

    const receiverBalance = await getBalance(receiver);

    // OOG test
    expect(await bridge.nClaimed()).to.be.equal(0);
    await bridge.requestBatchClaim(1, {gasLimit: 200000})
    expect(await bridge.nClaimed()).to.be.equal(1);
    expect(await getBalance(receiver)).to.be.equal(BigInt(Number(receiverBalance) + 1));

    await expect(bridge.requestBatchClaim(5, {gasLimit: 200000}))
      .to.be.reverted;
    expect(await bridge.nClaimed()).to.be.equal(1)
    expect(await getBalance(receiver)).to.be.equal(BigInt(Number(receiverBalance) + 1));

    // await bridge.requestBatchClaim(5, {gasLimit: 500000})
    await bridge.requestBatchClaim(5, {gasLimit: 600000})
    expect(await bridge.nClaimed()).to.be.equal(6)
    expect(await getBalance(receiver)).to.be.equal(BigInt(Number(receiverBalance) + 6));

    await expect(bridge.requestBatchClaim(10, {gasLimit: 600000}))
      .to.be.reverted;
    expect(await bridge.nClaimed()).to.be.equal(6)
    expect(await getBalance(receiver)).to.be.equal(BigInt(Number(receiverBalance) + 6));

    await bridge.requestBatchClaim(10, {gasLimit: 1200000})
    expect(await bridge.nClaimed()).to.be.equal(16)
    expect(await getBalance(receiver)).to.be.equal(BigInt(Number(receiverBalance) + 16));
  });

  it("#Confirmed provision (by compromised operator group) can be removed and true provision can be confrimed eventually", async function () {
    const fakeProvision = [seq, sender, receiver, amount * 2];
    const fakeProvisionRawData = (await bridge.populateTransaction.provision(fakeProvision)).data;

    expect(await bridge.isProvisioned(seq)).to.be.equal(false)

    // malicious provision was confirmed by compromised operator group
    await operator.connect(operator1).submitTransaction(bridge.address, fakeProvisionRawData, 0);
    await operator.connect(operator2).submitTransaction(bridge.address, fakeProvisionRawData, 0);
    await operator.connect(operator3).submitTransaction(bridge.address, fakeProvisionRawData, 0);
    expect(await bridge.isProvisioned(seq)).to.be.equal(true)
    expect(await bridge.nProvisioned()).to.be.equal(1);

    // confirmed provision can be removed by guardian group
    const removeProvisionSeq = seq;
    const removeProvisionRawData = (await bridge.populateTransaction.removeProvision(removeProvisionSeq)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, removeProvisionRawData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);
    expect(await bridge.isProvisioned(seq)).to.be.equal(false);
    expect(await bridge.nProvisioned()).to.be.equal(0);

    // In real secnario, operator group raplce must be performed

    // now, true provision can be confirmed again
    const trueProvision = [seq, sender, receiver, amount];
    const trueProvisionRawData = (await bridge.populateTransaction.provision(trueProvision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, trueProvisionRawData, 0);
    await operator.connect(operator2).submitTransaction(bridge.address, trueProvisionRawData, 0);
    await operator.connect(operator3).submitTransaction(bridge.address, trueProvisionRawData, 0);
    expect(await bridge.isProvisioned(seq)).to.be.equal(true);
    expect(await bridge.nProvisioned()).to.be.equal(1);
  });

  it("#change minimum lockable KAIA", async function () {
    const newMinLockableKAIA = BigInt((await bridge.KAIA_UNIT()) * 2);
    expect(await bridge.minLockableKAIA()).to.not.equal(newMinLockableKAIA);

    let rawTxData = (await bridge.populateTransaction.changeMinLockableKAIA(newMinLockableKAIA)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);

    expect(await bridge.minLockableKAIA()).to.equal(newMinLockableKAIA);
  });

  it("#change maximum lockable KAIA", async function () {
    const newMaxLockableKAIA = BigInt((await bridge.KAIA_UNIT()) * 200);
    expect(await bridge.maxLockableKAIA()).to.not.equal(newMaxLockableKAIA);

    let rawTxData = (await bridge.populateTransaction.changeMaxLockableKAIA(newMaxLockableKAIA)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);

    expect(await bridge.maxLockableKAIA()).to.equal(newMaxLockableKAIA);
  });

  it("#change maxTryTransfer", async function () {
    const newMaxTryTransfer = 5;
    expect(await bridge.maxTryTransfer()).to.not.equal(newMaxTryTransfer);

    let rawTxData = (await bridge.populateTransaction.changeMaxTryTransfer(newMaxTryTransfer)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);

    expect(await bridge.maxTryTransfer()).to.equal(5);
  });

  it("#Transfer (case: sequence number is mapped to block number)", async function () {
    const latestBlockNum = (await hre.ethers.provider.getBlock("latest")).number;
    const amount = BigInt(5 * 10e18);

    await expect(bridge.transfer(fnsaReceiver, {value: amount})).to.emit(bridge, "Transfer");
    expect(await bridge.seq2BlockNum(seq)).to.gt(latestBlockNum);
    let seq2BlockNum1 = await bridge.seq2BlockNum(seq);

    await expect(bridge.transfer(fnsaReceiver, {value: amount})).to.emit(bridge, "Transfer");
    let seq2BlockNum2 = await bridge.seq2BlockNum(seq + 1);
    expect(await seq2BlockNum2).to.gt(seq2BlockNum1);

    await expect(bridge.transfer(fnsaReceiver, {value: amount})).to.emit(bridge, "Transfer");
    let seq2BlockNum3 = await bridge.seq2BlockNum(seq + 2);
    expect(await seq2BlockNum3).to.gt(seq2BlockNum2);

    expect(await bridge.seq2BlockNum(seq + 3)).to.be.equal(0);
  });

  it("#Transfer KAIA (swap request)", async function () {
    const underMinLockableKAIA = BigInt(1);
    const upperMinLockableKAIA = BigInt(5 * 10e18);
    const upperMaxLockableKAIA = BigInt(10000000 * 10e18);
    await expect(bridge.transfer(fnsaReceiver, {value: underMinLockableKAIA}))
      .revertedWith("KAIA::Bridge: Locked KAIA must be larger than minimum");

    expect(await bridge.seq()).to.equal(1);
    await expect(bridge.transfer(fnsaReceiver, {value: upperMinLockableKAIA}))
      .to.emit(bridge, "Transfer");
    expect(await bridge.seq()).to.equal(2);
    await expect(bridge.transfer(fnsaReceiver, {value: upperMinLockableKAIA}))
      .to.emit(bridge, "Transfer");
    expect(await bridge.seq()).to.equal(3);

    await expect(bridge.transfer(fnsaReceiver, {value: upperMaxLockableKAIA}))
      .revertedWith("KAIA::Bridge: Locked KAIA must be less than maximum");

    expect((await bridge.getAllSwapRequests()).length).to.equal(2);
    expect((await bridge.getSwapRequests(0, 1)).length).to.equal(1);
    expect((await bridge.getSwapRequests(0, 2)).length).to.equal(2);
    expect((await bridge.getSwapRequests(0, 100)).length).to.equal(2);
  });

  it("#change operator contract address", async function () {
    const operatorFactory = await ethers.getContractFactory("Operator");
    const newOperator = await upgrades.deployProxy(operatorFactory, [[
      operator1.address,
      operator2.address,
      operator3.address,
      operator4.address,
    ], guardian.address, minOperatorRequiredConfirm]);

    expect(await bridge.operator()).to.be.equal(operator.address)
    const rawTxData = (await bridge.populateTransaction.changeOperator(newOperator.address)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);
    expect(await bridge.operator()).to.be.equal(newOperator.address)
  });

  it("#change guardian contract address", async function () {
    const guardianFactory = await ethers.getContractFactory("Guardian");
    const newGuardian = await upgrades.deployProxy(guardianFactory, [[
      guardian1.address,
      guardian2.address,
      guardian3.address,
      guardian4.address,
    ], minGuardianRequiredConfirm]);

    expect(await bridge.guardian()).to.be.equal(guardian.address)
    const rawTxData = (await bridge.populateTransaction.changeGuardian(newGuardian.address)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);
    expect(await bridge.guardian()).to.be.equal(newGuardian.address)
  });

  it("#change guardian contract address", async function () {
    const judgeFactory = await ethers.getContractFactory("Judge");
    const newJudge = await upgrades.deployProxy(judgeFactory, [[
      judge1.address
    ], guardian.address, 1]);

    expect(await bridge.judge()).to.be.equal(judge.address)
    const rawTxData = (await bridge.populateTransaction.changeJudge(newJudge.address)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);
    expect(await bridge.judge()).to.be.equal(newJudge.address)
  });

  it("#change bridge contract address", async function () {
    const bridgeFactory = await ethers.getContractFactory("KAIABridge");
    const newBridge = await upgrades.deployProxy(bridgeFactory, [
      operator.address, guardian.address, judge.address, maxTryTransfer
    ]);

    expect(await operator.bridge()).to.be.equal(bridge.address)
    const rawTxData = (await operator.populateTransaction.changeBridge(newBridge.address)).data;
    await guardian.connect(guardian1).submitTransaction(operator.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);
    expect(await operator.bridge()).to.be.equal(newBridge.address)
  });

  it("#set FNSA address validation on and off", async function () {
    const onOff = await bridge.addrValidationOn();
    expect(onOff).to.be.equal(true);

    const rawTxData = (await bridge.populateTransaction.setAddrValidation(!onOff)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID);
    expect(await bridge.addrValidationOn()).to.be.equal(false);
  });

  it("#resolve unclaimable provision by guardian", async function () {
    const C = await ethers.deployContract("C");

    const provision = [seq, sender, C.address, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID);
    await operator.connect(operator3).confirmTransaction(txID);

    const mintLock = Number(await bridge.TRANSFERLOCK());
    const setTime = mintLock;
    await addTime(setTime);

    const gasSmall = 300000;
    for (let i=0; i<maxTryTransfer; i++) {
      await bridge.requestBatchClaim(1, {gasLimit: gasSmall})
      expect(await bridge.transferFail(seq)).to.equal(i + 1);
      expect(await bridge.getClaimFailures()).to.deep.equal([])
    }

    let newReceiver = C.address;
    rawTxData = (await bridge.populateTransaction.resolveUnclaimable(seq, newReceiver)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID))
      .to.be.revertedWith("KAIA::Bridge: Must be in claim failure set");

    await bridge.requestBatchClaim(1, {gasLimit: gasSmall})
    expect(await bridge.getClaimFailures()).to.deep.equal([seq])

    // `newReceiver` address must not be a contract address
    rawTxData = (await bridge.populateTransaction.resolveUnclaimable(seq, newReceiver)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 1);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 1))
      .to.be.revertedWith("KAIA::Bridge: newReceiver must not be contract address");

    expect(await bridge.getClaimFailures()).to.deep.equal([1])
    newReceiver = "0x0000000000000000000000000000000000000789";
    rawTxData = (await bridge.populateTransaction.resolveUnclaimable(seq, newReceiver)).data;
    expect(await getBalance(newReceiver)).to.equal(0n);
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 2);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 2))
      .to.emit(bridge, "ProvisionReceiverChanged")
      .to.emit(bridge, "Claim");
    expect(await getBalance(newReceiver)).to.equal(BigInt(amount));
    expect(await bridge.getClaimFailures()).to.deep.equal([])
    expect(await bridge.getClaimFailuresRange(100)).to.deep.equal([])
  });

  it("#get seq2TxIDs", async function () {
    let provisions = [
      [1, sender, receiver, amount],
      [3, sender, receiver, amount],     // true provision
      [3, sender, receiver, amount * 2], // malicious provision
      [5, sender, receiver, amount],
    ];
    for (let prov of provisions) {
      let rawTxData = (await bridge.populateTransaction.provision(prov)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    }

    expect(await operator.getSeq2TxIDs(1)).to.deep.equal([1])
    expect(await operator.getSeq2TxIDs(3)).to.deep.equal([2,3])
    expect(await operator.getSeq2TxIDs(5)).to.deep.equal([4])
  });

  it("#Transfer (address validation)", async function () {
    const amount = BigInt(5 * 10e18);
    let receiver = "link1hpufl3l8g44aaz3qsqw886sjanhhu73ul6tllxuw3pqlhxzq9e4svku69h";
    await expect(bridge.transfer(receiver, {value: amount})).to.emit(bridge, "Transfer");

    receiver = "link1hpufl3l8g44aaz3qsqw816sjanhhu73ul6tllxuw3pqlhxzq9e4svku69h";
    await expect(bridge.transfer(receiver, {value: amount})).to.be.revertedWith("Invalid checksum");
  });

  it("#add operator (case: use unique user index)", async function () {
    const initialOperatorLen = 4;
    expect((await operator.getOperators()).length).to.equal(initialOperatorLen);

    const uniqUserIdx = 123;
    let userIdx2TxID = await guardian.userIdx2TxID(uniqUserIdx);
    expect(userIdx2TxID).to.be.equal(0);
    const operatorCandidate = unknown;
    const rawTxData = (await operator.populateTransaction.addOperator(operatorCandidate.address)).data;
    await guardian.connect(guardian1).submitTransaction(operator.address, rawTxData, uniqUserIdx);
    userIdx2TxID = await guardian.userIdx2TxID(uniqUserIdx);
    expect(userIdx2TxID).to.not.be.equal(0);

    await guardian.connect(guardian2).confirmTransaction(userIdx2TxID);
    await guardian.connect(guardian3).confirmTransaction(userIdx2TxID);

    expect((await operator.getOperators()).length).to.equal(initialOperatorLen + 1);
  });

  it("hold claim (case: use unique user index)", async function () {
    const provision = [seq, sender, receiver, amount];
    const uniqOperatorIndex = 123;
    let userIdx2TxID = await operator.userIdx2TxID(uniqOperatorIndex);
    expect(userIdx2TxID).to.be.equal(0);

    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, uniqOperatorIndex);
    userIdx2TxID = await operator.userIdx2TxID(uniqOperatorIndex);
    expect(userIdx2TxID).to.not.be.equal(0);

    await operator.connect(operator2).confirmTransaction(userIdx2TxID);
    await operator.connect(operator3).confirmTransaction(userIdx2TxID);

    expect(await bridge.timelocks(seq)).to.lte(await time.latest() + HOUR / 2);

    const uniqJudgeIndex = 123;
    userIdx2TxID = await judge.userIdx2TxID(uniqJudgeIndex);
    expect(userIdx2TxID).to.be.equal(0);
    rawTxData = (await bridge.populateTransaction.holdClaim(seq)).data;
    await judge.connect(judge1).submitTransaction(bridge.address, rawTxData, uniqJudgeIndex);

    userIdx2TxID = await judge.userIdx2TxID(uniqJudgeIndex);
    expect(userIdx2TxID).to.not.be.equal(0);

    expect(await bridge.timelocks(seq)).to.gte(await time.latest() + YEAR * 1000);
  });

  it("Change bridge service period", async function () {
    let uniqOperatorIndex = 123;
    const bridgeBalanceBefore = await getBalance(bridge.address);
    const deadAddrBalanceBefore = await getBalance("0x000000000000000000000000000000000000dEaD");
    expect(deadAddrBalanceBefore).to.be.equal(0n);
    expect(bridgeBalanceBefore).to.not.equal(0);

    await expect(bridge.connect(unknown).burnBridgeBalance())
      .to.be.revertedWith("KAIA::Bridge: Not an guardian")

    // Bridge not paused yet
    let rawTxData = (await bridge.populateTransaction.burnBridgeBalance()).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, uniqOperatorIndex);
    let userIdx2TxID1 = await guardian.userIdx2TxID(uniqOperatorIndex);
    await guardian.connect(guardian2).confirmTransaction(userIdx2TxID1);
    await expect(guardian.connect(guardian3).confirmTransaction(userIdx2TxID1))
      .to.be.revertedWith("KAIA::Bridge: Bridge has not been paused");

    // Puase the bridge
    uniqOperatorIndex++;
    rawTxData = (await bridge.populateTransaction.pauseBridge("Bridge pause")).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, uniqOperatorIndex);
    let userIdx2TxID2 = await guardian.userIdx2TxID(uniqOperatorIndex);
    await guardian.connect(guardian2).confirmTransaction(userIdx2TxID2);
    await guardian.connect(guardian3).confirmTransaction(userIdx2TxID2);

    await expect(guardian.connect(guardian3).confirmTransaction(userIdx2TxID1))
      .to.be.revertedWith("KAIA::Bridge: Service period is not expired yet");

    // Adjust timestamp
    const servicePeriodOver = Number(await bridge.bridgeServiceStarted()) + Number(await bridge.bridgeServicePeriod());
    await addTime(servicePeriodOver);

    // Burn
    await expect(guardian.connect(guardian3).confirmTransaction(userIdx2TxID1))
      .to.emit(bridge, "BridgeBalanceBurned");

    const bridgeBalanceAfter = await getBalance(bridge.address);
    expect(bridgeBalanceAfter).to.be.equal(0n);

    const deadAddrBalanceAfter = await getBalance("0x000000000000000000000000000000000000dEaD");
    expect(deadAddrBalanceAfter).to.be.equal(bridgeBalanceBefore);
  });

  it("Change bridge service period", async function () {
    const uniqOperatorIndex = 123;
    const curPeriodBefore = Number(await bridge.bridgeServicePeriod());
    const newPeriod = curPeriodBefore * 2;

    await expect(bridge.connect(unknown).changeBridgeServicePeriod(newPeriod))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian")

    let rawTxData = (await bridge.populateTransaction.changeBridgeServicePeriod(newPeriod)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, uniqOperatorIndex);
    let userIdx2TxID = await guardian.userIdx2TxID(uniqOperatorIndex);
    await guardian.connect(guardian2).confirmTransaction(userIdx2TxID);
    await expect(guardian.connect(guardian3).confirmTransaction(userIdx2TxID))
      .to.emit(bridge, "ChangeBridgeServicePeriod")

    const curPeriodAfter = Number(await bridge.bridgeServicePeriod());
    expect(curPeriodBefore * 2).to.be.equal(curPeriodAfter);
  });

  it("#Query the submission of the specific provision", async function () {
    const provision = [seq, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID);

    const hashedRawTxData = ethers.utils.keccak256(rawTxData);
    const isOp1Submitted = await operator.checkProvisionShouldSubmit(hashedRawTxData, operator1.address);
    const isOp2Submitted = await operator.checkProvisionShouldSubmit(hashedRawTxData, operator2.address);
    const isOp3Submitted = await operator.checkProvisionShouldSubmit(hashedRawTxData, operator3.address);
    const isOp4Submitted = await operator.checkProvisionShouldSubmit(hashedRawTxData, operator4.address);

    expect(isOp1Submitted).to.be.equal(false);
    expect(isOp2Submitted).to.be.equal(false);
    expect(isOp3Submitted).to.be.equal(true);
    expect(isOp4Submitted).to.be.equal(true);
  });

  it("#Query the operator and bridge next provision sequence", async function () {
    expect(await bridge.nextProvisionSeq()).to.be.equal(0)
    expect(await operator.nextProvisionSeq(operator1.address)).to.be.equal(0)

    let provision = [1, sender, receiver, amount];
    let rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID);
    await operator.connect(operator3).confirmTransaction(txID);

    expect(await bridge.nextProvisionSeq()).to.be.equal(1)
    expect(await operator.nextProvisionSeq(operator1.address)).to.be.equal(1)
    expect(await operator.nextProvisionSeq(operator2.address)).to.be.equal(1)
    expect(await operator.nextProvisionSeq(operator3.address)).to.be.equal(1)
    expect(await operator.nextProvisionSeq(operator4.address)).to.be.equal(0)

    provision = [2, sender, receiver, amount];
    rawTxData = (await bridge.populateTransaction.provision(provision)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);

    expect(await bridge.nextProvisionSeq()).to.be.equal(1)
    expect(await operator.nextProvisionSeq(operator1.address)).to.be.equal(2)
    expect(await operator.nextProvisionSeq(operator2.address)).to.be.equal(1)
    expect(await operator.nextProvisionSeq(operator3.address)).to.be.equal(1)
    expect(await operator.nextProvisionSeq(operator4.address)).to.be.equal(0)
  });

  it("#Claim error (case: bridge balacne is not enough)", async function () {
    const bridgeBalance = await getBalance(bridge.address);
    const prov1 = [seq, sender, receiver, bridgeBalance + 1n];
    const prov2 = [seq + 1, sender, receiver, amount];

    let rawTxData = (await bridge.populateTransaction.provision(prov1)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);

    rawTxData = (await bridge.populateTransaction.provision(prov2)).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);

    const mintLock = Number(await bridge.TRANSFERLOCK());
    await addTime(mintLock);

    // revert on single claim
    await expect(bridge.requestClaim(seq))
      .to.be.revertedWith("KAIA::Bridge: Bridge balance is not enough to transfer provision amount")

    expect(await bridge.nClaimed()).to.be.equal(0);
    await bridge.requestBatchClaim(10);
    expect(await bridge.nClaimed()).to.be.equal(1);
  })

  it("#Query acccumulated claim amount", async function () {
    async function sendProvision(prov) {
      let rawTxData = (await bridge.populateTransaction.provision(prov)).data;
      await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
      await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
    }

    async function claim(n) {
      expect(await bridge.nClaimed()).to.be.equal(0);
      const mintLock = Number(await bridge.TRANSFERLOCK());
      await addTime(mintLock);
      await bridge.requestBatchClaim(n);
      expect(await bridge.nClaimed()).to.be.equal(n);
      expect(await bridge.accumulatedClaimAmount()).to.be.equal(amount * n);
    }

    const n = 10;
    const amount = 10;
    for (let i=1; i<=n; i++) {
      let provision = [i, sender, receiver, amount];
      await sendProvision(provision);
    }
    await claim(n);
  });

  /////////////////// modifier/require coverage test ///////////////////
  it("#Bridge.sol modifier/require cov", async function () {
    // 1. auth
    await expect(bridge.changeTransferEnable(true))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 2. auth
    await expect(bridge.provision([seq, sender, receiver, amount]))
      .to.be.revertedWith("KAIA::Bridge: Not an operator");

    // 3. auth
    await expect(bridge.removeProvision(seq))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 4. same provision sequence submission
    let rawTxData = (await bridge.populateTransaction.provision([seq, sender, receiver, amount])).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID);
    await operator.connect(operator3).confirmTransaction(txID);

    rawTxData = (await bridge.populateTransaction.provision([seq, sender, receiver, amount * 2])).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).confirmTransaction(txID + 1);
    await expect(operator.connect(operator3).confirmTransaction(txID + 1))
      .to.be.revertedWith("KAIA::Bridge: A provision was submitted before")

    // 5. no provision for corresponding sequence
    rawTxData = (await bridge.populateTransaction.removeProvision(100)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID))
      .to.be.revertedWith("KAIA::Bridge: No provisoned for corresponding sequence")

    // 6. no provision for corresponding sequence
    rawTxData = (await bridge.populateTransaction.resolveUnclaimable(100, receiver)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 1);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 1))
      .to.be.revertedWith("KAIA::Bridge: No provisoned for corresponding sequence")

    // 7: timelock duration not passed
    rawTxData = (await bridge.populateTransaction.resolveUnclaimable(seq, receiver)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 2);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 2))
      .to.be.revertedWith("KAIA::Bridge: TimeLock duration is not passed over")

    // 8. already claimed
    const tiemlockOver = Number(await bridge.TRANSFERLOCK());
    await addTime(tiemlockOver);
    await bridge.requestClaim(seq);

    rawTxData = (await bridge.populateTransaction.resolveUnclaimable(seq, receiver)).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 3);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 3))
      .to.be.revertedWith("KAIA::Bridge: A provision corresponding the given sequence was already claimed")


    // 9. auth
    await expect(bridge.changeMinLockableKAIA(1))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 10. auth
    await expect(bridge.changeMaxLockableKAIA(1))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 11. auth
    await expect(bridge.changeMaxTryTransfer(1))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 12. auth
    await expect(bridge.setAddrValidation(true))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 13. auth
    await expect(bridge.changeOperator("0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 14. auth
    await expect(bridge.changeGuardian("0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 15. auth
    await expect(bridge.changeJudge("0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 16. auth
    await expect(bridge.changeTransferTimeLock(1))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 17. auth
    await expect(bridge.holdClaim(1))
      .to.be.revertedWith("KAIA::Bridge: Not an judge");

    // 18. auth
    await expect(bridge.releaseClaim(1))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 19. auth
    await expect(bridge.pauseBridge(""))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 20. auth
    await expect(bridge.resumeBridge(""))
      .to.be.revertedWith("KAIA::Bridge: Not an guardian");

    // 21. try bridge pause in pause
    rawTxData = (await bridge.populateTransaction.pauseBridge("")).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 4);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID + 4);

    rawTxData = (await bridge.populateTransaction.pauseBridge("")).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 5);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 5))
      .to.be.revertedWith("KAIA::Bridge: Bridge has been paused")

    // 22. try resume pause in unpaused
    rawTxData = (await bridge.populateTransaction.resumeBridge("")).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 6);
    await guardian.connect(guardian3).confirmTransaction(guardianTxID + 6);

    rawTxData = (await bridge.populateTransaction.resumeBridge("")).data;
    await guardian.connect(guardian1).submitTransaction(bridge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 7);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 7))
      .to.be.revertedWith("KAIA::Bridge: Bridge has not been paused")

    // 23. touch the first condition `from == 0`
    await bridge.isProvisionedRange(0,1);

    // 24. input range error
    await expect(bridge.getSwapRequests(1,0))
      .to.be.revertedWith("KAIA::Bridge: Invalid from and to");
  });

  it("#Guardian.sol modifier/require cov", async function () {
    // 1. addGguardian: auth
    await expect(guardian.addGuardian("0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Guardian: Sender is not guardian wallet")

    // 2. addGguardian: duplicated new guardian
    let rawTxData = (await guardian.populateTransaction.addGuardian(guardian1.address)).data;
    await guardian.connect(guardian1).submitTransaction(guardian.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID))
      .to.be.revertedWith("KAIA::Guardian: The address must not be guardian")

    // 3. addGguardian: new guardian address is null
    rawTxData = (await guardian.populateTransaction.addGuardian("0x0000000000000000000000000000000000000000")).data;
    await guardian.connect(guardian1).submitTransaction(guardian.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 1);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 1))
      .to.be.revertedWith("KAIA::Guardian: A zero address is not allowed")

    // 4. removeGguardian: auth
    await expect(guardian.removeGuardian("0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Guardian: Sender is not guardian wallet")

    // 5. removeGguardian: guardian does not exist
    rawTxData = (await guardian.populateTransaction.removeGuardian("0x0000000000000000000000000000000000000000")).data;
    await guardian.connect(guardian1).submitTransaction(guardian.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 2);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 2))
      .to.be.revertedWith("KAIA::Guardian: Not an guardian")

    // 6. replaceGuardian:auth
    await expect(guardian.replaceGuardian("0x0000000000000000000000000000000000000123", "0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Guardian: Sender is not guardian wallet")

    // 7. replaceGuardian: guardian does not exist
    rawTxData = (await guardian.populateTransaction.replaceGuardian("0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000123")).data;
    await guardian.connect(guardian1).submitTransaction(guardian.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 3);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 3))
      .to.be.revertedWith("KAIA::Guardian: Not an guardian")

    // 8. replaceGuardian: guardian exists
    rawTxData = (await guardian.populateTransaction.replaceGuardian(guardian1.address, guardian2.address)).data;
    await guardian.connect(guardian1).submitTransaction(guardian.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 4);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 4))
      .to.be.revertedWith("KAIA::Guardian: The address must not be guardian")

    // 9. changeRequirement: auth
    await expect(guardian.changeRequirement(1))
      .to.be.revertedWith("KAIA::Guardian: Sender is not guardian wallet")

    // 10. changeRequirement: invalid requirement
    rawTxData = (await operator.populateTransaction.changeRequirement(0)).data;
    await guardian.connect(guardian1).submitTransaction(operator.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 5);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 5))
      .to.be.revertedWith("");

    // 11. confirmTransaction: transation ID does not exist
    await expect(guardian.connect(guardian1).confirmTransaction(guardianTxID + 100))
      .to.be.revertedWith("KAIA::Guardian: Transaction does not exist");

    // 12. revokeConfirmation: not confirmed
    await expect(guardian.connect(guardian1).revokeConfirmation(guardianTxID + 100))
      .to.be.revertedWith("KAIA::Guardian: No confirmation was committed yet");

    // 13. revokeConfirmation: already executed
    await expect(guardian.connect(guardian1).revokeConfirmation(guardianTxID - 1))
      .to.be.revertedWith("KAIA::Guardian: Transaction was already executed");

    // 14. executeTransaction: not confirmed
    await expect(guardian.connect(guardian1).executeTransaction(guardianTxID + 100))
      .to.be.revertedWith("KAIA::Guardian: No confirmation was committed yet");

    // 15. getTransactionIds: input range error
    await expect(guardian.getTransactionIds(1, 0, true, true))
      .to.be.revertedWith("KAIA::Guardian: Invalid from and to")

    // 16. getTransactionIds: touch the first condition `from == 0`
    await guardian.getTransactionIds(0, 1, true, true)

    // 17. getTransactionIds: touch the second condition `to > transactions.length`
    await guardian.getTransactionIds(0, 10000, true, true)
  });

  it("#Operator.sol modifier/require cov", async function () {
    // 1. addOperator: new guardian address is null
    let rawTxData = (await operator.populateTransaction.addOperator("0x0000000000000000000000000000000000000000")).data;
    await guardian.connect(guardian1).submitTransaction(operator.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID))
      .to.be.revertedWith("KAIA::Operator: A zero address is not allowed")

    // 2. removeOperator: auth
    await expect(operator.removeOperator(operator1.address))
      .to.be.revertedWith("KAIA::Operator: Sender is not guardian contract")

    // 3. replaceGuardian: auth
    await expect(operator.replaceOperator("0x0000000000000000000000000000000000000123", "0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Operator: Sender is not guardian contract")

    // 4. replaceGuardian: operator does exist
    rawTxData = (await operator.populateTransaction.replaceOperator("0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000123")).data;
    await guardian.connect(guardian1).submitTransaction(operator.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 1);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 1))
      .to.be.revertedWith("KAIA::Operator: Not an operator")

    // 5. replaceGuardian: operator must not be operator
    rawTxData = (await operator.populateTransaction.replaceOperator(operator1.address, operator2.address)).data;
    await guardian.connect(guardian1).submitTransaction(operator.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 2);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 2))
      .to.be.revertedWith("KAIA::Operator: The address must not be operator")

    // 6. changeGuardian: auth
    await expect(operator.changeGuardian("0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Operator: Sender is not guardian contract")

    // 7. changeBridge
    await expect(operator.changeBridge("0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Operator: Sender is not guardian contract")

    // 8. changeRequirement
    await expect(operator.changeRequirement(0))
      .to.be.revertedWith("KAIA::Operator: Sender is not guardian contract")

    // 9. confirmTransaction: transation ID does not exist
    await expect(operator.connect(operator1).confirmTransaction(100))
      .to.be.revertedWith("KAIA::Operator: Transaction does not exist");

    // 10. confirmTransaction: already confirmed
    await operator.connect(operator1).submitTransaction(operator.address, rawTxData, 200);
    let txID = await operator.userIdx2TxID(200)
    await expect(operator.connect(operator1).confirmTransaction(txID))
      .to.be.revertedWith("KAIA::Operator: Transaction was already confirmed");

    // 11. revokeConfirmation: auth
    await expect(operator.connect(guardian1).revokeConfirmation(1))
      .to.be.revertedWith("KAIA::Operator: Not an operator");

    // 12. revokeConfirmation: already executed
    rawTxData = (await bridge.populateTransaction.provision([seq, sender, receiver, amount])).data;
    await operator.connect(operator1).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator2).submitTransaction(bridge.address, rawTxData, 0);
    await operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0);
    await expect(operator.connect(operator3).submitTransaction(bridge.address, rawTxData, 0))
      .to.be.revertedWith("KAIA::Operator: Transaction was already confirmed");

    // 13. executeTransaction: auth
    await expect(operator.connect(guardian1).executeTransaction(1))
      .to.be.revertedWith("KAIA::Operator: Not an operator");

    // 14. executeTransaction: no confirmation
    await expect(operator.connect(operator4).executeTransaction(1))
      .to.be.revertedWith("KAIA::Operator: No confirmation was committed yet");

    // 15. getTransactionIds: input range error
    await expect(operator.getTransactionIds(1, 0, true, true))
      .to.be.revertedWith("KAIA::Operator: Invalid from and to")

    // 16. getTransactionIds: touch the first condition `from == 0`
    await operator.getTransactionIds(0, 1, true, true)

    // 17. getTransactionIds: touch the second condition `to > transactions.length`
    await operator.getTransactionIds(0, 10000, true, true)

    // 18. getUnconfirmedProvisionSeqs: not an operator
    await expect(operator.getUnconfirmedProvisionSeqs("0x0000000000000000000000000000000000000123", 100))
      .to.be.revertedWith("KAIA::Operator: Not an operator")

    // 19. doGetUnconfirmedProvisionSeqs: not an operator
    await expect(operator.doGetUnconfirmedProvisionSeqs("0x0000000000000000000000000000000000000123", 0, 0))
      .to.be.revertedWith("KAIA::Operator: Not an operator")

    // 20. doGetUnconfirmedProvisionSeqs: input range error
    await expect(operator.doGetUnconfirmedProvisionSeqs(operator1.address, 1, 0))
      .to.be.revertedWith("KAIA::Operator: Invalid from and to")

    // 21. unmarkRevokeSeq: auth
    await expect(operator.unmarkRevokeSeq(1))
      .to.be.revertedWith("KAIA::Operator: Sender is not bridge contract")

    // 22. markRevokeSeq: auth
    await expect(operator.markRevokeSeq(1))
      .to.be.revertedWith("KAIA::Operator: Sender is not bridge contract")

    // 23. updateNextUnsubmittedSeq: not an operator
    await expect(operator.connect(guardian1).updateNextUnsubmittedSeq(0))
      .to.be.revertedWith("KAIA::Operator: Not an operator")
  });

  it("#Judge.sol modifier/require cov", async function () {
    // 1. addJudge: auth
    await expect(judge.addJudge("0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Judge: Sender is not guardian wallet")

    // 2. addJudge: judge exists already
    let rawTxData = (await judge.populateTransaction.addJudge(judge1.address)).data;
    await guardian.connect(guardian1).submitTransaction(judge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID))
      .to.be.revertedWith("KAIA::Judge: The address must not be judge")

    // 3. addJudge: judge exists already
    rawTxData = (await judge.populateTransaction.addJudge("0x0000000000000000000000000000000000000000")).data;
    await guardian.connect(guardian1).submitTransaction(judge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 1);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 1))
      .to.be.revertedWith("KAIA::Judge: A zero address is not allowed")

    // 4. removeJudge: auth
    await expect(judge.removeJudge("0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Judge: Sender is not guardian wallet")

    // 5. removeJudge: judge does not exist
    rawTxData = (await judge.populateTransaction.removeJudge("0x0000000000000000000000000000000000000123")).data;
    await guardian.connect(guardian1).submitTransaction(judge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 2);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 2))
      .to.be.revertedWith("KAIA::Judge: Not an judge")

    // 6. replaceJudge: auth
    await expect(judge.replaceJudge("0x0000000000000000000000000000000000000123", "0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Judge: Sender is not guardian wallet")

    // 7. replaceJudge: judge does not exist
    rawTxData = (await judge.populateTransaction.replaceJudge("0x0000000000000000000000000000000000000123", "0x0000000000000000000000000000000000000123")).data;
    await guardian.connect(guardian1).submitTransaction(judge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 3);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 3))
      .to.be.revertedWith("KAIA::Judge: Not an judge")

    // 8. replaceJudge: judge does not exist
    rawTxData = (await judge.populateTransaction.replaceJudge(judge1.address, judge1.address)).data;
    await guardian.connect(guardian1).submitTransaction(judge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 4);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 4))
      .to.be.revertedWith("KAIA::Judge: The address must not be judge")

    // 9. changeGuardian: auth
    await expect(judge.changeGuardian("0x0000000000000000000000000000000000000123"))
      .to.be.revertedWith("KAIA::Judge: Sender is not guardian wallet")

    // 10. changeRequirement: auth
    await expect(judge.changeRequirement(0))
      .to.be.revertedWith("KAIA::Judge: Sender is not guardian wallet")

    // 11. changeRequirement: invalid requirement
    rawTxData = (await judge.populateTransaction.changeRequirement(0)).data;
    await guardian.connect(guardian1).submitTransaction(judge.address, rawTxData, 0);
    await guardian.connect(guardian2).confirmTransaction(guardianTxID + 5);
    await expect(guardian.connect(guardian3).confirmTransaction(guardianTxID + 5))
      .to.be.revertedWith("")

    // 12. confirmTransaction: transaction ID does not exist
    await expect(judge.connect(judge1).confirmTransaction(100))
      .to.be.revertedWith("KAIA::Judge: Transaction does not exist");

    // 13. confirmTransaction: transaction ID does not exist
    rawTxData = (await bridge.populateTransaction.holdClaim(seq)).data;
    await judge.connect(judge1).submitTransaction(bridge.address, rawTxData, 0);
    await expect(judge.connect(judge1).confirmTransaction(1))
      .to.be.revertedWith("KAIA::Judge: Transaction was already confirmed");

    // 14. revokeConfirmation: not a judge
    await expect(judge.connect(guardian1).revokeConfirmation(1))
      .to.be.revertedWith("KAIA::Judge: Not an judge");

    // 15. revokeConfirmation: already executed
    await expect(judge.connect(judge1).revokeConfirmation(1))
      .to.be.revertedWith("KAIA::Judge: Transaction was already executed");

    // 16. executeTransaction: auth
    await expect(judge.connect(judge1).executeTransaction(100))
      .to.be.revertedWith("KAIA::Judge: No confirmation was committed yet");

    // 17. getTransactionIds: input range error
    await expect(judge.getTransactionIds(1, 0, true, true))
      .to.be.revertedWith("KAIA::Judge: Invalid from and to")

    // 18. getTransactionIds: touch the first condition `from == 0`
    await judge.getTransactionIds(0, 1, true, true)

    // 19. getTransactionIds: touch the second condition `to > transactions.length`
    await judge.getTransactionIds(0, 10000, true, true)

    // 20. touch getVersion
    await judge.getVersion();
  });

  it("#EnumerableSetUint64.sol modifier/require cov", async function () {
    const E = await ethers.deployContract("TestEnumSet");

    await E.add(3);
    await E.add(2);
    await E.add(1);

    expect(await E.at(0)).to.be.equal(3);
    expect(await E.at(1)).to.be.equal(2);
    expect(await E.at(2)).to.be.equal(1);
    await expect(E.at(3)).to.be.revertedWith("Index out of bounds");
  });
});
