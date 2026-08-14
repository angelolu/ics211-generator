import { useState, useEffect, useRef } from 'react';
import { fetchAndCacheTeamSubdomain, formatActivityLocation, getActivity, getAttendees, getMemberDetails, getMemberQualifications } from '../api/d4h';
import { format } from 'date-fns';
import { calculateHours } from '../utils/time';

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

const extractEmail = (email: any): string => {
  if (!email) return '';
  if (typeof email === 'string') return email;
  if (typeof email === 'object') {
    if (typeof email.value === 'string') return email.value;
    if (typeof email.email === 'string') return email.email;
  }
  return '';
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

export function useFormState(exerciseId: number | string | undefined, contextId: string | null, exercise: any | undefined, teamTitle: string) {
  const storageKey = `d4h_form_${exerciseId}`;
  
  const exerciseRef = useRef(exercise);
  exerciseRef.current = exercise;
  const teamTitleRef = useRef(teamTitle);
  teamTitleRef.current = teamTitle;
  const lastSavedJsonRef = useRef<string>('');

  const [formState, setFormState] = useState<FormStateData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPulling, setIsPulling] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [medicalMap, setMedicalMap] = useState<Record<number, string>>({});
  const [technicalMap, setTechnicalMap] = useState<Record<number, string>>({});
  const [positionsMap, setPositionsMap] = useState<Record<number, string>>({});
  const [idsMap, setIdsMap] = useState<Record<number, string>>({});
  const [statusMap, setStatusMap] = useState<Record<number, string>>({});
  const [rolesMap, setRolesMap] = useState<Record<number, string>>({});
  const [emailMap, setEmailMap] = useState<Record<number, string>>({});
  const [highlightChanges, setHighlightChanges] = useState(() => {
    return localStorage.getItem('d4h_highlight_changes') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('d4h_highlight_changes', String(highlightChanges));
  }, [highlightChanges]);
  
  const hasLocalChanges = formState ? (
    Object.values(formState.headers).some(c => c.isEditedLocally) ||
    formState.rows.some(r => Object.values(r.cells).some(c => c.isEditedLocally) || r.isDeleted) ||
    (formState.periods ? formState.periods.some(p =>
      Object.values(p.headers).some(c => c.isEditedLocally) ||
      p.rows.some(r => Object.values(r.cells).some(c => c.isEditedLocally) || r.isDeleted)
    ) : false)
  ) : false;
    
  const hasConflicts = formState ? (
    Object.values(formState.headers).some(c => !!c.conflictValue) ||
    formState.rows.some(r => Object.values(r.cells).some(c => !!c.conflictValue)) ||
    (formState.periods ? formState.periods.some(p =>
      Object.values(p.headers).some(c => !!c.conflictValue) ||
      p.rows.some(r => Object.values(r.cells).some(c => !!c.conflictValue))
    ) : false)
  ) : false;

  // Initialize or load state
  useEffect(() => {
    if (!exerciseId) return;
    const isLocal = typeof exerciseId === 'string' && exerciseId.startsWith('local_');
    const currentEx = exerciseRef.current;
    if (!isLocal && (!contextId || !currentEx)) return;

    const loadInitialData = async () => {
      try {
        const savedData = localStorage.getItem(storageKey);
        if (savedData) {
          const parsed = JSON.parse(savedData);
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
          if (!isLocal && contextId) {
            fetchAndCacheTeamSubdomain(contextId);
            const cachedMemberIds = parsed.periods
              ? parsed.periods.flatMap((p: any) => p.rows.map((r: any) => r.memberId)).filter((id: any): id is number => typeof id === 'number')
              : (parsed.rows as FormRowData[]).map(r => r.memberId).filter((id): id is number => typeof id === 'number');

            if (cachedMemberIds.length > 0) {
              getMemberQualifications(parseInt(contextId!, 10), cachedMemberIds)
                .then(res => {
                  setMedicalMap(res.medicalMap);
                  setTechnicalMap(res.technicalMap);
                });
              getMemberDetails(parseInt(contextId!, 10), cachedMemberIds)
                .then(members => {
                  const posMap: Record<number, string> = {};
                  const ids: Record<number, string> = {};
                  const statuses: Record<number, string> = {};
                  const roles: Record<number, string> = {};
                  const emails: Record<number, string> = {};
                  members.forEach(m => {
                    if (m.id) {
                      if (m.position) posMap[m.id] = m.position;
                      if (m.ref) ids[m.id] = m.ref;
                      else if (m.idTag) ids[m.id] = m.idTag;
                      else ids[m.id] = String(m.id);
                      if (m.customStatus?.title) statuses[m.id] = m.customStatus.title;
                      else if (m.status) statuses[m.id] = m.status;
                      if (m.role?.title) roles[m.id] = m.role.title;
                      if (m.email) emails[m.id] = extractEmail(m.email);
                    }
                  });
                  setPositionsMap(posMap);
                  setIdsMap(ids);
                  setStatusMap(statuses);
                  setRolesMap(roles);
                  setEmailMap(emails);
                });
            }

            // Background check for pending D4H changes
            const checkPendingChanges = async (currentForm: FormStateData) => {
              try {
                const [attData, freshExercise] = await Promise.all([
                  getAttendees(parseInt(contextId, 10), exerciseId as number),
                  getActivity(parseInt(contextId, 10), exerciseId as number, exercise?.type),
                ]);
                const memberIds = attData.map(a => a.member.id);
                const memberData = memberIds.length > 0
                  ? await getMemberDetails(parseInt(contextId, 10), memberIds)
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
                  const currentMemberRows = currentForm.rows.filter(r => typeof r.memberId === 'number' && !r.isDeleted);
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

                      const startIso = att.startsAt || freshExercise?.startsAt || exercise?.startsAt;
                      const endIso = att.endsAt || freshExercise?.endsAt || exercise?.endsAt;
                      const isTodayOrFuture = isEventTodayOrFuture(freshExercise?.startsAt || exercise?.startsAt || startIso);
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
            rows.push(generateBlankRow(`blank_${Date.now()}_${i}`));
          }
          const newState: FormStateData = { headers, rows };
          setFormState(newState);
          localStorage.setItem(storageKey, JSON.stringify(newState));
          setIsLoading(false);
          return;
        }

        // Build from scratch (D4H)
        const attData = await getAttendees(parseInt(contextId!, 10), exerciseId as number);
        const memberIds = Array.from(new Set(attData.map(a => a.member.id)));
        const [memberData, qualRes] = await Promise.all([
          memberIds.length > 0 ? getMemberDetails(parseInt(contextId!, 10), memberIds) : Promise.resolve([]),
          memberIds.length > 0 ? getMemberQualifications(parseInt(contextId!, 10), memberIds) : Promise.resolve({ medicalMap: {}, technicalMap: {} }),
        ]);
        setMedicalMap(qualRes.medicalMap);
        setTechnicalMap(qualRes.technicalMap);
        const posMap: Record<number, string> = {};
        const ids: Record<number, string> = {};
        const statuses: Record<number, string> = {};
        const roles: Record<number, string> = {};
        const emails: Record<number, string> = {};
        memberData.forEach(m => {
          if (m.id) {
            if (m.position) posMap[m.id] = m.position;
            if (m.ref) ids[m.id] = m.ref;
            else if (m.idTag) ids[m.id] = m.idTag;
            else ids[m.id] = String(m.id);
            if (m.customStatus?.title) statuses[m.id] = m.customStatus.title;
            else if (m.status) statuses[m.id] = m.status;
            if (m.role?.title) roles[m.id] = m.role.title;
            if (m.email) emails[m.id] = extractEmail(m.email);
          }
        });
        attData.forEach(att => {
          if (att.member?.id && att.role?.title) {
            roles[att.member.id] = att.role.title;
          }
        });
        setPositionsMap(posMap);
        setIdsMap(ids);
        setStatusMap(statuses);
        setRolesMap(roles);
        setEmailMap(emails);
        
        const exerciseDate = exercise.startsAt ? format(new Date(exercise.startsAt), 'MM/dd/yyyy') : '';
        const exName = exercise.referenceDescription || exercise.description || 'Unnamed Exercise';
        const checkInLoc = formatActivityLocation(exercise);

        const baseHeaders: FormHeaderData = {
          exerciseName: createCell(exName),
          date: createCell(exerciseDate),
          exerciseNumber: createCell(exercise.id.toString()),
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

        if (uniqueDates.size <= 1 && exercise?.startsAt && exercise?.endsAt) {
          const startD = new Date(exercise.startsAt);
          const endD = new Date(exercise.endsAt);
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
              const aDate = a.startsAt ? format(new Date(a.startsAt), 'yyyy-MM-dd') : format(new Date(exercise.startsAt), 'yyyy-MM-dd');
              return aDate === dateStr;
            });

            const periodRows: FormRowData[] = periodAttendees.map(att => {
              const memberDetail = memberData.find(m => m.id === att.member.id);
              const phone = memberDetail?.mobile?.phone || memberDetail?.home?.phone || memberDetail?.work?.phone || '';

              const startIso = att.startsAt || exercise?.startsAt;
              const endIso = att.endsAt || exercise?.endsAt;
              const isTodayOrFuture = isEventTodayOrFuture(startIso);
              const timeInStr = isTodayOrFuture ? '' : formatD4HTime(startIso);
              const timeOutStr = isTodayOrFuture ? '' : formatD4HTime(endIso);
              const hoursStr = isTodayOrFuture ? '' : calculateD4HHours(startIso, endIso, timeInStr, timeOutStr, att.hours, att.duration);

              return {
                id: `p${periodIdx}_member_${att.member.id}`,
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
            });

            // 5 blank rows per period
            for (let i = 0; i < 5; i++) {
              periodRows.push(generateBlankRow(`blank_p${periodIdx}_${Date.now()}_${i}`));
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
          finalRows = attData.map(att => {
            const memberDetail = memberData.find(m => m.id === att.member.id);
            const phone = memberDetail?.mobile?.phone || memberDetail?.home?.phone || memberDetail?.work?.phone || '';

            const startIso = att.startsAt || exercise?.startsAt;
            const endIso = att.endsAt || exercise?.endsAt;
            const isTodayOrFuture = isEventTodayOrFuture(exercise?.startsAt || startIso);
            const timeInStr = isTodayOrFuture ? '' : formatD4HTime(startIso);
            const timeOutStr = isTodayOrFuture ? '' : formatD4HTime(endIso);
            const hoursStr = isTodayOrFuture ? '' : calculateD4HHours(startIso, endIso, timeInStr, timeOutStr, att.hours, att.duration);

            return {
              id: `member_${att.member.id}`,
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
          });

          // Add 5 blank rows initially
          for (let i = 0; i < 5; i++) {
            finalRows.push(generateBlankRow(`blank_${Date.now()}_${i}`));
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
  }, [exerciseId, contextId, storageKey]);

  // Save to local storage whenever formState changes (avoid redundant writes)
  useEffect(() => {
    if (formState) {
      const json = JSON.stringify(formState);
      if (json !== lastSavedJsonRef.current) {
        lastSavedJsonRef.current = json;
        localStorage.setItem(storageKey, json);
      }
    }
  }, [formState, storageKey]);

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

      return {
        ...prev,
        headers: newTopHeaders,
        periods: newPeriods
      };
    });
  };

  const updateRowCell = (rowId: string, colKey: keyof FormRowData['cells'], value: string, _periodIndex?: number) => {
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
            newRows.push(generateBlankRow(`blank_p${idx}_${Date.now()}_${i}`));
          }
          return { ...p, rows: newRows };
        });
        return { ...prev, periods: newPeriods };
      }

      if (prev.periods) {
        const newPeriods = prev.periods.map((p, idx) => {
          const newRows = [...p.rows];
          for (let i = 0; i < count; i++) {
            newRows.push(generateBlankRow(`blank_p${idx}_${Date.now()}_${i}`));
          }
          return { ...p, rows: newRows };
        });
        return { ...prev, periods: newPeriods };
      }

      const newRows = [...prev.rows];
      for (let i = 0; i < count; i++) {
        newRows.push(generateBlankRow(`blank_${Date.now()}_${i}`));
      }
      return { ...prev, rows: newRows };
    });
  };

  const removeRow = (rowId: string) => {
    setFormState(prev => {
      if (!prev) return prev;
      const removeOrMark = (rowList: FormRowData[]) => rowList.filter(r => {
        if (r.id === rowId) {
          if (r.id.startsWith('blank_')) return false;
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
        return { ...r, cells: newCells };
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
    if (!exerciseId || !contextId) return;
    setIsPulling(true);
    try {
      const [attData, freshExercise] = await Promise.all([
        getAttendees(parseInt(contextId, 10), exerciseId as number),
        getActivity(parseInt(contextId, 10), exerciseId as number, exercise?.type),
      ]);
      const memberIds = attData.map(a => a.member.id);
      const [memberData, qualRes] = await Promise.all([
        memberIds.length > 0 ? getMemberDetails(parseInt(contextId, 10), memberIds) : Promise.resolve([]),
        memberIds.length > 0 ? getMemberQualifications(parseInt(contextId, 10), memberIds) : Promise.resolve({ medicalMap: {}, technicalMap: {} }),
      ]);
      setMedicalMap(prev => ({ ...prev, ...qualRes.medicalMap }));
      setTechnicalMap(prev => ({ ...prev, ...qualRes.technicalMap }));
      const posMap: Record<number, string> = {};
      const ids: Record<number, string> = {};
      const statuses: Record<number, string> = {};
      const roles: Record<number, string> = {};
      const emails: Record<number, string> = {};
      memberData.forEach(m => {
        if (m.id) {
          if (m.position) posMap[m.id] = m.position;
          if (m.ref) ids[m.id] = m.ref;
          else if (m.idTag) ids[m.id] = m.idTag;
          else ids[m.id] = String(m.id);
          if (m.customStatus?.title) statuses[m.id] = m.customStatus.title;
          else if (m.status) statuses[m.id] = m.status;
          if (m.role?.title) roles[m.id] = m.role.title;
          if (m.email) emails[m.id] = extractEmail(m.email);
        }
      });
      attData.forEach(att => {
        if (att.member?.id && att.role?.title) {
          roles[att.member.id] = att.role.title;
        }
      });
      setPositionsMap(prev => ({ ...prev, ...posMap }));
      setIdsMap(prev => ({ ...prev, ...ids }));
      setStatusMap(prev => ({ ...prev, ...statuses }));
      setRolesMap(prev => ({ ...prev, ...roles }));
      setEmailMap(prev => ({ ...prev, ...emails }));
      
      setFormState(prev => {
        if (!prev) return prev;
        
        const newHeaders = { ...prev.headers };

        const isTodayOrFuture = isEventTodayOrFuture(freshExercise?.startsAt || exercise?.startsAt);

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
                const aDate = a.startsAt ? format(new Date(a.startsAt), 'yyyy-MM-dd') : format(new Date(freshExercise?.startsAt || exercise?.startsAt), 'yyyy-MM-dd');
                return aDate === filterPeriodDate;
              })
            : attData;

          attendeesForThisList.forEach(att => {
            const memberDetail = memberData.find(m => m.id === att.member.id);
            const remoteName = memberDetail?.name || 'Unknown Member';
            const remotePhone = memberDetail?.mobile?.phone || memberDetail?.home?.phone || memberDetail?.work?.phone || '';
            
            const startIso = att.startsAt || freshExercise?.startsAt || exercise?.startsAt;
            const endIso = att.endsAt || freshExercise?.endsAt || exercise?.endsAt;
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
    medicalMap,
    technicalMap,
    positionsMap,
    idsMap,
    statusMap,
    rolesMap,
    emailMap,
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

