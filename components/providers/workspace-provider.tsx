'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { Profile, MatchResponse } from '@/frontend/types';

interface WorkspaceContextValue {
  profile: Profile | null;
  results: MatchResponse | null;
  isStale: boolean;
  setProfile: (profile: Profile | null) => void;
  setResults: (results: MatchResponse | null) => void;
  markStale: () => void;
  clearWorkspace: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [results, setResultsState] = useState<MatchResponse | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);

  const setProfile = useCallback((newProfile: Profile | null) => {
    setProfileState(newProfile);
    setIsStale(true);
  }, []);

  const setResults = useCallback((newResults: MatchResponse | null) => {
    setResultsState(newResults);
    setIsStale(false);
  }, []);

  const markStale = useCallback(() => {
    setIsStale(true);
  }, []);

  const clearWorkspace = useCallback(() => {
    setProfileState(null);
    setResultsState(null);
    setIsStale(false);
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        profile,
        results,
        isStale,
        setProfile,
        setResults,
        markStale,
        clearWorkspace,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
