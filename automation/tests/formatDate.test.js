import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddmmyyyyToIso } from '../src/formatDate.js';

test('converte DDMMYYYY para YYYY-MM-DD', () => {
  assert.equal(ddmmyyyyToIso('01062026'), '2026-06-01');
  assert.equal(ddmmyyyyToIso('31122025'), '2025-12-31');
});
