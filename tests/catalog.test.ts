import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_PILLOW_ID,
  buildBannerBrandLogos,
  buildFamilyCounts,
  displayGroupLabel,
  displaySubgroupLabel,
  MODEL_MODALITY_ORDER,
  resolveEntryLogoUrl,
  sortCatalogEntries,
} from '../src/lib/catalog';
import type { Entry } from '../src/lib/schema';

test('MODEL_MODALITY_ORDER exposes text, image, video, music, embeddings, others', () => {
  assert.deepEqual(MODEL_MODALITY_ORDER, [
    'text',
    'image',
    'video',
    'music',
    'embeddings',
    'others',
  ]);
  assert.equal(displayGroupLabel('model', ALL_PILLOW_ID), 'all');
  assert.equal(displayGroupLabel('connector', 'mcps'), 'mcp');
  assert.equal(displayGroupLabel('connector', 'onchain'), 'defi');
  assert.equal(displayGroupLabel('connector', 'accounts'), 'accounts');
});

test('displaySubgroupLabel formats compose-market operations and others/* modalities cleanly', () => {
  assert.equal(displaySubgroupLabel('text/vision-chat'), 'vision');
  assert.equal(displaySubgroupLabel('image/text-to-image'), 'txt2img');
  assert.equal(displaySubgroupLabel('others/speech'), 'speech');
  assert.equal(displaySubgroupLabel('others/object-detection'), 'detection');
  assert.equal(displaySubgroupLabel('accounts/developer tools'), 'dev tools');
});

test('resolveEntryLogoUrl maps compose-market family logos and aggregator frontier models', () => {
  assert.equal(
    resolveEntryLogoUrl({ kind: 'model', id: 'gpt-6.1-terra', family: 'openai' }),
    '/families/openai.png',
  );
  assert.equal(
    resolveEntryLogoUrl({ kind: 'model', id: 'claude-opus-5-5', family: 'deepinfra' }),
    '/families/anthropic.png',
  );
  assert.equal(
    resolveEntryLogoUrl({ kind: 'model', id: 'gemini-4-argon', family: 'gemini' }),
    '/families/gemini-color.svg',
  );
  assert.equal(
    resolveEntryLogoUrl({
      kind: 'connector',
      id: 'account:gmail',
      logo: 'https://logos.composio.dev/api/gmail',
    }),
    'https://logos.composio.dev/api/gmail',
  );
});

test('sortCatalogEntries orders models by isFrontier > isLatest > family size descending', () => {
  const sample: Entry[] = [
    {
      id: 'small-m1',
      name: 'Small Family Model',
      description: '',
      kind: 'model',
      groups: ['text'],
      subgroups: ['text/chat'],
      family: 'smallfam',
    },
    {
      id: 'big-m1',
      name: 'Big Family 1',
      description: '',
      kind: 'model',
      groups: ['text'],
      subgroups: ['text/chat'],
      family: 'bigfam',
    },
    {
      id: 'big-m2',
      name: 'Big Family 2',
      description: '',
      kind: 'model',
      groups: ['text'],
      subgroups: ['text/chat'],
      family: 'bigfam',
    },
    {
      id: 'lat-img',
      name: 'Latest Image',
      description: '',
      kind: 'model',
      groups: ['image'],
      subgroups: ['image/text-to-image'],
      family: 'imgfam',
      isLatest: true,
    },
    {
      id: 'front-music',
      name: 'Frontier Music',
      description: '',
      kind: 'model',
      groups: ['music'],
      subgroups: ['music/text-to-audio'],
      family: 'musicfam',
      isFrontier: true,
    },
    {
      id: 'front-txt',
      name: 'Frontier Text',
      description: '',
      kind: 'model',
      groups: ['text'],
      subgroups: ['text/chat'],
      family: 'txtfam',
      isFrontier: true,
    },
  ];

  const counts = buildFamilyCounts(sample);
  const sorted = sortCatalogEntries(sample, 'model', counts);

  assert.deepEqual(
    sorted.map((e) => e.id),
    ['front-txt', 'front-music', 'lat-img', 'big-m1', 'big-m2', 'small-m1'],
  );
});

test('buildBannerBrandLogos omits relative / localhost URLs while keeping public https logos and deduplicating names', () => {
  const logos = buildBannerBrandLogos([
    {
      data: {
        kind: 'model',
        label: 'OpenAI GPT',
        note: '',
        entry: {
          id: 'gpt-5',
          name: 'GPT-5',
          description: '',
          kind: 'model',
          family: 'openai',
        },
      },
    },
    {
      data: {
        kind: 'model',
        label: 'OpenAI Mini',
        note: '',
        entry: {
          id: 'gpt-5-mini',
          name: 'GPT-5 Mini',
          description: '',
          kind: 'model',
          family: 'openai',
        },
      },
    },
    {
      data: {
        kind: 'connector',
        label: 'Gmail',
        note: '',
        entry: {
          id: 'account:gmail',
          name: 'Gmail',
          description: '',
          kind: 'connector',
          logo: 'https://logos.composio.dev/api/gmail',
        },
      },
    },
  ]);
  assert.deepEqual(logos, [
    { name: 'Openai' },
    { name: 'Gmail', url: 'https://logos.composio.dev/api/gmail' },
  ]);
});
