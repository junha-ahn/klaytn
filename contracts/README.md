# Contracts

## Install dependencies

- Install node.js 20+
- Install solidity compiler:
  - [solc-select](https://github.com/crytic/solc-select)
  - or [svm-rs](https://github.com/alloy-rs/svm-rs)
  - or manually install a specific version if you are working with only one version.

## Generate Go wrappers via `abigen`

Regenerate after you change contract source.

- Install solidity compiler
- Run `go generate`

## Unit test and coverage test

```
npm install
npx hardhat compile

npx hardhat test
npx hardhat test --grep Bridge

npx hardhat coverage
npx hardhat coverage --testfiles test/Bridge/bridge.test.ts
```

## Source code organization

### Testing contracts

The contracts in `contracts/testing` are used for unit testing and performance benchmarks.

### Libraries

These contracts in `contracts/libs` are external dependencies and libraries. Some old libraries are kept to support other legacy contracts.

- `kip13/InterfaceIdentifier.sol`: The ERC-165 supportsInterface.
- `openzeppelin-contracts-v2/*`: OpenZeppelin contracts.
- `Ownable.sol`: Ownable contract.
- `SafeMath.sol`: SafeMath for older solidity versions.
- `ValidContract.sol`: Check if the contract is valid.

Some libraries are outside `/contracts` directory and are installed via npm

- `node_modules/@openzeppelin/contracts`: OpenZeppelin contracts.
- `node_modules/openzeppelin-contracts-5.0`: OpenZeppelin contracts v5.0.

### Service chain contracts

These contracts in `contracts/service_chain` are the service chain token bridges.

- `bridge/*.sol`: Token bridge implementation.
  - The `subbridge_deployBridge` API deploys this contract.
- `sc_erc20/IERC20BridgeReceiver.sol`: onERC20Received interface.
- `sc_erc721/IERC721BridgeReceiver.sol`: onERC721Received interface.

### System contracts

These contracts in `contracts/system_contracts` are deployed or planned to be deployed on the mainnet.

- `consensus/AddressBook.sol`: The validator registry.
  - Deployed at address 0x400: [testnet](https://baobab.klaytnscope.com/account/0x0000000000000000000000000000000000000400?tabId=contractCode), [mainnet](https://klaytnscope.com/account/0x0000000000000000000000000000000000000400?tabId=contractCode)
  - Deployed at the [genesis block](/blockchain/genesis_alloc.go) in 2018, active to date.
- `consensus/CnStakingContract.sol`: Validator (CN) staking contract V1.
  - Deployed instances: [search](https://klaytnscope.com/search/tokens-nft-account?key=CN%20V1), [example1](https://klaytnscope.com/account/0x49ee0e773da2635ba01a4f808c7f1a833a97c3d9?tabId=contractCode), [example2](https://klaytnscope.com/account/0xcaab49742bacb49b1cbe27b035cdee5efde1bb5a?tabId=txList)
  - Introduced since genesis in 2018, currently deprecated over [KIP-82](https://github.com/klaytn/kips/blob/main/KIPs/kip-82.md)'s [CnStakingV2](https://github.com/klaytn/governance-contracts-audit). The V1 to V2 migration has started since March 2023 and still some V1 instances remain active (i.e. registered in AddressBook).
- `gov/GovParam.sol`: On-chain storage for governance parameters.
  - Deployed instance: [testnet](https://baobab.klaytnscope.com/account/0x84214cec245d752a9f2faf355b59ddf7f58a6edb?tabId=contractCode), not on mainnet.
  - Introduced with v1.10.0 in Dec 2022, not been used after a test drive in testnet.
- `kip103/TreasuryRebalance.sol`: The [KIP-103](https://github.com/klaytn/kips/blob/main/KIPs/kip-103.md) treasury rebalance implementation.
  - Deployed instances: [testnet](https://baobab.klaytnscope.com/account/0xD5ad6D61Dd87EdabE2332607C328f5cc96aeCB95?tabId=contractCode), [mainnet](https://klaytnscope.com/account/0xD5ad6D61Dd87EdabE2332607C328f5cc96aeCB95?tabId=contractCode)
  - Introduced with v1.10.2 in Mar 2023, activated at the KIP-103 hardfork blocks and now finalized.
- `kip113/SimpleBlsRegistry.sol`: The [KIP-113](https://github.com/klaytn/kips/blob/main/KIPs/kip-113.md) BLS public key registry.
  - Deployed instances: testnet ([proxy](https://baobab.klaytnscope.com/account/0x4BEed0651C46aE5a7CB3b7737345d2ee733789e6?tabId=contractCode), [logic](https://baobab.klaytnscope.com/account/0x6751096fe72d835307d7e635aed51296948b93c5?tabId=contractCode)), mainnet ([proxy](https://klaytnscope.com/account/0x3e80e75975bdb8e04B800485DD28BebeC6d97679?tabId=contractCode), [logic](https://klaytnscope.com/account/0xb5ed8d6edd437a0d6ae828580c0aef5678d87f1a?tabId=contractCode))
  - Introduced with v1.12.0 in Dec 2023. active to date.
- `kip149/Registry.sol`: The [KIP-146](https://github.com/klaytn/kips/blob/main/KIPs/kip-146.md) system contract registry.
  - Deployed at address 0x401 via [hardfork](../consensus/istanbul/backend/engine.go#L547): [testnet](https://baobab.klaytnfinder.io/account/0x0000000000000000000000000000000000000401), [mainnet](https://www.klaytnfinder.io/account/0x0000000000000000000000000000000000000401)
  - Introduced with v1.12.0 in Dec 2023. active to date.
- `kip163/CnStakingV3MultiSig.sol`: TBA.
  - Not deployed yet.
- `kip163/PublicDelegation.sol`: TBA.
  - Not deployed yet.
- `misc/credit.sol`: The credit data.
  - Deployed at address [0x0](https://klaytnscope.com/account/0x0000000000000000000000000000000000000000?tabId=contractCode), not on testnet.
  - Deployed at the [genesis block](/blockchain/genesis_alloc.go) in 2018, relevant to date.
- `proxy/proxy.sol`: The ERC1967 Upgradable Proxy.
