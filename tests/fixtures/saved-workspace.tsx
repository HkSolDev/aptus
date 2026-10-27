import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  WorkspaceProvider,
  useWorkspace,
} from '../../components/providers/workspace-provider';
import { SaveJobButton } from '../../components/jobs/save-job-button';
import { ProfileForm } from '../../components/profile/profile-form';
import { ProfileAccess } from '../../components/profile/profile-access';
import { SavedJobsView } from '../../components/results/saved-jobs-view';

function Controls() {
  const w = useWorkspace();
  useEffect(() => {
    w.setSessionChecked(true);
  }, [w.setSessionChecked]);
  const login = (id: string | null) => {
    w.setAccountId(id);
    w.setAccountName(id ? 'Same display name' : null);
  };
  return (
    <>
      <button onClick={() => login('account-a')}>Account A</button>
      <button onClick={() => login('account-b')}>Account B</button>
      <button onClick={() => login(null)}>Logout</button>
      <button onClick={() => void w.unsaveJob('job-0').catch(() => {})}>
        Unsave first
      </button>
      <output id="saved-state">{[...w.savedJobIds].sort().join(',')}</output>
      {new URLSearchParams(location.search).get('view') === 'profile' ? (
        <ProfileAccess>
          <ProfileForm />
        </ProfileAccess>
      ) : new URLSearchParams(location.search).get('view') === 'saved' ? (
        <SavedJobsView />
      ) : (
        Array.from({ length: 60 }, (_, i) => (
          <div key={i} data-job={i}>
            <SaveJobButton id={`job-${i}`} />
          </div>
        ))
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <WorkspaceProvider>
    <Controls />
  </WorkspaceProvider>,
);
