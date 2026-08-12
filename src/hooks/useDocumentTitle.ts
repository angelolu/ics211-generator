import { useEffect } from 'react';

/**
 * Sets the document title dynamically.
 * @param title - The page title string.
 * @param prefix - Optional brand prefix to append (defaults to '211 Generator').
 */
export function useDocumentTitle(title: string, prefix = '211 Generator') {
  useEffect(() => {
    const fullTitle = title ? `${title} | ${prefix}` : prefix;
    document.title = fullTitle;
  }, [title, prefix]);
}
