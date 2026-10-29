import { useEffect, useRef, useCallback } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
}

export function useBarcodeScanner({ onScan }: UseBarcodeScannerOptions) {
  const keys = useRef<string[]>([]);
  const timeout = useRef<NodeJS.Timeout | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    // Never intercept Tab — Tab must always move focus to the next input box
    if (e.key === 'Tab') {
      keys.current = [];
      if (timeout.current) clearTimeout(timeout.current);
      return;
    }

    // Do not hijack typing when the user is focused inside an input, textarea, or select
    const activeEl = document.activeElement as HTMLElement | null;
    if (
      activeEl &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.isContentEditable)
    ) {
      keys.current = [];
      if (timeout.current) clearTimeout(timeout.current);
      return;
    }

    if (e.key === 'Enter') {
      if (keys.current.length > 0) {
        const barcode = keys.current.join('');
        
        if (barcode.length >= 3) {
          onScan(barcode);
          e.preventDefault();
        }
        keys.current = [];
        if (timeout.current) clearTimeout(timeout.current);
      }
      return;
    }

    if (e.key.length === 1) {
      keys.current.push(e.key);
      
      if (timeout.current) {
        clearTimeout(timeout.current);
      }
      
      timeout.current = setTimeout(() => {
        keys.current = [];
      }, 30); // 30ms is usually fast enough to filter human typing vs barcode scanner
    }
  }, [onScan]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [handleKeyDown]);
}
