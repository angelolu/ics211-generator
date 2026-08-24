import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Tooltip from '@radix-ui/react-tooltip';
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers,
  List,
  LogIn,
  LogOut,
  MapPin,
  UserCheck,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatActivityLocation, getActivities, getCurrentUserAttendingActivityIds, getCurrentUserMemberInfo, getD4HErrorMessage, logCurrentUserInfo } from '../api/d4h';
import type { Activity } from '../api/d4h';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ActivityPopover } from '../components/ActivityPopover';

type FilterType = 'all' | 'exercise' | 'event' | 'incident';

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

export function Dashboard() {
  useDocumentTitle('Dashboard');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const navigate = useNavigate();

  const ITEMS_PER_PAGE = 12;
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
  const effectiveActivitiesView = activitiesView;
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [attendingActivityIds, setAttendingActivityIds] = useState<Set<number>>(new Set());

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

  const load = async (quiet = false, targetView = activitiesView, targetMonth = currentMonth) => {
    if (!contextId) {
      setIsLoading(false);
      return;
    }
    if (!quiet) setIsLoading(true);
    setError('');
    try {
      let options: { startsAfter?: string; startsBefore?: string } | undefined = undefined;

      if (targetView === 'calendar') {
        const gridStart = startOfWeek(startOfMonth(targetMonth));
        const gridEnd = endOfWeek(endOfMonth(targetMonth));
        options = {
          startsAfter: subMonths(gridStart, 1).toISOString(),
          startsBefore: gridEnd.toISOString(),
        };
      }

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

  useEffect(() => { load(false, activitiesView, currentMonth); }, [contextId, activitiesView, currentMonth]);

  useEffect(() => {
    const handleWindowFocus = () => {
      if (contextId) {
        load(true, activitiesView, currentMonth);
      }
      loadLocalRosters();
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [contextId, activitiesView, currentMonth]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (contextId) {
        load(true, activitiesView, currentMonth);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [contextId, activitiesView, currentMonth]);

  const filtered = activities.filter(a => filter === 'all' || a.type === filter);
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const counts = {
    all: activities.length,
    exercise: activities.filter(a => a.type === 'exercise').length,
    event: activities.filter(a => a.type === 'event').length,
    incident: activities.filter(a => a.type === 'incident').length,
  };

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="app-bg" style={{ minHeight: '100vh' }}>
        {/* ── Header ───────────────────────────────────────── */}
        <header className="app-header">
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9,
                background: 'linear-gradient(145deg, #0d2d66, #061B44)',
                border: '1px solid rgba(220,195,148,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(6,27,68,0.35)',
              }}>
                <ActivityIcon size={16} color="white" strokeWidth={2.5} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'white', lineHeight: 1.2 }}>
                  ICS 211
                </div>
                <div style={{ fontSize: '0.7rem', color: 'rgba(220,195,148,0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Roster Generator
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className="btn btn-sm"
                    style={{
                      gap: 6, padding: '6px 12px',
                      background: 'rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.85)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 7,
                    }}
                  >
                    {contextId ? 'D4H' : 'D4H disconnected'}
                    <ChevronDown size={14} />
                  </button>
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
        <main className="dashboard-main" style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px 32px' }}>

          {/* Page title + filter bar */}
          <div className="dashboard-controls" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
            <div className="dashboard-switcher-row">
              {contextId ? (
                <ToggleGroup.Root
                  type="single"
                  value={viewMode}
                  onValueChange={(v) => { if (v) setViewMode(v as 'activities' | 'local'); }}
                  className="toggle-group"
                >
                  <ToggleGroup.Item value="activities" className="toggle-item">
                    D4H Activities
                  </ToggleGroup.Item>
                  <ToggleGroup.Item value="local" className="toggle-item">
                    Locally Stored
                  </ToggleGroup.Item>
                </ToggleGroup.Root>
              ) : (
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--slate-12)' }}>
                  Locally Stored
                </h2>
              )}
            </div>

            {viewMode === 'activities' ? (
              <div className="dashboard-filter-row" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <ToggleGroup.Root
                  type="single"
                  value={activitiesView}
                  onValueChange={(v) => { if (v) setActivitiesView(v as 'list' | 'calendar'); }}
                  className="toggle-group activities-view-toggle"
                >
                  <ToggleGroup.Item value="calendar" className="toggle-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={14} />
                    <span>Calendar</span>
                  </ToggleGroup.Item>
                  <ToggleGroup.Item value="list" className="toggle-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <List size={14} />
                    <span>List</span>
                  </ToggleGroup.Item>
                </ToggleGroup.Root>

                <ToggleGroup.Root
                  type="single"
                  value={filter}
                  onValueChange={(v) => { if (v) { setFilter(v as FilterType); setCurrentPage(1); } }}
                  className="toggle-group"
                >
                  {(['all', 'exercise', 'event', 'incident'] as FilterType[]).map(type => (
                    <ToggleGroup.Item
                      key={type}
                      value={type}
                      className="toggle-item"
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      {type !== 'all' && <div className={`type-dot type-dot-${type}`} />}
                      <span>{type === 'all' ? 'All' : `${TYPE_LABELS[type]}s`}</span>
                      <span style={{
                        background: 'var(--slate-5)', color: 'var(--slate-11)',
                        borderRadius: 100, padding: '1px 7px', fontSize: '0.7rem', fontWeight: 700,
                      }}>
                        {counts[type]}
                      </span>
                    </ToggleGroup.Item>
                  ))}
                </ToggleGroup.Root>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleCreateLocalRoster}
              >
                + Add Local Roster
              </button>
            )}
          </div>

          {/* Content */}
          {viewMode === 'activities' ? (
            isLoading ? (
              effectiveActivitiesView === 'calendar' ? (
                <CalendarSkeleton currentMonth={currentMonth} />
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
                <button className="btn btn-secondary" onClick={() => load()}>Try Again</button>
              </div>
            ) : effectiveActivitiesView === 'calendar' ? (
              <CalendarView
                activities={filtered}
                currentMonth={currentMonth}
                onMonthChange={(newMonth) => { setCurrentMonth(newMonth); setCurrentPage(1); }}
                attendingActivityIds={attendingActivityIds}
                onSelectActivity={(activity) => navigate(`/exercise/${activity.id}`, { state: { exercise: activity } })}
              />
            ) : filtered.length === 0 ? (
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
                  No {filter === 'all' ? 'activities' : `${TYPE_LABELS[filter]}s`.toLowerCase()} in {format(currentMonth, 'MMMM yyyy')}
                </h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--slate-10)' }}>
                  Nothing scheduled for this month. Check back later or navigate to another month.
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gap: 10 }}>
                  {paginated.map((activity, idx) => (
                    <ActivityCard
                      key={`${activity.type}-${activity.id}`}
                      activity={activity}
                      isAttending={attendingActivityIds.has(activity.id)}
                      idx={idx}
                      onClick={() => navigate(`/exercise/${activity.id}`, { state: { exercise: activity } })}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginTop: 24, padding: '14px 20px',
                    background: 'var(--slate-2)', border: '1px solid var(--slate-5)',
                    borderRadius: 10,
                  }}>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--slate-10)' }}>
                      Page {currentPage} of {totalPages} · {filtered.length} results
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={currentPage === 1}
                        onClick={() => { setCurrentPage(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      >
                        Previous
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={currentPage === totalPages}
                        onClick={() => { setCurrentPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )
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
                <p style={{ fontSize: '0.875rem', color: 'var(--slate-10)' }}>
                  Create a blank roster that is saved completely locally
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
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
                    } catch (e) { }
                  }

                  return (
                    <div
                      key={roster.id}
                      className="card card-interactive activity-card animate-slide-up"
                      style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, animationDelay: `${idx * 30}ms`, animationFillMode: 'both' }}
                      onClick={() => navigate(`/exercise/${roster.id}`, { state: { exercise: roster } })}
                    >
                      <div
                        className="activity-card-date"
                        style={{
                          minWidth: 56, height: 56, borderRadius: 12,
                          background: '#F0FDF4', border: '1px solid #BBF7D0',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1 }}>
                          {format(displayDate, 'MMM')}
                        </div>
                        <div style={{ fontSize: '1.375rem', fontWeight: 800, color: '#14532D', lineHeight: 1.1 }}>
                          {format(displayDate, 'd')}
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                          <span className="badge" style={{ background: '#DCFCE7', color: '#166534', border: '1px solid #BBF7D0' }}>Local</span>
                          <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--slate-12)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {title}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8125rem', color: 'var(--slate-10)' }}>
                            <Calendar size={13} />
                            <span>{format(displayDate, 'yyyy-MM-dd HH:mm')}</span>
                          </div>
                        </div>
                      </div>

                      <div
                        className="activity-card-chevron"
                        style={{
                          width: 32, height: 32, borderRadius: 8,
                          background: 'var(--slate-3)', border: '1px solid var(--slate-5)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, color: 'var(--slate-9)',
                          transition: 'all 0.15s',
                        }}
                      >
                        <ChevronRight size={16} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </main>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Tooltip.Provider>
  );
}

function CalendarSkeleton({ currentMonth }: { currentMonth?: Date }) {
  const isCurrentMonth = currentMonth ? isSameMonth(currentMonth, new Date()) : true;
  return (
    <div className="card" style={{ overflow: 'hidden', border: '1px solid var(--slate-3)' }}>
      {/* Unified Month Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          background: 'white',
          borderBottom: '1px solid var(--slate-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled
              style={{ padding: '5px 8px', height: 30, opacity: 0.6 }}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled
              style={{ padding: '5px 8px', height: 30, opacity: 0.6 }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          {currentMonth ? (
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0, paddingLeft: 4, lineHeight: 1, display: 'flex', alignItems: 'center' }}>
              {format(currentMonth, 'MMMM yyyy')}
            </h3>
          ) : (
            <div className="skeleton" style={{ width: 140, height: 20, borderRadius: 4 }} />
          )}
          {!isCurrentMonth && (
            <button
              className="btn btn-secondary btn-sm"
              disabled
              style={{ height: 30, padding: '0 12px', fontSize: '0.8125rem', fontWeight: 600, opacity: 0.6, marginLeft: 6 }}
            >
              Today
            </button>
          )}
        </div>
      </div>

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
  onMonthChange,
  attendingActivityIds,
  onSelectActivity,
}: {
  activities: Activity[];
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
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
    let end = isNaN(rawEnd.getTime()) || rawEnd < start ? start : rawEnd;

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

  const isCurrentMonth = isSameMonth(currentMonth, new Date());

  return (
    <div className="card" style={{ overflow: 'hidden', border: '1px solid var(--slate-3)' }}>
      {/* Unified Month Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          background: 'white',
          borderBottom: '1px solid var(--slate-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onMonthChange(subMonths(currentMonth, 1))}
              title="Previous Month"
              style={{ padding: '5px 8px', height: 30 }}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onMonthChange(addMonths(currentMonth, 1))}
              title="Next Month"
              style={{ padding: '5px 8px', height: 30 }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0, paddingLeft: 4, lineHeight: 1, display: 'flex', alignItems: 'center' }}>
            {format(currentMonth, 'MMMM yyyy')}
          </h3>

          {!isCurrentMonth && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onMonthChange(new Date())}
              style={{
                height: 30,
                padding: '0 12px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--navy-9)',
                marginLeft: 6,
              }}
            >
              Today
            </button>
          )}
        </div>
      </div>

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
                        className={`calendar-event-pill calendar-event-pill-${activity.type} ${hoveredActivityId === activity.id ? 'is-hovered' : ''}`}
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

                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
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
  isAttending?: boolean;
  idx: number;
  onClick: () => void;
}) {
  const startDate = new Date(activity.startsAt);
  const endDate = new Date(activity.endsAt);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const isPast = startDate < todayStart;

  const badgeClass = `badge badge-${activity.type}`;
  const dotClass = `type-dot type-dot-${activity.type}`;

  const location = formatActivityLocation(activity) || null;

  return (
    <div
      className="card card-interactive activity-card animate-slide-up"
      style={{
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        animationDelay: `${idx * 30}ms`,
        animationFillMode: 'both',
        opacity: isPast ? 0.75 : 1,
        filter: isPast ? 'grayscale(0.6)' : 'none',
      }}
      onClick={onClick}
    >
      {/* Date block */}
      <div
        className="activity-card-date"
        style={{
          minWidth: 56,
          height: 56,
          borderRadius: 12,
          background: isPast ? 'var(--slate-3)' : '#EEF2FF',
          border: isPast ? '1px solid var(--slate-5)' : '1px solid #C7D2FE',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: '0.6875rem',
            fontWeight: 700,
            color: isPast ? 'var(--slate-10)' : '#1a4480',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            lineHeight: 1,
          }}
        >
          {format(startDate, 'MMM')}
        </div>
        <div
          style={{
            fontSize: '1.375rem',
            fontWeight: 800,
            color: isPast ? 'var(--slate-11)' : '#061B44',
            lineHeight: 1.1,
          }}
        >
          {format(startDate, 'd')}
        </div>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
          {!isPast && <div className={dotClass} />}
          <span className={badgeClass} style={isPast ? { opacity: 0.8 } : {}}>{TYPE_LABELS[activity.type]}</span>
          {isPast && (
            <span
              style={{
                background: 'var(--slate-4)',
                color: 'var(--slate-11)',
                fontSize: '0.65rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}
            >
              Past
            </span>
          )}
          {isAttending && (
            <span
              style={{
                height: 20,
                padding: '0 6px',
                borderRadius: 4,
                fontSize: '0.6875rem',
                fontWeight: 700,
                color: 'var(--navy-9)',
                background: 'var(--navy-1)',
                border: '1px solid var(--navy-3)',
                letterSpacing: '0.04em',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <UserCheck size={11} strokeWidth={2.5} style={{ color: 'var(--navy-8)' }} />
              {isPast ? 'Attended' : 'Attending'}
            </span>
          )}
          <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--slate-12)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activity.referenceDescription || activity.description || `Unnamed ${activity.type}`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8125rem', color: 'var(--slate-10)' }}>
            <Calendar size={13} />
            <span>{format(startDate, 'HHmm')} – {format(endDate, 'HHmm')}</span>
          </div>
          {location && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8125rem', color: 'var(--slate-10)', overflow: 'hidden' }}>
              <MapPin size={13} style={{ flexShrink: 0 }} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{location}</span>
            </div>
          )}
          {activity.countAttendance !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} className="badge badge-success">
              <Users size={10} />
              {activity.countAttendance} attending
            </div>
          )}
        </div>
      </div>

      {/* Chevron */}
      <div
        className="activity-card-chevron"
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'var(--slate-3)',
          border: '1px solid var(--slate-5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: 'var(--slate-9)',
          transition: 'all 0.15s',
        }}
      >
        <ChevronRight size={16} />
      </div>
    </div>
  );
}
