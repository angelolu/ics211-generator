import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns';
import {
  Activity as ActivityIcon,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Layers,
  List,
  LogIn,
  LogOut,
  MapPin,
  MoreVertical,
  Plus,
  UserCheck,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatActivityLocation, getActivities, getCurrentUserAttendingActivityIds, getCurrentUserMemberInfo, getD4HErrorMessage, logCurrentUserInfo } from '../api/d4h';
import type { Activity } from '../api/d4h';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ActivityPopover } from '../components/ActivityPopover';

type FilterType = 'all' | 'exercise' | 'event' | 'incident';
export type ActivityCardType = 'exercise' | 'event' | 'incident' | 'local';

export interface LocalRoster {
  id: string;
  title: string;
  createdAt: string;
  type: 'local';
}

const TYPE_LABELS: Record<string, string> = {
  exercise: 'Exercise',
  event: 'Event',
  incident: 'Incident',
};

const TYPE_COLOR_STYLES: Record<string, string> = {
  all: 'border-slate-300 text-slate-700 bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:bg-slate-800',
  exercise: 'border-sky-300 text-sky-800 bg-sky-50 dark:border-sky-800 dark:text-sky-300 dark:bg-sky-950/40',
  event: 'border-teal-300 text-teal-800 bg-teal-50 dark:border-teal-800 dark:text-teal-300 dark:bg-teal-950/40',
  incident: 'border-red-300 text-red-800 bg-red-50 dark:border-red-800 dark:text-red-300 dark:bg-red-950/40',
};

interface DateBoxStyle {
  container: string;
  monthText: string;
  dayText: string;
}

const ACTIVITY_DATE_STYLES: Record<ActivityCardType, { active: DateBoxStyle; past: DateBoxStyle }> = {
  exercise: {
    active: {
      container: 'bg-sky-50 border-sky-300 text-sky-950 dark:bg-sky-950/50 dark:border-sky-800 dark:text-sky-200',
      monthText: 'text-sky-700 dark:text-sky-300',
      dayText: 'text-sky-950 dark:text-sky-100',
    },
    past: {
      container: 'bg-sky-50/70 border-sky-200/80 text-sky-900/80 dark:bg-sky-950/30 dark:border-sky-900/50 dark:text-sky-300/80 saturate-[0.6] opacity-80',
      monthText: 'text-sky-700/80 dark:text-sky-300/80',
      dayText: 'text-sky-950/80 dark:text-sky-200/80',
    },
  },
  event: {
    active: {
      container: 'bg-teal-50 border-teal-300 text-teal-950 dark:bg-teal-950/50 dark:border-teal-800 dark:text-teal-200',
      monthText: 'text-teal-700 dark:text-teal-300',
      dayText: 'text-teal-950 dark:text-teal-100',
    },
    past: {
      container: 'bg-teal-50/70 border-teal-200/80 text-teal-900/80 dark:bg-teal-950/30 dark:border-teal-900/50 dark:text-teal-300/80 saturate-[0.6] opacity-80',
      monthText: 'text-teal-700/80 dark:text-teal-300/80',
      dayText: 'text-teal-950/80 dark:text-teal-200/80',
    },
  },
  incident: {
    active: {
      container: 'bg-red-50 border-red-300 text-red-950 dark:bg-red-950/50 dark:border-red-800 dark:text-red-200',
      monthText: 'text-red-700 dark:text-red-300',
      dayText: 'text-red-950 dark:text-red-100',
    },
    past: {
      container: 'bg-red-50/70 border-red-200/80 text-red-900/80 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-300/80 saturate-[0.6] opacity-80',
      monthText: 'text-red-700/80 dark:text-red-300/80',
      dayText: 'text-red-950/80 dark:text-red-200/80',
    },
  },
  local: {
    active: {
      container: 'bg-emerald-50 border-emerald-300 text-emerald-950 dark:bg-emerald-950/50 dark:border-emerald-700 dark:text-emerald-200',
      monthText: 'text-emerald-700 dark:text-emerald-300',
      dayText: 'text-emerald-950 dark:text-emerald-100',
    },
    past: {
      container: 'bg-emerald-50/70 border-emerald-200/80 text-emerald-900/80 dark:bg-emerald-950/30 dark:border-emerald-900/50 dark:text-emerald-300/80 saturate-[0.6] opacity-80',
      monthText: 'text-emerald-700/80 dark:text-emerald-300/80',
      dayText: 'text-emerald-950/80 dark:text-emerald-200/80',
    },
  },
};

function getMonthQueryOptions(month: Date) {
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  return {
    startsAfter: subMonths(gridStart, 1).toISOString(),
    startsBefore: gridEnd.toISOString(),
  };
}

// Persists selected month during SPA session navigation, resets on full page reload
let sessionSelectedMonth: Date | null = null;

interface DashboardActionBarProps {
  currentMonth: Date;
  onMonthChange: (newMonth: Date, scrollToCurrentDate?: boolean) => void;
  viewMode: 'activities' | 'local';
  onViewModeChange: (mode: 'activities' | 'local') => void;
  filter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  counts: Record<FilterType, number>;
  contextId: string | null;
  onCreateLocalRoster: () => void;
}

function DashboardActionBar({
  currentMonth,
  onMonthChange,
  viewMode,
  onViewModeChange,
  filter,
  onFilterChange,
  counts,
  contextId,
  onCreateLocalRoster,
}: DashboardActionBarProps) {
  const isCurrentMonth = isSameMonth(currentMonth, new Date());

  return (
    <div className="sticky top-[60px] z-30 w-[calc(100%+24px)] sm:w-full -mx-3 sm:mx-0 px-3 sm:px-3.5 py-2 mb-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-y sm:border sm:rounded-xl border-slate-200 dark:border-slate-800 shadow-xs box-border">
      <div className="flex items-center justify-between gap-2 min-w-0">
        {/* Left Side: Month Navigation (< >) + Month Label + Today button */}
        {viewMode === 'activities' ? (
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMonthChange(subMonths(currentMonth, 1))}
                title="Previous Month"
                className="size-7 p-0 rounded-lg shrink-0"
              >
                <ChevronLeft size={15} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMonthChange(addMonths(currentMonth, 1))}
                title="Next Month"
                className="size-7 p-0 rounded-lg shrink-0"
              >
                <ChevronRight size={15} />
              </Button>
            </div>

            <span className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate min-w-0">
              {format(currentMonth, 'MMMM yyyy')}
            </span>

            <Button
              variant={isCurrentMonth ? "outline" : "secondary"}
              size="sm"
              onClick={() => onMonthChange(new Date(), true)}
              title="Jump to today"
              className="h-7 px-2 text-xs font-semibold rounded-md shadow-2xs shrink-0"
            >
              Today
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate min-w-0">
              Locally Stored Rosters
            </span>
          </div>
        )}

        {/* Right Side: On Mobile -> Filter Trigger + 3-Dot Menu */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mobile Filter Button (only shown in mobile activities view) */}
          {viewMode === 'activities' && (
            <div className="sm:hidden">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 gap-1 text-xs font-semibold rounded-md bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 shadow-2xs"
                  >
                    <span>{filter === 'all' ? 'All' : TYPE_LABELS[filter]}</span>
                    <Badge
                      variant="secondary"
                      className="h-4 px-1 text-[0.625rem] font-bold"
                    >
                      {counts[filter]}
                    </Badge>
                    <ChevronDown size={11} className="text-slate-400" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="select-content no-print animate-fade-in"
                    align="end"
                    sideOffset={6}
                    style={{
                      minWidth: 165,
                      background: 'white',
                      border: '1px solid var(--slate-4)',
                      borderRadius: 8,
                      padding: 4,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                      zIndex: 9999,
                    }}
                  >
                    {(['all', 'exercise', 'event', 'incident'] as FilterType[]).map(type => {
                      const isSelected = filter === type;
                      return (
                        <DropdownMenu.Item
                          key={type}
                          className="select-item"
                          onSelect={() => onFilterChange(type)}
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
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{type === 'all' ? 'All Activities' : `${TYPE_LABELS[type]}s`}</span>
                            <Badge
                              variant="outline"
                              className={`h-4 px-1.5 text-[0.625rem] font-bold border ${TYPE_COLOR_STYLES[type] || TYPE_COLOR_STYLES.all}`}
                            >
                              {counts[type]}
                            </Badge>
                          </div>
                          {isSelected && <Check size={14} className="text-navy-9 ml-2" />}
                        </DropdownMenu.Item>
                      );
                    })}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          )}

          {/* Mobile 3-Dot More Menu (View Mode Switcher + Actions) */}
          <div className="sm:hidden">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  title="More options"
                  className="size-7 p-0 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  <MoreVertical size={16} />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="select-content no-print animate-fade-in"
                  align="end"
                  sideOffset={6}
                  style={{
                    minWidth: 180,
                    background: 'white',
                    border: '1px solid var(--slate-4)',
                    borderRadius: 8,
                    padding: 4,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    zIndex: 9999,
                  }}
                >
                  {contextId && (
                    <>
                      <div className="px-2 py-1.5 text-[0.6875rem] font-bold uppercase tracking-wider text-slate-400">
                        View Mode
                      </div>
                      <DropdownMenu.Item
                        className="select-item"
                        onSelect={() => onViewModeChange('activities')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 8px',
                          borderRadius: 6,
                          fontSize: '0.8125rem',
                          fontWeight: viewMode === 'activities' ? 600 : 500,
                          color: viewMode === 'activities' ? 'var(--navy-9)' : 'var(--slate-12)',
                          background: viewMode === 'activities' ? 'var(--navy-1)' : 'transparent',
                          cursor: 'pointer',
                          outline: 'none',
                        }}
                      >
                        <span>D4H Activities</span>
                        {viewMode === 'activities' && <Check size={14} className="text-navy-9" />}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="select-item"
                        onSelect={() => onViewModeChange('local')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 8px',
                          borderRadius: 6,
                          fontSize: '0.8125rem',
                          fontWeight: viewMode === 'local' ? 600 : 500,
                          color: viewMode === 'local' ? 'var(--navy-9)' : 'var(--slate-12)',
                          background: viewMode === 'local' ? 'var(--navy-1)' : 'transparent',
                          cursor: 'pointer',
                          outline: 'none',
                        }}
                      >
                        <span>Locally Stored</span>
                        {viewMode === 'local' && <Check size={14} className="text-navy-9" />}
                      </DropdownMenu.Item>
                    </>
                  )}

                  {viewMode === 'local' && (
                    <>
                      {contextId && <div style={{ height: 1, background: 'var(--slate-4)', margin: '4px 0' }} />}
                      <DropdownMenu.Item
                        className="select-item"
                        onSelect={onCreateLocalRoster}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '6px 8px',
                          borderRadius: 6,
                          fontSize: '0.8125rem',
                          fontWeight: 600,
                          color: 'var(--navy-9)',
                          cursor: 'pointer',
                          outline: 'none',
                        }}
                      >
                        <Plus size={14} />
                        <span>+ Add Local Roster</span>
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  useDocumentTitle('Dashboard');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const teamTitle = localStorage.getItem('d4h_team_title') || 'Your Team';
  const [localRosters, setLocalRosters] = useState<LocalRoster[]>(() => {
    try {
      const saved = localStorage.getItem('fitnessqual_local_rosters');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [contextId, setContextId] = useState(localStorage.getItem('d4h_context_id'));
  const [userName, setUserName] = useState(() => localStorage.getItem('d4h_member_name') || '');
  const [viewMode, setViewMode] = useState<'activities' | 'local'>(() => {
    if (!contextId) return 'local';
    const saved = localStorage.getItem('fitnessqual_view_mode');
    return (saved === 'activities' || saved === 'local') ? saved : 'activities';
  });
  const [activitiesView, setActivitiesView] = useState<'list' | 'calendar'>('calendar');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const effectiveActivitiesView = isMobile ? 'list' : activitiesView;
  const [currentMonth, setCurrentMonth] = useState<Date>(() => sessionSelectedMonth || new Date());
  const [attendingActivityIds, setAttendingActivityIds] = useState<Set<number>>(new Set());
  const hasAutoScrolledRef = useRef(false);

  const handleMonthChange = (newMonth: Date, scrollToCurrentDate = false) => {
    const isSame = isSameMonth(currentMonth, newMonth);
    sessionSelectedMonth = newMonth;
    setCurrentMonth(newMonth);
    if (!scrollToCurrentDate) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      hasAutoScrolledRef.current = false;
      if (isSame) {
        setTimeout(scrollToTodayOrNearestEvent, 50);
      }
    }
  };

  const loadLocalRosters = () => {
    try {
      const saved = localStorage.getItem('fitnessqual_local_rosters');
      setLocalRosters(saved ? JSON.parse(saved) : []);
    } catch {
      setLocalRosters([]);
    }
  };

  useEffect(() => {
    if (contextId) {
      localStorage.setItem('fitnessqual_view_mode', viewMode);
    }
    if (viewMode === 'local') {
      loadLocalRosters();
    }
  }, [viewMode, contextId]);

  useEffect(() => {
    if (contextId) {
      logCurrentUserInfo();
      getCurrentUserMemberInfo(contextId).then(info => {
        if (info?.name) {
          setUserName(info.name);
        }
      });
    }
  }, [contextId]);

  const handleCreateLocalRoster = () => {
    try {
      const saved = localStorage.getItem('fitnessqual_local_rosters');
      const currentList: LocalRoster[] = saved ? JSON.parse(saved) : [];
      const newId = `local_${Date.now()}`;
      const newRoster: LocalRoster = { id: newId, title: 'New Local Roster', createdAt: new Date().toISOString(), type: 'local' };
      const updated = [newRoster, ...currentList.filter(r => r.id !== newId)];
      setLocalRosters(updated);
      localStorage.setItem('fitnessqual_local_rosters', JSON.stringify(updated));
      navigate(`/exercise/${newId}`, { state: { exercise: newRoster } });
    } catch (e) {
      console.error('Failed to create local roster', e);
    }
  };

  const load = async (quiet = false, targetMonth = currentMonth) => {
    if (!contextId) {
      setIsLoading(false);
      return;
    }
    if (!quiet) setIsLoading(true);
    setError('');
    try {
      const options = getMonthQueryOptions(targetMonth);
      const contextIdNum = parseInt(contextId, 10);
      const data = await getActivities(contextIdNum, options);
      setActivities(data);

      getCurrentUserAttendingActivityIds(contextIdNum, options)
        .then(ids => setAttendingActivityIds(ids))
        .catch(() => { });
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        localStorage.removeItem('d4h_token');
        localStorage.removeItem('d4h_context_id');
        localStorage.removeItem('d4h_member_id');
        localStorage.removeItem('d4h_member_name');
        setContextId(null);
        setViewMode('local');
        setError('D4H session expired or invalid. Switched to offline mode.');
      } else {
        setError(getD4HErrorMessage(err, 'Failed to load activities. Please try again.'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(false, currentMonth); }, [contextId, currentMonth]);

  useEffect(() => {
    const handleWindowFocus = () => {
      if (contextId) {
        load(true, currentMonth);
      }
      loadLocalRosters();
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [contextId, currentMonth]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (contextId) {
        load(true, currentMonth);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [contextId, currentMonth]);

  const viewActivities = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);

    const list = activities.filter(a => {
      const rawStart = new Date(a.startsAt);
      const rawEnd = a.endsAt ? new Date(a.endsAt) : rawStart;
      const start = isNaN(rawStart.getTime()) ? new Date() : rawStart;
      const end = isNaN(rawEnd.getTime()) || rawEnd < start ? start : rawEnd;
      const startDay = startOfDay(start);
      let endDay = startOfDay(end);
      if (
        end.getHours() === 0 &&
        end.getMinutes() === 0 &&
        end.getSeconds() === 0 &&
        !isSameDay(start, end)
      ) {
        endDay = subDays(endDay, 1);
      }
      if (endDay < startDay) {
        endDay = startDay;
      }
      if (effectiveActivitiesView === 'calendar') {
        return startDay <= gridEnd && endDay >= gridStart;
      }
      return startDay <= monthEnd && endDay >= monthStart;
    });

    // Chronological ascending (earliest in month first)
    list.sort((a, b) => {
      const aTime = new Date(a.startsAt).getTime() || 0;
      const bTime = new Date(b.startsAt).getTime() || 0;
      return aTime - bTime;
    });

    return list;
  }, [activities, effectiveActivitiesView, currentMonth]);

  const filtered = useMemo(() => {
    return viewActivities.filter(a => filter === 'all' || a.type === filter);
  }, [viewActivities, filter]);

  const counts = useMemo(() => {
    return {
      all: viewActivities.length,
      exercise: viewActivities.filter(a => a.type === 'exercise').length,
      event: viewActivities.filter(a => a.type === 'event').length,
      incident: viewActivities.filter(a => a.type === 'incident').length,
    };
  }, [viewActivities]);

  const scrollToTodayOrNearestEvent = useCallback(() => {
    const todayStart = startOfDay(new Date());

    if (effectiveActivitiesView === 'list' && filtered.length > 0) {
      // Find first event today or in the future
      const targetActivity = filtered.find(a => {
        const rawEnd = a.endsAt ? new Date(a.endsAt) : new Date(a.startsAt);
        return (isNaN(rawEnd.getTime()) ? new Date() : rawEnd) >= todayStart;
      });

      if (targetActivity) {
        const el = document.getElementById(`activity-card-${targetActivity.id}`);
        if (el) {
          const top = el.getBoundingClientRect().top + window.pageYOffset - 124;
          window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          return;
        }
      }
    } else if (effectiveActivitiesView === 'calendar') {
      const todayEl = document.getElementById('calendar-today-cell') || document.getElementById('calendar-today-week');
      if (todayEl) {
        const top = todayEl.getBoundingClientRect().top + window.pageYOffset - 130;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        return;
      }
    }

    // Fallback: if no specific future event is found or we are at top
    const mainEl = document.querySelector('main');
    if (mainEl) {
      const top = mainEl.getBoundingClientRect().top + window.pageYOffset - 120;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }, [effectiveActivitiesView, filtered]);

  useEffect(() => {
    if (isLoading || hasAutoScrolledRef.current) return;
    if (viewMode === 'activities' && isSameMonth(currentMonth, new Date())) {
      const timer = setTimeout(() => {
        scrollToTodayOrNearestEvent();
        hasAutoScrolledRef.current = true;
      }, 50);
      return () => clearTimeout(timer);
    } else if (!isLoading) {
      hasAutoScrolledRef.current = true;
    }
  }, [isLoading, viewMode, currentMonth, scrollToTodayOrNearestEvent]);

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="app-bg" style={{ minHeight: '100vh' }}>
        {/* ── Header ───────────────────────────────────────── */}
        <header className="app-header">
          <div className="w-full max-w-[1200px] mx-auto px-3 sm:px-6 h-[60px] flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div style={{
                width: 34, height: 34, borderRadius: 9,
                background: 'linear-gradient(145deg, #0d2d66, #061B44)',
                border: '1px solid rgba(220,195,148,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(6,27,68,0.35)',
                flexShrink: 0,
              }}>
                <ActivityIcon size={16} color="white" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'white', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
                  Roster
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 sm:px-3 bg-white/10 hover:bg-white/20 text-white/90 hover:text-white border border-white/15 font-semibold text-xs rounded-md shrink-0"
                  >
                    <span className="truncate">{contextId ? 'D4H' : 'D4H disconnected'}</span>
                    <ChevronDown size={14} className="opacity-75 shrink-0" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="select-content"
                    align="end"
                    sideOffset={6}
                    style={{ padding: 4, minWidth: 220, zIndex: 100 }}
                  >
                    {contextId && (
                      <>
                        <DropdownMenu.Item
                          onSelect={() => window.open('https://team-manager.us.d4h.com/', '_blank')}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            padding: '8px 12px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            outline: 'none',
                          }}
                          className="select-item"
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--slate-10)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Organization
                            </div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--slate-12)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {teamTitle}
                            </div>
                          </div>
                          <ExternalLink size={14} style={{ flexShrink: 0, opacity: 0.65 }} />
                        </DropdownMenu.Item>

                        <DropdownMenu.Item
                          onSelect={() => window.open('https://myaccount.us.d4h.com/', '_blank')}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            padding: '8px 12px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            outline: 'none',
                          }}
                          className="select-item"
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--slate-10)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Logged in
                            </div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--slate-12)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {userName || 'Team Member'}
                            </div>
                          </div>
                          <ExternalLink size={14} style={{ flexShrink: 0, opacity: 0.65 }} />
                        </DropdownMenu.Item>

                        <DropdownMenu.Separator style={{ height: 1, backgroundColor: 'var(--slate-5)', margin: '4px 0' }} />
                      </>
                    )}

                    <DropdownMenu.Item
                      onSelect={() => {
                        if (contextId) {
                          ['d4h_token', 'd4h_context_id', 'd4h_team_title', 'd4h_member_id', 'd4h_member_name', 'd4h_team_subdomain'].forEach(k => localStorage.removeItem(k));
                          localStorage.setItem('d4h_skip_login', 'true');
                          setContextId(null);
                          setUserName('');
                          setViewMode('local');
                        } else {
                          navigate('/connect-d4h');
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        outline: 'none',
                        fontSize: '0.875rem',
                        color: contextId ? 'var(--red-11)' : 'var(--slate-12)',
                      }}
                      className="select-item"
                    >
                      {contextId ? <LogOut size={14} /> : <LogIn size={14} />}
                      {contextId ? 'Disconnect D4H' : 'Connect D4H'}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        </header>

        {/* ── Main ─────────────────────────────────────────── */}
        <main className="dashboard-main" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 32px' }}>

          {/* Page title + filter bar (Desktop/Tablet Only) */}
          <div className="dashboard-controls hidden sm:flex pt-4" style={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
            <div className="dashboard-switcher-row">
              {contextId ? (
                <Tabs
                  value={viewMode}
                  onValueChange={(v) => { if (v) setViewMode(v as 'activities' | 'local'); }}
                >
                  <TabsList>
                    <TabsTrigger value="activities" className="text-xs px-3 font-semibold">
                      D4H Activities
                    </TabsTrigger>
                    <TabsTrigger value="local" className="text-xs px-3 font-semibold">
                      Locally Stored
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              ) : (
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--slate-12)' }}>
                  Locally Stored
                </h2>
              )}
            </div>

            {viewMode === 'activities' ? (
              <div className="dashboard-filter-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Calendar / List View Switcher (Desktop/Tablet Only) */}
                <Tabs
                  value={activitiesView}
                  onValueChange={(v) => { if (v) setActivitiesView(v as 'list' | 'calendar'); }}
                  className="hidden sm:inline-flex"
                >
                  <TabsList>
                    <TabsTrigger value="calendar" className="gap-1.5 text-xs px-3 font-semibold">
                      <Calendar size={13} />
                      <span>Calendar</span>
                    </TabsTrigger>
                    <TabsTrigger value="list" className="gap-1.5 text-xs px-3 font-semibold">
                      <List size={13} />
                      <span>List</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {/* Filter Tabs (Desktop/Tablet) */}
                <Tabs
                  value={filter}
                  onValueChange={(v) => { if (v) setFilter(v as FilterType); }}
                  className="hidden sm:inline-flex"
                >
                  <TabsList>
                    {(['all', 'exercise', 'event', 'incident'] as FilterType[]).map(type => (
                      <TabsTrigger
                        key={type}
                        value={type}
                        className="gap-1.5 text-xs px-3"
                      >
                        <span>{type === 'all' ? 'All' : `${TYPE_LABELS[type]}s`}</span>
                        <Badge
                          variant="outline"
                          className={`h-4 px-1.5 text-[0.625rem] font-bold ml-0.5 border ${TYPE_COLOR_STYLES[type] || TYPE_COLOR_STYLES.all}`}
                        >
                          {counts[type]}
                        </Badge>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            ) : (
              <Button
                variant="default"
                onClick={handleCreateLocalRoster}
                className="gap-1.5 font-semibold text-xs h-9 px-3 rounded-lg"
              >
                + Add Local Roster
              </Button>
            )}
          </div>

          {/* Sticky Dashboard Action & Month Bar */}
          <DashboardActionBar
            currentMonth={currentMonth}
            onMonthChange={handleMonthChange}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            filter={filter}
            onFilterChange={setFilter}
            counts={counts}
            contextId={contextId}
            onCreateLocalRoster={handleCreateLocalRoster}
          />

          {/* Content */}
          {viewMode === 'activities' ? (
            <>

              {isLoading ? (
                effectiveActivitiesView === 'calendar' ? (
                  <CalendarSkeleton />
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="card" style={{ height: 88, padding: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div className="skeleton" style={{ width: 58, height: 58, borderRadius: 10, flexShrink: 0 }} />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div className="skeleton" style={{ height: 16, width: '45%' }} />
                          <div className="skeleton" style={{ height: 12, width: '65%' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : error ? (
                <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚠️</div>
                  <p style={{ color: 'var(--red-11)', fontWeight: 600, marginBottom: 16 }}>{error}</p>
                  <Button variant="outline" onClick={() => load()}>Try Again</Button>
                </div>
              ) : effectiveActivitiesView === 'calendar' ? (
                <CalendarView
                  activities={filtered}
                  currentMonth={currentMonth}
                  attendingActivityIds={attendingActivityIds}
                  onSelectActivity={(activity) => navigate(`/exercise/${activity.id}`, { state: { exercise: activity } })}
                />
              ) : (
                <>
                  {filtered.length === 0 ? (
                    <div className="card" style={{ padding: 56, textAlign: 'center' }}>
                      <div style={{
                        width: 56, height: 56, borderRadius: 14,
                        background: 'var(--slate-3)', border: '1px solid var(--slate-5)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 14px',
                      }}>
                        <Layers size={26} style={{ color: 'var(--slate-8)' }} />
                      </div>
                      <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--slate-12)', marginBottom: 6 }}>
                        No {filter === 'all' ? 'activities' : `${TYPE_LABELS[filter]}s`.toLowerCase()} in {format(currentMonth, 'MMMM yyyy')}
                      </h3>
                      <p style={{ fontSize: '0.875rem', color: 'var(--slate-10)', marginBottom: !isSameMonth(currentMonth, new Date()) ? 16 : 0 }}>
                        {filter === 'all'
                          ? `There are no activities scheduled for ${format(currentMonth, 'MMMM yyyy')}.`
                          : `No ${TYPE_LABELS[filter]}s found for this month matching the selected filter.`}
                      </p>
                      {!isSameMonth(currentMonth, new Date()) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleMonthChange(new Date(), true)}
                          className="font-semibold text-xs mt-2"
                        >
                          Jump to Current Month ({format(new Date(), 'MMM yyyy')})
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {filtered.map((activity, idx) => (
                        <ActivityCard
                          key={`${activity.type}-${activity.id}`}
                          activity={activity}
                          isAttending={attendingActivityIds.has(activity.id)}
                          idx={idx}
                          onClick={() => navigate(`/exercise/${activity.id}`, { state: { exercise: activity } })}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            localRosters.length === 0 ? (
              <div className="card" style={{ padding: 64, textAlign: 'center' }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 16,
                  background: 'var(--slate-3)', border: '1px solid var(--slate-5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px',
                }}>
                  <Layers size={28} style={{ color: 'var(--slate-8)' }} />
                </div>
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--slate-12)', marginBottom: 6 }}>
                  No local rosters
                </h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--slate-10)', marginBottom: 16 }}>
                  Create a blank roster that is saved completely locally
                </p>
                <Button
                  variant="default"
                  onClick={handleCreateLocalRoster}
                  className="font-semibold text-xs h-9 px-4 gap-1.5 rounded-lg"
                >
                  <Plus size={14} />
                  Create Local Roster
                </Button>
              </div>
            ) : (
              <div className="grid gap-3">
                {localRosters.map((roster, idx) => {
                  let title = roster.title;
                  let displayDate = new Date(roster.createdAt);
                  const saved = localStorage.getItem(`d4h_form_${roster.id}`);
                  if (saved) {
                    try {
                      const parsed = JSON.parse(saved);
                      if (parsed.headers?.exerciseName?.value) title = parsed.headers.exerciseName.value;
                      if (parsed.headers?.date?.value) {
                        const parsedDate = new Date(parsed.headers.date.value);
                        if (!isNaN(parsedDate.getTime())) {
                          displayDate = parsedDate;
                        }
                      }
                    } catch {
                      // ignore malformed stored form
                    }
                  }
                  const isPast = displayDate < startOfDay(new Date());
                  const style = ACTIVITY_DATE_STYLES.local[isPast ? 'past' : 'active'];

                  return (
                    <div
                      key={roster.id}
                      className={cn(
                        "card card-interactive activity-card animate-slide-up group flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-[var(--slate-4)] hover:border-[var(--navy-6)] bg-white hover:bg-[var(--slate-1)] dark:bg-[var(--slate-2)] transition-all duration-150 cursor-pointer shadow-xs min-w-0 max-w-full overflow-hidden",
                        isPast && "opacity-80 saturate-[0.9]"
                      )}
                      style={{ animationDelay: `${idx * 25}ms`, animationFillMode: 'both' }}
                      onClick={() => navigate(`/exercise/${roster.id}`, { state: { exercise: roster } })}
                    >
                      <div
                        className={cn(
                          "activity-card-date size-11 sm:size-14 rounded-xl border flex flex-col items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-105",
                          style.container
                        )}
                      >
                        <div className={cn("text-[0.625rem] sm:text-[0.6875rem] font-bold uppercase tracking-wider leading-none", style.monthText)}>
                          {format(displayDate, 'MMM')}
                        </div>
                        <div className={cn("text-base sm:text-xl font-extrabold leading-none mt-0.5 sm:mt-1", style.dayText)}>
                          {format(displayDate, 'd')}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="font-semibold text-sm sm:text-[0.9375rem] text-slate-900 dark:text-slate-100 truncate mb-1 leading-snug w-full">
                          {title}
                        </div>
                        <div className="flex items-center gap-2.5 sm:gap-4 flex-wrap text-xs sm:text-[0.8125rem] text-slate-500 dark:text-slate-400 min-w-0">
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Clock size={13} className="text-slate-400 shrink-0" />
                            <span className="whitespace-nowrap">{format(displayDate, 'yyyy-MM-dd HH:mm')}</span>
                          </div>
                        </div>
                      </div>

                      <div className="activity-card-chevron size-7 sm:size-8 rounded-lg bg-slate-100 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 flex items-center justify-center shrink-0 text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200 group-hover:border-slate-300 transition-colors">
                        <ChevronRight size={15} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Floating Action Button (FAB) on Mobile for Local Rosters */}
          {viewMode === 'local' && (
            <Button
              variant="default"
              size="icon"
              onClick={handleCreateLocalRoster}
              aria-label="Add local roster"
              className="fixed bottom-6 right-6 z-40 sm:hidden size-14 rounded-full shadow-lg bg-[var(--navy-9)] hover:bg-[var(--navy-10)] text-white flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95"
            >
              <Plus size={26} strokeWidth={2.5} />
            </Button>
          )}
        </main>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Tooltip.Provider>
  );
}

function CalendarSkeleton() {
  return (
    <div className="card" style={{ overflow: 'hidden', border: '1px solid var(--slate-3)' }}>
      {/* Weekday headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        background: 'var(--slate-2)',
        borderBottom: '1px solid var(--slate-3)',
      }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(dayName => (
          <div
            key={dayName}
            style={{
              padding: '10px 8px',
              textAlign: 'center',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--slate-10)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              minWidth: 0,
            }}
          >
            {dayName}
          </div>
        ))}
      </div>

      {/* Grid of skeleton week rows */}
      <div>
        {[...Array(5)].map((_, weekIdx) => (
          <div
            key={weekIdx}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              minHeight: 110,
              borderBottom: weekIdx === 4 ? 'none' : '1px solid var(--slate-3)',
              background: 'white',
            }}
          >
            {[...Array(7)].map((_, dayIdx) => (
              <div
                key={dayIdx}
                style={{
                  borderRight: dayIdx === 6 ? 'none' : '1px solid var(--slate-3)',
                  padding: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div className="skeleton" style={{ width: 22, height: 22, borderRadius: '50%' }} />
                {(weekIdx + dayIdx) % 3 === 0 && (
                  <div className="skeleton" style={{ height: 20, width: '85%', borderRadius: 6, marginTop: 4 }} />
                )}
                {(weekIdx + dayIdx) % 5 === 0 && (
                  <div className="skeleton" style={{ height: 20, width: '65%', borderRadius: 6 }} />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarView({
  activities,
  currentMonth,
  attendingActivityIds,
  onSelectActivity,
}: {
  activities: Activity[];
  currentMonth: Date;
  attendingActivityIds?: Set<number>;
  onSelectActivity: (activity: Activity) => void;
}) {
  const [hoveredActivityId, setHoveredActivityId] = useState<number | null>(null);
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  // Split days into weeks (7 days each)
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  // Precompute normalized dates for each activity
  const normalizedActivities = activities.map(activity => {
    const rawStart = new Date(activity.startsAt);
    const rawEnd = activity.endsAt ? new Date(activity.endsAt) : rawStart;
    const start = isNaN(rawStart.getTime()) ? new Date() : rawStart;
    const end = isNaN(rawEnd.getTime()) || rawEnd < start ? start : rawEnd;

    const startDay = startOfDay(start);
    let endDay = startOfDay(end);

    // If event ends at midnight (00:00:00) and spans across multiple days, treat endDay as previous day
    if (
      end.getHours() === 0 &&
      end.getMinutes() === 0 &&
      end.getSeconds() === 0 &&
      !isSameDay(start, end)
    ) {
      endDay = subDays(endDay, 1);
    }
    if (endDay < startDay) {
      endDay = startDay;
    }

    return {
      activity,
      rawStart: start,
      rawEnd: end,
      startDay,
      endDay,
    };
  });

  return (
    <div className="card" style={{ overflow: 'hidden', border: '1px solid var(--slate-3)' }}>
      {/* Weekday headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        background: 'var(--slate-2)',
        borderBottom: '1px solid var(--slate-3)',
      }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(dayName => (
          <div
            key={dayName}
            style={{
              padding: '10px 8px',
              textAlign: 'center',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--slate-10)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              minWidth: 0,
            }}
          >
            {dayName}
          </div>
        ))}
      </div>

      {/* Grid of week rows with multi-day events */}
      <div>
        {weeks.map((weekDays, weekIdx) => {
          // Find all segments for this week
          const weekStart = weekDays[0];
          const weekEnd = weekDays[6];

          interface LayoutSegment {
            activity: Activity;
            startCol: number;
            span: number;
            isStart: boolean;
            isEnd: boolean;
            slot: number;
          }

          const rawSegments: Omit<LayoutSegment, 'slot'>[] = [];

          normalizedActivities.forEach(({ activity, startDay, endDay }) => {
            // Check if activity overlaps with this week
            if (startDay <= weekEnd && endDay >= weekStart) {
              const segStart = startDay < weekStart ? weekStart : startDay;
              const segEnd = endDay > weekEnd ? weekEnd : endDay;
              const startCol = differenceInCalendarDays(segStart, weekStart);
              const span = differenceInCalendarDays(segEnd, segStart) + 1;
              const isStart = isSameDay(startDay, segStart);
              const isEnd = isSameDay(endDay, segEnd);

              rawSegments.push({
                activity,
                startCol,
                span,
                isStart,
                isEnd,
              });
            }
          });

          // Sort segments: earlier start col first, longer span first
          rawSegments.sort((a, b) => {
            if (a.startCol !== b.startCol) return a.startCol - b.startCol;
            return b.span - a.span;
          });

          // Assign vertical slots (greedy interval coloring)
          const slotOccupied: boolean[][] = [];
          const segments: LayoutSegment[] = [];

          rawSegments.forEach(seg => {
            let slot = 0;
            while (true) {
              if (!slotOccupied[slot]) {
                slotOccupied[slot] = new Array(7).fill(false);
              }
              let collision = false;
              for (let c = seg.startCol; c < seg.startCol + seg.span; c++) {
                if (slotOccupied[slot][c]) {
                  collision = true;
                  break;
                }
              }
              if (!collision) {
                for (let c = seg.startCol; c < seg.startCol + seg.span; c++) {
                  slotOccupied[slot][c] = true;
                }
                segments.push({ ...seg, slot });
                break;
              }
              slot++;
            }
          });

          return (
            <div
              key={weekIdx}
              id={weekDays.some((d) => isToday(d)) ? 'calendar-today-week' : undefined}
              style={{
                position: 'relative',
                minHeight: 110,
                borderBottom: weekIdx === weeks.length - 1 ? 'none' : '1px solid var(--slate-3)',
                background: 'white',
              }}
            >
              {/* Day Cells Background Layer */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                  pointerEvents: 'none',
                }}
              >
                {weekDays.map((day, dayIdx) => {
                  const today = isToday(day);
                  const inMonth = isSameMonth(day, currentMonth);

                  return (
                    <div
                      key={dayIdx}
                      id={today ? 'calendar-today-cell' : undefined}
                      style={{
                        borderRight: dayIdx === 6 ? 'none' : '1px solid var(--slate-3)',
                        background: today ? 'var(--gold-1)' : inMonth ? 'white' : 'var(--slate-1)',
                        padding: '6px 8px',
                        boxSizing: 'border-box',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: today ? 800 : inMonth ? 600 : 400,
                            color: today ? 'white' : inMonth ? 'var(--slate-12)' : 'var(--slate-8)',
                            background: today ? 'var(--navy-9)' : 'transparent',
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {format(day, 'd')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Events Grid Layer */}
              <div
                style={{
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                  gridAutoRows: '24px',
                  rowGap: '4px',
                  paddingTop: '34px',
                  paddingBottom: '8px',
                  paddingLeft: '2px',
                  paddingRight: '2px',
                  zIndex: 1,
                }}
              >
                {segments.map(segment => {
                  const { activity, startCol, span, isStart, isEnd, slot } = segment;
                  const title = activity.referenceDescription || activity.description || `Unnamed ${activity.type}`;
                  const isAttending = attendingActivityIds?.has(activity.id) ?? false;
                  const isPast = (activity.endsAt ? new Date(activity.endsAt) : new Date(activity.startsAt)) < new Date();
                  const isCancelled = /cancelled/i.test(title) || /cancelled/i.test(activity.referenceDescription || '') || /cancelled/i.test(activity.description || '');

                  return (
                    <ActivityPopover
                      key={`${activity.type}-${activity.id}-${startCol}`}
                      activity={activity}
                      isAttending={isAttending}
                      onOpenRoster={onSelectActivity}
                    >
                      <div
                        onClick={() => onSelectActivity(activity)}
                        onMouseEnter={() => setHoveredActivityId(activity.id)}
                        onMouseLeave={() => setHoveredActivityId(null)}
                        className={`calendar-event-pill calendar-event-pill-${activity.type} ${hoveredActivityId === activity.id ? 'is-hovered' : ''} ${isCancelled ? 'is-cancelled' : ''} ${isPast ? 'is-past' : ''}`}
                        style={{
                          gridColumn: `${startCol + 1} / span ${span}`,
                          gridRow: slot + 1,
                          margin: '0 2px',
                          padding: '0 8px',
                          height: 24,
                          borderRadius: isStart && isEnd ? 6 : isStart ? '6px 0 0 6px' : isEnd ? '0 6px 6px 0' : 0,
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          lineHeight: 1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontWeight: 500,
                          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                        }}
                      >
                        {!isStart && (
                          <span style={{ fontSize: '0.75rem', opacity: 0.7, flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>
                            ↳
                          </span>
                        )}

                        {isAttending && (
                          <span
                            title={isPast ? 'Attended' : 'Attending'}
                            style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}
                          >
                            <UserCheck
                              size={12}
                              strokeWidth={2.5}
                              style={{
                                opacity: 0.9,
                              }}
                            />
                          </span>
                        )}

                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: 600,
                            textDecoration: isCancelled ? 'line-through' : undefined,
                          }}
                        >
                          {title}
                        </span>
                      </div>
                    </ActivityPopover>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityCard({
  activity,
  isAttending,
  idx,
  onClick,
}: {
  activity: Activity;
  isAttending: boolean;
  idx: number;
  onClick: () => void;
}) {
  const rawStart = new Date(activity.startsAt);
  const rawEnd = activity.endsAt ? new Date(activity.endsAt) : rawStart;
  const startDate = isNaN(rawStart.getTime()) ? new Date() : rawStart;
  const endDate = isNaN(rawEnd.getTime()) ? startDate : rawEnd;

  const now = new Date();
  const todayStart = startOfDay(now);
  const isPast = endDate < todayStart;

  const location = formatActivityLocation(activity) || null;
  const title = activity.referenceDescription || activity.description || `Unnamed ${activity.type}`;
  const isCancelled = /cancelled/i.test(title) || /cancelled/i.test(activity.referenceDescription || '') || /cancelled/i.test(activity.description || '');

  const activityTypeKey = (activity.type as ActivityCardType) in ACTIVITY_DATE_STYLES
    ? (activity.type as ActivityCardType)
    : 'exercise';
  const style = ACTIVITY_DATE_STYLES[activityTypeKey][isPast ? 'past' : 'active'];

  return (
    <div
      id={`activity-card-${activity.id}`}
      className={cn(
        "card card-interactive activity-card animate-slide-up group flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-[var(--slate-4)] hover:border-[var(--navy-6)] bg-white hover:bg-[var(--slate-1)] dark:bg-[var(--slate-2)] transition-all duration-150 cursor-pointer shadow-xs min-w-0 max-w-full overflow-hidden",
        isPast && "opacity-80 saturate-[0.9]"
      )}
      style={{
        animationDelay: `${idx * 25}ms`,
        animationFillMode: 'both',
      }}
      onClick={onClick}
    >
      {/* Date block */}
      <div
        className={cn(
          "activity-card-date size-11 sm:size-14 rounded-xl flex flex-col items-center justify-center shrink-0 border transition-transform duration-150 group-hover:scale-105",
          style.container
        )}
      >
        <div
          className={cn(
            "text-[0.625rem] sm:text-[0.6875rem] font-bold uppercase tracking-wider leading-none",
            style.monthText
          )}
        >
          {format(startDate, 'MMM')}
        </div>
        <div
          className={cn(
            "text-base sm:text-xl font-extrabold leading-none mt-0.5 sm:mt-1",
            style.dayText
          )}
        >
          {format(startDate, 'd')}
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {/* Title */}
        <div
          className={cn(
            "font-semibold text-sm sm:text-[0.9375rem] text-slate-900 dark:text-slate-100 truncate mb-1 leading-snug w-full",
            isCancelled && "line-through opacity-60"
          )}
          title={title}
        >
          {title}
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-x-2.5 sm:gap-x-4 gap-y-1 flex-wrap text-xs sm:text-[0.8125rem] text-slate-500 dark:text-slate-400 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <Clock size={13} className="text-slate-400 shrink-0" />
            <span className="whitespace-nowrap">
              {isSameDay(startDate, endDate)
                ? `${format(startDate, 'HH:mm')} – ${format(endDate, 'HH:mm')}`
                : `${format(startDate, 'MMM d, HH:mm')} – ${format(endDate, 'MMM d, HH:mm')}`}
            </span>
          </div>

          {/* Attendance Badge (if attending) */}
          {isAttending && (
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
              <Badge
                variant="outline"
                className={cn(
                  "h-5 px-1.5 text-[0.6875rem] font-bold border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1 shrink-0",
                  isPast && "opacity-75 saturate-[0.9]"
                )}
              >
                <UserCheck size={11} strokeWidth={2.5} />
                {isPast ? 'Attended' : 'Attending'}
              </Badge>
            </div>
          )}

          {location && (
            <div className="flex items-center gap-1.5 min-w-0 max-w-full sm:max-w-xs">
              <MapPin size={13} className="text-slate-400 shrink-0" />
              <span className="truncate">{location}</span>
            </div>
          )}

          {activity.countAttendance !== undefined && activity.countAttendance > 0 && (
            <div className="flex items-center gap-1.5 shrink-0 text-slate-500 dark:text-slate-400">
              <Users size={13} className="text-slate-400 shrink-0" />
              <span className="whitespace-nowrap">{activity.countAttendance}</span>
            </div>
          )}
        </div>
      </div>

      {/* Chevron */}
      <div className="activity-card-chevron size-7 sm:size-8 rounded-lg bg-slate-100 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 flex items-center justify-center shrink-0 text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200 group-hover:border-slate-300 transition-colors">
        <ChevronRight size={15} />
      </div>
    </div>
  );
}
