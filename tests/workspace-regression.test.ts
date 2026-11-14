import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mypagePath = resolve(__dirname, '../src/pages/mypage.tsx');

test('Workspace page preserves SPENT dashboard, adaptive mobile glyph tabs, mint-tx badges, and multi-wallet badges', () => {
  const src = readFileSync(mypagePath, 'utf8');

  // 1. SPENT dashboard & SectionMode
  assert.match(src, /import\s*\{\s*SpentDashboard\s*\}\s*from\s*'\.\.\/components\/dashboard\/usage'/);
  assert.match(src, /type\s+SectionMode\s*=\s*'workspace'\s*\|\s*'earn'\s*\|\s*'spent'/);
  assert.match(src, /section\s*===\s*'spent'\s*\?\s*\(\s*<SpentDashboard\s*\/>/);

  // 2. Adaptive mobile tab bar with glyphs, labels, and tooltips
  assert.match(src, /segmented\s+segmented--adaptive-mobile/);
  assert.match(src, /<FolderKanban\b[^>]*className="seg-btn-glyph"/);
  assert.match(src, /<TrendingUp\b[^>]*className="seg-btn-glyph"/);
  assert.match(src, /<Receipt\b[^>]*className="seg-btn-glyph"/);
  assert.match(src, /<span className="seg-btn-label">WORKSPACE<\/span>/);
  assert.match(src, /<span className="seg-btn-label">EARN<\/span>/);
  assert.match(src, /<span className="seg-btn-label">SPENT<\/span>/);
  assert.match(src, /<Tooltip\s+label="Workspace"/);
  assert.match(src, /<Tooltip\s+label="Earn"/);
  assert.match(src, /<Tooltip\s+label="Spent"/);

  // 3. Published workflow mint transaction badges, explorer links & .wf-card-top-meta bounds
  assert.match(src, /explorerTxUrl\(mintTxHash,\s*mintContractId\)/);
  assert.match(src, /className="wf-card-media-badge-right"/);
  assert.match(src, /wf-media-net-link/);
  assert.match(src, /<div className="wf-card-top-meta">[\s\S]*?<TaskPills/);

  // 4. Multi-wallet per-address deduplication preserved
  assert.match(src, /\$\{net\}:\$\{item\.address\.toLowerCase\(\)\}/);
});
