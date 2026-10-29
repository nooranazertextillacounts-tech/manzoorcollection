import React, { createContext, useContext, useState, useEffect } from 'react';
import { doc, onSnapshot, addDoc, updateDoc, deleteDoc, query, getDocs, getDoc, runTransaction, writeBatch } from '../lib/customFirestore';
import { setDoc } from '../lib/customFirestore';
import { mainDb, safeGetDocs, safeDocSnapshot } from '../lib/firebase';
import { useAuth } from './AuthContext';

interface SettingsContextType {
  enableDashboardEdit: boolean;
  toggleDashboardEdit: () => void;
  enableBillEdit: boolean;
  toggleBillEdit: () => void;
  dashboardOffsets: any;
  updateDashboardOffsets: (newOffsets: any) => void;
  enableDeletion: boolean;
  toggleDeletion: () => void;
}

const SettingsContext = createContext<SettingsContextType>({
  enableDeletion: false,
  enableDashboardEdit: false,
  toggleDashboardEdit: () => {},
  enableBillEdit: false,
  toggleBillEdit: () => {},
  dashboardOffsets: {},
  updateDashboardOffsets: () => {},
  toggleDeletion: () => {},
});

export const useSettings = () => useContext(SettingsContext);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [enableDeletion, setEnableDeletion] = useState(false);
  const [enableDashboardEdit, setEnableDashboardEdit] = useState(false);
  const [enableBillEdit, setEnableBillEdit] = useState(false);
  const [dashboardOffsets, setDashboardOffsets] = useState<any>({});

  useEffect(() => {
    const unsub = safeDocSnapshot(doc(mainDb, 'settings', 'system'), (docSnap) => {
      if (docSnap.exists()) {
        setEnableDeletion(!!docSnap.data().enableDeletion);
        setEnableDashboardEdit(!!docSnap.data().enableDashboardEdit);
        setEnableBillEdit(!!docSnap.data().enableBillEdit);
        setDashboardOffsets(docSnap.data().dashboardOffsets || 0);
      }
    });
    return unsub;
  }, []);

  const toggleDashboardEdit = async () => {
    if (user?.role !== 'super_admin') return;
    const nextVal = !enableDashboardEdit;
    setEnableDashboardEdit(nextVal);
    try {
      await setDoc(doc(mainDb, 'settings', 'system'), { enableDashboardEdit: nextVal }, { merge: true });
    } catch (error) {
      console.error(error);
      setEnableDashboardEdit(!nextVal);
      alert("Failed to toggle setting.");
    }
  };

  const toggleBillEdit = async () => {
    if (user?.role !== 'super_admin') return;
    const nextVal = !enableBillEdit;
    setEnableBillEdit(nextVal);
    try {
      await setDoc(doc(mainDb, 'settings', 'system'), { enableBillEdit: nextVal }, { merge: true });
    } catch (error) {
      console.error(error);
      setEnableBillEdit(!nextVal);
      alert("Failed to toggle setting.");
    }
  };

  const updateDashboardOffsets = async (newOffsets: any) => {
    if (user?.role !== 'super_admin') return;
    try {
      await setDoc(doc(mainDb, 'settings', 'system'), { dashboardOffsets: newOffsets }, { merge: true });
    } catch (error) {
      console.error(error);
      alert("Failed to update offsets.");
    }
  };

  const toggleDeletion = async () => {
    if (user?.role !== 'super_admin') return;
    const nextVal = !enableDeletion;
    setEnableDeletion(nextVal);
    try {
      await setDoc(doc(mainDb, 'settings', 'system'), { enableDeletion: nextVal }, { merge: true });
    } catch (error) {
      console.error(error);
      setEnableDeletion(!nextVal);
      alert("Failed to toggle setting. You might not have permission.");
    }
  };

  return (
    <SettingsContext.Provider value={{ enableDeletion, toggleDeletion, enableDashboardEdit, toggleDashboardEdit, enableBillEdit, toggleBillEdit, dashboardOffsets, updateDashboardOffsets }}>
      {children}
    </SettingsContext.Provider>
  );
};
