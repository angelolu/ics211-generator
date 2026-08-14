import { forwardRef, useEffect, useState } from 'react';
import type { FormHeaderData, FormRowData, FormStateData } from '../hooks/useFormState';
import { calculateHours } from '../utils/time';
import { EditableCell } from './EditableCell';

interface ICS211FormProps {
  formState: FormStateData;
  highlightChanges: boolean;
  activityType?: 'exercise' | 'event' | 'incident';
  showPhone?: boolean;
  showEmail?: boolean;
  emailMap?: Record<number, string>;
  showCalcHours?: boolean;
  showId?: boolean;
  idsMap?: Record<number, string>;
  showStatus?: boolean;
  statusMap?: Record<number, string>;
  showRole?: boolean;
  rolesMap?: Record<number, string>;
  showPositions?: boolean;
  positionsMap?: Record<number, string>;
  showMedical?: boolean;
  medicalMap?: Record<number, string>;
  showTechnical?: boolean;
  technicalMap?: Record<number, string>;
  onUpdateHeader: (key: keyof FormHeaderData, value: string) => void;
  onUpdateRow: (rowId: string, colKey: keyof FormRowData['cells'], value: string) => void;
  onRemoveRow?: (rowId: string) => void;
  onRestoreRow?: (rowId: string) => void;
}

export const ICS211AForm = forwardRef<HTMLDivElement, ICS211FormProps>(
  ({ formState, highlightChanges, activityType = 'incident', showPhone = false, showEmail = false, emailMap = {}, showCalcHours = false, showId = false, idsMap = {}, showStatus = false, statusMap = {}, showRole = false, rolesMap = {}, showPositions = false, positionsMap = {}, showMedical = false, medicalMap = {}, showTechnical = false, technicalMap = {}, onUpdateHeader, onUpdateRow, onRemoveRow, onRestoreRow }, ref) => {
    const typeLabel = activityType === 'exercise' ? 'EXERCISE' : activityType === 'event' ? 'EVENT' : 'INCIDENT';

    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, actions: { label: string, onClick?: () => void, danger?: boolean, isInfo?: boolean, isError?: boolean, isSuccess?: boolean }[] } | null>(null);

    useEffect(() => {
      const closeMenu = () => setContextMenu(null);
      window.addEventListener('click', closeMenu);
      window.addEventListener('contextmenu', closeMenu, { capture: true });
      return () => {
        window.removeEventListener('click', closeMenu);
        window.removeEventListener('contextmenu', closeMenu, { capture: true });
      };
    }, []);

    const handleCellContextMenu = (e: React.MouseEvent, actions: { label: string, onClick?: () => void, danger?: boolean, isInfo?: boolean, isError?: boolean, isSuccess?: boolean }[]) => {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        actions
      });
    };

    // Tweak this value to adjust how far left the custom menu spawns relative to the cursor
    const CONTEXT_MENU_X_OFFSET = 150;

    const extraColsCount =
      (showId ? 1 : 0) +
      (showStatus ? 1 : 0) +
      (showRole ? 1 : 0) +
      (showPositions ? 1 : 0) +
      (showMedical ? 1 : 0) +
      (showTechnical ? 1 : 0) +
      (showPhone ? 1 : 0) +
      (showEmail ? 1 : 0);

    const fixedNonPersonnelTotal = 4.0 + 8.5 + 8.5 + 6.5; // 27.5%
    const availableForPersonnel = 100 - fixedNonPersonnelTotal; // 72.5%

    const baseWeights = {
      id: 5.5,
      status: 7.0,
      role: 6.5,
      positions: 6.5,
      medical: 6.0,
      technical: 9.5,
      phone: 10.5,
      email: 11.0,
    };

    let totalBaseExtras = 0;
    if (showId) totalBaseExtras += baseWeights.id;
    if (showStatus) totalBaseExtras += baseWeights.status;
    if (showRole) totalBaseExtras += baseWeights.role;
    if (showPositions) totalBaseExtras += baseWeights.positions;
    if (showMedical) totalBaseExtras += baseWeights.medical;
    if (showTechnical) totalBaseExtras += baseWeights.technical;
    if (showPhone) totalBaseExtras += baseWeights.phone;
    if (showEmail) totalBaseExtras += baseWeights.email;

    const minNameAndAddl = 26.0;
    const maxExtrasAllowed = availableForPersonnel - minNameAndAddl;
    const scaleFactor = totalBaseExtras > maxExtrasAllowed ? maxExtrasAllowed / totalBaseExtras : 1.0;

    const idWidth = `${(baseWeights.id * scaleFactor).toFixed(1)}%`;
    const statusWidth = `${(baseWeights.status * scaleFactor).toFixed(1)}%`;
    const roleWidth = `${(baseWeights.role * scaleFactor).toFixed(1)}%`;
    const positionsWidth = `${(baseWeights.positions * scaleFactor).toFixed(1)}%`;
    const medicalWidth = `${(baseWeights.medical * scaleFactor).toFixed(1)}%`;
    const technicalWidth = `${(baseWeights.technical * scaleFactor).toFixed(1)}%`;
    const phoneWidth = `${(baseWeights.phone * scaleFactor).toFixed(1)}%`;
    const emailWidth = `${(baseWeights.email * scaleFactor).toFixed(1)}%`;

    const actualExtrasTotal = totalBaseExtras * scaleFactor;
    const remainingForNameAndAddl = availableForPersonnel - actualExtrasTotal;
    const nameWidthVal = Math.max(15, remainingForNameAndAddl * 0.58);
    const addlWidthVal = remainingForNameAndAddl - nameWidthVal;

    const nameWidth = `${nameWidthVal.toFixed(1)}%`;
    const addlWidth = `${addlWidthVal.toFixed(1)}%`;

    return (
      <div ref={ref} className="bg-white p-8 font-sans text-black max-w-[11in] mx-auto print:p-0 print:m-0 relative">
        {contextMenu && (
          <div
            className="fixed z-[100] bg-slate-800 text-white text-xs font-semibold py-1 rounded-lg shadow-xl print:hidden border border-slate-600 flex flex-col min-w-[120px] max-w-[200px]"
            style={{ top: Math.max(10, contextMenu.y - 10), left: Math.min(window.innerWidth - 220, Math.max(10, contextMenu.x - CONTEXT_MENU_X_OFFSET)) }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {contextMenu.actions.map((action, i) => {
              if (action.isError || action.isSuccess || action.isInfo) {
                return (
                  <div key={i} className={`px-3 py-2 text-[11px] font-medium border-b border-slate-700 pb-2 mb-1 pointer-events-none whitespace-pre-wrap break-words ${action.isError ? 'text-red-400' : action.isSuccess ? 'text-emerald-400' : 'text-slate-300'}`}>
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
        )}

        <style type="text/css" media="print">
          {`
            @page {
              size: landscape;
              margin: 10mm;
            }
            body {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .page-break-inside-avoid {
              page-break-inside: avoid;
            }
          `}
        </style>

        <table className="w-full table-fixed border-collapse border-2 border-black text-xs print:text-[10px]">
          <colgroup>
            <col style={{ width: '4%' }} />
            {showId && <col style={{ width: idWidth }} />}
            <col style={{ width: nameWidth }} />
            {showStatus && <col style={{ width: statusWidth }} />}
            {showRole && <col style={{ width: roleWidth }} />}
            {showPositions && <col style={{ width: positionsWidth }} />}
            {showMedical && <col style={{ width: medicalWidth }} />}
            {showTechnical && <col style={{ width: technicalWidth }} />}
            {showPhone && <col style={{ width: phoneWidth }} />}
            {showEmail && <col style={{ width: emailWidth }} />}
            <col style={{ width: '8.5%' }} />
            <col style={{ width: '8.5%' }} />
            <col style={{ width: '6.5%' }} />
            <col style={{ width: addlWidth }} />
          </colgroup>
          <thead className="table-header-group">
            <tr>
              <td colSpan={6 + extraColsCount} className="p-0 border-0">
                <div className="grid grid-cols-4 border-b-2 border-black">
                  <div className="col-span-1 border-r border-black p-2 flex flex-col justify-center items-center min-w-0">
                    <h1 className="font-bold text-lg leading-tight uppercase text-center">Agency Check In List</h1>
                    <h2 className="font-bold text-[10px] uppercase text-center">Use One Sheet Per Agency</h2>
                  </div>
                  <div className="col-span-1 border-r border-black px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">1. {typeLabel} NAME</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu} cell={formState.headers.exerciseName} onChange={(v) => onUpdateHeader('exerciseName', v)} highlightChanges={highlightChanges} className="font-bold text-sm print:text-[11px] leading-tight break-words" />
                  </div>
                  <div className="col-span-1 border-r border-black px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">2. DATE</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu} cell={formState.headers.date} onChange={(v) => onUpdateHeader('date', v)} highlightChanges={highlightChanges} className="font-bold text-sm print:text-[11px] leading-tight break-words" />
                  </div>
                  <div className="col-span-1 px-1 py-0.5 flex min-w-0">
                    <div className="w-1/2 border-r border-black pr-1 mr-1 min-w-0 overflow-hidden">
                      <div className="text-[10px] uppercase font-semibold leading-tight break-words">3. {typeLabel} NUMBER</div>
                      <EditableCell onContextMenuEvent={handleCellContextMenu} cell={formState.headers.exerciseNumber} onChange={(v) => onUpdateHeader('exerciseNumber', v)} highlightChanges={highlightChanges} className="font-bold text-sm print:text-[11px] leading-tight break-words" />
                    </div>
                    <div className="w-1/2 min-w-0 overflow-hidden">
                      <div className="text-[10px] uppercase font-semibold leading-tight break-words">4. CHECK IN LOCATION</div>
                      <EditableCell onContextMenuEvent={handleCellContextMenu} cell={formState.headers.checkInLocation} onChange={(v) => onUpdateHeader('checkInLocation', v)} highlightChanges={highlightChanges} className="font-bold text-sm print:text-[11px] leading-tight break-words" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4">
                  <div className="col-span-1 border-r border-black px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">5. AGENCY/TEAM</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu} cell={formState.headers.agencyTeam} onChange={(v) => onUpdateHeader('agencyTeam', v)} highlightChanges={highlightChanges} className="font-bold text-sm print:text-[11px] leading-tight break-words" />
                  </div>
                  <div className="col-span-1 border-r border-black px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">6. LIAISON NAME</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu} cell={formState.headers.liaisonName} onChange={(v) => onUpdateHeader('liaisonName', v)} highlightChanges={highlightChanges} className="font-bold text-sm print:text-[11px] leading-tight min-h-[1rem] break-words" />
                  </div>
                  <div className="col-span-1 border-r border-black px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">7. AGENCY ADDRESS</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu} cell={formState.headers.agencyAddress} onChange={(v) => onUpdateHeader('agencyAddress', v)} highlightChanges={highlightChanges} className="font-bold text-sm print:text-[11px] leading-tight min-h-[1rem] break-words" />
                  </div>
                  <div className="col-span-1 px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">8. AGENCY PHONE #</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu} cell={formState.headers.agencyPhone} onChange={(v) => onUpdateHeader('agencyPhone', v)} highlightChanges={highlightChanges} className="font-bold text-sm print:text-[11px] leading-tight min-h-[1rem] break-words" />
                  </div>
                </div>
              </td>
            </tr>
            <tr className="bg-gray-50/50 border-y-2 border-black">
              <th className="w-[4%] border-r border-black py-1 px-1 text-[8px] font-semibold text-center leading-tight">T<br />CARD<br />√<br />WHEN<br />MADE</th>
              {showId && (
                <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">ID</th>
              )}
              <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center leading-tight uppercase">NAME (PERSONNEL) -OR-<br />DESCRIPTION (EQUIPMENT)</th>
              {showStatus && (
                <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">STATUS</th>
              )}
              {showRole && (
                <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">ROLE</th>
              )}
              {showPositions && (
                <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">POSITION</th>
              )}
              {showMedical && (
                <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">MEDICAL</th>
              )}
              {showTechnical && (
                <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">TECHNICAL</th>
              )}
              {showPhone && (
                <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">PHONE</th>
              )}
              {showEmail && (
                <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">EMAIL</th>
              )}
              <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center uppercase leading-tight">DATE/TIME<br />IN</th>
              <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center uppercase leading-tight">DATE/TIME<br />OUT</th>
              <th className="border-r border-black py-1 px-2 text-[10px] font-semibold text-center uppercase">HOURS</th>
              <th className="py-1 px-2 text-[10px] font-semibold text-center uppercase">ADDITIONAL INFORMATION</th>
            </tr>
          </thead>

          <tbody className="table-row-group">
            {formState.rows.map((row) => {
              if (row.isDeleted && !highlightChanges) return null;
              const isDeleted = highlightChanges && row.isDeleted;
              const rowClasses = `page-break-inside-avoid border-b border-black last:border-b-0 h-8 ${isDeleted ? 'bg-red-100 text-red-900 line-through print:hidden' : ''}`;

              const rowActions = {
                isDeleted: row.isDeleted,
                removeFn: onRemoveRow ? () => onRemoveRow(row.id) : undefined,
                restoreFn: onRestoreRow ? () => onRestoreRow(row.id) : undefined
              };

              return (
                <tr key={row.id} className={rowClasses}>
                  <td className="border-r border-black p-1 text-center">
                    <EditableCell rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.tCard} onChange={(v) => onUpdateRow(row.id, 'tCard', v)} highlightChanges={highlightChanges} />
                  </td>
                  {showId && (
                    <td className="border-r border-black p-1 px-2 bg-slate-50 text-slate-500 italic font-medium print:bg-transparent print:text-black print:not-italic print:font-normal">
                      <div className="text-[10px] leading-tight break-words select-none pointer-events-none text-center">
                        {row.memberId ? (idsMap[row.memberId] || '') : ''}
                      </div>
                    </td>
                  )}
                  <td className="border-r border-black p-1 px-2">
                    <EditableCell rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.name} onChange={(v) => onUpdateRow(row.id, 'name', v)} highlightChanges={highlightChanges} className="font-medium break-words" />
                  </td>
                  {showStatus && (
                    <td className="border-r border-black p-1 px-2 bg-slate-50 text-slate-500 italic font-medium print:bg-transparent print:text-black print:not-italic print:font-normal">
                      <div className="text-[10px] leading-tight break-words select-none pointer-events-none">
                        {row.memberId ? (statusMap[row.memberId] || '') : ''}
                      </div>
                    </td>
                  )}
                  {showRole && (
                    <td className="border-r border-black p-1 px-2 bg-slate-50 text-slate-500 italic font-medium print:bg-transparent print:text-black print:not-italic print:font-normal">
                      <div className="text-[10px] leading-tight break-words select-none pointer-events-none">
                        {row.memberId ? (rolesMap[row.memberId] || '') : ''}
                      </div>
                    </td>
                  )}
                  {showPositions && (
                    <td className="border-r border-black p-1 px-2 bg-slate-50 text-slate-500 italic font-medium print:bg-transparent print:text-black print:not-italic print:font-normal">
                      <div className="text-[10px] leading-tight break-words select-none pointer-events-none">
                        {row.memberId ? (positionsMap[row.memberId] || '') : ''}
                      </div>
                    </td>
                  )}
                  {showMedical && (
                    <td className="border-r border-black p-1 px-2 bg-slate-50 text-slate-500 italic font-medium print:bg-transparent print:text-black print:not-italic print:font-normal">
                      <div className="text-[10px] leading-tight break-words select-none pointer-events-none">
                        {row.memberId ? (medicalMap[row.memberId] || '') : ''}
                      </div>
                    </td>
                  )}
                  {showTechnical && (
                    <td className="border-r border-black p-1 px-2 bg-slate-50 text-slate-500 italic font-medium print:bg-transparent print:text-black print:not-italic print:font-normal">
                      <div className="text-[10px] leading-tight break-words select-none pointer-events-none">
                        {row.memberId ? (technicalMap[row.memberId] || '') : ''}
                      </div>
                    </td>
                  )}
                  {showPhone && (
                    <td className="border-r border-black p-1 px-2 text-center">
                      <EditableCell rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.phone} onChange={(v) => onUpdateRow(row.id, 'phone', v)} highlightChanges={highlightChanges} className="text-[10px] leading-tight break-words" />
                    </td>
                  )}
                  {showEmail && (
                    <td className="border-r border-black p-1 px-1 bg-slate-50 text-slate-500 italic font-medium print:bg-transparent print:text-black print:not-italic print:font-normal">
                      <div className="text-[9px] leading-tight break-words select-none pointer-events-none text-center">
                        {row.memberId ? (emailMap[row.memberId] || '') : ''}
                      </div>
                    </td>
                  )}
                  <td className="border-r border-black p-1 text-center">
                    <EditableCell rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.timeIn} onChange={(v) => onUpdateRow(row.id, 'timeIn', v)} highlightChanges={highlightChanges} />
                  </td>
                  <td className="border-r border-black p-1 text-center">
                    <EditableCell rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.timeOut} onChange={(v) => onUpdateRow(row.id, 'timeOut', v)} highlightChanges={highlightChanges} />
                  </td>
                  <td className={`border-r border-black p-1 text-center ${showCalcHours ? 'bg-slate-50 text-slate-500 italic font-medium print:bg-transparent print:text-black print:not-italic print:font-normal' : ''}`}>
                    {showCalcHours ? (
                      <div className="w-full h-full select-none pointer-events-none flex items-center justify-center">
                        {calculateHours(row.cells.timeIn?.value || '', row.cells.timeOut?.value || '')}
                      </div>
                    ) : (
                      <EditableCell rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.hours} onChange={(v) => onUpdateRow(row.id, 'hours', v)} highlightChanges={highlightChanges} />
                    )}
                  </td>
                  <td className="p-1 px-2">
                    <EditableCell rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.additionalInfo} onChange={(v) => onUpdateRow(row.id, 'additionalInfo', v)} highlightChanges={highlightChanges} className="break-words" />
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot className="table-footer-group">
            <tr>
              <td colSpan={6 + extraColsCount} className="p-0 border-0">
                <div className="grid grid-cols-4 border-t-2 border-black mt-0">
                  <div className="col-span-1 border-r border-black py-0.5 px-2 flex flex-col justify-center items-start">
                    <div className="font-bold text-sm uppercase leading-tight">ICS 211A</div>
                    <div className="text-[10px]">CALSAR {new Date().toLocaleDateString('en-US', { month: '2-digit', year: '2-digit' }).replace('/', '/')}</div>
                  </div>
                  <div className="col-span-3 px-1 py-0.5 pl-4 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">9. PREPARED BY (RESOURCE UNIT)</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu} cell={formState.headers.preparedBy} onChange={(v) => onUpdateHeader('preparedBy', v)} highlightChanges={highlightChanges} className="font-bold text-sm print:text-[11px] leading-tight w-full min-h-[1rem]" />
                  </div>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }
);

ICS211AForm.displayName = 'ICS211AForm';
