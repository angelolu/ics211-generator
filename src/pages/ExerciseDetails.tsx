import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Label from '@radix-ui/react-label';
import * as Select from '@radix-ui/react-select';
import * as Separator from '@radix-ui/react-separator';
import * as Switch from '@radix-ui/react-switch';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  Check,
  ChevronDown,
  Clock,
  FileDown,
  FileText,
  Highlighter,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import type { Activity } from '../api/d4h';
import { ICS211AForm } from '../components/ICS211AForm';
import { ICS211BForm } from '../components/ICS211BForm';
import { ICS211Form } from '../components/ICS211Form';
import { useFormState, type FormRowData } from '../hooks/useFormState';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { calculateHours } from '../utils/time';

const FORM_TYPES = [
  { value: '211a', label: 'ICS 211A', icon: '📋' },
  { value: '211b', label: 'ICS 211B', icon: '📄' },
  { value: 'fitness', label: 'ICS 211 Fitness', icon: '🏋️' },
];

const TYPE_LABELS: Record<string, string> = {
  exercise: 'Exercise', event: 'Event', incident: 'Incident', local: 'Local',
};

const TYPE_ICONS: Record<string, string> = {
  exercise: '🏋️', event: '📅', incident: '🚨', local: '💾',
};

export function ExerciseDetails() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const exercise = location.state?.exercise as Activity;
  const componentRef = useRef<HTMLDivElement>(null);

  const teamTitle = localStorage.getItem('d4h_team_title') || 'Your Team';
  const contextId = localStorage.getItem('d4h_context_id');

  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCalcHours, setShowCalcHours] = useState(false);
  const [showQualifications, setShowQualifications] = useState(false);
  const [showPositions, setShowPositions] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [formType, setFormType] = useState(() => localStorage.getItem(`d4h_form_type_${id}`) || '211a');

  useEffect(() => {
    if (id) localStorage.setItem(`d4h_form_type_${id}`, formType);
  }, [formType, id]);

  const {
    formState, isLoading, isPulling, hasLocalChanges, hasConflicts,
    qualificationsMap, positionsMap,
    highlightChanges, setHighlightChanges, updateHeaderCell, updateRowCell,
    addBlankRows, resetChanges, fixConflicts, pullData, removeRow, restoreRow,
  } = useFormState(id ? (id.startsWith('local_') ? id : parseInt(id, 10)) : undefined, contextId, exercise, teamTitle);

  const isLocal = typeof id === 'string' && id.startsWith('local_');
  const activityName = isLocal && formState?.headers?.exerciseName?.value
    ? formState.headers.exerciseName.value
    : exercise?.referenceDescription || exercise?.description || (exercise as { title?: string })?.title || 'Exercise Details';
  useDocumentTitle(activityName);
  const activityType = exercise?.type || 'local';
  const currentFormLabel = FORM_TYPES.find(f => f.value === formType)?.label ?? formType;

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `ICS-211_${activityName.replace(/\s+/g, '_')}_${exercise?.id || id}`,
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

  const handleExportCsv = () => {
    let headers: string[] = [];
    let keys: (keyof FormRowData['cells'])[] = [];

    if (formType === '211a') {
      headers = ['T CARD', 'NAME (PERSONNEL) -OR- DESCRIPTION (EQUIPMENT)', 'DATE/TIME IN', 'DATE/TIME OUT', 'HOURS', 'ADDITIONAL INFORMATION'];
      keys = ['tCard', 'name', 'timeIn', 'timeOut', 'hours', 'additionalInfo'];
    } else if (formType === '211b') {
      headers = ['T CARD', 'NAME (PERSONNEL) -OR- DESCRIPTION (EQUIPMENT)', 'AGENCY/TEAM', 'TIME IN', 'TIME OUT', 'HOURS', 'ADDITIONAL INFORMATION'];
      keys = ['tCard', 'name', 'agencyTeam', 'timeIn', 'timeOut', 'hours', 'additionalInfo'];
    } else if (formType === 'fitness') {
      headers = ['NAME', 'PHONE', 'TIME IN', 'START WEIGHT', 'LAP 1 START TIME', 'LAP 1 END TIME', 'LAP 2 START TIME', 'LAP 2 END TIME', 'END WEIGHT', 'TIME OUT'];
      keys = ['name', 'phone', 'timeIn', 'weightStart', 'lap1Start', 'lap1End', 'lap2Start', 'lap2End', 'weightEnd', 'timeOut'];
    }

    const escapeCsv = (str: string) => {
      if (!str) return '';
      const s = String(str);
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = formState?.rows
      .filter(row => !row.isDeleted)
      .map(row => keys.map(key => {
        if (key === 'hours' && showCalcHours) {
          return escapeCsv(calculateHours(row.cells.timeIn?.value || '', row.cells.timeOut?.value || ''));
        }
        return escapeCsv((row.cells as Record<keyof FormRowData['cells'], { value: string }>)[key]?.value || '');
      }).join(',')) || [];

    const csvContent = [headers.join(','), ...rows].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ICS-211_${activityName.replace(/\\s+/g, '_')}_${exercise?.id || id}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!id || (!isLocal && !contextId) || !exercise) {
    return <Navigate to="/" replace />;
  }

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

              {/* Refresh */}
              {!isLocal && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      className="btn btn-sm"
                      onClick={() => pullData()}
                      disabled={isPulling}
                      style={{
                        background: 'rgba(255,255,255,0.1)',
                        color: 'rgba(255,255,255,0.85)',
                        border: '1px solid rgba(255,255,255,0.18)',
                      }}
                    >
                      <RefreshCw size={14} style={isPulling ? { animation: 'spin 1s linear infinite' } : {}} />
                      Refresh from D4H
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="tooltip-content" sideOffset={5}>
                      Pull latest attendee data from D4H
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
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

                      {formType !== 'fitness' && (
                        <DropdownMenu.Item
                          onSelect={(e) => { e.preventDefault(); setShowQualifications(!showQualifications); }}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 12px', borderRadius: 6, cursor: 'pointer', outline: 'none',
                            fontSize: '0.875rem', color: 'var(--slate-12)',
                          }}
                          className="select-item no-print"
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Award size={14} style={{ color: 'var(--slate-9)' }} />
                            Show qualifications
                          </div>
                          <Switch.Root
                            checked={showQualifications}
                            className="switch-root"
                            style={{ pointerEvents: 'none' }}
                          >
                            <Switch.Thumb className="switch-thumb" />
                          </Switch.Root>
                        </DropdownMenu.Item>
                      )}

                      <DropdownMenu.Item
                        onSelect={(e) => { e.preventDefault(); setShowPositions(!showPositions); }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 12px', borderRadius: 6, cursor: 'pointer', outline: 'none',
                          fontSize: '0.875rem', color: 'var(--slate-12)',
                        }}
                        className="select-item no-print"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <UserCheck size={14} style={{ color: 'var(--slate-9)' }} />
                          Show position
                        </div>
                        <Switch.Root
                          checked={showPositions}
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
                    <FileText size={14} />
                    Export
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
                  Roster Configuration
                </span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--slate-10)' }}>· auto-saved locally</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {/* Form type select */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Label.Root style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--slate-11)', whiteSpace: 'nowrap' }}>
                    Form Type
                  </Label.Root>
                  <Select.Root value={formType} onValueChange={setFormType}>
                    <Select.Trigger className="select-trigger" style={{ minWidth: 160 }}>
                      <Select.Value />
                      <Select.Icon><ChevronDown size={14} /></Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className="select-content" position="popper" sideOffset={6}>
                        <Select.Viewport>
                          {FORM_TYPES.map(ft => (
                            <Select.Item key={ft.value} value={ft.value} className="select-item">
                              <Select.ItemText>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span>{ft.icon}</span>
                                  <span>{ft.label}</span>
                                </span>
                              </Select.ItemText>
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

                <Separator.Root className="separator" style={{ width: 1, height: 20 }} orientation="vertical" />

                {/* Add rows */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Label.Root style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--slate-11)', whiteSpace: 'nowrap' }}>
                    Add rows
                  </Label.Root>
                  <button className="btn btn-secondary btn-sm" onClick={() => addBlankRows(1)}>
                    <Plus size={13} /> 1
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => addBlankRows(5)}>
                    <Plus size={13} /> 5
                  </button>
                </div>
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
          ) : (
            <div style={{
              borderRadius: 8, overflow: 'hidden',
              boxShadow: '0 2px 20px rgba(0,0,0,0.08)',
              border: '1px solid var(--slate-5)',
            }}>
              {formType === 'fitness' && (
                <ICS211Form ref={componentRef} formState={formState} showCalcHours={showCalcHours} showValidation={showValidation}
                  showPositions={showPositions} positionsMap={positionsMap}
                  highlightChanges={highlightChanges} activityType={activityType} onUpdateHeader={updateHeaderCell}
                  onUpdateRow={updateRowCell} onRemoveRow={removeRow} onRestoreRow={restoreRow} />
              )}
              {formType === '211a' && (
                <ICS211AForm ref={componentRef} formState={formState} showCalcHours={showCalcHours}
                  showQualifications={showQualifications} qualificationsMap={qualificationsMap}
                  showPositions={showPositions} positionsMap={positionsMap}
                  highlightChanges={highlightChanges} activityType={activityType} onUpdateHeader={updateHeaderCell}
                  onUpdateRow={updateRowCell} onRemoveRow={removeRow} onRestoreRow={restoreRow} />
              )}
              {formType === '211b' && (
                <ICS211BForm ref={componentRef} formState={formState} showCalcHours={showCalcHours}
                  showQualifications={showQualifications} qualificationsMap={qualificationsMap}
                  showPositions={showPositions} positionsMap={positionsMap}
                  highlightChanges={highlightChanges} activityType={activityType} onUpdateHeader={updateHeaderCell}
                  onUpdateRow={updateRowCell} onRemoveRow={removeRow} onRestoreRow={restoreRow} />
              )}
            </div>
          )}
        </main>

        {/* ── Reset Dialog ─────────────────────────────── */}
        <Dialog.Root open={showResetModal} onOpenChange={setShowResetModal}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content no-print">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 4, marginBottom: 20 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: 'var(--red-3)', border: '1px solid var(--red-6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8,
                }}>
                  <RotateCcw size={22} style={{ color: 'var(--red-10)' }} />
                </div>
                <Dialog.Title style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--slate-12)' }}>
                  Reset all local changes?
                </Dialog.Title>
                <Dialog.Description style={{ fontSize: '0.875rem', color: 'var(--slate-10)', lineHeight: 1.6, maxWidth: 360 }}>
                  This will discard all manual edits and revert the form to exactly what's in D4H. This cannot be undone.
                </Dialog.Description>
              </div>

              <Separator.Root className="separator" style={{ marginBottom: 20 }} />

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <Dialog.Close asChild>
                  <button className="btn btn-secondary">Cancel</button>
                </Dialog.Close>
                <button
                  className="btn btn-danger"
                  onClick={() => { resetChanges(); setShowResetModal(false); }}
                >
                  Reset Everything
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* ── Delete Local Roster Dialog ─────────────────────────────── */}
        <Dialog.Root open={showDeleteModal} onOpenChange={setShowDeleteModal}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content no-print">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 4, marginBottom: 20 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: 'var(--red-3)', border: '1px solid var(--red-6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8,
                }}>
                  <Trash2 size={22} style={{ color: 'var(--red-10)' }} />
                </div>
                <Dialog.Title style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--slate-12)' }}>
                  Delete this local roster?
                </Dialog.Title>
                <Dialog.Description style={{ fontSize: '0.875rem', color: 'var(--slate-10)', lineHeight: 1.6, maxWidth: 360 }}>
                  This will permanently delete the roster and all its attendee data. This cannot be undone.
                </Dialog.Description>
              </div>

              <Separator.Root className="separator" style={{ marginBottom: 20 }} />

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <Dialog.Close asChild>
                  <button className="btn btn-secondary">Cancel</button>
                </Dialog.Close>
                <button
                  className="btn btn-danger"
                  onClick={() => { handleDeleteLocalRoster(); setShowDeleteModal(false); }}
                >
                  Delete Roster
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </Tooltip.Provider>
  );
}
