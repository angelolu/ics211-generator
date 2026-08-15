import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Label from '@radix-ui/react-label';
import * as Select from '@radix-ui/react-select';
import * as Separator from '@radix-ui/react-separator';
import * as Switch from '@radix-ui/react-switch';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  FileDown,
  FileText,
  Hash,
  HeartPulse,
  Highlighter,
  Loader2,
  Mail,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Shield,
  Trash2,
  UserCheck,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { getD4HActivityUrl } from '../api/d4h';
import type { Activity } from '../api/d4h';
import { ICS211AForm } from '../components/ICS211AForm';
import { ICS211BForm } from '../components/ICS211BForm';
import { ICS211Form } from '../components/ICS211Form';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RemovedAttendeesModal } from '../components/RemovedAttendeesModal';
import { useFormState, type FormHeaderData, type FormRowData } from '../hooks/useFormState';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { calculateHours } from '../utils/time';
import { format } from 'date-fns';

// ── Constants ─────────────────────────────────────────────

const FORM_TYPES = [
  { value: '211a', label: 'ICS 211A' },
  { value: '211b', label: 'ICS 211B' },
  { value: 'fitness', label: 'ICS 211 Fitness' },
];

const TYPE_LABELS: Record<string, string> = {
  exercise: 'Exercise', event: 'Event', incident: 'Incident', local: 'Local',
};

const TYPE_ICONS: Record<string, string> = {
  exercise: '🏋️', event: '📅', incident: '🚨', local: '💾',
};

/** Config for optional column toggles (data-driven dropdown) */
const COLUMN_TOGGLES: { key: keyof ColumnFlags; label: string; icon: LucideIcon; className?: string }[] = [
  { key: 'showPhone', label: 'Phone numbers', icon: Phone },
  { key: 'showEmail', label: 'Email', icon: Mail },
  { key: 'showId', label: 'ID', icon: Hash, className: 'no-print' },
  { key: 'showStatus', label: 'Status', icon: Shield, className: 'no-print' },
  { key: 'showRole', label: 'Role', icon: Briefcase, className: 'no-print' },
  { key: 'showPositions', label: 'Position', icon: UserCheck, className: 'no-print' },
  { key: 'showMedical', label: 'Medical', icon: HeartPulse, className: 'no-print' },
  { key: 'showTechnical', label: 'Technical', icon: Wrench, className: 'no-print' },
];

interface ColumnFlags {
  showPhone: boolean;
  showEmail: boolean;
  showId: boolean;
  showStatus: boolean;
  showRole: boolean;
  showPositions: boolean;
  showMedical: boolean;
  showTechnical: boolean;
}

// ── Component ─────────────────────────────────────────────

export function ExerciseDetails() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const exercise = location.state?.exercise as Activity;
  const componentRef = useRef<HTMLDivElement>(null);

  const teamTitle = localStorage.getItem('d4h_team_title') || 'Your Team';
  const contextId = localStorage.getItem('d4h_context_id');

  const cachedActivity = useMemo(() => {
    if (exercise || !id || id.startsWith('local_')) return null;
    try {
      const cache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
      return (cache[id] as Activity) || null;
    } catch { return null; }
  }, [exercise, id]);
  const currentExercise = exercise || cachedActivity;

  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [formType, setFormType] = useState(() => localStorage.getItem(`d4h_form_type_${id}`) || '211a');
  const [showCalcHours, setShowCalcHours] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  // Single state object for all 8 column-visibility booleans
  const [columnFlags, setColumnFlags] = useState<ColumnFlags>(() => ({
    showPhone: (localStorage.getItem(`d4h_form_type_${id}`) || '211a') === 'fitness',
    showEmail: false,
    showId: false,
    showStatus: false,
    showRole: false,
    showPositions: false,
    showMedical: false,
    showTechnical: false,
  }));

  const toggleColumn = (key: keyof ColumnFlags) => {
    setColumnFlags(prev => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (id) localStorage.setItem(`d4h_form_type_${id}`, formType);
  }, [formType, id]);

  const handleFormTypeChange = (newType: string) => {
    setFormType(newType);
    if (newType === 'fitness') {
      setColumnFlags(prev => ({ ...prev, showPhone: true }));
    }
  };

  const {
    formState, isLoading, isPulling, hasLocalChanges, hasConflicts, hasPendingChanges,
    pendingChanges, removedAttendeesPrompt, confirmRemovedAttendees, cancelRemovedAttendees,
    medicalMap, technicalMap, positionsMap, idsMap, statusMap, rolesMap, emailMap,
    highlightChanges, setHighlightChanges, updateHeaderCell, updateRowCell,
    addBlankRows, resetChanges, fixConflicts, pullData, removeRow, restoreRow,
  } = useFormState(id ? (id.startsWith('local_') ? id : parseInt(id, 10)) : undefined, contextId, currentExercise, teamTitle);

  const isLocal = typeof id === 'string' && id.startsWith('local_');
  const activityName = isLocal && formState?.headers?.exerciseName?.value
    ? formState.headers.exerciseName.value
    : currentExercise?.referenceDescription || currentExercise?.description || (currentExercise as { title?: string })?.title || 'Exercise Details';
  useDocumentTitle(activityName);
  const activityType = currentExercise?.type || 'local';
  const currentFormLabel = FORM_TYPES.find(f => f.value === formType)?.label ?? formType;

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `ICS-211_${activityName.replace(/\s+/g, '_')}_${currentExercise?.id || id}`,
  });

  const handleDeleteLocalRoster = () => {
    try {
      const saved = localStorage.getItem('fitnessqual_local_rosters');
      if (saved) {
        let rosters = JSON.parse(saved);
        rosters = rosters.filter((r: { id: string }) => r.id !== id);
        localStorage.setItem('fitnessqual_local_rosters', JSON.stringify(rosters));
      }
      localStorage.removeItem(`d4h_form_${id}`);
      localStorage.removeItem(`d4h_form_type_${id}`);
      navigate('/dashboard');
    } catch (e) {
      console.error('Failed to delete local roster', e);
    }
  };

  // ── CSV Export (deduplicated across form types) ─────────

  const handleExportCsv = () => {
    const extractors: { header: string; getValue: (row: FormRowData & { _periodLabel?: string }) => string }[] = [];

    const escapeCsv = (str: string) => {
      if (!str) return '';
      const s = String(str);
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    // ── Form-specific prefix columns
    if (formType !== 'fitness') {
      extractors.push({ header: 'T CARD', getValue: r => r.cells.tCard?.value || '' });
    }

    // ── Optional ID (always before name)
    if (columnFlags.showId) {
      extractors.push({ header: 'ID', getValue: r => (r.memberId ? idsMap[r.memberId] || '' : '') });
    }

    // ── Name column
    extractors.push({
      header: formType === 'fitness' ? 'NAME' : 'NAME (PERSONNEL) -OR- DESCRIPTION (EQUIPMENT)',
      getValue: r => r.cells.name?.value || ''
    });

    // ── Shared optional columns (same across all form types)
    if (columnFlags.showStatus) extractors.push({ header: 'STATUS', getValue: r => (r.memberId ? statusMap[r.memberId] || '' : '') });
    if (columnFlags.showRole) extractors.push({ header: 'ROLE', getValue: r => (r.memberId ? rolesMap[r.memberId] || '' : '') });
    if (columnFlags.showPositions) extractors.push({ header: 'POSITION', getValue: r => (r.memberId ? positionsMap[r.memberId] || '' : '') });
    if (columnFlags.showMedical) extractors.push({ header: 'MEDICAL', getValue: r => (r.memberId ? medicalMap[r.memberId] || '' : '') });
    if (columnFlags.showTechnical) extractors.push({ header: 'TECHNICAL', getValue: r => (r.memberId ? technicalMap[r.memberId] || '' : '') });
    if (columnFlags.showPhone) extractors.push({ header: 'PHONE', getValue: r => r.cells.phone?.value || '' });
    if (columnFlags.showEmail) extractors.push({ header: 'EMAIL', getValue: r => (r.memberId ? emailMap[r.memberId] || '' : '') });

    // ── Form-specific suffix columns
    if (formType === 'fitness') {
      extractors.push({ header: 'TIME IN', getValue: r => r.cells.timeIn?.value || '' });
      extractors.push({ header: 'START WEIGHT', getValue: r => r.cells.weightStart?.value || '' });
      extractors.push({ header: 'LAP 1 START TIME', getValue: r => r.cells.lap1Start?.value || '' });
      extractors.push({ header: 'LAP 1 END TIME', getValue: r => r.cells.lap1End?.value || '' });
      extractors.push({ header: 'LAP 2 START TIME', getValue: r => r.cells.lap2Start?.value || '' });
      extractors.push({ header: 'LAP 2 END TIME', getValue: r => r.cells.lap2End?.value || '' });
      extractors.push({ header: 'END WEIGHT', getValue: r => r.cells.weightEnd?.value || '' });
      extractors.push({ header: 'TIME OUT', getValue: r => r.cells.timeOut?.value || '' });
      if (showCalcHours) {
        extractors.push({
          header: 'CALC. HOURS',
          getValue: r => calculateHours(r.cells.timeIn?.value || '', r.cells.timeOut?.value || '')
        });
      }
    } else {
      if (formType === '211b') {
        extractors.push({ header: 'AGENCY/TEAM', getValue: r => r.cells.agencyTeam?.value || '' });
      }
      extractors.push({ header: formType === '211a' ? 'DATE/TIME IN' : 'TIME IN', getValue: r => r.cells.timeIn?.value || '' });
      extractors.push({ header: formType === '211a' ? 'DATE/TIME OUT' : 'TIME OUT', getValue: r => r.cells.timeOut?.value || '' });
      extractors.push({
        header: 'HOURS',
        getValue: r => showCalcHours ? calculateHours(r.cells.timeIn?.value || '', r.cells.timeOut?.value || '') : (r.cells.hours?.value || '')
      });
      extractors.push({ header: 'ADDITIONAL INFORMATION', getValue: r => r.cells.additionalInfo?.value || '' });
    }

    // ── Multi-period support
    const isMultiPeriod = !!(formState?.periods && formState.periods.length > 1);
    if (isMultiPeriod) {
      extractors.unshift({ header: 'OPERATIONAL PERIOD', getValue: r => r._periodLabel || '' });
    }

    const headers = extractors.map(e => escapeCsv(e.header)).join(',');
    let rows: string[] = [];

    if (isMultiPeriod && formState?.periods) {
      rows = formState.periods.flatMap(p =>
        p.rows
          .filter(r => !r.isDeleted)
          .map(row => {
            const rowWithPeriod = { ...row, _periodLabel: p.label };
            return extractors.map(e => escapeCsv(e.getValue(rowWithPeriod))).join(',');
          })
      );
    } else {
      rows = (formState?.rows || [])
        .filter(r => !r.isDeleted)
        .map(row => extractors.map(e => escapeCsv(e.getValue(row as any))).join(','));
    }

    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ICS-211_${activityName.replace(/\s+/g, '_')}_${currentExercise?.id || id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Early return guards ─────────────────────────────────

  if (!id || (!isLocal && !contextId) || (!isLocal && !currentExercise)) {
    return <Navigate to="/" replace />;
  }

  // ── Render form component for a given form-state slice ──

  const renderForm = (
    props: {
      formState: { headers: FormHeaderData; rows: FormRowData[] };
      onUpdateHeader: (key: keyof FormHeaderData, val: string) => void;
      onUpdateRow: (rowId: string, colKey: keyof FormRowData['cells'], val: string) => void;
      ref?: React.Ref<HTMLDivElement>;
    }
  ) => {
    const shared = {
      formState: props.formState,
      ...columnFlags,
      showCalcHours,
      emailMap,
      idsMap,
      statusMap,
      rolesMap,
      positionsMap,
      medicalMap,
      technicalMap,
      highlightChanges,
      activityType,
      onUpdateHeader: props.onUpdateHeader,
      onUpdateRow: props.onUpdateRow,
      onRemoveRow: removeRow,
      onRestoreRow: restoreRow,
    };

    if (formType === 'fitness') return <ICS211Form ref={props.ref} {...shared} showValidation={showValidation} />;
    if (formType === '211b') return <ICS211BForm ref={props.ref} {...shared} />;
    return <ICS211AForm ref={props.ref} {...shared} />;
  };

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="app-bg" style={{ minHeight: '100vh', paddingBottom: 64 }}>

        {/* ── Header ─────────────────────────────────────── */}
        <header className="app-header no-print">
          <div style={{
            maxWidth: 1200, margin: '0 auto', padding: '0 24px',
            height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            {/* Left: back + title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    className="btn btn-sm"
                    onClick={() => navigate('/dashboard')}
                    style={{
                      padding: '6px 8px', flexShrink: 0,
                      background: 'rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.85)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 7,
                    }}
                  >
                    <ArrowLeft size={17} />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="tooltip-content" sideOffset={5}>Back to dashboard</Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`badge badge-${activityType}`} style={{
                    background: 'rgba(255,255,255,0.12)',
                    color: 'rgba(220,195,148,0.9)',
                    border: '1px solid rgba(220,195,148,0.25)',
                  }}>
                    <span style={{ fontSize: 13 }}>{TYPE_ICONS[activityType]}</span>
                    {TYPE_LABELS[activityType]}
                  </span>
                  <span style={{
                    fontWeight: 700, fontSize: '0.9375rem', color: 'white',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {activityName}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'rgba(220,195,148,0.55)', marginTop: 2 }}>
                  {currentFormLabel} · {teamTitle}
                </div>
              </div>
            </div>

            {/* Right: actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>

              {/* Split button: D4H Event link + Refresh icon */}
              {!isLocal && (
                <div style={{ display: 'inline-flex', alignItems: 'stretch', height: 29 }}>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        className="btn btn-sm"
                        onClick={() => window.open(getD4HActivityUrl(exercise?.id || id || '', activityType), '_blank', 'noopener,noreferrer')}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          height: '100%',
                          boxSizing: 'border-box',
                          background: 'rgba(255,255,255,0.1)',
                          color: 'rgba(255,255,255,0.85)',
                          border: '1px solid rgba(255,255,255,0.18)',
                          borderTopRightRadius: 0,
                          borderBottomRightRadius: 0,
                          borderRight: 'none',
                        }}
                      >
                        <ExternalLink size={13} className="header-icon-responsive" />
                        <span>D4H event</span>
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content className="tooltip-content" side="top" sideOffset={5}>
                        Open event page in D4H
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>

                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        className="btn btn-sm"
                        onClick={() => pullData()}
                        disabled={isPulling}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: '100%',
                          boxSizing: 'border-box',
                          background: hasPendingChanges ? 'var(--gold-6)' : 'rgba(255,255,255,0.1)',
                          color: hasPendingChanges ? 'var(--navy-9)' : 'rgba(255,255,255,0.85)',
                          border: hasPendingChanges ? '1px solid var(--gold-6)' : '1px solid rgba(255,255,255,0.18)',
                          borderTopLeftRadius: 0,
                          borderBottomLeftRadius: 0,
                          paddingLeft: 8,
                          paddingRight: 8,
                          fontWeight: hasPendingChanges ? 700 : 600,
                        }}
                      >
                        <RefreshCw size={14} style={isPulling ? { animation: 'spin 1s linear infinite' } : {}} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content className="tooltip-content" side="top" sideOffset={5} style={{ maxWidth: 320, textAlign: 'left' }}>
                        {hasPendingChanges ? (
                          <div>
                            <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--gold-6)' }}>
                              Pending changes in D4H:
                            </div>
                            {pendingChanges.length > 0 ? (
                              <ul style={{ margin: 0, paddingLeft: 16, fontSize: '0.75rem', lineHeight: 1.4, maxHeight: 180, overflowY: 'auto' }}>
                                {pendingChanges.slice(0, 10).map((change, idx) => (
                                  <li key={idx} style={{ marginBottom: 2 }}>{change}</li>
                                ))}
                                {pendingChanges.length > 10 && (
                                  <li style={{ fontStyle: 'italic', opacity: 0.8 }}>+ {pendingChanges.length - 10} more...</li>
                                )}
                              </ul>
                            ) : (
                              <div style={{ fontSize: '0.75rem' }}>Changes detected in D4H.</div>
                            )}
                            <div style={{ marginTop: 6, fontSize: '0.7rem', opacity: 0.8, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 4 }}>
                              Click to sync
                            </div>
                          </div>
                        ) : (
                          'Pull latest attendee data from D4H'
                        )}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </div>
              )}

              {/* Changes dropdown */}
              {!isLocal && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button className="btn btn-sm" style={{
                      background: hasConflicts ? 'rgba(220,38,38,0.25)' : hasLocalChanges ? 'rgba(217,119,6,0.2)' : 'rgba(255,255,255,0.1)',
                      color: hasConflicts ? '#fca5a5' : hasLocalChanges ? '#fcd34d' : 'rgba(255,255,255,0.85)',
                      border: hasConflicts ? '1px solid rgba(220,38,38,0.4)' : hasLocalChanges ? '1px solid rgba(217,119,6,0.4)' : '1px solid rgba(255,255,255,0.18)',
                    }}>
                      {hasConflicts && <AlertTriangle size={13} />}
                      {!hasConflicts && hasLocalChanges && (
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: 'var(--amber-9)', display: 'inline-block',
                        }} />
                      )}
                      Changes
                      <ChevronDown size={13} />
                    </button>
                  </DropdownMenu.Trigger>

                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="select-content"
                      align="end"
                      sideOffset={6}
                      style={{ padding: 4, minWidth: 220 }}
                    >
                      {/* Highlight toggle */}
                      <DropdownMenu.Item
                        onSelect={(e) => { e.preventDefault(); setHighlightChanges(!highlightChanges); }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 12px', borderRadius: 6, cursor: 'pointer', outline: 'none',
                          fontSize: '0.875rem', color: 'var(--slate-12)',
                        }}
                        className="select-item"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Highlighter size={14} style={{ color: 'var(--slate-9)' }} />
                          Highlight changes
                        </div>
                        <Switch.Root
                          checked={highlightChanges}
                          className="switch-root"
                          style={{ pointerEvents: 'none' }}
                        >
                          <Switch.Thumb className="switch-thumb" />
                        </Switch.Root>
                      </DropdownMenu.Item>

                      <DropdownMenu.Item
                        onSelect={(e) => { e.preventDefault(); setShowCalcHours(!showCalcHours); }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 12px', borderRadius: 6, cursor: 'pointer', outline: 'none',
                          fontSize: '0.875rem', color: 'var(--slate-12)',
                        }}
                        className="select-item no-print"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Clock size={14} style={{ color: 'var(--slate-9)' }} />
                          Auto calculate hours
                        </div>
                        <Switch.Root
                          checked={showCalcHours}
                          className="switch-root"
                          style={{ pointerEvents: 'none' }}
                        >
                          <Switch.Thumb className="switch-thumb" />
                        </Switch.Root>
                      </DropdownMenu.Item>

                      {formType === 'fitness' && (
                        <DropdownMenu.Item
                          onSelect={(e) => { e.preventDefault(); setShowValidation(!showValidation); }}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 12px', borderRadius: 6, cursor: 'pointer', outline: 'none',
                            fontSize: '0.875rem', color: 'var(--slate-12)',
                          }}
                          className="select-item no-print"
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Check size={14} style={{ color: 'var(--slate-9)' }} />
                            Data validation
                          </div>
                          <Switch.Root
                            checked={showValidation}
                            className="switch-root"
                            style={{ pointerEvents: 'none' }}
                          >
                            <Switch.Thumb className="switch-thumb" />
                          </Switch.Root>
                        </DropdownMenu.Item>
                      )}

                      {hasConflicts && (
                        <>
                          <DropdownMenu.Separator style={{ height: 1, background: 'var(--slate-5)', margin: '4px 0' }} />
                          <DropdownMenu.Item
                            className="select-item"
                            onSelect={() => fixConflicts()}
                            style={{
                              borderRadius: 6, padding: '8px 12px', outline: 'none',
                              color: 'var(--red-11)', cursor: 'pointer',
                            }}
                          >
                            <AlertTriangle size={14} />
                            Accept D4H values (fix conflicts)
                          </DropdownMenu.Item>
                        </>
                      )}

                      <DropdownMenu.Separator style={{ height: 1, background: 'var(--slate-5)', margin: '4px 0' }} />

                      <DropdownMenu.Item
                        className="select-item"
                        onSelect={() => setShowResetModal(true)}
                        disabled={!hasLocalChanges && !hasConflicts}
                        style={{
                          borderRadius: 6, padding: '8px 12px', outline: 'none',
                          opacity: (!hasLocalChanges && !hasConflicts) ? 0.4 : 1,
                          cursor: (!hasLocalChanges && !hasConflicts) ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <RotateCcw size={14} style={{ color: 'var(--slate-9)' }} />
                        Reset local changes
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
              {/* Delete local roster */}
              {isLocal && (
                <button
                  className="btn btn-sm"
                  style={{
                    background: 'rgba(220,38,38,0.15)',
                    color: '#fca5a5',
                    border: '1px solid rgba(220,38,38,0.3)',
                  }}
                  onClick={() => setShowDeleteModal(true)}
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              )}

              <Separator.Root style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)' }} orientation="vertical" />

              {/* Export dropdown */}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className="btn btn-sm"
                    style={{ background: 'var(--gold-6)', color: 'var(--navy-9)', fontWeight: 700 }}
                  >
                    <FileText size={14} className="header-icon-responsive" />
                    <span>Export</span>
                    <ChevronDown size={13} />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="select-content"
                    align="end"
                    sideOffset={6}
                    style={{ padding: 4, minWidth: 160 }}
                  >
                    <DropdownMenu.Item
                      className="select-item"
                      onSelect={() => handlePrint()}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        borderRadius: 6, padding: '8px 12px', outline: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--slate-12)',
                      }}
                    >
                      <Printer size={14} style={{ color: 'var(--slate-9)' }} />
                      PDF / Print
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="select-item"
                      onSelect={() => handleExportCsv()}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        borderRadius: 6, padding: '8px 12px', outline: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--slate-12)',
                      }}
                    >
                      <FileDown size={14} style={{ color: 'var(--slate-9)' }} />
                      CSV
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        </header>

        <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 0', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties}>

          {/* ── Config card ──────────────────────────────── */}
          <div className="card no-print" style={{ padding: '18px 24px', marginBottom: 20 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={16} style={{ color: 'var(--slate-9)' }} />
                <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--slate-12)' }}>
                  Form Builder
                </span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--slate-10)' }}>· auto-saved locally</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {/* Form type select */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Label.Root style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--slate-11)', whiteSpace: 'nowrap' }}>
                    Form Type
                  </Label.Root>
                  <Select.Root value={formType} onValueChange={handleFormTypeChange}>
                    <Select.Trigger className="select-trigger">
                      <Select.Value />
                      <Select.Icon><ChevronDown size={14} /></Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className="select-content" position="popper" sideOffset={6}>
                        <Select.Viewport>
                          {FORM_TYPES.map(ft => (
                            <Select.Item key={ft.value} value={ft.value} className="select-item">
                              <Select.ItemText>{ft.label}</Select.ItemText>
                              <Select.ItemIndicator style={{ marginLeft: 'auto' }}>
                                <Check size={13} style={{ color: 'var(--indigo-9)' }} />
                              </Select.ItemIndicator>
                            </Select.Item>
                          ))}
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>

                {/* Data-driven column toggles dropdown */}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button className="select-trigger" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, width: 'auto' }}>
                      <span>Columns</span>
                      <ChevronDown size={14} />
                    </button>
                  </DropdownMenu.Trigger>

                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="select-content"
                      align="start"
                      sideOffset={6}
                      style={{ padding: 4, width: 'max-content' }}
                    >
                      {COLUMN_TOGGLES.map(({ key, label, icon: Icon, className }) => (
                        <DropdownMenu.Item
                          key={key}
                          onSelect={(e) => { e.preventDefault(); toggleColumn(key); }}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: 16, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', outline: 'none',
                            fontSize: '0.8125rem', color: 'var(--slate-12)',
                          }}
                          className={`select-item ${className || ''}`}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Icon size={14} style={{ color: 'var(--slate-9)' }} />
                            {label}
                          </div>
                          <Switch.Root
                            checked={columnFlags[key]}
                            className="switch-root"
                            style={{ pointerEvents: 'none' }}
                          >
                            <Switch.Thumb className="switch-thumb" />
                          </Switch.Root>
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Add rows (only shown when not multi-period, since multi-period pages have their own row buttons) */}
                {(!formState?.periods || formState.periods.length <= 1) && (
                  <>
                    <Separator.Root className="separator" style={{ width: 1, height: 20 }} orientation="vertical" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Label.Root style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--slate-11)', whiteSpace: 'nowrap' }}>
                        Add rows
                      </Label.Root>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => addBlankRows(1)}
                      >
                        <Plus size={13} /> 1
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => addBlankRows(5)}
                      >
                        <Plus size={13} /> 5
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Conflict banner ───────────────────────────── */}
          {hasConflicts && (
            <div
              className="no-print"
              style={{
                marginBottom: 16, padding: '12px 20px', borderRadius: 10,
                background: 'var(--red-3)', border: '1px solid var(--red-6)',
                display: 'flex', alignItems: 'flex-start', gap: 12,
              }}
            >
              <AlertTriangle size={18} style={{ color: 'var(--red-10)', flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--red-12)', marginBottom: 2 }}>
                  Merge Conflicts Detected
                </p>
                <p style={{ fontSize: '0.8125rem', color: 'var(--red-11)', lineHeight: 1.5 }}>
                  Remote D4H changes conflict with your local edits. Hover over red cells to see remote values, or use the Changes menu to accept D4H values.
                </p>
              </div>
              <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={() => fixConflicts()}>
                Fix conflicts
              </button>
            </div>
          )}

          {/* ── Form ─────────────────────────────────────── */}
          {isLoading ? (
            <div className="no-print" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16 }}>
              <Loader2 size={36} style={{ color: 'var(--indigo-9)', animation: 'spin 1s linear infinite' }} />
              <p style={{ fontSize: '0.9375rem', color: 'var(--slate-10)', fontWeight: 500 }}>
                Loading roster data…
              </p>
            </div>
          ) : !formState ? (
            <Navigate to="/" replace />
          ) : (
            <div ref={componentRef} className="operational-periods-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
              {formState.periods && formState.periods.length > 1 ? (
                formState.periods.map((period, pIdx) => {
                  const isLastPeriod = pIdx === formState.periods!.length - 1;
                  const periodFormState = {
                    headers: period.headers,
                    rows: period.rows,
                  };

                  return (
                    <div
                      key={period.id}
                      className="operational-period-page"
                      style={{
                        pageBreakAfter: isLastPeriod ? 'auto' : 'always',
                        breakAfter: isLastPeriod ? 'auto' : 'page',
                      }}
                    >
                      {/* Period Label Banner on Screen */}
                      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--slate-11)' }}>
                          Operational Period {pIdx + 1} of {formState.periods!.length} · {(() => {
                            try {
                              const rawDate = period.id.startsWith('period_') ? period.id.replace('period_', '') : period.date;
                              return format(new Date(rawDate.includes('-') ? `${rawDate}T12:00:00` : rawDate), 'EEE, MMM d');
                            } catch {
                              return period.date;
                            }
                          })()}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.75rem', padding: '3px 8px', height: 'auto' }}
                            onClick={() => addBlankRows(1, pIdx)}
                            title="Add 1 row"
                          >
                            <Plus size={12} style={{ marginRight: 4 }} /> Add Row
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.75rem', padding: '3px 8px', height: 'auto' }}
                            onClick={() => addBlankRows(5, pIdx)}
                            title="Add 5 rows"
                          >
                            + 5 Rows
                          </button>
                        </div>
                      </div>

                      {/* BUG FIX: pass activityType via renderForm instead of wrong typeLabel */}
                      {renderForm({
                        formState: periodFormState,
                        onUpdateHeader: (key, val) => updateHeaderCell(key, val, pIdx),
                        onUpdateRow: (rowId, colKey, val) => updateRowCell(rowId, colKey, val),
                      })}
                    </div>
                  );
                })
              ) : (
                <div>
                  {renderForm({
                    ref: componentRef,
                    formState: formState,
                    onUpdateHeader: updateHeaderCell,
                    onUpdateRow: updateRowCell,
                  })}
                </div>
              )}
            </div>
          )}
        </main>

        {/* ── Reset Dialog ─────────────────────────────── */}
        <ConfirmDialog
          open={showResetModal}
          onOpenChange={setShowResetModal}
          icon={<RotateCcw size={22} style={{ color: 'var(--red-10)' }} />}
          title="Reset all local changes?"
          description="This will discard all manual edits and revert the form to exactly what's in D4H. This cannot be undone."
          confirmLabel="Reset Everything"
          onConfirm={resetChanges}
        />

        {/* ── Delete Local Roster Dialog ─────────────────────────────── */}
        <ConfirmDialog
          open={showDeleteModal}
          onOpenChange={setShowDeleteModal}
          icon={<Trash2 size={22} style={{ color: 'var(--red-10)' }} />}
          title="Delete this local roster?"
          description="This will permanently delete the roster and all its attendee data. This cannot be undone."
          confirmLabel="Delete Roster"
          onConfirm={handleDeleteLocalRoster}
        />

        {/* ── Attendees Removed on D4H Dialog ───────────── */}
        <RemovedAttendeesModal
          open={!!removedAttendeesPrompt}
          onOpenChange={(open) => {
            if (!open) cancelRemovedAttendees();
          }}
          count={removedAttendeesPrompt?.count || 0}
          onKeepAsCustom={() => confirmRemovedAttendees('keepCustom')}
          onRemoveRows={() => confirmRemovedAttendees('remove')}
        />

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </Tooltip.Provider>
  );
}
