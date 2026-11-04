import '@fontsource-variable/manrope/index.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootTelegram } from './lib/telegram';
import { player } from './lib/player';

// Development builds only: lets e2e tests read the player state.
if (import.meta.env.DEV) (window as unknown as { __auris: unknown }).__auris = { player };

const root = createRoot(document.getElementById('root')!);
bootTelegram()
  .then((s) => {
    const bootError = s.mode === 'outside' ? 'AURIS работает как Mini App внутри Telegram. Откройте бота и нажмите «Открыть AURIS».' : undefined;
    root.render(
      <StrictMode>
        <App bootError={bootError} />
      </StrictMode>,
    );
  })
  .catch((e: unknown) => {
    console.error("boot failed", e);
    return (
    root.render(
      <StrictMode>
        <App bootError="Не удалось запустить Telegram SDK." />
      </StrictMode>,
    ));
  });
