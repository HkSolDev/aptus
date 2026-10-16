'use client';

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';

type ReviewState = {
  saved: string[];
  setSaved: Dispatch<SetStateAction<string[]>>;
  hidden: string[];
  setHidden: Dispatch<SetStateAction<string[]>>;
  profile: ReviewProfile;
  setProfile: Dispatch<SetStateAction<ReviewProfile>>;
  views: Record<'recommendations' | 'saved', ReviewListView>;
  setViews: Dispatch<
    SetStateAction<Record<'recommendations' | 'saved', ReviewListView>>
  >;
};

export type ReviewListView = {
  search: string;
  qualification: '' | 'TWELFTH' | 'DIPLOMA' | 'BACHELORS';
  sort: 'soonest' | 'furthest';
  layout: 'rows' | 'cards';
  showingHidden: boolean;
};
export const defaultReviewView: ReviewListView = {
  search: '',
  qualification: '',
  sort: 'soonest',
  layout: 'cards',
  showingHidden: false,
};

export type ReviewQualification = {
  level: string;
  degree: string;
  subject: string;
};
type ReviewProfile = {
  dob: string;
  category: string;
  qualifications: ReviewQualification[];
};

const Context = createContext<ReviewState | null>(null);

// Mounted only by the development review layout. Nothing is persisted.
export function DesignReviewProvider({ children }: { children: ReactNode }) {
  const [views, setViews] = useState({
    recommendations: defaultReviewView,
    saved: defaultReviewView,
  });
  const [saved, setSaved] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [profile, setProfile] = useState<ReviewProfile>({
    dob: '1998-06-15',
    category: 'Prefer not to say',
    qualifications: [
      {
        level: 'Graduation',
        degree: 'BTech',
        subject: 'Mechanical Engineering',
      },
      { level: 'Diploma', degree: 'Diploma', subject: 'Electronics' },
    ],
  });
  return (
    <Context.Provider
      value={{
        saved,
        setSaved,
        hidden,
        setHidden,
        profile,
        setProfile,
        views,
        setViews,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useDesignReview() {
  return useContext(Context);
}
