import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';




const originalConsoleError = console.error;
console.error = (...args) => {
  if (args.some(arg => {
    if (typeof arg === 'string') return arg.includes('resource-exhausted');
    if (arg && typeof arg === 'object' && arg.message) return arg.message.includes('resource-exhausted');
    return false;
  })) {
    console.warn("Ignored Firebase Quota Error (console.error):", ...args);
    return;
  }
  originalConsoleError.apply(console, args);
};

window.addEventListener('error', (event) => {
  const errorMsg = event.message || '';
  if (errorMsg.includes('resource-exhausted')) {
    event.preventDefault();
    console.warn("Ignored Firebase Quota Error (window.error):", errorMsg);
  } else {
    console.error("Global Javascript Error:", event.error);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const errorMsg = event.reason?.message || event.reason;
  if (typeof errorMsg === 'string' && errorMsg.includes('resource-exhausted')) {
    event.preventDefault();
    console.warn("Ignored Firebase Quota Error (unhandledrejection):", errorMsg);
  }
});



createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
