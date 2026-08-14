import { useState, useEffect } from 'react';

export interface ContextMenuAction {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  isInfo?: boolean;
  isError?: boolean;
  isSuccess?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('contextmenu', closeMenu, { capture: true });
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('contextmenu', closeMenu, { capture: true });
    };
  }, []);

  const handleCellContextMenu = (e: React.MouseEvent, actions: ContextMenuAction[]) => {
    setContextMenu({ x: e.clientX, y: e.clientY, actions });
  };

  return { contextMenu, setContextMenu, handleCellContextMenu };
}
