import { cloneTemplate, find } from './dom.js';
import type { EducationEntry, EducationLevel } from './types.js';

export function setupEducation(entries: EducationEntry[] = []): void {
  const list = find('#education-list');
  list.replaceChildren();
  let nextRow = 0;

  function refreshRemoveButtons(): void {
    const rows = list.querySelectorAll('.education-row');
    rows.forEach((row) => {
      find<HTMLButtonElement>('.remove-education', row).hidden =
        rows.length === 1;
    });
  }

  function addRow(entry?: EducationEntry): HTMLElement {
    const row = cloneTemplate<HTMLElement>('education-template');
    const level = find<HTMLSelectElement>('[name="eduLevel"]', row);
    const marks = find<HTMLInputElement>('[name="eduMarks"]', row);
    level.id = `education-level-${nextRow}`;
    marks.id = `education-marks-${nextRow++}`;
    level.value = entry?.level ?? '';
    marks.value = entry?.marksPercent?.toString() ?? '';
    find<HTMLButtonElement>('.remove-education', row).addEventListener(
      'click',
      () => {
        row.remove();
        refreshRemoveButtons();
        find('#add-education').focus();
        list.dispatchEvent(new Event('change', { bubbles: true }));
      },
    );
    list.append(row);
    refreshRemoveButtons();
    return row;
  }

  (entries.length ? entries : [undefined]).forEach(addRow);
  find('#add-education').addEventListener('click', () => {
    const row = addRow();
    find('select', row).focus();
    list.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // A corrected selection should be allowed to submit after a duplicate-level error.
  list.addEventListener('change', () => {
    list
      .querySelectorAll<HTMLSelectElement>('select')
      .forEach((select) => select.setCustomValidity(''));
  });
}

export function readEducation(): EducationEntry[] {
  return Array.from(document.querySelectorAll('.education-row'), (row) => {
    const level = find<HTMLSelectElement>('[name="eduLevel"]', row).value as
      EducationLevel | '';
    const marks = find<HTMLInputElement>('[name="eduMarks"]', row).value;
    return { level, marksPercent: marks === '' ? null : Number(marks) };
  });
}

export function validateEducation(): boolean {
  const used = new Set<string>();
  for (const select of document.querySelectorAll<HTMLSelectElement>(
    '[name="eduLevel"]',
  )) {
    if (used.has(select.value)) {
      select.setCustomValidity(
        'This qualification level is already listed. Edit its existing row instead.',
      );
      select.reportValidity();
      return false;
    }
    used.add(select.value);
  }
  return true;
}
