import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapAnswer, MAPPING_VERSION } from './mtoFieldMapping.js';

test('MAPPING_VERSION is a stable integer', () => {
  assert.equal(MAPPING_VERSION, 1);
});

test('matches by configured question_id first, ignoring the label', () => {
  const field = mapAnswer(
    { questionId: 999, formattedName: 'Some unrelated label' },
    { questionIdMap: { '999': 'target_customer' } },
  );
  assert.equal(field, 'target_customer');
});

test('falls back to label matching when question_id is not in the map', () => {
  assert.equal(mapAnswer({ questionId: 111, formattedName: 'Who usually buys this product?' }), 'target_customer');
  assert.equal(mapAnswer({ questionId: 111, formattedName: 'What should shoppers understand first?' }), 'messaging');
  assert.equal(mapAnswer({ questionId: 111, formattedName: 'Where will you share this page?' }), 'traffic_source');
  assert.equal(mapAnswer({ questionId: 111, formattedName: 'Which Etsy product should this page promote?' }), 'product_url');
  assert.equal(mapAnswer({ questionId: 111, formattedName: 'Upload your product photos and brand assets' }), 'assets');
});

test('label matching is case-insensitive', () => {
  assert.equal(mapAnswer({ questionId: null, formattedName: 'WHO USUALLY BUYS THIS PRODUCT?' }), 'target_customer');
});

test('returns unmapped when neither question_id nor label matches anything known', () => {
  assert.equal(mapAnswer({ questionId: 42, formattedName: 'Gift wrap color?' }), 'unmapped');
});

test('returns unmapped when formattedName is missing entirely', () => {
  assert.equal(mapAnswer({ questionId: null, formattedName: undefined }), 'unmapped');
});
