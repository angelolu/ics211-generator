import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchAndCacheTeamSubdomain, formatActivityLocation, getActivity, getAttendees, getMemberDetails, getMemberQualifications } from '../api/d4h';
import { format } from 'date-fns';
import { calculateHours } from '../utils/time';
import { buildMemberMaps, type MemberDetailMaps } from '../utils/memberMaps';

const formatD4HTime = (isoString?: string | null): string => {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  return format(d, 'HHmm');
};

const calculateD4HHours = (
  startIso?: string | null,
  endIso?: string | null,
  timeInStr?: string,
  timeOutStr?: string,
  attHours?: number,
  attDuration?: number
): string => {
  if (startIso && endIso) {
    const s = new Date(startIso).getTime();
    const e = new Date(endIso).getTime();
    if (!isNaN(s) && !isNaN(e) && e > s) {
      const diffMins = Math.round((e - s) / (1000 * 60));
      const h = Math.floor(diffMins / 60);
      const m = diffMins % 60;
      if (m === 0) return `${h}h`;
      return `${h}h ${m}m`;
    }
  }
  if (timeInStr && timeOutStr) {
    return calculateHours(timeInStr, timeOutStr);
  }
  if (attHours !== undefined && attHours !== null) {
    return `${attHours}h`;
  }
  if (attDuration !== undefined && attDuration !== null) {
    const h = Math.floor(attDuration / 60);
    const m = attDuration % 60;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }
  return '';
};

const isEventTodayOrFuture = (isoDate?: string | null): boolean => {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return d.getTime() >= todayStart;
};

export interface CellState {
  value: string;
  isEditedLocally: boolean;
  conflictValue?: string;
  originalValue: string;
}

export interface FormRowData {
  id: string; // "member_123" or "blank_uuid"
  memberId?: number;
  cells: {
    name: CellState;
    phone: CellState;
    timeIn: CellState;
    weightStart: CellState;
    lap1Start: CellState;
    lap1End: CellState;
    lap2Start: CellState;
    lap2End: CellState;
    weightEnd: CellState;
    timeOut: CellState;
    tCard: CellState;
    hours: CellState;
    additionalInfo: CellState;
    agencyTeam: CellState;
  };
  isDeleted?: boolean;
}

export interface FormHeaderData {
  exerciseName: CellState;
  date: CellState;
  exerciseNumber: CellState;
  checkInLocation: CellState;
  agencyTeam: CellState;
  liaisonName: CellState;
  agencyAddress: CellState;
  agencyPhone: CellState;
  preparedBy: CellState;
}

export interface FormPeriodData {
  id: string; // e.g. 'period_2026-08-14'
  date: string; // '08/14/2026'
  label: string; // 'Day 1 — Aug 14, 2026'
  headers: FormHeaderData;
  rows: FormRowData[];
}

export interface FormStateData {
  headers: FormHeaderData;
  rows: FormRowData[];
  periods?: FormPeriodData[];
}

// ── Helpers ────────────────────────────────────────────────

const createCell = (value: string): CellState => ({
  value,
  isEditedLocally: false,
  originalValue: value,
});

const generateBlankRow = (id: string): FormRowData => ({
  id,
  cells: {
    name: createCell(''),
    phone: createCell(''),
    timeIn: createCell(''),
    weightStart: createCell(''),
    lap1Start: createCell(''),
    lap1End: createCell(''),
    lap2Start: createCell(''),
    lap2End: createCell(''),
    weightEnd: createCell(''),
    timeOut: createCell(''),
    tCard: createCell(''),
    hours: createCell(''),
    additionalInfo: createCell(''),
    agencyTeam: createCell(''),
  }
});

/** Generate a unique blank-row ID using crypto.randomUUID */
const blankRowId = (prefix = '') => `${prefix}blank_${crypto.randomUUID()}`;

/** Build a FormRowData from an attendee + member detail lookup */
const buildAttendeeRow = (
  att: any,
  memberData: any[],
  isTodayOrFuture: boolean,
  exerciseFallback: any,
  idPrefix: string,
): FormRowData => {
  const memberDetail = memberData.find((m: any) => m.id === att.member.id);
  const phone = memberDetail?.mobile?.phone || memberDetail?.home?.phone || memberDetail?.work?.phone || '';
  const startIso = att.startsAt || exerciseFallback?.startsAt;
  const endIso = att.endsAt || exerciseFallback?.endsAt;
  const timeInStr = isTodayOrFuture ? '' : formatD4HTime(startIso);
  const timeOutStr = isTodayOrFuture ? '' : formatD4HTime(endIso);
  const hoursStr = isTodayOrFuture ? '' : calculateD4HHours(startIso, endIso, timeInStr, timeOutStr, att.hours, att.duration);

  return {
    id: `${idPrefix}member_${att.member.id}`,
    memberId: att.member.id,
    cells: {
      name: createCell(memberDetail?.name || 'Unknown Member'),
      phone: createCell(phone),
      timeIn: createCell(timeInStr),
      weightStart: createCell(''),
      lap1Start: createCell(''),
      lap1End: createCell(''),
      lap2Start: createCell(''),
      lap2End: createCell(''),
      weightEnd: createCell(''),
      timeOut: createCell(timeOutStr),
      tCard: createCell(''),
      hours: createCell(hoursStr),
      additionalInfo: createCell(''),
      agencyTeam: createCell(''),
    }
  };
};

// ── Combined member-maps state ─────────────────────────────

interface AllMemberMaps extends MemberDetailMaps {
  medicalMap: Record<number, string>;
  technicalMap: Record<number, string>;
}

const EMPTY_MAPS: AllMemberMaps = {
  medicalMap: {}, technicalMap: {},
  positionsMap: {}, idsMap: {}, statusMap: {}, rolesMap: {}, emailMap: {},
};

// ── Hook ───────────────────────────────────────────────────

export function useFormState(exerciseId: number | string | undefined, contextId: string | null, exercise: any | undefined, teamTitle: string) {
  const storageKey = `d4h_form_${exerciseId}`;
  
  // Parse contextId once — all API calls use this number
  const contextIdNum = contextId ? parseInt(contextId, 10) : NaN;
  
  const exerciseRef = useRef(exercise);
  exerciseRef.current = exercise;
  const teamTitleRef = useRef(teamTitle);
  teamTitleRef.current = teamTitle;
  const lastSavedJsonRef = useRef<string>('');

  const [formState, setFormState] = useState<FormStateData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPulling, setIsPulling] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [memberMaps, setMemberMaps] = useState<AllMemberMaps>(EMPTY_MAPS);
  const [highlightChanges, setHighlightChanges] = useState(() => {
    return localStorage.getItem('d4h_highlight_changes') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('d4h_highlight_changes', String(highlightChanges));
  }, [highlightChanges]);

  // ── Derived flags (memoized) ──────────────────────────────

  const hasLocalChanges = useMemo(() => {
    if (!formState) return false;
    return (
      Object.values(formState.headers).some(c => c.isEditedLocally) ||
      formState.rows.some(r => Object.values(r.cells).some(c => c.isEditedLocally) || r.isDeleted) ||
      (formState.periods ? formState.periods.some(p =>
        Object.values(p.headers).some(c => c.isEditedLocally) ||
        p.rows.some(r => Object.values(r.cells).some(c => c.isEditedLocally) || r.isDeleted)
      ) : false)
    );
  }, [formState]);
    
  const hasConflicts = useMemo(() => {
    if (!formState) return false;
    return (
      Object.values(formState.headers).some(c => !!c.conflictValue) ||
      formState.rows.some(r => Object.values(r.cells).some(c => !!c.conflictValue)) ||
      (formState.periods ? formState.periods.some(p =>
        Object.values(p.headers).some(c => !!c.conflictValue) ||
        p.rows.some(r => Object.values(r.cells).some(c => !!c.conflictValue))
      ) : false)
    );
  }, [formState]);

  // ── Initialize or load state ──────────────────────────────

  useEffect(() => {
    if (!exerciseId) return;
    const isLocal = typeof exerciseId === 'string' && exerciseId.startsWith('local_');
    const currentEx = exerciseRef.current;
    if (!isLocal && (isNaN(contextIdNum) || !currentEx)) return;

    const loadInitialData = async () => {
      try {
        const savedData = localStorage.getItem(storageKey);
        if (savedData) {
          const parsed = JSON.parse(savedData);

          // If activity spans multiple days in D4H but the cache is in legacy single-page format, discard stale cache and rebuild fresh
          const isLegacySinglePageMultiDay = !isLocal && !parsed.periods && currentEx?.startsAt && currentEx?.endsAt &&
            format(new Date(currentEx.startsAt), 'yyyy-MM-dd') !== format(new Date(currentEx.endsAt), 'yyyy-MM-dd');

          if (isLegacySinglePageMultiDay) {
            localStorage.removeItem(storageKey);
          } else {
            // Normalize legacy rows to have the new cells
            if (parsed && parsed.rows) {
              parsed.rows = parsed.rows.map((r: any) => ({
                ...r,
                cells: {
                  ...r.cells,
                  tCard: r.cells.tCard || createCell(''),
                  hours: r.cells.hours || createCell(''),
                  additionalInfo: r.cells.additionalInfo || createCell(''),
                  agencyTeam: r.cells.agencyTeam || createCell('')
                }
              }));
            }
            if (parsed && parsed.periods) {
              parsed.periods = parsed.periods.map((p: any) => ({
                ...p,
                rows: p.rows.map((r: any) => ({
                  ...r,
                  cells: {
                    ...r.cells,
                    tCard: r.cells?.tCard || createCell(''),
                    hours: r.cells?.hours || createCell(''),
                    additionalInfo: r.cells?.additionalInfo || createCell(''),
                    agencyTeam: r.cells?.agencyTeam || createCell('')
                  }
                }))
              }));
            }

            setFormState(parsed);
            setIsLoading(false);

            // Even when loading from cache, fetch member info live for D4H rosters
            if (!isLocal && !isNaN(contextIdNum)) {
              fetchAndCacheTeamSubdomain(contextId!);
              const cachedMemberIds = parsed.periods
                ? parsed.periods.flatMap((p: any) => p.rows.map((r: any) => r.memberId)).filter((id: any): id is number => typeof id === 'number')
                : (parsed.rows as FormRowData[]).map(r => r.memberId).filter((id): id is number => typeof id === 'number');

              if (cachedMemberIds.length > 0) {
                getMemberQualifications(contextIdNum, cachedMemberIds)
                  .then(res => {
                    setMemberMaps(prev => ({ ...prev, medicalMap: res.medicalMap, technicalMap: res.technicalMap }));
                  });
                getMemberDetails(contextIdNum, cachedMemberIds)
                  .then(members => {
                    const maps = buildMemberMaps(members);
                    setMemberMaps(prev => ({ ...prev, ...maps }));
                  });
              }

              // Background check for pending D4H changes
              const checkPendingChanges = async (currentForm: FormStateData) => {
                try {
                  const [attData, freshExercise] = await Promise.all([
                    getAttendees(contextIdNum, exerciseId as number),
                    getActivity(contextIdNum, exerciseId as number, currentEx?.type),
                  ]);
                  const memberIds = attData.map(a => a.member.id);
                  const memberData = memberIds.length > 0
                    ? await getMemberDetails(contextIdNum, memberIds)
                    : [];

                  let changesFound = false;

                  if (freshExercise) {
                    const remoteExName = freshExercise.referenceDescription || freshExercise.description || 'Unnamed Exercise';
                    const remoteDate = freshExercise.startsAt ? format(new Date(freshExercise.startsAt), 'MM/dd/yyyy') : '';
                    const remoteExNumber = freshExercise.id.toString();
                    const remoteCheckInLoc = formatActivityLocation(freshExercise);

                    if (
                      (currentForm.headers.exerciseName && currentForm.headers.exerciseName.originalValue !== remoteExName) ||
                      (currentForm.headers.date && currentForm.headers.date.originalValue !== remoteDate) ||
                      (currentForm.headers.exerciseNumber && currentForm.headers.exerciseNumber.originalValue !== remoteExNumber) ||
                      (currentForm.headers.checkInLocation && currentForm.headers.checkInLocation.originalValue !== remoteCheckInLoc)
                    ) {
                      changesFound = true;
                    }
                  }

                  if (!changesFound) {
                    const currentMemberRows = currentForm.periods
                      ? currentForm.periods.flatMap(p => p.rows.filter(r => typeof r.memberId === 'number' && !r.isDeleted))
                      : currentForm.rows.filter(r => typeof r.memberId === 'number' && !r.isDeleted);
                    const currentMemberIds = new Set(currentMemberRows.map(r => r.memberId));

                    if (currentMemberRows.length !== attData.length) {
                      changesFound = true;
                    } else {
                      for (const att of attData) {
                        if (!currentMemberIds.has(att.member.id)) {
                          changesFound = true;
                          break;
                        }
                      }
                    }

                    if (!changesFound) {
                      for (const att of attData) {
                        const row = currentMemberRows.find(r => r.memberId === att.member.id);
                        if (!row) {
                          changesFound = true;
                          break;
                        }

                        const memberDetail = memberData.find(m => m.id === att.member.id);
                        const remoteName = memberDetail?.name || 'Unknown Member';
                        const remotePhone = memberDetail?.mobile?.phone || memberDetail?.home?.phone || memberDetail?.work?.phone || '';

                        const startIso = att.startsAt || freshExercise?.startsAt || currentEx?.startsAt;
                        const endIso = att.endsAt || freshExercise?.endsAt || currentEx?.endsAt;
                        const isTodayOrFuture = isEventTodayOrFuture(freshExercise?.startsAt || currentEx?.startsAt || startIso);
                        const remoteTimeIn = isTodayOrFuture ? '' : formatD4HTime(startIso);
                        const remoteTimeOut = isTodayOrFuture ? '' : formatD4HTime(endIso);
                        const remoteHours = isTodayOrFuture ? '' : calculateD4HHours(startIso, endIso, remoteTimeIn, remoteTimeOut, att.hours, att.duration);

                        if (
                          row.cells.name.originalValue !== remoteName ||
                          row.cells.phone.originalValue !== remotePhone ||
                          row.cells.timeIn.originalValue !== remoteTimeIn ||
                          row.cells.timeOut.originalValue !== remoteTimeOut ||
                          row.cells.hours.originalValue !== remoteHours
                        ) {
                          changesFound = true;
                          break;
                        }
                      }
                    }
                  }

                  setHasPendingChanges(changesFound);
                } catch (e) {
                  console.error('[Background Check] Error checking D4H changes:', e);
                }
              };

              checkPendingChanges(parsed);
            }
            return;
          }
        }

        if (isLocal) {
          const headers: FormHeaderData = {
            exerciseName: createCell(exercise?.title || 'New Local Roster'),
            date: createCell(format(new Date(), 'MM/dd/yyyy')),
            exerciseNumber: createCell('Local'),
            checkInLocation: createCell(''),
            agencyTeam: createCell(teamTitle),
            liaisonName: createCell(''),
            agencyAddress: createCell(''),
            agencyPhone: createCell(''),
            preparedBy: createCell(''),
          };
          const rows: FormRowData[] = [];
          for (let i = 0; i < 15; i++) {
            rows.push(generateBlankRow(blankRowId()));
          }
          const newState: FormStateData = { headers, rows };
          setFormState(newState);
          localStorage.setItem(storageKey, JSON.stringify(newState));

          // Ensure this roster is present in fitnessqual_local_rosters
          try {
            const savedList = localStorage.getItem('fitnessqual_local_rosters');
            const rosters = savedList ? JSON.parse(savedList) : [];
            if (!rosters.some((r: { id: string }) => r.id === exerciseId)) {
              rosters.unshift({
                id: exerciseId,
                title: headers.exerciseName.value,
                createdAt: new Date().toISOString(),
                type: 'local',
              });
              localStorage.setItem('fitnessqual_local_rosters', JSON.stringify(rosters));
            }
          } catch (e) {
            console.error('Failed to sync local roster list', e);
          }

          setIsLoading(false);
          return;
        }

        // Build from scratch (D4H)
        const attData = await getAttendees(contextIdNum, exerciseId as number);
        const memberIds = Array.from(new Set(attData.map(a => a.member.id)));
        const [memberData, qualRes] = await Promise.all([
          memberIds.length > 0 ? getMemberDetails(contextIdNum, memberIds) : Promise.resolve([]),
          memberIds.length > 0 ? getMemberQualifications(contextIdNum, memberIds) : Promise.resolve({ medicalMap: {}, technicalMap: {} }),
        ]);

        const maps = buildMemberMaps(memberData, attData);
        setMemberMaps({
          medicalMap: qualRes.medicalMap,
          technicalMap: qualRes.technicalMap,
          ...maps,
        });
        
        const exerciseDate = currentEx.startsAt ? format(new Date(currentEx.startsAt), 'MM/dd/yyyy') : '';
        const exName = currentEx.referenceDescription || currentEx.description || 'Unnamed Exercise';
        const checkInLoc = formatActivityLocation(currentEx);

        const baseHeaders: FormHeaderData = {
          exerciseName: createCell(exName),
          date: createCell(exerciseDate),
          exerciseNumber: createCell(currentEx.id.toString()),
          checkInLocation: createCell(checkInLoc),
          agencyTeam: createCell(teamTitle),
          liaisonName: createCell(''),
          agencyAddress: createCell(''),
          agencyPhone: createCell(''),
          preparedBy: createCell(''),
        };

        // Detect operational periods from attendees' startsAt dates
        const uniqueDates = new Set<string>();
        attData.forEach(att => {
          if (att.startsAt) {
            uniqueDates.add(format(new Date(att.startsAt), 'yyyy-MM-dd'));
          }
        });

        if (uniqueDates.size <= 1 && currentEx?.startsAt && currentEx?.endsAt) {
          const startD = new Date(currentEx.startsAt);
          const endD = new Date(currentEx.endsAt);
          const startDay = format(startD, 'yyyy-MM-dd');
          const endDay = format(endD, 'yyyy-MM-dd');
          if (startDay !== endDay) {
            let curr = new Date(startD);
            while (curr < endD) {
              uniqueDates.add(format(curr, 'yyyy-MM-dd'));
              curr.setDate(curr.getDate() + 1);
            }
          }
        }

        const sortedDates = Array.from(uniqueDates).sort();

        let periods: FormPeriodData[] | undefined = undefined;
        let finalHeaders = baseHeaders;
        let finalRows: FormRowData[] = [];

        if (sortedDates.length > 1) {
          // Multi-period activity
          periods = sortedDates.map((dateStr, periodIdx) => {
            const periodDateFormatted = format(new Date(dateStr + 'T12:00:00'), 'MM/dd/yyyy');
            const periodLabel = `Day ${periodIdx + 1} — ${format(new Date(dateStr + 'T12:00:00'), 'EEE, MMM d')}`;
            
            const periodHeaders: FormHeaderData = {
              ...baseHeaders,
              date: createCell(periodDateFormatted),
            };

            const periodAttendees = attData.filter(a => {
              const aDate = a.startsAt ? format(new Date(a.startsAt), 'yyyy-MM-dd') : format(new Date(currentEx.startsAt), 'yyyy-MM-dd');
              return aDate === dateStr;
            });

            const isFuture = isEventTodayOrFuture(dateStr + 'T00:00:00');
            const periodRows: FormRowData[] = periodAttendees.map(att =>
              buildAttendeeRow(att, memberData, isFuture, currentEx, `p${periodIdx}_`)
            );

            // 5 blank rows per period
            for (let i = 0; i < 5; i++) {
              periodRows.push(generateBlankRow(blankRowId(`p${periodIdx}_`)));
            }

            return {
              id: `period_${dateStr}`,
              date: periodDateFormatted,
              label: periodLabel,
              headers: periodHeaders,
              rows: periodRows,
            };
          });

          finalHeaders = periods[0].headers;
          finalRows = periods[0].rows;
        } else {
          // Single period
          const isFuture = isEventTodayOrFuture(currentEx?.startsAt);
          finalRows = attData.map(att =>
            buildAttendeeRow(att, memberData, isFuture, currentEx, '')
          );

          // Add 5 blank rows initially
          for (let i = 0; i < 5; i++) {
            finalRows.push(generateBlankRow(blankRowId()));
          }
        }

        const newState: FormStateData = { headers: finalHeaders, rows: finalRows, periods };
        setFormState(newState);
        localStorage.setItem(storageKey, JSON.stringify(newState));
      } catch (e) {
        console.error("Failed to load initial data", e);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, [exerciseId, contextIdNum, storageKey]);

  // Save to local storage whenever formState changes (avoid redundant writes)
  useEffect(() => {
    if (formState) {
      const json = JSON.stringify(formState);
      if (json !== lastSavedJsonRef.current) {
        lastSavedJsonRef.current = json;
        localStorage.setItem(storageKey, json);

        // If local roster, keep title in fitnessqual_local_rosters updated
        if (typeof exerciseId === 'string' && exerciseId.startsWith('local_')) {
          try {
            const savedList = localStorage.getItem('fitnessqual_local_rosters');
            if (savedList) {
              const rosters: Array<{ id: string; title: string; createdAt: string; type: string }> = JSON.parse(savedList);
              const currentTitle = formState.headers?.exerciseName?.value;
              if (currentTitle) {
                let updated = false;
                const newRosters = rosters.map(r => {
                  if (r.id === exerciseId && r.title !== currentTitle) {
                    updated = true;
                    return { ...r, title: currentTitle };
                  }
                  return r;
                });
                if (updated) {
                  localStorage.setItem('fitnessqual_local_rosters', JSON.stringify(newRosters));
                }
              }
            }
          } catch (e) {
            console.error('Failed to sync local roster title', e);
          }
        }
      }
    }
  }, [formState, storageKey, exerciseId]);

  // ── Mutation helpers ──────────────────────────────────────

  const updateHeaderCell = (key: keyof FormHeaderData, value: string, periodIndex?: number) => {
    setFormState(prev => {
      if (!prev) return prev;
      
      let newPeriods = prev.periods;
      if (newPeriods && periodIndex !== undefined && newPeriods[periodIndex]) {
        newPeriods = newPeriods.map((p, idx) => {
          if (idx !== periodIndex) return p;
          const cell = p.headers[key];
          return {
            ...p,
            headers: {
              ...p.headers,
              [key]: {
                ...cell,
                value,
                isEditedLocally: value !== cell.originalValue,
                conflictValue: cell.conflictValue && value === cell.conflictValue ? undefined : cell.conflictValue
              }
            }
          };
        });
      }

      // BUG FIX: Only update top-level headers when no period is targeted
      if (periodIndex === undefined) {
        const cell = prev.headers[key];
        const newTopHeaders = {
          ...prev.headers,
          [key]: {
            ...cell,
            value,
            isEditedLocally: value !== cell.originalValue,
            conflictValue: cell.conflictValue && value === cell.conflictValue ? undefined : cell.conflictValue
          }
        };
        return { ...prev, headers: newTopHeaders, periods: newPeriods };
      }

      return { ...prev, periods: newPeriods };
    });
  };

  const updateRowCell = (rowId: string, colKey: keyof FormRowData['cells'], value: string) => {
    setFormState(prev => {
      if (!prev) return prev;
      
      const updateRowList = (rowList: FormRowData[]) => rowList.map(r => {
        if (r.id !== rowId) return r;
        const cell = r.cells[colKey];
        return {
          ...r,
          cells: {
            ...r.cells,
            [colKey]: {
              ...cell,
              value,
              isEditedLocally: value !== cell.originalValue,
              conflictValue: cell.conflictValue && value === cell.conflictValue ? undefined : cell.conflictValue
            }
          }
        };
      });

      const newRows = updateRowList(prev.rows);
      const newPeriods = prev.periods ? prev.periods.map(p => ({
        ...p,
        rows: updateRowList(p.rows)
      })) : undefined;

      return { ...prev, rows: newRows, periods: newPeriods };
    });
  };

  const addBlankRows = (count: number, periodIndex?: number) => {
    setFormState(prev => {
      if (!prev) return prev;
      
      if (prev.periods && periodIndex !== undefined && prev.periods[periodIndex]) {
        const newPeriods = prev.periods.map((p, idx) => {
          if (idx !== periodIndex) return p;
          const newRows = [...p.rows];
          for (let i = 0; i < count; i++) {
            newRows.push(generateBlankRow(blankRowId(`p${idx}_`)));
          }
          return { ...p, rows: newRows };
        });
        return { ...prev, periods: newPeriods };
      }

      if (prev.periods) {
        const newPeriods = prev.periods.map((p, idx) => {
          const newRows = [...p.rows];
          for (let i = 0; i < count; i++) {
            newRows.push(generateBlankRow(blankRowId(`p${idx}_`)));
          }
          return { ...p, rows: newRows };
        });
        return { ...prev, periods: newPeriods };
      }

      const newRows = [...prev.rows];
      for (let i = 0; i < count; i++) {
        newRows.push(generateBlankRow(blankRowId()));
      }
      return { ...prev, rows: newRows };
    });
  };

  const removeRow = (rowId: string) => {
    setFormState(prev => {
      if (!prev) return prev;
      const removeOrMark = (rowList: FormRowData[]) => rowList.filter(r => {
        if (r.id === rowId) {
          if (r.id.startsWith('blank_') || r.id.includes('_blank_')) return false;
          return true;
        }
        return true;
      }).map(r => r.id === rowId ? { ...r, isDeleted: true } : r);

      const newRows = removeOrMark(prev.rows);
      const newPeriods = prev.periods ? prev.periods.map(p => ({
        ...p,
        rows: removeOrMark(p.rows)
      })) : undefined;

      return { ...prev, rows: newRows, periods: newPeriods };
    });
  };

  const restoreRow = (rowId: string) => {
    setFormState(prev => {
      if (!prev) return prev;
      const restoreInList = (rowList: FormRowData[]) => rowList.map(r => r.id === rowId ? { ...r, isDeleted: false } : r);

      const newRows = restoreInList(prev.rows);
      const newPeriods = prev.periods ? prev.periods.map(p => ({
        ...p,
        rows: restoreInList(p.rows)
      })) : undefined;

      return { ...prev, rows: newRows, periods: newPeriods };
    });
  };

  const resetChanges = () => {
    setFormState(prev => {
      if (!prev) return prev;
      const resetHeaders = (h: FormHeaderData) => {
        const out = { ...h };
        (Object.keys(out) as Array<keyof FormHeaderData>).forEach(k => {
          out[k] = { ...out[k], value: out[k].originalValue, isEditedLocally: false, conflictValue: undefined };
        });
        return out;
      };
      const resetRows = (rows: FormRowData[]) => rows.map(r => {
        const newCells = { ...r.cells };
        (Object.keys(newCells) as Array<keyof FormRowData['cells']>).forEach(k => {
          const colKey = k as keyof FormRowData['cells'];
          newCells[colKey] = { ...newCells[colKey], value: newCells[colKey].originalValue, isEditedLocally: false, conflictValue: undefined };
        });
        // BUG FIX: Also restore deleted rows so reset truly reverts to D4H state
        return { ...r, cells: newCells, isDeleted: false };
      });

      return {
        ...prev,
        headers: resetHeaders(prev.headers),
        rows: resetRows(prev.rows),
        periods: prev.periods ? prev.periods.map(p => ({
          ...p,
          headers: resetHeaders(p.headers),
          rows: resetRows(p.rows)
        })) : undefined
      };
    });
  };

  const fixConflicts = () => {
    // Accept all remote values
    setFormState(prev => {
      if (!prev) return prev;
      const fixHeaders = (h: FormHeaderData) => {
        const out = { ...h };
        (Object.keys(out) as Array<keyof FormHeaderData>).forEach(k => {
          if (out[k].conflictValue !== undefined) {
            out[k] = {
              ...out[k],
              value: out[k].conflictValue!,
              originalValue: out[k].conflictValue!,
              isEditedLocally: false,
              conflictValue: undefined
            };
          }
        });
        return out;
      };

      const fixRows = (rows: FormRowData[]) => rows.map(r => {
        const newCells = { ...r.cells };
        (Object.keys(newCells) as Array<keyof FormRowData['cells']>).forEach(k => {
          const colKey = k as keyof FormRowData['cells'];
          if (newCells[colKey].conflictValue !== undefined) {
            newCells[colKey] = {
              ...newCells[colKey],
              value: newCells[colKey].conflictValue!,
              originalValue: newCells[colKey].conflictValue!,
              isEditedLocally: false,
              conflictValue: undefined
            };
          }
        });
        return { ...r, cells: newCells };
      });

      return {
        ...prev,
        headers: fixHeaders(prev.headers),
        rows: fixRows(prev.rows),
        periods: prev.periods ? prev.periods.map(p => ({
          ...p,
          headers: fixHeaders(p.headers),
          rows: fixRows(p.rows)
        })) : undefined
      };
    });
  };

  const pullData = async () => {
    if (!exerciseId || isNaN(contextIdNum)) return;
    setIsPulling(true);
    try {
      // BUG FIX: Use exerciseRef.current to avoid stale closure
      const currentExercise = exerciseRef.current;
      const [attData, freshExercise] = await Promise.all([
        getAttendees(contextIdNum, exerciseId as number),
        getActivity(contextIdNum, exerciseId as number, currentExercise?.type),
      ]);
      const memberIds = attData.map(a => a.member.id);
      const [memberData, qualRes] = await Promise.all([
        memberIds.length > 0 ? getMemberDetails(contextIdNum, memberIds) : Promise.resolve([]),
        memberIds.length > 0 ? getMemberQualifications(contextIdNum, memberIds) : Promise.resolve({ medicalMap: {}, technicalMap: {} }),
      ]);

      const maps = buildMemberMaps(memberData, attData);
      setMemberMaps(prev => ({
        medicalMap: { ...prev.medicalMap, ...qualRes.medicalMap },
        technicalMap: { ...prev.technicalMap, ...qualRes.technicalMap },
        positionsMap: { ...prev.positionsMap, ...maps.positionsMap },
        idsMap: { ...prev.idsMap, ...maps.idsMap },
        statusMap: { ...prev.statusMap, ...maps.statusMap },
        rolesMap: { ...prev.rolesMap, ...maps.rolesMap },
        emailMap: { ...prev.emailMap, ...maps.emailMap },
      }));
      
      setFormState(prev => {
        if (!prev) return prev;
        
        const newHeaders = { ...prev.headers };

        const isTodayOrFuture = isEventTodayOrFuture(freshExercise?.startsAt || currentExercise?.startsAt);

        if (freshExercise) {
          const remoteExName = freshExercise.referenceDescription || freshExercise.description || 'Unnamed Exercise';
          const remoteDate = freshExercise.startsAt ? format(new Date(freshExercise.startsAt), 'MM/dd/yyyy') : '';
          const remoteExNumber = freshExercise.id.toString();
          const remoteCheckInLoc = formatActivityLocation(freshExercise);

          const updateHeaderCellLogic = (hObj: FormHeaderData, headerKey: keyof FormHeaderData, remoteVal: string) => {
            const cell = hObj[headerKey];
            if (cell.isEditedLocally) {
              hObj[headerKey] = {
                ...cell,
                originalValue: remoteVal,
                isEditedLocally: cell.value !== remoteVal,
                conflictValue: undefined
              };
            } else {
              hObj[headerKey] = {
                ...cell,
                value: remoteVal,
                originalValue: remoteVal,
                isEditedLocally: false,
                conflictValue: undefined
              };
            }
          };

          updateHeaderCellLogic(newHeaders, 'exerciseName', remoteExName);
          updateHeaderCellLogic(newHeaders, 'date', remoteDate);
          updateHeaderCellLogic(newHeaders, 'exerciseNumber', remoteExNumber);
          updateHeaderCellLogic(newHeaders, 'checkInLocation', remoteCheckInLoc);
        }

        const updateRowsForList = (rowsList: FormRowData[], filterPeriodDate?: string) => {
          const updatedRows = [...rowsList];
          const attendeesForThisList = filterPeriodDate
            ? attData.filter(a => {
                const aDate = a.startsAt ? format(new Date(a.startsAt), 'yyyy-MM-dd') : format(new Date(freshExercise?.startsAt || currentExercise?.startsAt), 'yyyy-MM-dd');
                return aDate === filterPeriodDate;
              })
            : attData;

          attendeesForThisList.forEach(att => {
            const memberDetail = memberData.find(m => m.id === att.member.id);
            const remoteName = memberDetail?.name || 'Unknown Member';
            const remotePhone = memberDetail?.mobile?.phone || memberDetail?.home?.phone || memberDetail?.work?.phone || '';
            
            const startIso = att.startsAt || freshExercise?.startsAt || currentExercise?.startsAt;
            const endIso = att.endsAt || freshExercise?.endsAt || currentExercise?.endsAt;
            const remoteTimeIn = isTodayOrFuture ? '' : formatD4HTime(startIso);
            const remoteTimeOut = isTodayOrFuture ? '' : formatD4HTime(endIso);
            const remoteHours = isTodayOrFuture ? '' : calculateD4HHours(startIso, endIso, remoteTimeIn, remoteTimeOut, att.hours, att.duration);
            
            const existingRowIndex = updatedRows.findIndex(r => r.memberId === att.member.id);
            
            if (existingRowIndex >= 0) {
              const row = updatedRows[existingRowIndex];
              const newCells = { ...row.cells };
              
              const updateCellLogic = (colKey: keyof FormRowData['cells'], remoteVal: string) => {
                const cell = newCells[colKey];
                if (cell.isEditedLocally) {
                  newCells[colKey] = {
                    ...cell,
                    originalValue: remoteVal,
                    isEditedLocally: cell.value !== remoteVal,
                    conflictValue: undefined
                  };
                } else {
                  newCells[colKey] = {
                    ...cell,
                    value: remoteVal,
                    originalValue: remoteVal,
                    isEditedLocally: false,
                    conflictValue: undefined
                  };
                }
              };
              
              updateCellLogic('name', remoteName);
              updateCellLogic('phone', remotePhone);
              updateCellLogic('timeIn', remoteTimeIn);
              updateCellLogic('timeOut', remoteTimeOut);
              updateCellLogic('hours', remoteHours);
              
              updatedRows[existingRowIndex] = { ...row, cells: newCells };
            } else {
              let lastFilledIndex = -1;
              for (let i = 0; i < updatedRows.length; i++) {
                const isFilled = Object.values(updatedRows[i].cells).some(c => c.value.trim() !== '');
                if (isFilled) lastFilledIndex = i;
              }
              
              const newAttRow: FormRowData = {
                id: filterPeriodDate ? `p_${filterPeriodDate}_member_${att.member.id}` : `member_${att.member.id}`,
                memberId: att.member.id,
                cells: {
                  name: createCell(remoteName),
                  phone: createCell(remotePhone),
                  timeIn: createCell(remoteTimeIn),
                  weightStart: createCell(''),
                  lap1Start: createCell(''),
                  lap1End: createCell(''),
                  lap2Start: createCell(''),
                  lap2End: createCell(''),
                  weightEnd: createCell(''),
                  timeOut: createCell(remoteTimeOut),
                  tCard: createCell(''),
                  hours: createCell(remoteHours),
                  additionalInfo: createCell(''),
                  agencyTeam: createCell(''),
                }
              };
              
              updatedRows.splice(lastFilledIndex + 1, 0, newAttRow);
            }
          });
          return updatedRows;
        };

        const newRows = updateRowsForList(prev.rows);
        const newPeriods = prev.periods ? prev.periods.map(p => {
          const dateStr = p.id.startsWith('period_') ? p.id.replace('period_', '') : '';
          const pHeaders = { ...p.headers };
          if (freshExercise) {
            const remoteExName = freshExercise.referenceDescription || freshExercise.description || 'Unnamed Exercise';
            const remoteExNumber = freshExercise.id.toString();
            const remoteCheckInLoc = formatActivityLocation(freshExercise);
            const updateH = (key: keyof FormHeaderData, val: string) => {
              const cell = pHeaders[key];
              if (cell.isEditedLocally) {
                pHeaders[key] = { ...cell, originalValue: val, isEditedLocally: cell.value !== val, conflictValue: undefined };
              } else {
                pHeaders[key] = { ...cell, value: val, originalValue: val, isEditedLocally: false, conflictValue: undefined };
              }
            };
            updateH('exerciseName', remoteExName);
            updateH('exerciseNumber', remoteExNumber);
            updateH('checkInLocation', remoteCheckInLoc);
          }
          return {
            ...p,
            headers: pHeaders,
            rows: updateRowsForList(p.rows, dateStr || undefined)
          };
        }) : undefined;
        
        return { ...prev, headers: newHeaders, rows: newRows, periods: newPeriods };
      });
      setHasPendingChanges(false);
    } catch (e) {
      console.error("Failed to pull updates", e);
    } finally {
      setIsPulling(false);
    }
  };

  return {
    formState,
    isLoading,
    isPulling,
    hasLocalChanges,
    hasConflicts,
    hasPendingChanges,
    ...memberMaps,
    highlightChanges,
    setHighlightChanges,
    updateHeaderCell,
    updateRowCell,
    addBlankRows,
    resetChanges,
    fixConflicts,
    pullData,
    removeRow,
    restoreRow
  };
}
