import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { UserProvider } from './context/UserContext';
import { SecureRecoveryView } from './components/SecureRecoveryView';

function isRecoveryModeRequested(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const hash = window.location.hash.toLowerCase();
    if (hash === '#recuperation' || hash.startsWith('#recuperation?')) return true;
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'recuperation';
  } catch {
    return false;
  }
}

function RootShell() {
  const [recoveryActive, setRecoveryActive] = useState<boolean>(() => isRecoveryModeRequested());

  useEffect(() => {
    const syncFromLocation = () => setRecoveryActive(isRecoveryModeRequested());
    const openRecovery = () => {
      if (window.location.hash !== '#recuperation') {
        window.location.hash = '#recuperation';
      }
      setRecoveryActive(true);
    };

    window.addEventListener('hashchange', syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('lahcen:open-recovery', openRecovery);
    return () => {
      window.removeEventListener('hashchange', syncFromLocation);
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('lahcen:open-recovery', openRecovery);
    };
  }, []);

  if (recoveryActive) {
    return (
      <SecureRecoveryView
        onExit={() => {
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete('mode');
            if (url.hash.toLowerCase().startsWith('#recuperation')) {
              url.hash = '';
            }
            window.history.replaceState(null, '', url.toString());
          } catch {
            window.location.hash = '';
          }
          setRecoveryActive(false);
        }}
      />
    );
  }

  return (
    <UserProvider>
      <App />
    </UserProvider>
  );
}

createRoot(document.getElementById('root')!).render(<RootShell />);

