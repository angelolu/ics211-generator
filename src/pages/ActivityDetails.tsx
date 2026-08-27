import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Label from '@radix-ui/react-label';
import * as Separator from '@radix-ui/react-separator';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
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
  Info,
  Loader2,
  Mail,
  Map as MapIcon,
  Maximize2,
  Phone,
  Play,
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
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { getD4HActivityUrl, getActivity, getPreviousOpPeriodAttendees } from '../api/d4h';
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
import type { DepartureWindowMode } from '../api/mapbox';
import type { ActivityMapViewRef } from '../components/ActivityMapView';

// ── Lazy Loaded Tab Views (Code Splitting) ─────────────────
const ActivityInfoView = lazy(() =>
  import('../components/ActivityInfoView').then((m) => ({ default: m.ActivityInfoView }))
);
const ActivityMapView = lazy(() =>
  import('../components/ActivityMapView').then((m) => ({ default: m.ActivityMapView }))
);

// ── Constants ─────────────────────────────────────────────

const FORM_TYPES = [
  { value: '211a', label: 'ICS 211A' },
  { value: '211b', label: 'ICS 211B' },
  { value: 'fitness', label: 'ICS 211 Fitness' },
];

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

export function ActivityDetails() {
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

  const localRosterExists = useMemo(() => {
    if (!id || !id.startsWith('local_')) return false;
    if (exercise) return true;
    try {
      const savedList = localStorage.getItem('fitnessqual_local_rosters');
      const rosters = savedList ? JSON.parse(savedList) : [];
      if (rosters.some((r: { id: string }) => r.id === id)) return true;
    } catch {
      // ignore JSON parse error
    }
    if (localStorage.getItem(`d4h_form_${id}`)) return true;
    return false;
  }, [id, exercise]);

  const [fetchedActivity, setFetchedActivity] = useState<Activity | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(() => {
    if (exercise || cachedActivity) return false;
    if (id && id.startsWith('local_')) return false;
    if (!id || !contextId) return false;
    const cid = parseInt(contextId, 10);
    const numId = parseInt(id, 10);
    if (isNaN(cid) || isNaN(numId)) return false;
    return true;
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // ignore
    }
  }, [id]);

  useEffect(() => {
    if (exercise || cachedActivity) return;
    if (!id) {
      navigate('/dashboard', { replace: true });
      return;
    }

    if (id.startsWith('local_')) {
      if (!localRosterExists) {
        navigate('/dashboard', { replace: true });
      }
      return;
    }

    const cid = parseInt(contextId || '', 10);
    const numId = parseInt(id, 10);
    if (isNaN(cid) || isNaN(numId)) {
      navigate('/dashboard', { replace: true });
      return;
    }

    let isMounted = true;
    getActivity(cid, numId)
      .then((act) => {
        if (!isMounted) return;
        if (act) {
          setFetchedActivity(act);
          setIsResolving(false);
        } else {
          navigate('/dashboard', { replace: true });
        }
      })
      .catch(() => {
        if (!isMounted) return;
        navigate('/dashboard', { replace: true });
      });

    return () => {
      isMounted = false;
    };
  }, [exercise, cachedActivity, id, contextId, localRosterExists, navigate]);

  const currentExercise = exercise || cachedActivity || fetchedActivity;

  const isLocal = typeof id === 'string' && id.startsWith('local_');

  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [activeView, setActiveView] = useState<'info' | 'roster' | 'map'>(() => {
    if (!id || id.startsWith('local_')) return 'roster';
    const saved = localStorage.getItem(`d4h_active_view_${id}`);
    if (saved === 'info' || saved === 'roster' || saved === 'map') {
      return saved;
    }
    return 'info';
  });

  useEffect(() => {
    if (!id) return;
    if (id.startsWith('local_')) {
      setActiveView('roster');
      return;
    }
    const saved = localStorage.getItem(`d4h_active_view_${id}`);
    if (saved === 'info' || saved === 'roster' || saved === 'map') {
      setActiveView(saved);
    } else {
      setActiveView('info');
    }
  }, [id]);

  const handleViewChange = (view: 'info' | 'roster' | 'map') => {
    if (isLocal) return;
    setActiveView(view);
    if (id) {
      localStorage.setItem(`d4h_active_view_${id}`, view);
    }
  };

  const [formType, setFormType] = useState(() => localStorage.getItem(`d4h_form_type_${id}`) || '211a');
  const [showCalcHours, setShowCalcHours] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const mapRef = useRef<ActivityMapViewRef | null>(null);
  const [mapDepartureMode, setMapDepartureMode] = useState<DepartureWindowMode>('baseline');

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
    formState, attendees, members, isLoading, isPulling, hasLocalChanges, hasConflicts, hasPendingChanges,
    pendingChanges, removedAttendeesPrompt, confirmRemovedAttendees, cancelRemovedAttendees,
    medicalMap, technicalMap, positionsMap, idsMap, statusMap, rolesMap, emailMap,
    highlightChanges, setHighlightChanges, updateHeaderCell, updateRowCell,
    addBlankRows, resetChanges, fixConflicts, pullData, removeRow, restoreRow,
  } = useFormState(id ? (id.startsWith('local_') ? id : parseInt(id, 10)) : undefined, contextId, currentExercise, teamTitle);

  // Pre-load immediate previous day's op period responding personnel
  useEffect(() => {
    if (!contextId || !currentExercise || isLocal) return;
    const cid = parseInt(contextId, 10);
    if (!isNaN(cid)) {
      getPreviousOpPeriodAttendees(cid, currentExercise, attendees).catch(() => {});
    }
  }, [contextId, currentExercise, attendees, isLocal]);

  const isD4HConnected = Boolean(localStorage.getItem('d4h_token') && !isLocal);
  const activityName = isLocal && formState?.headers?.exerciseName?.value
    ? formState.headers.exerciseName.value
    : currentExercise?.referenceDescription || currentExercise?.description || (currentExercise as { title?: string })?.title || 'Activity Details';
  useDocumentTitle(activityName);
  const activityType = currentExercise?.type || 'local';

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
      localStorage.removeItem(`d4h_active_view_${id}`);
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
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ICS-211_${activityName.replace(/\s+/g, '_')}_${currentExercise?.id || id}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderForm = (props: {
    ref?: React.Ref<HTMLDivElement>;
    formState: { headers: FormHeaderData; rows: FormRowData[] };
    onUpdateHeader: (key: keyof FormHeaderData, val: string) => void;
    onUpdateRow: (rowId: string, colKey: keyof FormRowData['cells'], val: string) => void;
  }) => {
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
      activityType: (activityType === 'exercise' || activityType === 'event' || activityType === 'incident') ? activityType : undefined,
      onUpdateHeader: props.onUpdateHeader,
      onUpdateRow: props.onUpdateRow,
      onRemoveRow: removeRow,
      onRestoreRow: restoreRow,
    };

    if (formType === 'fitness') return <ICS211Form ref={props.ref} {...shared} showValidation={showValidation} />;
    if (formType === '211b') return <ICS211BForm ref={props.ref} {...shared} />;
    return <ICS211AForm ref={props.ref} {...shared} />;
  };

  if (isResolving || (!currentExercise && !isLocal) || (isLocal && !localRosterExists)) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400" style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--navy-12, #020617)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" style={{ animation: 'spin 1s linear infinite' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--slate-10)' }}>Loading activity...</span>
      </div>
    );
  }

  const isMapView = !isLocal && activeView === 'map';

  return (
    <Tooltip.Provider delayDuration={400}>
      <div
        className={`app-bg ${isMapView ? 'map-view-active' : ''}`}
        style={{
          minHeight: '100vh',
          height: isMapView ? '100vh' : undefined,
          maxHeight: isMapView ? '100vh' : undefined,
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: isMapView ? 'hidden' : undefined,
        }}
      >

        {/* ── Header ─────────────────────────────────────── */}
        <header className="app-header no-print select-none">
          <div
            style={{
              maxWidth: 1300,
              margin: '0 auto',
              padding: '0 24px',
              height: 60,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          >
            {/* Left: back + title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/dashboard')}
                    className="size-8 p-0 bg-white/10 hover:bg-white/20 text-white/90 hover:text-white border border-white/15 rounded-md select-none"
                  >
                    <ArrowLeft size={16} />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="tooltip-content" sideOffset={5}>Back to dashboard</Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, userSelect: 'none', WebkitUserSelect: 'none' }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: '1rem',
                    color: 'white',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    letterSpacing: '-0.01em',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }}
                >
                  {activityName}
                </span>
              </div>
            </div>

            {/* Right: actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {/* Split button: D4H Event link + Refresh icon */}
              {!isLocal && (
                <div style={{ display: 'inline-flex', alignItems: 'stretch', height: 29 }}>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(getD4HActivityUrl(currentExercise?.id || id || '', activityType), '_blank', 'noopener,noreferrer')}
                        className="h-full gap-1.5 px-3 bg-white/10 hover:bg-white/20 text-white/90 hover:text-white border border-white/18 border-r-0 rounded-r-none font-semibold text-xs"
                      >
                        <ExternalLink size={13} className="header-icon-responsive" />
                        <span>D4H</span>
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content className="tooltip-content" side="top" sideOffset={5}>
                        Open event page in D4H
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>

                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => pullData()}
                        disabled={isPulling}
                        className={`h-full px-2 border rounded-l-none font-semibold text-xs ${
                          hasPendingChanges
                            ? 'bg-amber-400 hover:bg-amber-500 text-slate-950 border-amber-500'
                            : 'bg-white/10 hover:bg-white/20 text-white/90 hover:text-white border-white/18'
                        }`}
                      >
                        <RefreshCw size={14} className={isPulling ? 'animate-spin' : ''} />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content className="tooltip-content" side="top" sideOffset={5} style={{ maxWidth: 320, textAlign: 'left' }}>
                        {hasPendingChanges ? (
                          <div>
                            <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--gold-6)' }}>
                              Pending changes from D4H:
                            </div>
                            {pendingChanges.length > 0 ? (
                              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.75rem', lineHeight: 1.4, maxHeight: 180, overflowY: 'auto' }}>
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
                          </div>
                        ) : (
                          'Pull latest attendee data from D4H'
                        )}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          className={cn("activity-details-main", isMapView && "map-view-active")}
          style={{
            maxWidth: 1300,
            width: '100%',
            margin: '0 auto',
            flex: isMapView ? 1 : undefined,
            display: isMapView ? 'flex' : undefined,
            flexDirection: isMapView ? 'column' : undefined,
            minHeight: isMapView ? 0 : undefined,
            boxSizing: 'border-box',
            overflow: isMapView ? 'hidden' : undefined,
            WebkitPrintColorAdjust: 'exact',
            printColorAdjust: 'exact',
          } as React.CSSProperties}
        >
          {/* ── Top View & Action Bar ──────────────────────── */}
          <div
            className="activity-details-topbar no-print"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
              flexWrap: 'wrap',
              gap: 12,
              flexShrink: 0,
            }}
          >
            {/* View Switcher (only when connected to D4H and not local) */}
            {isD4HConnected ? (
              <Tabs
                value={activeView}
                onValueChange={(v) => {
                  if (v) handleViewChange(v as 'info' | 'roster' | 'map');
                }}
              >
                <TabsList className="h-10 p-1 bg-slate-200/80 border-slate-300/70 dark:bg-slate-800 dark:border-slate-700/80 gap-1 rounded-xl shadow-2xs">
                  <TabsTrigger value="info" className="h-8 px-3.5 sm:px-4 text-sm font-semibold gap-1.5 rounded-lg">
                    <Info size={16} />
                    <span>Info</span>
                  </TabsTrigger>
                  <TabsTrigger value="roster" className="h-8 px-3.5 sm:px-4 text-sm font-semibold gap-1.5 rounded-lg">
                    <FileText size={16} />
                    <span>Roster</span>
                  </TabsTrigger>
                  <TabsTrigger value="map" className="h-8 px-3.5 sm:px-4 text-sm font-semibold gap-1.5 rounded-lg">
                    <MapIcon size={16} />
                    <span>Map</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            ) : (
              <div />
            )}

            {/* Map Actions in top header row (in line with switcher) */}
            {!isLocal && activeView === 'map' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
                {/* 1. Add Carpool Button */}
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => mapRef.current?.openAddCarpool()}
                  className="h-8 gap-1.5 font-semibold"
                  title="Create a new carpool group"
                >
                  <Plus size={14} />
                  <span>Add Carpool</span>
                </Button>

                {/* 2. Traffic / Departure Window Selector */}
                <DropdownMenu.Root modal={false}>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-2.5 text-xs font-semibold"
                      title="Select departure time window for traffic and routing calculations"
                    >
                      <Clock size={13} className="text-slate-500" />
                      <span className="text-slate-500 font-medium">Traffic:</span>
                      <span>
                        {mapDepartureMode === 'baseline'
                          ? 'Average'
                          : mapDepartureMode === 'now'
                            ? 'Leave Now'
                            : mapDepartureMode === 'activity_start'
                              ? 'Arrive by start time'
                              : mapDepartureMode === 'morning_rush'
                                ? 'Morning Rush (07:30)'
                                : mapDepartureMode === 'midday'
                                  ? 'Midday (12:00)'
                                  : 'Evening Rush (17:00)'}
                      </span>
                      <ChevronDown size={12} className="text-slate-500 ml-0.5" />
                    </Button>
                  </DropdownMenu.Trigger>

                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="select-content no-print animate-fade-in"
                      align="end"
                      sideOffset={6}
                      style={{
                        minWidth: 210,
                        background: 'white',
                        border: '1px solid var(--slate-4)',
                        borderRadius: 8,
                        padding: 4,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                        zIndex: 9999,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <div
                        style={{
                          padding: '6px 8px 4px',
                          fontSize: '0.6875rem',
                          fontWeight: 700,
                          color: 'var(--slate-9)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        Departure Window
                      </div>

                      {[
                        { value: 'baseline', label: 'Average', desc: 'Standard traffic estimates' },
                        { value: 'now', label: 'Leave Now', desc: 'Real-time live traffic' },
                        { value: 'activity_start', label: 'Arrive by start time', desc: 'Target 30m prior to start' },
                        { value: 'morning_rush', label: 'Morning Rush (07:30)', desc: 'Peak morning commute' },
                        { value: 'midday', label: 'Midday (12:00)', desc: 'Midday traffic flow' },
                        { value: 'evening_rush', label: 'Evening Rush (17:00)', desc: 'Peak evening commute' },
                      ].map((opt) => {
                        const isSelected = mapDepartureMode === opt.value;
                        return (
                          <DropdownMenu.Item
                            key={opt.value}
                            className="select-item"
                            onSelect={() => setMapDepartureMode(opt.value as DepartureWindowMode)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 8px',
                              borderRadius: 6,
                              fontSize: '0.8125rem',
                              fontWeight: isSelected ? 600 : 500,
                              color: isSelected ? 'var(--navy-9)' : 'var(--slate-12)',
                              background: isSelected ? 'var(--navy-1)' : 'transparent',
                              cursor: 'pointer',
                              outline: 'none',
                              transition: 'background 0.12s ease',
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span>{opt.label}</span>
                              <span style={{ fontSize: '0.6875rem', color: 'var(--slate-9)', fontWeight: 400 }}>
                                {opt.desc}
                              </span>
                            </div>
                            {isSelected && (
                              <Check size={14} style={{ color: 'var(--navy-9)', marginLeft: 8, flexShrink: 0 }} />
                            )}
                          </DropdownMenu.Item>
                        );
                      })}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* 3. Play Animation Icon Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => mapRef.current?.playAnimation()}
                  className="size-8 p-0"
                  title="Replay animated corridor driving routes"
                  aria-label="Replay animated routes"
                >
                  <Play size={13} className="ml-0.5" />
                </Button>

                {/* 4. Fit All Icon Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => mapRef.current?.fitAll()}
                  className="size-8 p-0 map-fit-all-btn"
                  title="Fit map to all responders and incident"
                  aria-label="Fit map to all responders and incident"
                >
                  <Maximize2 size={13} />
                </Button>
              </div>
            )}

            {/* Options and Export buttons (only in roster view, shown for both local and D4H activities) */}
            {(!isD4HConnected || activeView === 'roster') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                {/* Options dropdown */}
                <DropdownMenu.Root modal={false}>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant={hasConflicts ? 'destructive' : 'outline'}
                      size="sm"
                      className="h-8 gap-1.5 font-semibold"
                      style={
                        !hasConflicts && hasLocalChanges
                          ? {
                              background: 'var(--amber-3)',
                              color: 'var(--amber-11)',
                              borderColor: 'var(--amber-7)',
                            }
                          : undefined
                      }
                    >
                      {hasConflicts && <AlertTriangle size={13} />}
                      {!hasConflicts && hasLocalChanges && (
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: 'var(--amber-9)',
                            display: 'inline-block',
                          }}
                        />
                      )}
                      <span>Options</span>
                      <ChevronDown size={13} />
                    </Button>
                  </DropdownMenu.Trigger>

                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="select-content"
                      align="end"
                      sideOffset={6}
                      style={{ padding: 4, minWidth: 220 }}
                    >
                      <DropdownMenu.Item
                        onSelect={(e) => {
                          e.preventDefault();
                          setShowCalcHours(!showCalcHours);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          outline: 'none',
                          fontSize: '0.875rem',
                          color: 'var(--slate-12)',
                        }}
                        className="select-item no-print"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Clock size={14} style={{ color: 'var(--slate-9)' }} />
                          Auto calculate hours
                        </div>
                        <Switch checked={showCalcHours} className="pointer-events-none" />
                      </DropdownMenu.Item>

                      {formType === 'fitness' && (
                        <DropdownMenu.Item
                          onSelect={(e) => {
                            e.preventDefault();
                            setShowValidation(!showValidation);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            outline: 'none',
                            fontSize: '0.875rem',
                            color: 'var(--slate-12)',
                          }}
                          className="select-item no-print"
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Check size={14} style={{ color: 'var(--slate-9)' }} />
                            Data validation
                          </div>
                          <Switch checked={showValidation} className="pointer-events-none" />
                        </DropdownMenu.Item>
                      )}

                      {hasConflicts && (
                        <>
                          <DropdownMenu.Separator style={{ height: 1, background: 'var(--slate-5)', margin: '4px 0' }} />
                          <DropdownMenu.Item
                            className="select-item"
                            onSelect={() => fixConflicts()}
                            style={{
                              borderRadius: 6,
                              padding: '8px 12px',
                              outline: 'none',
                              color: 'var(--red-11)',
                              cursor: 'pointer',
                            }}
                          >
                            <AlertTriangle size={14} />
                            Accept D4H values (fix conflicts)
                          </DropdownMenu.Item>
                        </>
                      )}

                      <DropdownMenu.Separator style={{ height: 1, background: 'var(--slate-5)', margin: '4px 0' }} />

                      <DropdownMenu.Label style={{ padding: '6px 12px 2px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--slate-10)' }}>
                        Local Changes
                      </DropdownMenu.Label>

                      {/* Highlight toggle */}
                      <DropdownMenu.Item
                        onSelect={(e) => {
                          e.preventDefault();
                          setHighlightChanges(!highlightChanges);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          outline: 'none',
                          fontSize: '0.875rem',
                          color: 'var(--slate-12)',
                        }}
                        className="select-item"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Highlighter size={14} style={{ color: 'var(--slate-9)' }} />
                          Highlight
                        </div>
                        <Switch checked={highlightChanges} className="pointer-events-none" />
                      </DropdownMenu.Item>

                      <DropdownMenu.Item
                        className="select-item"
                        onSelect={() => setShowResetModal(true)}
                        disabled={!hasLocalChanges && !hasConflicts}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          borderRadius: 6,
                          padding: '8px 12px',
                          outline: 'none',
                          fontSize: '0.875rem',
                          color: 'var(--slate-12)',
                          opacity: !hasLocalChanges && !hasConflicts ? 0.4 : 1,
                          cursor: !hasLocalChanges && !hasConflicts ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <RotateCcw size={14} style={{ color: 'var(--slate-9)' }} />
                        Reset
                      </DropdownMenu.Item>

                      {isLocal && (
                        <>
                          <DropdownMenu.Separator style={{ height: 1, background: 'var(--slate-5)', margin: '4px 0' }} />
                          <DropdownMenu.Item
                            className="select-item"
                            onSelect={() => setShowDeleteModal(true)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              borderRadius: 6,
                              padding: '8px 12px',
                              outline: 'none',
                              fontSize: '0.875rem',
                              color: 'var(--red-11)',
                              cursor: 'pointer',
                            }}
                          >
                            <Trash2 size={14} style={{ color: 'var(--red-10)' }} />
                            Delete roster
                          </DropdownMenu.Item>
                        </>
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Export dropdown */}
                <DropdownMenu.Root modal={false}>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-8 gap-1.5 font-semibold"
                    >
                      <FileText size={14} className="header-icon-responsive" />
                      <span>Export</span>
                      <ChevronDown size={13} />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="select-content" align="end" sideOffset={6} style={{ padding: 4, minWidth: 160 }}>
                      <DropdownMenu.Item
                        className="select-item"
                        onSelect={() => handlePrint()}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          borderRadius: 6,
                          padding: '8px 12px',
                          outline: 'none',
                          cursor: 'pointer',
                          fontSize: '0.875rem',
                          color: 'var(--slate-12)',
                        }}
                      >
                        <Printer size={14} style={{ color: 'var(--slate-9)' }} />
                        PDF / Print
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="select-item"
                        onSelect={() => handleExportCsv()}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          borderRadius: 6,
                          padding: '8px 12px',
                          outline: 'none',
                          cursor: 'pointer',
                          fontSize: '0.875rem',
                          color: 'var(--slate-12)',
                        }}
                      >
                        <FileDown size={14} style={{ color: 'var(--slate-9)' }} />
                        CSV
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            )}
          </div>

          {/* VIEW 1: INFO VIEW */}
          {!isLocal && activeView === 'info' && (
            <Suspense
              fallback={
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 16 }}>
                  <Loader2 size={36} style={{ color: 'var(--indigo-9)', animation: 'spin 1s linear infinite' }} />
                  <p style={{ fontSize: '0.875rem', color: 'var(--slate-10)', fontWeight: 500 }}>
                    Loading Activity details…
                  </p>
                </div>
              }
            >
              <ActivityInfoView
                activity={currentExercise}
                activityType={activityType}
                activityName={activityName}
                teamTitle={teamTitle}
                attendees={attendees}
                members={members}
                medicalMap={medicalMap}
                technicalMap={technicalMap}
                isLocal={isLocal}
                onAttendanceChanged={() => pullData()}
                onSwitchToRoster={() => handleViewChange('roster')}
                onSwitchToMap={() => handleViewChange('map')}
              />
            </Suspense>
          )}

          {/* VIEW 2: MAP VIEW */}
          {!isLocal && activeView === 'map' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', width: '100%' }}>
              <Suspense
                fallback={
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400, gap: 16 }}>
                    <Loader2 size={36} style={{ color: 'var(--indigo-9)', animation: 'spin 1s linear infinite' }} />
                    <p style={{ fontSize: '0.875rem', color: 'var(--slate-10)', fontWeight: 500 }}>
                      Loading Map View…
                    </p>
                  </div>
                }
              >
                <ActivityMapView
                  ref={mapRef}
                  activity={currentExercise}
                  activityType={activityType}
                  activityName={activityName}
                  attendees={attendees}
                  members={members}
                  isLoading={isLoading}
                  departureMode={mapDepartureMode}
                />
              </Suspense>
            </div>
          )}

          {/* VIEW 3: ROSTER / FORM VIEW */}
          {(isLocal || activeView === 'roster') && (
            <>
              {/* ── Form Controls Toolbar ──────────────────────── */}
              <div
                className="card form-controls-toolbar no-print"
                style={{
                  padding: '14px 20px',
                  marginBottom: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={16} style={{ color: 'var(--slate-9)' }} />
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--slate-12)' }}>
                      Form Builder
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    {/* Form type dropdown (styled like traffic dropdown) */}
                    <DropdownMenu.Root modal={false}>
                      <DropdownMenu.Trigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 px-2.5 text-xs font-semibold"
                          title="Select form type"
                        >
                          <span className="text-slate-500 font-medium">Form:</span>
                          <span>{FORM_TYPES.find(ft => ft.value === formType)?.label || formType}</span>
                          <ChevronDown size={12} className="text-slate-500 ml-0.5" />
                        </Button>
                      </DropdownMenu.Trigger>

                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="select-content no-print animate-fade-in"
                          align="start"
                          sideOffset={6}
                          style={{
                            minWidth: 170,
                            background: 'white',
                            border: '1px solid var(--slate-4)',
                            borderRadius: 8,
                            padding: 4,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                            zIndex: 9999,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                          }}
                        >
                          {FORM_TYPES.map((ft) => {
                            const isSelected = formType === ft.value;
                            return (
                              <DropdownMenu.Item
                                key={ft.value}
                                className="select-item"
                                onSelect={() => handleFormTypeChange(ft.value)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '6px 10px',
                                  borderRadius: 6,
                                  fontSize: '0.8125rem',
                                  fontWeight: isSelected ? 600 : 500,
                                  color: isSelected ? 'var(--navy-9)' : 'var(--slate-12)',
                                  background: isSelected ? 'var(--navy-1)' : 'transparent',
                                  cursor: 'pointer',
                                  outline: 'none',
                                  transition: 'background 0.12s ease',
                                }}
                              >
                                <span>{ft.label}</span>
                                {isSelected && (
                                  <Check size={14} style={{ color: 'var(--navy-9)', marginLeft: 8, flexShrink: 0 }} />
                                )}
                              </DropdownMenu.Item>
                            );
                          })}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>

                    {/* Data-driven column toggles dropdown */}
                    <DropdownMenu.Root modal={false}>
                      <DropdownMenu.Trigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 px-2.5 text-xs font-semibold"
                        >
                          <span>Columns</span>
                          <ChevronDown size={12} className="text-slate-500 ml-0.5" />
                        </Button>
                      </DropdownMenu.Trigger>

                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="select-content no-print animate-fade-in"
                          align="start"
                          sideOffset={6}
                          style={{
                            minWidth: 200,
                            background: 'white',
                            border: '1px solid var(--slate-4)',
                            borderRadius: 8,
                            padding: 4,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                            zIndex: 9999,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                          }}
                        >
                          {COLUMN_TOGGLES.map(({ key, label, icon: Icon, className }) => (
                            <DropdownMenu.Item
                              key={key}
                              onSelect={(e) => { e.preventDefault(); toggleColumn(key); }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 16,
                                padding: '6px 10px',
                                borderRadius: 6,
                                cursor: 'pointer',
                                outline: 'none',
                                fontSize: '0.8125rem',
                                color: 'var(--slate-12)',
                              }}
                              className={`select-item ${className || ''}`}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Icon size={14} style={{ color: 'var(--slate-9)' }} />
                                <span>{label}</span>
                              </div>
                              <Switch checked={columnFlags[key]} className="pointer-events-none" />
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
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs font-semibold gap-1"
                            onClick={() => addBlankRows(1)}
                          >
                            <Plus size={13} /> 1
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs font-semibold gap-1"
                            onClick={() => addBlankRows(5)}
                          >
                            <Plus size={13} /> 5
                          </Button>
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
                  <Button
                    variant="destructive"
                    size="sm"
                    className="ml-auto shrink-0 font-semibold"
                    onClick={() => fixConflicts()}
                  >
                    Fix conflicts
                  </Button>
                </div>
              )}

              {/* ── Form ─────────────────────────────────────── */}
              {isLoading ? (
                <div className="no-print" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16 }}>
                  <Loader2 size={36} style={{ color: 'var(--indigo-9)', animation: 'spin 1s linear infinite' }} />
                  <p style={{ fontSize: '0.875rem', color: 'var(--slate-10)', fontWeight: 500 }}>
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
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[0.6875rem] font-semibold gap-1"
                                onClick={() => addBlankRows(1, pIdx)}
                                title="Add 1 row"
                              >
                                <Plus size={12} /> Add Row
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[0.6875rem] font-semibold"
                                onClick={() => addBlankRows(5, pIdx)}
                                title="Add 5 rows"
                              >
                                + 5 Rows
                              </Button>
                            </div>
                          </div>

                          {renderForm({
                            formState: periodFormState,
                            onUpdateHeader: (key, val) => updateHeaderCell(key, val, pIdx),
                            onUpdateRow: updateRowCell,
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
            </>
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

// Backwards compatibility alias
export const ExerciseDetails = ActivityDetails;
