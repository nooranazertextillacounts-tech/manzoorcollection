import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User as FirebaseUser, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc } from '../lib/customFirestore';
import { setDoc } from '../lib/customFirestore';
import toast from 'react-hot-toast';
import { auth, db, mainAuth, mainDb, safeDocSnapshot } from '../lib/firebase';

export type UserRole = 'super_admin' | 'branch_admin' | 'staff' | 'billing_only' | 'limited_access' | 'sales_stock_only' | 'online_team' | 'new_limited_access' | 'cashier' | 'online_sale_login';

export interface AppUser {
  uid: string;
  email: string | null;
  name: string;
  role: UserRole;
  branchId?: string | null;
  tenantId: string;
}

interface AuthContextType {
  user: AppUser | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  logout: () => Promise<void>;
  loginAsDemo: (email: string, role?: UserRole) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  firebaseUser: null,
  loading: true,
  logout: async () => {},
  loginAsDemo: () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loginAsDemo = (email: string, role: UserRole = 'super_admin') => {
    const demoUser: AppUser = {
      uid: 'demo-uid',
      email: email || 'admin@manzoor.com',
      name: 'Demo Admin',
      role: role,
      branchId: null,
      tenantId: 'CzUMfpmdGJWpFhJYaFdjRBGI1vH3',
    };
    setUser(demoUser);
    setFirebaseUser({
      email: demoUser.email,
      uid: demoUser.uid,
      displayName: demoUser.name,
    } as any);
    sessionStorage.setItem('demo_app_user', JSON.stringify(demoUser));

    import('../lib/activityLogger').then(({ recordActivityLog }) => {
      recordActivityLog({
        action: 'Demo Login',
        category: 'Auth',
        details: `Quick Demo Login session started for ${demoUser.email}`,
        user: demoUser,
      }).catch(() => {});
    });
  };

  useEffect(() => {
    const savedDemoUser = sessionStorage.getItem('demo_app_user');
    if (savedDemoUser) {
      try {
        const parsed = JSON.parse(savedDemoUser);
        setUser(parsed);
        setFirebaseUser({
          email: parsed.email,
          uid: parsed.uid,
          displayName: parsed.name,
        } as any);
        setLoading(false);
        return;
      } catch (e) {}
    }

    const unsubscribe = onAuthStateChanged(auth, async (fUser) => {
      if (sessionStorage.getItem('demo_app_user')) {
        return;
      }
      setFirebaseUser(fUser);
      if (fUser) {
        let snapshotResolved = false;
        const isSuperAdminEmail = fUser.email === 'admin@manzoor.com' || fUser.email === 'clintkarachi@gmail.com' || fUser.email === 'mainbranch@manzoor.com';
        const cachedUser = localStorage.getItem(`appUser_${fUser.uid}`);
        if (cachedUser) {
          try { 
            const parsedUser = JSON.parse(cachedUser);
            if (isSuperAdminEmail) {
              parsedUser.role = 'super_admin';
            }
            setUser(parsedUser);
            setLoading(false);
          } catch(e){}
        }

        // Set a safety timeout to stop loading if Firestore is stuck connecting (e.g. on slow mobile data)
        const safetyTimeout = setTimeout(() => {
          if (!snapshotResolved) {
            console.warn("Firestore onSnapshot timed out. Proceeding with cache or fallback user.");
            if (!user) {
              const fallbackUser: AppUser = {
                uid: fUser.uid,
                email: fUser.email,
                name: fUser.displayName || 'User',
                role: 'super_admin', // Allow super admin fallback so they can access restoration tools
                branchId: null,
                tenantId: 'CzUMfpmdGJWpFhJYaFdjRBGI1vH3',
              };
              setUser(fallbackUser);
            }
            setLoading(false);
          }
        }, 4000);

        // Select the appropriate database to fetch the user profile from:
        // If the logged in user is admin@manzoor.com, clintkarachi@gmail.com, mainbranch@manzoor.com or we are on mainAuth, we use mainDb
        const userDbToUse = (isSuperAdminEmail || auth === mainAuth) ? mainDb : db;

        const unsubDoc = safeDocSnapshot(doc(userDbToUse, 'users', fUser.uid), (docSnap) => {
          snapshotResolved = true;
          clearTimeout(safetyTimeout);
          if (docSnap.exists()) {
            const data = docSnap.data();
            let resolvedRole = data.role;
            if (isSuperAdminEmail) {
              resolvedRole = 'super_admin';
            }
            if (data.role !== resolvedRole) {
              setDoc(doc(userDbToUse, 'users', fUser.uid), { role: resolvedRole }, { merge: true }).catch(console.error);
            }
            const appUser = { uid: fUser.uid, ...data, role: resolvedRole, tenantId: data.tenantId || fUser.uid } as AppUser;
            setUser(prev => prev && JSON.stringify(prev) === JSON.stringify(appUser) ? prev : appUser);
            try { localStorage.setItem(`appUser_${fUser.uid}`, JSON.stringify(appUser)); } catch(e) { console.error('Failed to cache user:', e); }
          } else {
            // Only make them super_admin if they are the designated admin or as a fallback
            // But since this allows any deleted user to become super_admin, we MUST restrict it
            // For safety, unauthorized raw logins without an admin invitation are blocked
            const newAppUser: AppUser = {
              uid: fUser.uid,
              email: fUser.email,
              name: fUser.displayName || 'User',
              role: 'sales_stock_only', // Default to Sales/Billing, Inventory & Stock Transfer
              branchId: 'main',
              tenantId: 'CzUMfpmdGJWpFhJYaFdjRBGI1vH3', // Default to the main tenant so everyone shares data
            };
            
            // Temporary exception for development / first admin
            if (isSuperAdminEmail) {
              newAppUser.role = 'super_admin';
              newAppUser.tenantId = 'CzUMfpmdGJWpFhJYaFdjRBGI1vH3'; // Ensure admin gets the main data
            }

            setUser(prev => prev && JSON.stringify(prev) === JSON.stringify(newAppUser) ? prev : newAppUser);
            try { localStorage.setItem(`appUser_${fUser.uid}`, JSON.stringify(newAppUser)); } catch(e) { console.error('Failed to cache new user:', e); }
            setDoc(doc(userDbToUse, 'users', fUser.uid), newAppUser).catch(e => {
              console.error("Could not bootstrap user (might not be first user or rules blocked it):", e);
            });
          }
          setLoading(false);
        }, (error: any) => {
          snapshotResolved = true;
          clearTimeout(safetyTimeout);
          if (error?.message?.includes("Quota")) {
            console.warn("AuthContext onSnapshot error (Quota Exceeded):", error.message);
            toast.error("Database Error. Data will load tomorrow.. Some features will be unavailable.");
          } else {
            console.error("AuthContext onSnapshot error:", error?.message || 0);
          }
          
          setLoading(false);
        });
        return () => {
          clearTimeout(safetyTimeout);
          unsubDoc();
        };
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [auth]);

  const logout = async () => {
    if (user) {
      import('../lib/activityLogger').then(({ recordActivityLog }) => {
        recordActivityLog({
          action: 'User Logout',
          category: 'Auth',
          details: `User signed out (${user.email || user.name})`,
          user,
        }).catch(() => {});
      });
    }
    sessionStorage.removeItem('demo_app_user');
    sessionStorage.removeItem('profit_loss_unlocked');
    setUser(null);
    setFirebaseUser(null);
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("SignOut failed or bypassed:", e);
    }
    const { switchFirebaseProject } = await import('../lib/firebase');
    switchFirebaseProject(null);
  };

  return (
    <AuthContext.Provider value={{ user, firebaseUser, loading, logout, loginAsDemo }}>
      {children}
    </AuthContext.Provider>
  );
}
