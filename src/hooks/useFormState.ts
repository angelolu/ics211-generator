import { useState, useEffect } from 'react';
import { getAttendees, getMemberDetails, getMemberQualifications } from '../api/d4h';
import { format } from 'date-fns';

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

export interface FormStateData {
  headers: FormHeaderData;
  rows: FormRowData[];
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
  
  const [formState, setFormState] = useState<FormStateData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPulling, setIsPulling] = useState(false);
  const [qualificationsMap, setQualificationsMap] = useState<Record<number, string>>({});
  const [positionsMap, setPositionsMap] = useState<Record<number, string>>({});
  const [highlightChanges, setHighlightChanges] = useState(() => {
    return localStorage.getItem('d4h_highlight_changes') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('d4h_highlight_changes', String(highlightChanges));
  }, [highlightChanges]);
  
  const hasLocalChanges = formState ? 
    Object.values(formState.headers).some(c => c.isEditedLocally) ||
    formState.rows.some(r => Object.values(r.cells).some(c => c.isEditedLocally) || r.isDeleted) : false;
    
  const hasConflicts = formState ? 
    Object.values(formState.headers).some(c => !!c.conflictValue) ||
    formState.rows.some(r => Object.values(r.cells).some(c => !!c.conflictValue)) : false;

  // Initialize or load state
  useEffect(() => {
    if (!exerciseId) return;
    const isLocal = typeof exerciseId === 'string' && exerciseId.startsWith('local_');
    if (!isLocal && (!contextId || !exercise)) return;

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
          setFormState(parsed);
          setIsLoading(false);

          // Even when loading from cache, fetch qualifications live for D4H rosters
          // (qualifications are not cached in localStorage)
          if (!isLocal && contextId) {
            console.log('[Quals] Form loaded from cache — fetching qualifications separately');
            const cachedMemberIds = (parsed.rows as FormRowData[])
              .map(r => r.memberId)
              .filter((id): id is number => typeof id === 'number');
            console.log('[Quals] Member IDs from cache:', cachedMemberIds);
            if (cachedMemberIds.length > 0) {
              getMemberQualifications(parseInt(contextId!, 10), cachedMemberIds)
                .then(setQualificationsMap);
              getMemberDetails(parseInt(contextId!, 10), cachedMemberIds)
                .then(members => {
                  const posMap: Record<number, string> = {};
                  members.forEach(m => {
                    if (m.id && m.position) posMap[m.id] = m.position;
                  });
                  setPositionsMap(posMap);
                });
            }
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
          const newState = { headers, rows };
          setFormState(newState);
          localStorage.setItem(storageKey, JSON.stringify(newState));
          setIsLoading(false);
          return;
        }

        // Build from scratch (D4H)
        const attData = await getAttendees(parseInt(contextId!, 10), exerciseId as number);
        const memberIds = attData.map(a => a.member.id);
        const [memberData, qualMap] = await Promise.all([
          memberIds.length > 0 ? getMemberDetails(parseInt(contextId!, 10), memberIds) : Promise.resolve([]),
          memberIds.length > 0 ? getMemberQualifications(parseInt(contextId!, 10), memberIds) : Promise.resolve({}),
        ]);
        setQualificationsMap(qualMap);
        const posMap: Record<number, string> = {};
        memberData.forEach(m => {
          if (m.id && m.position) posMap[m.id] = m.position;
        });
        setPositionsMap(posMap);
        
        const exerciseDate = exercise.startsAt ? format(new Date(exercise.startsAt), 'MM/dd/yyyy') : '';
        const exName = exercise.referenceDescription || exercise.description || 'Unnamed Exercise';
        const checkInLoc = exercise.address?.street || '';

        const headers: FormHeaderData = {
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

        const rows: FormRowData[] = attData.map(att => {
          const memberDetail = memberData.find(m => m.id === att.member.id);
          const phone = memberDetail?.mobile?.phone || memberDetail?.home?.phone || memberDetail?.work?.phone || '';
          return {
            id: `member_${att.member.id}`,
            memberId: att.member.id,
            cells: {
              name: createCell(memberDetail?.name || 'Unknown Member'),
              phone: createCell(phone),
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
          };
        });

        // Add 5 blank rows initially
        for (let i = 0; i < 5; i++) {
          rows.push(generateBlankRow(`blank_${Date.now()}_${i}`));
        }

        const newState = { headers, rows };
        setFormState(newState);
        localStorage.setItem(storageKey, JSON.stringify(newState));
      } catch (e) {
        console.error("Failed to load initial data", e);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, [exerciseId, contextId, exercise, teamTitle, storageKey]);

  // Save to local storage whenever formState changes
  useEffect(() => {
    if (formState) {
      localStorage.setItem(storageKey, JSON.stringify(formState));
    }
  }, [formState, storageKey]);

  const updateHeaderCell = (key: keyof FormHeaderData, value: string) => {
    setFormState(prev => {
      if (!prev) return prev;
      const cell = prev.headers[key];
      return {
        ...prev,
        headers: {
          ...prev.headers,
          [key]: {
            ...cell,
            value,
            isEditedLocally: value !== cell.originalValue,
            conflictValue: cell.conflictValue && value === cell.conflictValue ? undefined : cell.conflictValue // clear conflict if user matches it
          }
        }
      };
    });
  };

  const updateRowCell = (rowId: string, colKey: keyof FormRowData['cells'], value: string) => {
    setFormState(prev => {
      if (!prev) return prev;
      const newRows = prev.rows.map(r => {
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
      return { ...prev, rows: newRows };
    });
  };

  const addBlankRows = (count: number) => {
    setFormState(prev => {
      if (!prev) return prev;
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
      const newRows = prev.rows.filter(r => {
        if (r.id === rowId) {
          // If it was manually added (blank_), permanently remove it
          if (r.id.startsWith('blank_')) return false;
          return true; // Keep it but mark as deleted
        }
        return true;
      }).map(r => r.id === rowId ? { ...r, isDeleted: true } : r);
      return { ...prev, rows: newRows };
    });
  };

  const restoreRow = (rowId: string) => {
    setFormState(prev => {
      if (!prev) return prev;
      const newRows = prev.rows.map(r => r.id === rowId ? { ...r, isDeleted: false } : r);
      return { ...prev, rows: newRows };
    });
  };

  const resetChanges = () => {
    setFormState(prev => {
      if (!prev) return prev;
      const newHeaders = { ...prev.headers };
      (Object.keys(newHeaders) as Array<keyof FormHeaderData>).forEach(k => {
        newHeaders[k] = { ...newHeaders[k], value: newHeaders[k].originalValue, isEditedLocally: false, conflictValue: undefined };
      });
      const newRows = prev.rows.map(r => {
        const newCells = { ...r.cells };
        (Object.keys(newCells) as Array<keyof FormRowData['cells']>).forEach(k => {
          const colKey = k as keyof FormRowData['cells'];
          newCells[colKey] = { ...newCells[colKey], value: newCells[colKey].originalValue, isEditedLocally: false, conflictValue: undefined };
        });
        return { ...r, cells: newCells };
      });
      return { ...prev, headers: newHeaders, rows: newRows };
    });
  };

  const fixConflicts = () => {
    // A simple workflow: accept all remote values
    setFormState(prev => {
      if (!prev) return prev;
      const newHeaders = { ...prev.headers };
      (Object.keys(newHeaders) as Array<keyof FormHeaderData>).forEach(k => {
        if (newHeaders[k].conflictValue !== undefined) {
          newHeaders[k] = { 
            ...newHeaders[k], 
            value: newHeaders[k].conflictValue!, 
            originalValue: newHeaders[k].conflictValue!, 
            isEditedLocally: false, 
            conflictValue: undefined 
          };
        }
      });
      const newRows = prev.rows.map(r => {
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
      return { ...prev, headers: newHeaders, rows: newRows };
    });
  };

  const pullData = async () => {
    if (!exerciseId || !contextId) return;
    setIsPulling(true);
    try {
      const attData = await getAttendees(parseInt(contextId, 10), exerciseId as number);
      const memberIds = attData.map(a => a.member.id);
      const [memberData, qualMap] = await Promise.all([
        memberIds.length > 0 ? getMemberDetails(parseInt(contextId, 10), memberIds) : Promise.resolve([]),
        memberIds.length > 0 ? getMemberQualifications(parseInt(contextId, 10), memberIds) : Promise.resolve({}),
      ]);
      setQualificationsMap(prev => ({ ...prev, ...qualMap }));
      const posMap: Record<number, string> = {};
      memberData.forEach(m => {
        if (m.id && m.position) posMap[m.id] = m.position;
      });
      setPositionsMap(prev => ({ ...prev, ...posMap }));
      
      setFormState(prev => {
        if (!prev) return prev;
        
        const newRows = [...prev.rows];
        
        // Match members
        attData.forEach(att => {
          const memberDetail = memberData.find(m => m.id === att.member.id);
          const remoteName = memberDetail?.name || 'Unknown Member';
          const remotePhone = memberDetail?.mobile?.phone || memberDetail?.home?.phone || memberDetail?.work?.phone || '';
          
          const existingRowIndex = newRows.findIndex(r => r.memberId === att.member.id);
          
          if (existingRowIndex >= 0) {
            // Update existing row
            const row = newRows[existingRowIndex];
            const newCells = { ...row.cells };
            
            const updateCellLogic = (colKey: keyof FormRowData['cells'], remoteVal: string) => {
              const cell = newCells[colKey];
              if (cell.originalValue !== remoteVal) {
                // Remote changed
                if (!cell.isEditedLocally) {
                  // Local hasn't changed, auto update
                  newCells[colKey] = { ...cell, value: remoteVal, originalValue: remoteVal };
                } else if (cell.value !== remoteVal) {
                  // Local changed and remote changed -> CONFLICT
                  newCells[colKey] = { ...cell, conflictValue: remoteVal };
                } else {
                  // Local changed to exactly what remote changed to
                  newCells[colKey] = { ...cell, originalValue: remoteVal, isEditedLocally: false };
                }
              }
            };
            
            updateCellLogic('name', remoteName);
            updateCellLogic('phone', remotePhone);
            
            newRows[existingRowIndex] = { ...row, cells: newCells };
          } else {
            // New attendee! Add right after the last non-empty row.
            // Find last non-empty row
            let lastFilledIndex = -1;
            for (let i = 0; i < newRows.length; i++) {
              const row = newRows[i];
              const isFilled = Object.values(row.cells).some(c => c.value.trim() !== '');
              if (isFilled) lastFilledIndex = i;
            }
            
            const newAttRow: FormRowData = {
              id: `member_${att.member.id}`,
              memberId: att.member.id,
              cells: {
                name: createCell(remoteName),
                phone: createCell(remotePhone),
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
            };
            
            newRows.splice(lastFilledIndex + 1, 0, newAttRow);
          }
        });
        
        return { ...prev, rows: newRows };
      });
      
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
    qualificationsMap,
    positionsMap,
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
