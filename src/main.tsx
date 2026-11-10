import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles.css';
import App from './App';
import { tidyPhotoStore } from './lib/actions';
import { loadTree } from './lib/treeStore';
import { hydrate } from './store';

// The saved tree comes from IndexedDB, which is asynchronous; render once it's in place
// so the welcome screen doesn't flash up for people who already have a tree.
void loadTree().then((tree) => {
  hydrate(tree);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Once things have settled, clear out full-size photos that were replaced or removed last time.
  window.setTimeout(tidyPhotoStore, 4000);
});
