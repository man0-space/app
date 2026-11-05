import assert from 'node:assert/strict';
import test from 'node:test';
import {
  explorerAccountUrl,
  externalWalletExplorerUrl,
  getContractAddresses,
  shortenInlineAddresses,
} from '../src/lib/contracts';

test('explorerAccountUrl maps 0u... universal accounts to the configured NEAR network explorer', () => {
  const { network } = getContractAddresses();
  const addr = '0uv4zk76ahgxd8az198c2dpd52jk8ek7apj5ncp0a1he0nbdrefatg';
  const url = explorerAccountUrl(addr);
  if (network === 'testnet') {
    assert.equal(url, `https://testnet.nearblocks.io/address/${addr}`);
  } else {
    assert.equal(url, `https://nearblocks.io/address/${addr}`);
  }
  assert.equal(
    explorerAccountUrl(addr, 'testnet'),
    `https://testnet.nearblocks.io/address/${addr}`,
  );
  assert.equal(
    explorerAccountUrl(addr, 'mainnet'),
    `https://nearblocks.io/address/${addr}`,
  );
});

test('externalWalletExplorerUrl resolves NEAR, EVM, and SVM explorer links accurately', () => {
  const evm = '0x89caf60b0e742b9299e14d611b205870207b5ce3';
  const svm = '139ckThCRxYDDFXgfRjH4TCiaTJETbb1UMLwACvWJ1fq';
  assert.equal(externalWalletExplorerUrl('evm', evm), `https://etherscan.io/address/${evm}`);
  assert.equal(externalWalletExplorerUrl('svm', svm), `https://solscan.io/account/${svm}`);
});

test('shortenInlineAddresses shortens NEAR 0u, EVM 0x, Solana base58, hex hashes, and long named accounts while preserving prose and URLs', () => {
  assert.equal(
    shortenInlineAddresses('0uv4zk76ahgxd8az198c2dpd52jk8ek7apj5ncp0a1he0nbdrefatg'),
    '0uv4zk…fatg',
  );
  assert.equal(
    shortenInlineAddresses('Copy EVM · 0x89caf60b0e742b9299e14d611b205870207b5ce3'),
    'Copy EVM · 0x89ca…5ce3',
  );
  assert.equal(
    shortenInlineAddresses('Solana (139ckThCRxYDDFXgfRjH4TCiaTJETbb1UMLwACvWJ1fq)'),
    'Solana (139ckT…J1fq)',
  );
  assert.equal(
    shortenInlineAddresses('super-long-workflow-registry-v2.testnet'),
    'super-lo…estnet',
  );
  assert.equal(
    shortenInlineAddresses('Open your public creator page'),
    'Open your public creator page',
  );
  assert.equal(
    shortenInlineAddresses('https://nearblocks.io/txns/139ckThCRxYDDFXgfRjH4TCiaTJETbb1UMLwACvWJ1fq'),
    'https://nearblocks.io/txns/139ckThCRxYDDFXgfRjH4TCiaTJETbb1UMLwACvWJ1fq',
  );
});
