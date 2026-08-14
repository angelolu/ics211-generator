import { forwardRef, useEffect, useState } from 'react';
import type { FormHeaderData, FormRowData, FormStateData } from '../hooks/useFormState';

interface ICS211FormProps {
  formState: FormStateData;
  highlightChanges: boolean;
  activityType?: 'exercise' | 'event' | 'incident';
  showPhone?: boolean;
  showEmail?: boolean;
  emailMap?: Record<number, string>;
  showCalcHours?: boolean;
  showValidation?: boolean;
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

import { calculateHours, calculateMinutesDiff, formatDuration } from '../utils/time';
import { EditableCell } from './EditableCell';

export const ICS211Form = forwardRef<HTMLDivElement, ICS211FormProps>(
  ({ formState, highlightChanges, activityType = 'exercise', showPhone = true, showEmail = false, emailMap = {}, showCalcHours = false, showValidation = false, showId = false, idsMap = {}, showStatus = false, statusMap = {}, showRole = false, rolesMap = {}, showPositions = false, positionsMap = {}, showMedical = false, medicalMap = {}, showTechnical = false, technicalMap = {}, onUpdateHeader, onUpdateRow, onRemoveRow, onRestoreRow }, ref) => {
    const typeLabel = activityType === 'incident' ? 'INCIDENT' : activityType === 'event' ? 'EVENT' : 'EXERCISE';

    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, actions: { label: string, onClick?: () => void, danger?: boolean, isInfo?: boolean, isError?: boolean, isSuccess?: boolean }[] } | null>(null);

    useEffect(() => {
      const closeMenu = () => setContextMenu(null);
      // Listen to both click and contextmenu on window to close our custom floating button
      window.addEventListener('click', closeMenu);
      window.addEventListener('contextmenu', closeMenu, { capture: true });
      return () => {
        window.removeEventListener('click', closeMenu);
        window.removeEventListener('contextmenu', closeMenu, { capture: true });
      };
    }, []);

    const handleCellContextMenu = (e: React.MouseEvent, actions: { label: string, onClick?: () => void, danger?: boolean, isInfo?: boolean, isError?: boolean, isSuccess?: boolean }[]) => {
      // Do NOT e.preventDefault() here! This preserves the native context menu
      // containing copy/paste/spellcheck.
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        actions
      });
    };

    // Tweak this value to adjust how far left the custom menu spawns relative to the cursor
    const CONTEXT_MENU_X_OFFSET = 200;

    const extraColsCount =
      (showId ? 1 : 0) +
      (showStatus ? 1 : 0) +
      (showRole ? 1 : 0) +
      (showPositions ? 1 : 0) +
      (showMedical ? 1 : 0) +
      (showTechnical ? 1 : 0) +
      (showPhone ? 1 : 0) +
      (showEmail ? 1 : 0);

    const baseMetricWidth = showCalcHours ? 6.5 : 7.2;
    const calcHoursWidth = showCalcHours ? 5.0 : 0;
    const initialMetricsTotal = baseMetricWidth * 8 + calcHoursWidth;
    const initialPersonnelAvail = 100 - initialMetricsTotal;

    const baseWeights = {
      id: 6.0,
      status: 7.0,
      role: 6.5,
      positions: 6.5,
      medical: 6.0,
      technical: 9.0,
      phone: 11.5,
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

    const minNameWidth = 14.0;
    const maxExtrasAllowed = initialPersonnelAvail - minNameWidth;

    let scaleFactor = 1.0;
    let actualMetricWidth = baseMetricWidth;
    let actualCalcHoursWidth = calcHoursWidth;
    let availableForPersonnel = initialPersonnelAvail;

    if (totalBaseExtras > maxExtrasAllowed) {
      const extraDeficit = totalBaseExtras - maxExtrasAllowed;
      const metricCompression = Math.min(extraDeficit * 0.35, showCalcHours ? 10.4 : 16.0);
      actualMetricWidth = baseMetricWidth - metricCompression / 8;
      actualCalcHoursWidth = calcHoursWidth ? calcHoursWidth - 0.5 : 0;
      availableForPersonnel = 100 - (actualMetricWidth * 8 + actualCalcHoursWidth);

      const newMaxExtras = availableForPersonnel - 12.0;
      scaleFactor = Math.min(1.0, newMaxExtras / totalBaseExtras);
    }

    const idWidth = `${(baseWeights.id * scaleFactor).toFixed(1)}%`;
    const statusWidth = `${(baseWeights.status * scaleFactor).toFixed(1)}%`;
    const roleWidth = `${(baseWeights.role * scaleFactor).toFixed(1)}%`;
    const positionsWidth = `${(baseWeights.positions * scaleFactor).toFixed(1)}%`;
    const medicalWidth = `${(baseWeights.medical * scaleFactor).toFixed(1)}%`;
    const technicalWidth = `${(baseWeights.technical * scaleFactor).toFixed(1)}%`;
    const phoneWidth = `${(baseWeights.phone * scaleFactor).toFixed(1)}%`;
    const emailWidth = `${(baseWeights.email * scaleFactor).toFixed(1)}%`;

    const actualExtrasTotal = totalBaseExtras * scaleFactor;
    const nameWidth = `${Math.max(12, availableForPersonnel - actualExtrasTotal).toFixed(1)}%`;
    const metricWidth = `${actualMetricWidth.toFixed(1)}%`;
    const calcHoursWidthStr = `${actualCalcHoursWidth.toFixed(1)}%`;

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
            {showId && <col style={{ width: idWidth }} />}
            <col style={{ width: nameWidth }} />
            {showStatus && <col style={{ width: statusWidth }} />}
            {showRole && <col style={{ width: roleWidth }} />}
            {showPositions && <col style={{ width: positionsWidth }} />}
            {showMedical && <col style={{ width: medicalWidth }} />}
            {showTechnical && <col style={{ width: technicalWidth }} />}
            {showPhone && <col style={{ width: phoneWidth }} />}
            {showEmail && <col style={{ width: emailWidth }} />}
            <col style={{ width: metricWidth }} />
            <col style={{ width: metricWidth }} />
            <col style={{ width: metricWidth }} />
            <col style={{ width: metricWidth }} />
            <col style={{ width: metricWidth }} />
            <col style={{ width: metricWidth }} />
            <col style={{ width: metricWidth }} />
            <col style={{ width: metricWidth }} />
            {showCalcHours && <col style={{ width: calcHoursWidthStr }} />}
          </colgroup>
          <thead className="table-header-group">
            <tr>
              <td colSpan={9 + extraColsCount + (showCalcHours ? 1 : 0)} className="p-0 border-0">
                {/* Header Information Section */}
                <div className="grid grid-cols-4 border-b-2 border-black">
                  <div className="col-span-1 border-r border-black p-2 flex flex-col justify-center items-center min-w-0">
                    <h1 className="font-bold text-lg leading-tight uppercase">Agency Check In List</h1>
                    <h2 className="font-bold text-md tracking-widest uppercase">Fitness</h2>
                  </div>
                  <div className="col-span-1 border-r border-black px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">1. {typeLabel} NAME</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu}
                      cell={formState.headers.exerciseName}
                      onChange={(v) => onUpdateHeader('exerciseName', v)}
                      highlightChanges={highlightChanges}
                      className="font-bold text-sm print:text-[11px] leading-tight break-words"
                    />
                  </div>
                  <div className="col-span-1 border-r border-black px-1 py-0.5 flex min-w-0">
                    <div className="w-1/2 border-r border-black pr-1 mr-1 min-w-0 overflow-hidden">
                      <div className="text-[10px] uppercase font-semibold leading-tight">2. DATE</div>
                      <EditableCell onContextMenuEvent={handleCellContextMenu}
                        cell={formState.headers.date}
                        onChange={(v) => onUpdateHeader('date', v)}
                        highlightChanges={highlightChanges}
                        className="font-bold text-sm print:text-[11px] leading-tight break-words"
                      />
                    </div>
                    <div className="w-1/2 min-w-0 overflow-hidden">
                      <div className="text-[10px] uppercase font-semibold leading-tight break-words">3. {typeLabel} NUMBER</div>
                      <EditableCell onContextMenuEvent={handleCellContextMenu}
                        cell={formState.headers.exerciseNumber}
                        onChange={(v) => onUpdateHeader('exerciseNumber', v)}
                        highlightChanges={highlightChanges}
                        className="font-bold text-sm print:text-[11px] leading-tight break-words"
                      />
                    </div>
                  </div>
                  <div className="col-span-1 px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">4. CHECK IN LOCATION</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu}
                      cell={formState.headers.checkInLocation}
                      onChange={(v) => onUpdateHeader('checkInLocation', v)}
                      highlightChanges={highlightChanges}
                      className="font-bold text-sm print:text-[11px] leading-tight break-words"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-4">
                  <div className="col-span-1 border-r border-black px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">5. AGENCY/TEAM</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu}
                      cell={formState.headers.agencyTeam}
                      onChange={(v) => onUpdateHeader('agencyTeam', v)}
                      highlightChanges={highlightChanges}
                      className="font-bold text-sm print:text-[11px] leading-tight break-words"
                    />
                  </div>
                  <div className="col-span-1 border-r border-black px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">6. LIAISON NAME</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu}
                      cell={formState.headers.liaisonName}
                      onChange={(v) => onUpdateHeader('liaisonName', v)}
                      highlightChanges={highlightChanges}
                      className="font-bold text-sm print:text-[11px] leading-tight min-h-[1rem] break-words"
                    />
                  </div>
                  <div className="col-span-1 border-r border-black px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">7. AGENCY ADDRESS</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu}
                      cell={formState.headers.agencyAddress}
                      onChange={(v) => onUpdateHeader('agencyAddress', v)}
                      highlightChanges={highlightChanges}
                      className="font-bold text-sm print:text-[11px] leading-tight min-h-[1rem] break-words"
                    />
                  </div>
                  <div className="col-span-1 px-1 py-0.5 min-w-0 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">8. AGENCY PHONE</div>
                    <EditableCell onContextMenuEvent={handleCellContextMenu}
                      cell={formState.headers.agencyPhone}
                      onChange={(v) => onUpdateHeader('agencyPhone', v)}
                      highlightChanges={highlightChanges}
                      className="font-bold text-sm print:text-[11px] leading-tight min-h-[1rem] break-words"
                    />
                  </div>
                </div>
              </td>
            </tr>
            {/* Column Headers */}
            <tr className="bg-gray-50/50 border-y-2 border-black">
              {showId && (
                <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">ID</th>
              )}
              <th className="border-r border-black py-1 px-1 text-[10px] font-semibold text-center">NAME</th>
              {showStatus && (
                <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">STATUS</th>
              )}
              {showRole && (
                <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">ROLE</th>
              )}
              {showPositions && (
                <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">POSITION</th>
              )}
              {showMedical && (
                <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">MEDICAL</th>
              )}
              {showTechnical && (
                <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">TECHNICAL</th>
              )}
              {showPhone && (
                <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center">PHONE</th>
              )}
              {showEmail && (
                <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center uppercase leading-tight bg-slate-100 text-slate-500 print:bg-transparent print:text-black">EMAIL</th>
              )}
              <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center">TIME IN</th>
              <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center leading-tight">START<br />WEIGHT</th>
              <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center leading-tight">LAP 1 START<br />TIME</th>
              <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center leading-tight">LAP 1 END<br />TIME</th>
              <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center leading-tight">LAP 2 START<br />TIME</th>
              <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center leading-tight">LAP 2 END<br />TIME</th>
              <th className="border-r border-black py-1 px-1 text-[9px] font-semibold text-center leading-tight">END<br />WEIGHT</th>
              <th className={`py-1 px-1 text-[9px] font-semibold text-center ${showCalcHours ? 'border-r border-black' : ''}`}>TIME OUT</th>
              {showCalcHours && (
                <th className="py-1 px-1 text-[9px] font-semibold text-center leading-tight text-slate-500 bg-slate-100 print:bg-transparent print:text-black">CALC.<br />HOURS</th>
              )}
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

              const errors: Partial<Record<keyof FormRowData['cells'], string>> = {};
              const successes: Partial<Record<keyof FormRowData['cells'], string>> = {};

              if (showValidation) {
                const parseWeight = (val: string) => {
                  if (!val || !val.trim()) return null;
                  const num = parseFloat(val);
                  return isNaN(num) ? null : num;
                };

                const wStart = parseWeight(row.cells.weightStart.value);
                if (wStart !== null) {
                  if (wStart < 25) errors.weightStart = `Weight must be at least 25 (Actual: ${wStart})`;
                  else successes.weightStart = `Weight pass (${wStart})`;
                }

                const wEnd = parseWeight(row.cells.weightEnd.value);
                if (wEnd !== null) {
                  if (wEnd < 25) errors.weightEnd = `Weight must be at least 25 (Actual: ${wEnd})`;
                  else successes.weightEnd = `Weight pass (${wEnd})`;
                }

                const lap1Diff = calculateMinutesDiff(row.cells.lap1Start.value, row.cells.lap1End.value);
                if (lap1Diff !== null) {
                  if (lap1Diff > 95) errors.lap1End = `Lap 1 must take no longer than 95 mins (Actual: ${formatDuration(lap1Diff)})`;
                  else successes.lap1End = `Lap 1 pass (${formatDuration(lap1Diff)})`;
                }

                const lap1HasValue = !!row.cells.lap1Start.value.trim() && !!row.cells.lap1End.value.trim();
                const lap2HasValue = !!row.cells.lap2Start.value.trim() && !!row.cells.lap2End.value.trim();

                if (lap1HasValue && lap2HasValue) {
                  const totalDiff = calculateMinutesDiff(row.cells.lap1Start.value, row.cells.lap2End.value);
                  if (totalDiff !== null) {
                    if (totalDiff > 210) {
                      const totalMsg = `Total for 2 laps must be under 3 hours 30 mins (Actual: ${formatDuration(totalDiff)})`;
                      errors.lap2End = errors.lap2End ? `${errors.lap2End} | ${totalMsg}` : totalMsg;
                    } else {
                      const totalMsg = `Total 2 laps pass (${formatDuration(totalDiff)})`;
                      successes.lap2End = successes.lap2End ? `${successes.lap2End} | ${totalMsg}` : totalMsg;
                    }
                  }
                }
              }

              return (
                <tr key={row.id} className={rowClasses}>
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
                    <EditableCell errorMsg={errors.weightStart} successMsg={successes.weightStart} rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.weightStart} onChange={(v) => onUpdateRow(row.id, 'weightStart', v)} highlightChanges={highlightChanges} />
                  </td>
                  <td className="border-r border-black p-1 text-center">
                    <EditableCell errorMsg={errors.lap1Start} successMsg={successes.lap1Start} rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.lap1Start} onChange={(v) => onUpdateRow(row.id, 'lap1Start', v)} highlightChanges={highlightChanges} />
                  </td>
                  <td className="border-r border-black p-1 text-center">
                    <EditableCell errorMsg={errors.lap1End} successMsg={successes.lap1End} rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.lap1End} onChange={(v) => onUpdateRow(row.id, 'lap1End', v)} highlightChanges={highlightChanges} />
                  </td>
                  <td className="border-r border-black p-1 text-center">
                    <EditableCell errorMsg={errors.lap2Start} successMsg={successes.lap2Start} rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.lap2Start} onChange={(v) => onUpdateRow(row.id, 'lap2Start', v)} highlightChanges={highlightChanges} />
                  </td>
                  <td className="border-r border-black p-1 text-center">
                    <EditableCell errorMsg={errors.lap2End} successMsg={successes.lap2End} rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.lap2End} onChange={(v) => onUpdateRow(row.id, 'lap2End', v)} highlightChanges={highlightChanges} />
                  </td>
                  <td className="border-r border-black p-1 text-center">
                    <EditableCell errorMsg={errors.weightEnd} successMsg={successes.weightEnd} rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.weightEnd} onChange={(v) => onUpdateRow(row.id, 'weightEnd', v)} highlightChanges={highlightChanges} />
                  </td>
                  <td className={`p-1 text-center ${showCalcHours ? 'border-r border-black' : ''}`}>
                    <EditableCell rowActions={rowActions} onContextMenuEvent={handleCellContextMenu} cell={row.cells.timeOut} onChange={(v) => onUpdateRow(row.id, 'timeOut', v)} highlightChanges={highlightChanges} />
                  </td>
                  {showCalcHours && (
                    <td className="p-1 text-center bg-slate-50 text-slate-500 italic font-medium select-none pointer-events-none print:bg-transparent print:text-black print:not-italic print:font-normal">
                      {calculateHours(row.cells.timeIn?.value || '', row.cells.timeOut?.value || '')}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>

          <tfoot className="table-footer-group">
            <tr>
              <td colSpan={9 + extraColsCount + (showCalcHours ? 1 : 0)} className="p-0 border-0">
                <div className="grid grid-cols-4 border-t-2 border-black mt-0">
                  <div className="col-span-1 border-r border-black py-0.5 px-2 flex flex-col justify-center items-start">
                    <div className="font-bold text-sm uppercase leading-tight">ICS 211 FIT</div>
                    <div className="text-[10px]">CALSAR {new Date().toLocaleDateString('en-US', { month: '2-digit', year: '2-digit' }).replace('/', '/')}</div>
                  </div>
                  <div className="col-span-3 px-1 py-0.5 pl-4 overflow-hidden">
                    <div className="text-[10px] uppercase font-semibold leading-tight">9. PREPARED BY</div>
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

ICS211Form.displayName = 'ICS211Form';
