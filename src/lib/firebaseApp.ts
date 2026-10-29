import { initializeApp, getApps, getApp } from 'firebase/app';
import firebaseConfig from '../../firebase-applet-config.json';

export { firebaseConfig };

// Primary App for Authentication
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Secondary App for creating branch admins without signing out the Super Admin
export const secondaryApp = getApps().length < 2 ? initializeApp(firebaseConfig, "Secondary") : getApp("Secondary");

