import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  marketCreator,
  marketWorkflow,
  parseRoute,
  workflowPageId,
  workflowPath,
} from '../src/lib/routes.ts';
import { formatMicroUsdc } from '../src/hooks/use-session.ts';

test('parses standalone /workflow/:id routes cleanly without colliding with creator slugs', () => {
  const id = '4d2e9c7a-8b10-4c9d-9e3f-123456789abc';
  const path = workflowPath(id);
  assert.equal(path, `/workflow/${id}`);
  assert.equal(parseRoute(path), 'workflow');
  assert.equal(workflowPageId(path), id);
  assert.equal(marketCreator(path), null);
  assert.equal(marketWorkflow(path), null);
});

test('preserves studio, workspace, and market creator routes', () => {
  assert.equal(parseRoute('/studio'), 'studio');
  assert.equal(parseRoute('/workspace'), 'mypage');
  assert.equal(parseRoute('/my-page'), 'mypage');
  assert.equal(parseRoute('/market'), 'market');
  assert.equal(parseRoute('/alice/research-flow'), 'market');
  assert.equal(marketCreator('/alice/research-flow'), 'alice');
  assert.equal(marketWorkflow('/alice/research-flow'), 'research-flow');
});

test('formats micro-USDC settlement amounts cleanly at 2, 4, and 6 decimal tiers', () => {
  assert.equal(formatMicroUsdc(undefined), '$0.00');
  assert.equal(formatMicroUsdc('0'), '$0.00');
  assert.equal(formatMicroUsdc('45'), '$0.000045');
  assert.equal(formatMicroUsdc('12500'), '$0.0125');
  assert.equal(formatMicroUsdc('1500000'), '$1.50');
});
