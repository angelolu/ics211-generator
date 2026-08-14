import { useState, useEffect } from 'react';
import type { CellState } from '../hooks/useFormState';

interface EditableCellProps {
  cell: CellState;
  onChange: (val: string) => void;
  highlightChanges: boolean;
  className?: string;
  onContextMenuEvent: (e: React.MouseEvent, actions: {label: string, onClick?: () => void, danger?: boolean, isInfo?: boolean, isError?: boolean, isSuccess?: boolean}[]) => void;
  rowActions?: { isDeleted?: boolean, removeFn?: () => void, restoreFn?: () => void };
  errorMsg?: string;
  successMsg?: string;
}

const getRawValue = (val: any): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && val.value !== undefined) return getRawValue(val.value);
  return '';
};

export const EditableCell = ({ 
  cell, onChange, highlightChanges, className = '', onContextMenuEvent, rowActions, errorMsg, successMsg
}: EditableCellProps) => {
  const [localValue, setLocalValue] = useState(() => getRawValue(cell?.value));

  useEffect(() => {
    setLocalValue(getRawValue(cell?.value));
  }, [cell?.value]);

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const text = e.target.innerText;
    if (text !== cell.value) {
      onChange(text);
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const actions: {label: string, onClick?: () => void, danger?: boolean, isInfo?: boolean, isError?: boolean, isSuccess?: boolean}[] = [];
    
    if (errorMsg) {
      actions.push({ label: `❌ ${errorMsg}`, isError: true });
    } else if (successMsg) {
      actions.push({ label: `✅ ${successMsg}`, isSuccess: true });
    }

    if (!!cell.conflictValue) {
      actions.push({ label: `⚠️ Remote changed to: ${cell.conflictValue}`, isInfo: true });
    }

    if (cell.isEditedLocally || !!cell.conflictValue) {
      actions.push({
        label: 'Reset Cell',
        onClick: () => {
          onChange(cell.originalValue);
          setLocalValue(cell.originalValue);
        }
      });
    }

    if (rowActions?.isDeleted && rowActions.restoreFn) {
      actions.push({
        label: 'Restore Row',
        onClick: rowActions.restoreFn
      });
    } else if (!rowActions?.isDeleted && rowActions?.removeFn) {
      actions.push({
        label: 'Remove Row',
        danger: true,
        onClick: rowActions.removeFn
      });
    }

    if (actions.length > 0) {
      onContextMenuEvent(e, actions);
    }
  };

  const hasConflict = !!cell.conflictValue;
  const isEdited = cell.isEditedLocally;

  let bgClass = '';
  if (hasConflict) {
    bgClass = 'bg-red-100 text-red-900 ring-2 ring-inset ring-red-500 z-10 relative print:bg-transparent print:text-inherit print:ring-0';
  } else if (errorMsg) {
    bgClass = 'bg-red-200 text-red-900 ring-2 ring-inset ring-red-600 z-10 relative print:bg-transparent print:text-inherit print:ring-0';
  } else if (successMsg) {
    bgClass = 'bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-500/50 z-10 relative print:bg-transparent print:text-inherit print:ring-0';
  } else if (highlightChanges && isEdited) {
    bgClass = 'bg-yellow-100 text-yellow-900 print:bg-transparent print:text-inherit';
  }

  const tooltipTitle = hasConflict ? `Remote changed to: ${cell.conflictValue}` : errorMsg ? `❌ ${errorMsg}` : successMsg ? `✅ ${successMsg}` : undefined;

  return (
    <div
      className={`w-full h-full outline-none overflow-hidden ${bgClass} ${className}`}
      contentEditable
      suppressContentEditableWarning
      onBlur={handleBlur}
      onContextMenu={handleContextMenu}
      title={tooltipTitle}
    >
      {localValue}
    </div>
  );
};
