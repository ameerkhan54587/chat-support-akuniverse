import { createContext, useContext, useCallback } from 'react';
import en from './en.json';

export const LANGUAGES = [
  { code: 'en', name: 'English' }
];

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const t = useCallback((key) => {
    const keys = key.split('.');
    let value = en;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return key;
      }
    }

    return value ?? key;
  }, []);

  const changeLanguage = useCallback(() => {}, []);

  return (
    <I18nContext.Provider value={{ language: 'en', t, changeLanguage, languages: LANGUAGES }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within I18nProvider');
  }
  return context;
}
