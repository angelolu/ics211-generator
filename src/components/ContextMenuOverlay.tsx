import type { ContextMenuState } from '../hooks/useContextMenu';

interface ContextMenuOverlayProps {
  contextMenu: ContextMenuState | null;
  setContextMenu: (v: ContextMenuState | null) => void;
  xOffset?: number;
}

export function ContextMenuOverlay({ contextMenu, setContextMenu, xOffset = 150 }: ContextMenuOverlayProps) {
  if (!contextMenu) return null;

  return (
    <div
      className="fixed z-[100] bg-slate-800 text-white text-xs font-semibold py-1 rounded-lg shadow-xl print:hidden border border-slate-600 flex flex-col min-w-[120px] max-w-[200px]"
      style={{
        top: Math.max(10, contextMenu.y - 10),
        left: Math.min(window.innerWidth - 220, Math.max(10, contextMenu.x - xOffset)),
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {contextMenu.actions.map((action, i) => {
        if (action.isError || action.isSuccess || action.isInfo) {
          return (
            <div
              key={i}
              className={`px-3 py-2 text-[11px] font-medium border-b border-slate-700 pb-2 mb-1 pointer-events-none whitespace-pre-wrap break-words ${action.isError ? 'text-red-400' : action.isSuccess ? 'text-emerald-400' : 'text-slate-300'}`}
            >
              {action.label}
            </div>
          );
        }
        return (
          <div
            key={i}
            className={`px-3 py-2 cursor-pointer transition-colors flex items-center whitespace-pre-wrap break-words ${action.danger ? 'text-red-400 hover:bg-red-900/30' : 'hover:bg-slate-700'}`}
            onClick={(e) => {
              e.stopPropagation();
              action.onClick && action.onClick();
              setContextMenu(null);
            }}
          >
            {action.label}
          </div>
        );
      })}
    </div>
  );
}
