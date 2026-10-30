export type CandidateRefreshDecision =
  | { action: 'apply-fresh'; editingRevisionId: string }
  | { action: 'preserve-editing'; editingRevisionId: string }
  | { action: 'keep-editing'; editingRevisionId: string };

// The facts being edited stay bound to the revision they were loaded from.
// A background refresh (manual or validation polling) must never move that
// base to a newer revision while edits are unsaved.
export function resolveCandidateRefresh(input: {
  hasUnsavedChanges: boolean;
  editingRevisionId: string;
  freshRevisionId: string;
}): CandidateRefreshDecision {
  if (input.hasUnsavedChanges && input.freshRevisionId !== input.editingRevisionId) {
    return { action: 'keep-editing', editingRevisionId: input.editingRevisionId };
  }
  if (input.hasUnsavedChanges) {
    // Same revision: status/validation may refresh, editable facts may not.
    return { action: 'preserve-editing', editingRevisionId: input.editingRevisionId };
  }
  return { action: 'apply-fresh', editingRevisionId: input.freshRevisionId };
}
