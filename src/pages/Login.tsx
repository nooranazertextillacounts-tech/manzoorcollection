import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate, useNavigate } from 'react-router';
import { signInWithEmailAndPassword, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Lock, Mail, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { InstallPWA } from '../components/InstallPWA';
import { MCLogo } from '../components/MCLogo';

const bgImage = "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?auto=format&fit=crop&w=2000&q=80";

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, loginAsDemo } = useAuth();
  const navigate = useNavigate();

  if (user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900 p-8 rounded-2xl shadow-2xl border border-white/10 max-w-sm w-full text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none" />
          <div className="mx-auto mb-6 flex justify-center relative z-10">
            <MCLogo className="w-20 h-20 shadow-[0_0_30px_rgba(59,130,246,0.15)]" />
          </div>
          <h2 className="text-xl font-medium text-white mb-2 relative z-10 font-serif">Already Logged In</h2>
          <p className="text-zinc-400 mb-8 text-sm relative z-10 font-light tracking-wide">
            You are currently logged in as <br/><strong className="text-zinc-300 font-medium">{user.email}</strong>
          </p>
          <div className="space-y-3 relative z-10">
            <button
              onClick={() => navigate('/')}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-medium hover:from-blue-500 hover:to-blue-600 transition shadow-lg shadow-blue-900/20"
            >
              Continue to Dashboard
            </button>
            <button
              onClick={() => auth.signOut()}
              className="w-full py-3 bg-white/5 text-zinc-300 rounded-xl font-medium hover:bg-white/10 transition border border-white/5"
            >
              Sign out and switch accounts
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const trimmedEmail = email.trim().toLowerCase();
      
      // Step 1: Detect branch configuration for this email
      let branchConfigToUse = null;
      
      // If it's the known super admin email, skip lookup to save quota and go directly to main
      if (trimmedEmail !== 'admin@manzoor.com' && trimmedEmail !== 'mainbranch@manzoor.com') {
        try {
          const { collection, query, where, doc } = await import('../lib/customFirestore');
          const { mainDb, safeGetDocs, safeGetDoc } = await import('../lib/firebase');
          
          // Try loading fallback branch configs first
          const branchConfigsFallback = await import('../lib/branch-configs.json').then(m => m.default || m);
          
          const usersRef = collection(mainDb, 'users');
          const q = query(usersRef, where('email', '==', trimmedEmail));
          const querySnap = await safeGetDocs(q);
          
          if (!querySnap.empty) {
            const userDoc = querySnap.docs[0].data() as any;
            const branchId = userDoc.branchId;
            if (branchId && branchId !== 'main') {
              // Check fallback first, then Firestore
              if (branchConfigsFallback && branchConfigsFallback[branchId]) {
                branchConfigToUse = branchConfigsFallback[branchId];
              } else {
                const branchDocRef = doc(mainDb, 'branches', branchId);
                const branchDocSnap = await safeGetDoc(branchDocRef);
                if (branchDocSnap.exists()) {
                  const branchData = branchDocSnap.data() as any;
                  if (branchData.firebaseConfig) {
                    branchConfigToUse = branchData.firebaseConfig;
                  }
                }
              }
            }
          } else {
            // Check if there's any fallback mapping matching this email or if we can find any branch
            // matching a fallback config
            const fallbackBranchId = Object.keys(branchConfigsFallback || {}).find(bId => {
              const cfg = branchConfigsFallback[bId];
              return cfg && cfg.adminEmail === trimmedEmail;
            });
            if (fallbackBranchId) {
              branchConfigToUse = branchConfigsFallback[fallbackBranchId];
            }
          }
        } catch (dbErr) {
          console.error("Failed to query mainDb during login. Falling back to local configs.", dbErr);
          try {
            const branchConfigsFallback = await import('../lib/branch-configs.json').then(m => m.default || m);
            const fallbackBranchId = Object.keys(branchConfigsFallback || {}).find(bId => {
              const cfg = branchConfigsFallback[bId];
              return cfg && cfg.adminEmail === trimmedEmail;
            });
            if (fallbackBranchId) {
              branchConfigToUse = branchConfigsFallback[fallbackBranchId];
            }
          } catch (jsonErr) {
            console.error("Fallback json parse failed", jsonErr);
          }
        }
      }

      // Step 2: Switch active firebase project
      const firebase = await import('../lib/firebase');
      firebase.switchFirebaseProject(branchConfigToUse);

      // Step 3: Authenticate against the active project
      // Set persistence to session so different tabs can have different users
      await setPersistence(firebase.auth, browserSessionPersistence);
      const userCred = await signInWithEmailAndPassword(firebase.auth, email, password);

      try {
        const { recordActivityLog } = await import('../lib/activityLogger');
        await recordActivityLog({
          action: 'User Login',
          category: 'Auth',
          details: `User signed in successfully with email ${trimmedEmail}`,
          user: {
            uid: userCred.user.uid,
            email: userCred.user.email,
            name: userCred.user.displayName || trimmedEmail.split('@')[0],
          }
        });
      } catch (e) {}

      window.location.href = '/';
    } catch (err: any) {
      console.error("Login failed:", err);
      let msg = "Authentication failed. Please check your email and password.";
      if (err.code === 'auth/invalid-credential' || err.message?.includes('invalid-credential')) {
        msg = "Invalid email or password. Please verify your credentials or use the Quick Demo Login below.";
      } else if (err.code === 'auth/user-not-found') {
        msg = "No account found with this email address.";
      } else if (err.code === 'auth/wrong-password') {
        msg = "Incorrect password. Please try again.";
      } else if (err.code === 'auth/too-many-requests') {
        msg = "Too many failed attempts. Please wait a moment or use Demo Login.";
      } else if (err.message) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-zinc-950 font-sans">
      {/* Full Screen Background */}
      <div className="absolute inset-0 z-0">
        <motion.img
          initial={{ scale: 1.05, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.6 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className="absolute inset-0 h-full w-full object-cover"
          src={bgImage}
          alt="Premium Boutique"
          referrerPolicy="no-referrer"
        />
        {/* Dark Luxury Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/80 via-zinc-900/60 to-zinc-950/90 mix-blend-multiply" />
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      </div>

      {/* Login Card */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="relative z-10 w-full max-w-md px-6 py-12 lg:px-8"
      >
        <div className="backdrop-blur-xl bg-zinc-900/50 border border-white/10 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-8 sm:p-10 relative overflow-hidden">
          {/* Subtle gold sheen */}
          <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/5 via-transparent to-white/5 pointer-events-none" />
          
          <div className="relative z-10">
            <div className="flex flex-col items-center text-center mb-8">
              <MCLogo className="w-20 h-20 mb-6 shadow-[0_0_40px_rgba(59,130,246,0.1)]" />
              <h1 className="font-serif text-3xl tracking-wide text-white mb-2">
                Manzoor<span className="font-light text-blue-500 italic">Collection</span>
              </h1>
              <p className="text-sm text-zinc-400 font-light tracking-widest uppercase">
                Premium Retail Ledger
              </p>
            </div>

            <form className="space-y-6" onSubmit={handleSubmit}>
              {error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                  <p className="text-sm text-red-200 font-light mb-3">{error}</p>
                  <button
                    type="button"
                    onClick={() => {
                      loginAsDemo(email || 'admin@manzoor.com');
                      navigate('/');
                    }}
                    className="w-full text-xs bg-red-600 hover:bg-red-500 text-white font-semibold py-2 px-3 rounded-lg transition-all shadow-md active:scale-95"
                  >
                    Bypass & Sign In as Demo Admin
                  </button>
                </motion.div>
              )}
              
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-400 uppercase tracking-widest ml-1">Email address</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-zinc-500 group-focus-within:text-blue-400 transition-colors" />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full pl-11 bg-zinc-950/40 border border-white/10 rounded-xl py-3.5 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder-zinc-600 font-light backdrop-blur-sm"
                    placeholder="admin@manzoor.com"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-400 uppercase tracking-widest ml-1">Password</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-zinc-500 group-focus-within:text-blue-400 transition-colors" />
                  </div>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-11 bg-zinc-950/40 border border-white/10 rounded-xl py-3.5 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all placeholder-zinc-600 font-light backdrop-blur-sm"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={loading}
                className="w-full mt-2 flex justify-center items-center py-4 px-4 border border-transparent rounded-xl shadow-[0_4px_20px_rgba(37,99,235,0.3)] text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-900 focus:ring-blue-500 disabled:opacity-50 transition-all uppercase tracking-widest"
              >
                {loading ? "Authenticating..." : "Sign In"}
                {!loading && <ArrowRight className="w-4 h-4 ml-3" />}
              </motion.button>

              <div className="text-center mt-4">
                <span className="text-xs text-zinc-500 font-light">Trouble signing in? </span>
                <button
                  type="button"
                  onClick={() => {
                    loginAsDemo('admin@manzoor.com');
                    navigate('/');
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium underline transition-colors"
                >
                  Quick Demo Login (Bypass Auth)
                </button>
              </div>
            </form>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 border-t border-white/5 pt-8">
              <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] mb-1">Mobile App</p>
              <InstallPWA className="!py-3 !px-6 !bg-blue-600/10 !text-blue-400 hover:!bg-blue-600/20 !shadow-none border border-blue-500/20 !text-sm !font-medium tracking-wide rounded-2xl backdrop-blur-sm transition-all active:scale-95" />
              <p className="text-[9px] text-zinc-600 text-center max-w-[200px] leading-relaxed">
                Install as an app for a faster experience and offline access
              </p>
            </div>
          </div>
        </div>
        
        <div className="mt-8 text-center text-xs text-zinc-500 font-light tracking-wide">
          <p>&copy; 2026&ndash;2080 Premium Retail Systems.</p>
          <p className="mt-1">.</p>
        </div>
      </motion.div>
    </div>
  );
}
