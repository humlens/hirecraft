import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

/** "Add to home screen", only where the browser offers it (Chromium / Android). */
const InstallPrompt = () => {
  const { t } = useTranslation('common');
  const [evt, setEvt] = useState<BIPEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    const onInstalled = () => setEvt(null);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!evt) return null;

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <h3 className="font-semibold">{t('install-title', 'Install the app')}</h3>
      <p className="text-sm opacity-70">
        {t('install-explain', 'Add it to your home screen for quick access.')}
      </p>
      <button
        type="button"
        className="btn btn-sm min-h-11"
        onClick={async () => {
          await evt.prompt();
          setEvt(null);
        }}
      >
        {t('install-button', 'Install')}
      </button>
    </div>
  );
};

export default InstallPrompt;
