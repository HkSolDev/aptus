import { matchProfile } from './api.js';
import { saveProfileApi } from './profile-api.js';
import { find } from './dom.js';
import {
  readEducation,
  setupEducation,
  validateEducation,
} from './education.js';
import { loadProfile, saveProfile } from './profile-storage.js';
import {
  markResultsStale,
  renderResults,
  setResultsLoading,
} from './results.js';
import type { Profile } from './types.js';

const form = find<HTMLFormElement>('#match-form');
const fields = find<HTMLFieldSetElement>('#profile-fields');
const submit = find<HTMLButtonElement>('#submit-profile');
const remember = find<HTMLInputElement>('#remember-profile');
const errorBox = find('#form-error');
const name = find<HTMLInputElement>('[name="name"]');
const dob = find<HTMLInputElement>('[name="dob"]');
const category = find<HTMLSelectElement>('[name="category"]');
const restored = loadProfile();
let userId = restored?.userId;

setupEducation(restored?.educations);
if (restored) {
  name.value = restored.name ?? '';
  dob.value = restored.dob;
  category.value = restored.category ?? '';
  remember.checked = true;
  find('#storage-status').textContent =
    'Restored your browser profile. Check again for current results.';
}
// Use the local calendar date, avoiding UTC shifting the maximum by one day.
const today = new Date();
dob.max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
fields.disabled = false;
find('#startup-status').hidden = true;

function readProfile(): Profile {
  return {
    userId,
    name: name.value.trim() || undefined,
    dob: dob.value,
    category: category.value || null,
    educations: readEducation(),
  };
}

function persistProfile(): void {
  const saved = saveProfile(remember.checked ? readProfile() : null);
  find('#storage-status').textContent = !saved
    ? 'Browser storage is unavailable. You can still check matches.'
    : remember.checked
      ? 'Your profile is remembered in this browser.'
      : '';
}

function profileChanged(): void {
  errorBox.hidden = true;
  markResultsStale();
  persistProfile();
}
form.addEventListener('input', profileChanged);
form.addEventListener('change', profileChanged);
find('#clear-profile').addEventListener('click', () => {
  remember.checked = false;
  const cleared = saveProfile(null);
  find('#storage-status').textContent = cleared
    ? 'Browser copy cleared. Your current form and database profile are unchanged.'
    : 'Couldn’t clear browser storage. Use your browser’s site-data settings.';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (fields.disabled || !validateEducation() || !form.reportValidity()) return;
  errorBox.hidden = true;
  const profile = readProfile();
  fields.disabled = true;
  form.setAttribute('aria-busy', 'true');
  submit.textContent = 'Checking your matches…';
  setResultsLoading(true);
  // Keep an older result visibly marked until this request succeeds.
  markResultsStale();
  try {
    await saveProfileApi({
      dob: profile.dob,
      category: profile.category,
      educations: profile.educations.flatMap(({ level, marksPercent }) =>
        level ? [{ level, marksPercent }] : [],
      ),
    });
    const data = await matchProfile();
    userId = data.userId;
    persistProfile();
    renderResults(data);
  } catch (error) {
    errorBox.textContent =
      error instanceof Error
        ? error.message
        : 'Couldn’t check your profile. Please try again.';
    errorBox.hidden = false;
    find('#results-status').textContent =
      'The check couldn’t finish. Your form is preserved; use Find my matches to try again.';
  } finally {
    fields.disabled = false;
    form.setAttribute('aria-busy', 'false');
    submit.textContent = 'Find my matches ↗';
    setResultsLoading(false);
  }
});
