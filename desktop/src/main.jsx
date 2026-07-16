import React from 'react';
import ReactDOM from 'react-dom/client';
import './tokens.css';
import './styles.css';
import App from './App.jsx';
import { LanguageProvider } from './i18n.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>
);
