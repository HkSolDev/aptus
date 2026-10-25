'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type {
  Profile,
  MatchResponse,
  SavedProfile,
} from '../../frontend/types';
import {
  fetchSavedStatus,
  saveJobApi,
  unsaveJobApi,
} from '../../frontend/saved-jobs-api';

interface WorkspaceContextValue {
  accountId: string | null;
  setAccountId: (id: string | null) => void;
  sessionVersion: number;
  savedStatusError: string | null;
  isJobStatusChecked: (id: string) => boolean;
  accountName: string | null;
  setAccountName: (name: string | null) => void;
  sessionChecked: boolean;
  setSessionChecked: (checked: boolean) => void;
  profile: Profile | null;
  savedProfile: SavedProfile | null;
  setSavedProfile: (profile: SavedProfile | null) => void;
  results: MatchResponse | null;
  isStale: boolean;
  setProfile: (profile: Profile | null) => void;
  setResults: (results: MatchResponse | null) => void;
  markStale: () => void;
  clearWorkspace: () => void;
  savedJobIds: Set<string>;
  isJobSaved: (jobId: string) => boolean;
  checkSavedStatus: (jobIds: string[]) => void;
  saveJob: (jobId: string) => Promise<boolean>;
  unsaveJob: (jobId: string) => Promise<boolean>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountIdState] = useState<string | null>(null);
  const identityRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [savedStatusError, setSavedStatusError] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [savedProfile, setSavedProfileState] = useState<SavedProfile | null>(
    null,
  );
  const [results, setResultsState] = useState<MatchResponse | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [checkedJobIds, setCheckedJobIds] = useState<Set<string>>(new Set());

  const pendingStatusIdsRef = useRef<Set<string>>(new Set());
  const statusBatchScheduledRef = useRef<number | null>(null);
  const failedIdsRef = useRef(new Set<string>());
  const checkedIdsRef = useRef(new Set<string>());
  const inFlightIdsRef = useRef(new Set<string>());
  const jobVersionsRef = useRef(new Map<string, number>());

  const setProfile = useCallback(
    (newProfile: Profile | null) => {
      if (generationRef.current !== sessionVersion) return;
      setProfileState(newProfile);
      setIsStale(true);
    },
    [sessionVersion],
  );

  const setSavedProfile = useCallback(
    (newProfile: SavedProfile | null) => {
      if (generationRef.current !== sessionVersion) return;
      setSavedProfileState(newProfile);
    },
    [sessionVersion],
  );

  const setResults = useCallback(
    (newResults: MatchResponse | null) => {
      if (generationRef.current !== sessionVersion) return;
      setResultsState(newResults);
      setIsStale(false);
    },
    [sessionVersion],
  );

  const markStale = useCallback(() => {
    setIsStale(true);
  }, []);

  const isJobSaved = useCallback(
    (jobId: string) => savedJobIds.has(jobId),
    [savedJobIds],
  );

  const isJobStatusChecked = useCallback(
    (id: string) => checkedJobIds.has(id),
    [checkedJobIds],
  );

  const checkSavedStatus = useCallback((jobIds: string[]) => {
    if (!identityRef.current) return;
    for (const id of [...failedIdsRef.current, ...jobIds]) {
      if (!checkedIdsRef.current.has(id) && !inFlightIdsRef.current.has(id))
        pendingStatusIdsRef.current.add(id);
    }
    const generation = generationRef.current;
    if (
      !pendingStatusIdsRef.current.size ||
      statusBatchScheduledRef.current === generation
    )
      return;
    statusBatchScheduledRef.current = generation;
    setSavedStatusError(null);
    queueMicrotask(async () => {
      while (
        generation === generationRef.current &&
        pendingStatusIdsRef.current.size
      ) {
        const batch = [...pendingStatusIdsRef.current].slice(0, 50);
        const versions = new Map(
          batch.map((id) => [id, jobVersionsRef.current.get(id) ?? 0]),
        );
        batch.forEach((id) => {
          pendingStatusIdsRef.current.delete(id);
          inFlightIdsRef.current.add(id);
        });
        try {
          const saved = new Set(await fetchSavedStatus(batch));
          if (generation !== generationRef.current) return;
          const current = batch.filter(
            (id) => versions.get(id) === (jobVersionsRef.current.get(id) ?? 0),
          );
          current.forEach((id) => {
            checkedIdsRef.current.add(id);
            failedIdsRef.current.delete(id);
          });
          setSavedStatusError(
            failedIdsRef.current.size
              ? 'Couldn’t check saved jobs. Try again.'
              : null,
          );
          setCheckedJobIds(new Set(checkedIdsRef.current));
          setSavedJobIds((prev) => {
            const next = new Set(prev);
            current.forEach((id) => {
              if (saved.has(id)) next.add(id);
              else next.delete(id);
            });
            return next;
          });
        } catch {
          if (generation === generationRef.current) {
            batch.forEach((id) => failedIdsRef.current.add(id));
            setSavedStatusError('Couldn’t check saved jobs. Try again.');
          }
        } finally {
          if (generation === generationRef.current)
            batch.forEach((id) => inFlightIdsRef.current.delete(id));
        }
      }
      if (generation === generationRef.current)
        statusBatchScheduledRef.current = null;
    });
  }, []);

  const updateSavedJob = useCallback(async (jobId: string, save: boolean) => {
    if (!identityRef.current) throw new Error('Please sign in again.');
    const generation = generationRef.current;
    const version = (jobVersionsRef.current.get(jobId) ?? 0) + 1;
    jobVersionsRef.current.set(jobId, version);
    try {
      const saved = await (save ? saveJobApi(jobId) : unsaveJobApi(jobId));
      if (
        generation !== generationRef.current ||
        jobVersionsRef.current.get(jobId) !== version
      ) {
        throw new Error('Your session changed. Please try again.');
      }
      checkedIdsRef.current.add(jobId);
      setCheckedJobIds(new Set(checkedIdsRef.current));
      setSavedJobIds((prev) => {
        const next = new Set(prev);
        if (saved) next.add(jobId);
        else next.delete(jobId);
        return next;
      });
      return saved;
    } catch (error) {
      if (
        generation === generationRef.current &&
        jobVersionsRef.current.get(jobId) === version
      ) {
        checkedIdsRef.current.delete(jobId);
        failedIdsRef.current.add(jobId);
        setCheckedJobIds(new Set(checkedIdsRef.current));
        setSavedStatusError('Couldn’t confirm saved status. Try again.');
      }
      throw error;
    }
  }, []);
  const saveJob = useCallback(
    (id: string) => updateSavedJob(id, true),
    [updateSavedJob],
  );
  const unsaveJob = useCallback(
    (id: string) => updateSavedJob(id, false),
    [updateSavedJob],
  );

  const clearWorkspace = useCallback(() => {
    generationRef.current += 1;
    setSessionVersion(generationRef.current);
    setProfileState(null);
    setSavedProfileState(null);
    setResultsState(null);
    setIsStale(false);
    setSavedJobIds(new Set());
    setCheckedJobIds(new Set());
    setSavedStatusError(null);
    checkedIdsRef.current.clear();
    failedIdsRef.current.clear();
    pendingStatusIdsRef.current.clear();
    inFlightIdsRef.current.clear();
    jobVersionsRef.current.clear();
    statusBatchScheduledRef.current = null;
  }, []);
  const setAccountId = useCallback(
    (id: string | null) => {
      if (identityRef.current !== id) {
        identityRef.current = id;
        clearWorkspace();
        setAccountIdState(id);
      }
    },
    [clearWorkspace],
  );

  return (
    <WorkspaceContext.Provider
      value={{
        accountId,
        setAccountId,
        sessionVersion,
        savedStatusError,
        isJobStatusChecked,
        accountName,
        setAccountName,
        sessionChecked,
        setSessionChecked,
        profile,
        savedProfile,
        setSavedProfile,
        results,
        isStale,
        setProfile,
        setResults,
        markStale,
        clearWorkspace,
        savedJobIds,
        isJobSaved,
        checkSavedStatus,
        saveJob,
        unsaveJob,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

const defaultWorkspaceValue: WorkspaceContextValue = {
  accountId: null,
  setAccountId: () => {},
  sessionVersion: 0,
  savedStatusError: null,
  isJobStatusChecked: () => false,
  accountName: null,
  setAccountName: () => {},
  sessionChecked: false,
  setSessionChecked: () => {},
  profile: null,
  savedProfile: null,
  setSavedProfile: () => {},
  results: null,
  isStale: false,
  setProfile: () => {},
  setResults: () => {},
  markStale: () => {},
  clearWorkspace: () => {},
  savedJobIds: new Set<string>(),
  isJobSaved: () => false,
  checkSavedStatus: () => {},
  saveJob: async () => false,
  unsaveJob: async () => false,
};

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  return context ?? defaultWorkspaceValue;
}
