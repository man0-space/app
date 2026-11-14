import assert from 'node:assert/strict';
import test from 'node:test';
import {
  api,
  type IntentLeg,
} from '../src/lib/api';
import {
  type EvmProvider,
  requestEvmAccounts,
  resetEip6963ProvidersForTesting,
  sendEvmOriginTransfer,
} from '../src/lib/intents';

const ACCT_OLD = '0x89caF60B0e742b9299E14d611b205870207b5cE3';
const ACCT_NEW_CHECKSUM = '0x058271E764154c322F3D3ddc18AF44F7d91B1C80';
const ACCT_NEW_LOWER = ACCT_NEW_CHECKSUM.toLowerCase();
const DEPOSIT_ADDR = '0x138E78ACa384F5a7801EC420d735af442bf5a472';

function installMockWindow(
  announcements: Array<{ rdns: string; name: string; provider: EvmProvider }>,
): () => void {
  const prevWindow = (globalThis as { window?: unknown }).window;
  const target = new EventTarget();
  const mockWin = Object.assign(target, {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
  });

  mockWin.addEventListener('eip6963:requestProvider', () => {
    for (const entry of announcements) {
      mockWin.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: {
            info: { uuid: entry.rdns, rdns: entry.rdns, name: entry.name },
            provider: entry.provider,
          },
        }),
      );
    }
  });

  resetEip6963ProvidersForTesting();
  (globalThis as { window?: unknown }).window = mockWin;

  return () => {
    resetEip6963ProvidersForTesting();
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  };
}

function makeArbSepoliaLeg(originWalletAddress = ACCT_NEW_LOWER): IntentLeg {
  return {
    source: 'external',
    depositType: 'ORIGIN_CHAIN',
    originToken: {
      assetId: 'nep141:arb-sepolia.omft.testnet',
      decimals: 18,
      blockchain: 'arb',
      symbol: 'ETH',
      price: 1820,
    },
    originChainLabel: 'Arbitrum Sepolia',
    originExplorerUrl: 'https://sepolia.arbiscan.io',
    originWalletNetwork: 'evm',
    originWalletAddress,
    hexChainId: '0x66eee',
    destinationToken: {
      assetId: 'nep141:usdc.fakes.testnet',
      decimals: 6,
      blockchain: 'near',
      symbol: 'USDC',
      price: 1,
    },
    destinationChainLabel: 'NEAR Testnet',
    recipientAddress: '0u9nc7hf4p9rq8tcm4gnvgv1nkgd6cvwb0cnmcxxf5cxr9ncf749fg',
    amountAtomic: '5469000000000000',
    displayAmount: '0.005469',
    quote: {
      depositAddress: DEPOSIT_ADDR,
      amountIn: '5469000000000000',
      amountInFormatted: '0.005469',
      amountOut: '9944138',
      amountOutFormatted: '9.944138',
    },
  };
}

test('Multi-account Chrome (MetaMask Account 1 + Phantom installed): sendEvmOriginTransfer authorizes Account 2 via wallet_requestPermissions, re-verifies CAIP-25 post-switch, and never touches Phantom', async (t) => {
  const metamaskCalls: string[] = [];
  const phantomCalls: string[] = [];
  let chainId = '0x1';
  let authorizedAccounts = [ACCT_OLD];
  const submittedDeposits: Array<{ txHash: string; depositAddress: string }> = [];

  t.mock.method(api, 'intentsDeposit', async (payload: { txHash: string; depositAddress: string }) => {
    submittedDeposits.push(payload);
    return {};
  });

  const metamaskProvider: EvmProvider = {
    request: async ({ method, params }) => {
      metamaskCalls.push(method);
      if (method === 'eth_accounts') {
        return authorizedAccounts;
      }
      if (method === 'wallet_requestPermissions') {
        // User checks Account 2 in MetaMask permission picker
        authorizedAccounts = [ACCT_NEW_CHECKSUM, ACCT_OLD];
        return [
          {
            parentCapability: 'eth_accounts',
            caveats: [{ type: 'restrictReturnedAccounts', value: authorizedAccounts }],
          },
        ];
      }
      if (method === 'eth_requestAccounts') {
        // Without wallet_requestPermissions, MetaMask silently returns existing authorizedAccounts
        return authorizedAccounts;
      }
      if (method === 'eth_chainId') {
        return chainId;
      }
      if (method === 'wallet_switchEthereumChain') {
        chainId = (params?.[0] as { chainId: string }).chainId;
        return null;
      }
      if (method === 'eth_getBlockByNumber') {
        return { baseFeePerGas: '0x5f5e100' };
      }
      if (method === 'eth_gasPrice') {
        return '0x5f5e100';
      }
      if (method === 'eth_maxPriorityFeePerGas') {
        return '0xf4240';
      }
      if (method === 'eth_estimateGas') {
        return '0x5208';
      }
      if (method === 'eth_getBalance') {
        return '0x4900e7ad5ccec000'; // ~0.32875 ETH
      }
      if (method === 'eth_sendTransaction') {
        const tx = (params?.[0] ?? {}) as { from?: string };
        if (
          chainId !== '0x66eee' ||
          !authorizedAccounts.some((a) => a.toLowerCase() === tx.from?.toLowerCase())
        ) {
          throw Object.assign(
            new Error('The requested account and/or method has not been authorized by the user.'),
            { code: 4100 },
          );
        }
        return '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678';
      }
      return null;
    },
  };

  const phantomProvider: EvmProvider = {
    request: async ({ method }) => {
      phantomCalls.push(method);
      if (method === 'eth_accounts') return [];
      throw Object.assign(
        new Error('The requested account and/or method has not been authorized by the user.'),
        { code: 4100 },
      );
    },
  };

  const cleanup = installMockWindow([
    { rdns: 'app.phantom', name: 'Phantom', provider: phantomProvider },
    { rdns: 'io.metamask', name: 'MetaMask', provider: metamaskProvider },
  ]);

  try {
    const res = await sendEvmOriginTransfer({
      leg: makeArbSepoliaLeg(ACCT_NEW_LOWER),
      depositAddress: DEPOSIT_ADDR,
    });

    assert.equal(res.txHash, '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678');
    assert.equal(res.sender, ACCT_NEW_CHECKSUM);

    // Phantom may only be passively inspected via eth_accounts, NEVER prompted interactively
    assert.deepEqual(phantomCalls, ['eth_accounts']);

    // MetaMask must receive wallet_requestPermissions so Account 2 gets authorized
    assert.ok(
      metamaskCalls.includes('wallet_requestPermissions'),
      'Expected wallet_requestPermissions on MetaMask when Account 2 was not yet authorized',
    );

    // CAIP-25: eth_requestAccounts must also run AFTER wallet_switchEthereumChain
    const switchIdx = metamaskCalls.indexOf('wallet_switchEthereumChain');
    const postSwitchReqIdx = metamaskCalls.lastIndexOf('eth_requestAccounts');
    assert.ok(switchIdx >= 0 && postSwitchReqIdx > switchIdx);

    assert.equal(submittedDeposits.length, 1);
    assert.equal(submittedDeposits[0]!.depositAddress, DEPOSIT_ADDR);
  } finally {
    cleanup();
  }
});

test('requestEvmAccounts with forceAccountPicker prompts wallet_requestPermissions and skips excludeAddresses', async () => {
  let permissionsRequested = false;

  const metamaskProvider: EvmProvider = {
    request: async ({ method }) => {
      if (method === 'eth_accounts') {
        return [ACCT_OLD];
      }
      if (method === 'wallet_requestPermissions') {
        permissionsRequested = true;
        return [
          {
            parentCapability: 'eth_accounts',
            caveats: [{ type: 'restrictReturnedAccounts', value: [ACCT_OLD, ACCT_NEW_CHECKSUM] }],
          },
        ];
      }
      if (method === 'eth_requestAccounts') {
        return permissionsRequested ? [ACCT_OLD, ACCT_NEW_CHECKSUM] : [ACCT_OLD];
      }
      return null;
    },
  };

  const cleanup = installMockWindow([
    { rdns: 'io.metamask', name: 'MetaMask', provider: metamaskProvider },
  ]);

  try {
    const picked = await requestEvmAccounts(undefined, {
      forceAccountPicker: true,
      excludeAddresses: [ACCT_OLD],
    });
    assert.equal(permissionsRequested, true);
    assert.equal(picked.sender, ACCT_NEW_CHECKSUM);
    assert.equal(picked.rdns, 'io.metamask');
    assert.equal(picked.walletName, 'MetaMask');
  } finally {
    cleanup();
  }
});

test('sendEvmOriginTransfer recovers from EIP-1193 4100 via single permission refresh and never double-sends on 4001 or -32002', async (t) => {
  t.mock.method(api, 'intentsDeposit', async () => ({}));

  // Part 1: Recoverable 4100 on first eth_sendTransaction
  let sendAttempts = 0;
  let reauthorized = false;
  const recoveringProvider: EvmProvider = {
    request: async ({ method }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
        return [ACCT_NEW_CHECKSUM];
      }
      if (method === 'eth_chainId') {
        return '0x66eee';
      }
      if (method === 'eth_getBlockByNumber') {
        return { baseFeePerGas: '0x5f5e100' };
      }
      if (method === 'wallet_requestPermissions') {
        reauthorized = true;
        return [
          {
            parentCapability: 'eth_accounts',
            caveats: [{ type: 'restrictReturnedAccounts', value: [ACCT_NEW_CHECKSUM] }],
          },
        ];
      }
      if (method === 'eth_sendTransaction') {
        sendAttempts += 1;
        if (!reauthorized) {
          throw Object.assign(
            new Error('The requested account and/or method has not been authorized by the user.'),
            { code: 4100 },
          );
        }
        return '0xabc123';
      }
      return null;
    },
  };

  let cleanup = installMockWindow([
    { rdns: 'io.metamask', name: 'MetaMask', provider: recoveringProvider },
  ]);
  try {
    const res = await sendEvmOriginTransfer({
      leg: makeArbSepoliaLeg(ACCT_NEW_LOWER),
      depositAddress: DEPOSIT_ADDR,
    });
    assert.equal(res.txHash, '0xabc123');
    assert.equal(reauthorized, true);
    assert.equal(sendAttempts, 2);
  } finally {
    cleanup();
  }

  // Part 2: User rejection (4001) and pending request (-32002) NEVER trigger duplicate eth_sendTransaction
  for (const errSpec of [
    { code: 4001, message: 'User rejected the request.' },
    { code: -32002, message: 'Request of type eth_sendTransaction already pending.' },
  ]) {
    let calls = 0;
    const rejectingProvider: EvmProvider = {
      request: async ({ method }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
          return [ACCT_NEW_CHECKSUM];
        }
        if (method === 'eth_chainId') return '0x66eee';
        if (method === 'eth_getBlockByNumber') return { baseFeePerGas: '0x5f5e100' };
        if (method === 'eth_sendTransaction') {
          calls += 1;
          throw Object.assign(new Error(errSpec.message), { code: errSpec.code });
        }
        return null;
      },
    };
    cleanup = installMockWindow([
      { rdns: 'io.metamask', name: 'MetaMask', provider: rejectingProvider },
    ]);
    try {
      await assert.rejects(
        () =>
          sendEvmOriginTransfer({
            leg: makeArbSepoliaLeg(ACCT_NEW_LOWER),
            depositAddress: DEPOSIT_ADDR,
          }),
      );
      assert.equal(calls, 1, `Expected strictly 1 eth_sendTransaction attempt for code ${errSpec.code}`);
    } finally {
      cleanup();
    }
  }
});
