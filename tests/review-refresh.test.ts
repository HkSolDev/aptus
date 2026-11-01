import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCandidateRefresh } from '../components/admin/candidate-refresh.ts';

test('B: manual refresh keeps unsaved facts on their base revision', () => {
  const decision = resolveCandidateRefresh({
    hasUnsavedChanges: true,
    editingRevisionId: 'rev-1',
    freshRevisionId: 'rev-2',
  });
  assert.equal(decision.action, 'keep-editing');
  assert.equal(decision.editingRevisionId, 'rev-1');
});

test('B: validation-result refresh keeps unsaved facts on their base revision', () => {
  const decision = resolveCandidateRefresh({
    hasUnsavedChanges: true,
    editingRevisionId: 'rev-1',
    freshRevisionId: 'rev-2',
  });
  assert.equal(decision.action, 'keep-editing');
  assert.notEqual(decision.editingRevisionId, 'rev-2');
});

test('B: dirty refresh returning the same revision preserves editing', () => {
  const decision = resolveCandidateRefresh({
    hasUnsavedChanges: true,
    editingRevisionId: 'rev-1',
    freshRevisionId: 'rev-1',
  });
  assert.equal(decision.action, 'preserve-editing');
  assert.equal(decision.editingRevisionId, 'rev-1');
});

test('B: refresh without unsaved changes applies the fresh revision', () => {
  const decision = resolveCandidateRefresh({
    hasUnsavedChanges: false,
    editingRevisionId: 'rev-1',
    freshRevisionId: 'rev-2',
  });
  assert.equal(decision.action, 'apply-fresh');
  assert.equal(decision.editingRevisionId, 'rev-2');
});
