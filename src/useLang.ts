import React, { createContext, useContext } from 'react';
import { makeT, type TranslationKey } from './i18n';

// App chỉ còn tiếng Việt (đã bỏ tiếng Nhật).
const t = makeT();

const LangContext = createContext<{ t: (key: TranslationKey) => string }>({ t });

export function LangProvider({ children }: { children: React.ReactNode }) {
  return React.createElement(LangContext.Provider, { value: { t } }, children);
}

export function useLang() {
  return useContext(LangContext);
}
