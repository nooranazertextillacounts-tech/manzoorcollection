import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { collection, onSnapshot, query, where, addDoc, setDoc, updateDoc, deleteDoc, getDocs, getDoc, runTransaction, writeBatch } from '../lib/customFirestore';
import toast from 'react-hot-toast';
import { db, mainDb, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';

export interface Branch {
  id: string;
  name: string;
  color: string;
  adminEmail: string;
  phone?: string;
  phone2?: string;
  address?: string;
  onlinePhone?: string;
}

interface BranchContextType {
  branches: Branch[];
  activeBranchId: string | null; // null means 'All Branches'
  setActiveBranchId: (id: string | null) => void;
  loading: boolean;
}

const BranchContext = createContext<BranchContextType>({
  branches: [],
  activeBranchId: null,
  setActiveBranchId: () => {},
  loading: true,
});

export const useBranch = () => useContext(BranchContext);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { user, firebaseUser } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch branches as soon as we have a firebase user, in parallel with user profile fetch
  useEffect(() => {
    if (!user) {
      // If auth resolves to null, stop loading
      // (AuthContext has loading: true initially, but firebaseUser is only set to null when auth completes as signed-out)
      // Actually we just wait for firebaseUser. If no user, AuthContext will handle redirect.
      return;
    }

    const cachedBranches = localStorage.getItem('appBranches');
    if (cachedBranches) {
      try { 
        setBranches(JSON.parse(cachedBranches)); 
        setLoading(false);
      } catch(e){}
    }

    let snapshotResolved = false;
    const safetyTimeout = setTimeout(() => {
      if (!snapshotResolved) {
        console.warn("Branch Firestore onSnapshot timed out. Proceeding with cache.");
        setLoading(false);
      }
    }, 4000);

    const targetDb = mainDb; // Always fetch branches from main project
    const q = collection(targetDb, 'branches');
    const unsub = safeCollectionSnapshot(q, (snap) => {
      snapshotResolved = true;
      clearTimeout(safetyTimeout);
      const bList = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() || 0) } as Branch));
      setBranches(bList);
      try { localStorage.setItem('appBranches', JSON.stringify(bList)); } catch(e) { console.error('Failed to cache branches:', e); }
      setLoading(false);
    }, (error: any) => {
      snapshotResolved = true;
      clearTimeout(safetyTimeout);
      if (error?.message?.includes("Quota")) {
         console.warn("Error fetching branches (Quota Exceeded):", error.message);
         toast.error("Database Error. Data will load tomorrow.. Please wait until tomorrow or upgrade your plan.");
      } else {
         console.error("Error fetching branches:", error?.message || 0);
      }
      
      setLoading(false);
    });

    return () => {
      clearTimeout(safetyTimeout);
      unsub();
    };
  }, [user]);

  // Set active branch when user or branches ready
  useEffect(() => {
    if (user && branches.length > 0) {
      if (user.branchId && branches.some(b => b.id === user.branchId)) {
        setActiveBranchId(user.branchId);
      } else {
        const savedBranchId = localStorage.getItem('lastActiveBranchId');
        if (savedBranchId && branches.some(b => b.id === savedBranchId)) {
          setActiveBranchId(savedBranchId);
        } else if (!activeBranchId || activeBranchId === 'main' || activeBranchId === 'all' || !branches.some(b => b.id === activeBranchId)) {
          setActiveBranchId(branches[0].id);
        }
      }
    }
  }, [user, branches]);

  const handleSetActiveBranchId = (id: string | null) => {
    setActiveBranchId(id);
    if (id) {
      try { localStorage.setItem('lastActiveBranchId', id); } catch(e) {}
    }
  };

  // Dynamically switch the Firebase project when active branch changes
  useEffect(() => {
    if (!user) return;
    
    // Switch Firebase project based on active branch for ANY user
    if (activeBranchId && activeBranchId !== 'main') {
        const branch = branches.find(b => b.id === activeBranchId);
        const branchConfig = (branch as any)?.firebaseConfig;
        if (branchConfig) {
          import('../lib/firebase').then(({ switchFirebaseProject }) => {
            switchFirebaseProject(branchConfig);
          });
          return;
        }
      }
      // If no branch is active or it has no custom config, reset to Main project
    import('../lib/firebase').then(({ switchFirebaseProject }) => {
      switchFirebaseProject(null);
    });
  }, [activeBranchId, branches, user]);

  return (
    <BranchContext.Provider value={{ branches, activeBranchId, setActiveBranchId: handleSetActiveBranchId, loading }}>
      {children}
    </BranchContext.Provider>
  );
}
