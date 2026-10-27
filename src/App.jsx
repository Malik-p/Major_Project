import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, Ban, Check, ChevronDown, CircleDot, CircleHelp, Code2,
  Command, FileCode2, FlaskConical, FolderKanban, GitBranch, GitCommitHorizontal, GitPullRequest, History,
  LayoutDashboard, LoaderCircle, LogOut, Menu, Pencil, Plus, RefreshCw, RotateCcw, Search, Settings, ShieldAlert,
  ShieldCheck, Sparkles, Target, TrendingUp, X
} from 'lucide-react';
import { api } from './services/api.js';
import {
  ErrorState, InlineEmpty, PageHeading, PageLoading, PanelHeading, PriorityBadge, ScoreRing, SeverityBadge,
  StackedBar, StatusBadge, TypeBadge, VerificationBadge, fileName, initials, shortSha, timeAgo
} from './components/ui.jsx';
import { ArtifactDrawer, TraceExplorer } from './components/Traceability.jsx';
import { ImpactReport } from './components/ImpactReport.jsx';

const isProjectId = (value) => /^[a-f0-9]{24}$/i.test(value ?? '');

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onUnauthorized = () => { setUser(null); navigate('/login'); };
    window.addEventListener('devintel:unauthorized', onUnauthorized);
    const token = localStorage.getItem('devintel-token');
    if (!token) setChecking(false);
    else api('/auth/me').then(({ user: current }) => setUser(current)).catch(() => setUser(null)).finally(() => setChecking(false));
    return () => window.removeEventListener('devintel:unauthorized', onUnauthorized);
  }, [navigate]);

  const onLogin = (session) => {
    localStorage.setItem('devintel-token', session.token);
    setUser(session.user);
    navigate('/dashboard');
  };
  const signOut = () => {
    localStorage.removeItem('devintel-token');
    setUser(null);
    navigate('/login');
  };
  if (checking) return <div className="screen-loader"><LoaderCircle className="spin" /> Connecting to DevIntel</div>;

  return <Routes>
    <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <AuthPage onLogin={onLogin} />} />
    <Route path="/register" element={user ? <Navigate to="/dashboard" /> : <AuthPage register onLogin={onLogin} />} />
    <Route path="/demo" element={<DemoLaunch user={user} onLogin={onLogin} />} />
    <Route element={user ? <Shell user={user} onSignOut={signOut} /> : <Navigate to="/login" state={{ from: location }} />}>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/projects/:projectId" element={<Dashboard />} />
      <Route path="/projects/:projectId/requirements" element={<Requirements />} />
      <Route path="/projects/:projectId/requirements/:requirementId" element={<RequirementDetail />} />
      <Route path="/projects/:projectId/tasks" element={<Tasks />} />
      <Route path="/projects/:projectId/sprints" element={<Sprints />} />
      <Route path="/projects/:projectId/github" element={<GithubPage />} />
      <Route path="/projects/:projectId/reviews" element={<Reviews />} />
      <Route path="/projects/:projectId/traceability" element={<TraceabilityIndex />} />
      <Route path="/projects/:projectId/impact-analysis" element={<ImpactPage />} />
      <Route path="/projects/:projectId/health" element={<ProjectHealth />} />
      <Route path="/projects/:projectId/assistant" element={<Assistant />} />
      <Route path="/settings" element={<SettingsPage user={user} />} />
    </Route>
    <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
  </Routes>;
}

/** /demo — signs straight into the seeded demo workspace (local presentations). */
function DemoLaunch({ user, onLogin }) {
  const [error, setError] = useState('');
  const started = useRef(false);
  useEffect(() => {
    if (user || started.current) return;
    started.current = true;
    api('/auth/demo', { method: 'POST' }).then(onLogin).catch((issue) => setError(issue.message));
  }, [user, onLogin]);
  if (user) return <Navigate to="/dashboard" replace />;
  return <div className="screen-loader">{error ? <><AlertTriangle /> {error} <Link to="/login" className="text-link">Go to sign in</Link></> : <><LoaderCircle className="spin" /> Opening the demo workspace…</>}</div>;
}

const navigation = [
  { label: 'Overview', items: [
    { label: 'Dashboard', path: 'dashboard', icon: LayoutDashboard }
  ] },
  { label: 'Engineering', items: [
    { label: 'Requirements', path: 'requirements', icon: Target },
    { label: 'Tasks', path: 'tasks', icon: CircleDot },
    { label: 'Traceability', path: 'traceability', icon: GitBranch },
    { label: 'Impact analysis', path: 'impact-analysis', icon: AlertTriangle }
  ] },
  { label: 'Intelligence', items: [
    { label: 'Code review', path: 'reviews', icon: ShieldCheck },
    { label: 'GitHub', path: 'github', icon: GitCommitHorizontal },
    { label: 'Project health', path: 'health', icon: ShieldAlert },
    { label: 'Assistant', path: 'assistant', icon: Sparkles }
  ] }
];

function Shell({ user, onSignOut }) {
  const { projectId } = useParams();
  const [projects, setProjects] = useState([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarError, setSidebarError] = useState('');
  const [system, setSystem] = useState(null);
  const [revalidationCount, setRevalidationCount] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { api('/system').then(setSystem).catch(() => setSystem(null)); }, []);

  useEffect(() => {
    const loadProjects = () => api('/projects').then(({ projects: items }) => {
      setSidebarError('');
      setProjects(items);
      if (location.pathname === '/dashboard') navigate(items[0] ? `/projects/${items[0]._id}` : '/projects', { replace: true });
      else if (projectId && !items.some((item) => item._id === projectId) && items[0]) navigate(`/projects/${items[0]._id}`, { replace: true });
    }).catch((issue) => setSidebarError(issue.message));
    loadProjects();
    window.addEventListener('devintel:projects-changed', loadProjects);
    return () => window.removeEventListener('devintel:projects-changed', loadProjects);
  }, [projectId, location.pathname, navigate]);

  const activeProject = projects.find((item) => item._id === projectId) ?? (projectId ? null : projects[0]) ?? null;

  useEffect(() => {
    if (!activeProject) return undefined;
    const refresh = () => api(`/projects/${activeProject._id}/health`).then((health) => setRevalidationCount(health.revalidation.length)).catch(() => {});
    refresh();
    window.addEventListener('devintel:data-changed', refresh);
    return () => window.removeEventListener('devintel:data-changed', refresh);
  }, [activeProject?._id, location.pathname]);

  const activePath = location.pathname.split('/')[3] ?? (location.pathname.startsWith('/projects/') ? 'dashboard' : '');
  const database = system?.database;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <Link to="/dashboard" className="brand" onClick={() => setMobileOpen(false)}>
        <span className="brand-mark"><Command size={18} /></span>
        <span>dev<span className="brand-light">intel</span><small>ENGINEERING INTELLIGENCE</small></span>
      </Link>
      <div className="workspace-label">PROJECT</div>
      <label className="project-picker">
        <span className="project-avatar">{activeProject?.name?.[0]?.toUpperCase() ?? 'D'}</span>
        <select value={activeProject?._id ?? ''} onChange={(event) => navigate(event.target.value ? `/projects/${event.target.value}` : '/projects')} aria-label="Select project">
          {!projects.length && <option value="">No projects</option>}
          {projects.map((item) => <option key={item._id} value={item._id}>{item.name}{item.isDemo ? ' · DEMO' : ''}</option>)}
        </select><ChevronDown size={14} />
      </label>
      <Link to="/projects" className="manage-projects" onClick={() => setMobileOpen(false)}><FolderKanban size={12} /> Manage projects</Link>
      {sidebarError && <div className="sidebar-error">{sidebarError}</div>}
      {navigation.map((section) => <div className="nav-section" key={section.label}>
        <div className="nav-heading">{section.label}</div>
        {section.items.map(({ label, path, icon: NavIcon }) => {
          const url = activeProject ? (path === 'dashboard' ? `/projects/${activeProject._id}` : `/projects/${activeProject._id}/${path}`) : '/projects';
          const active = activeProject && activePath === path;
          return <Link key={path} to={url} className={`nav-item ${active ? 'active' : ''}`} onClick={() => setMobileOpen(false)}>
            <NavIcon size={17} strokeWidth={active ? 2.2 : 1.8} /><span>{label}</span>
            {path === 'impact-analysis' && revalidationCount > 0 && <span className="nav-count" title="Requirements requiring revalidation">{revalidationCount}</span>}
          </Link>;
        })}
      </div>)}
      <div className="sidebar-bottom">
        <div className="connection"><span className={`connection-dot ${database?.mode === 'local-fallback' ? 'warning' : ''}`} />{database?.mode === 'local-fallback' ? 'Local DB fallback' : database?.mode === 'primary' ? 'MongoDB connected' : 'API connected'}{system?.aiConfigured ? ' · AI on' : ''}</div>
        <Link to="/settings" className={`nav-item ${location.pathname === '/settings' ? 'active' : ''}`}><Settings size={17} /><span>Settings</span></Link>
        <div className="user-card"><div className="user-avatar">{initials(user.name)}</div><div className="user-details"><strong>{user.name}</strong><span>{user.email}</span></div><button className="icon-button" title="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div>
      </div>
    </aside>
    {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
        <div className="breadcrumbs"><span>DevIntel</span><span className="crumb-divider">/</span><strong>{location.pathname === '/settings' ? 'Settings' : location.pathname === '/projects' ? 'Projects' : activeProject?.name ?? 'Projects'}</strong></div>
        <div className="topbar-actions">
          {activeProject?.isDemo && <span className="demo-pill" title="This workspace contains seeded demo data"><span /> DEMO WORKSPACE</span>}
          {activeProject && <button className="search-trigger" onClick={() => navigate(`/projects/${activeProject._id}/assistant`)}><Search size={15} /><span>Ask about this project…</span></button>}
          <div className="top-avatar" title={user.name}>{initials(user.name)}</div>
        </div>
      </header>
      {database?.mode === 'local-fallback' && <div className="database-fallback-banner"><AlertTriangle size={16} /><div><strong>Using local MongoDB fallback</strong><span>Changes are saved on this machine, not to your configured primary database.</span></div></div>}
      <div className="page-content"><Outlet /></div>
    </main>
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════════════════════════ */

function AuthPage({ register = false, onLogin }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { api('/auth/config').then(setConfig).catch(() => setConfig({ demoMode: false })); }, []);
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      onLogin(await api(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) }));
    } catch (issue) { setError(issue.message); } finally { setBusy(false); }
  };
  const launchDemo = async () => {
    setBusy(true); setError('');
    try { onLogin(await api('/auth/demo', { method: 'POST' })); } catch (issue) { setError(issue.message); } finally { setBusy(false); }
  };
  return <div className="auth-screen">
    <div className="auth-decoration"><div className="orb orb-one" /><div className="orb orb-two" /><div className="auth-visual">
      <div className="visual-kicker"><span /> REQUIREMENT-TO-CODE TRACEABILITY</div>
      <h2>Know exactly what<br />breaks when a<br /><em>requirement changes.</em></h2>
      <p>DevIntel links every requirement to its tasks, commits, source files, tests and findings — and analyses the impact of every change.</p>
      <div className="mini-flow"><span>Requirement</span><ArrowRight size={15} /><span>Code</span><ArrowRight size={15} /><span>Tests</span><ArrowRight size={15} /><span>Impact</span></div>
    </div><div className="auth-copyright">DEVINTEL · ENGINEERING INTELLIGENCE</div></div>
    <div className="auth-panel"><div className="auth-form-wrap">
      <Link to="/login" className="brand auth-brand"><span className="brand-mark"><Command size={18} /></span><span>dev<span className="brand-light">intel</span></span></Link>
      {!register && config?.demoMode && <div className="demo-launch-card">
        <div className="eyebrow">EXAMINER DEMO</div>
        <h2>ShopSphere — E-Commerce Platform</h2>
        <p>A fully populated project: 10 requirements, 33 tasks, commits, pull requests, source files, tests and review findings — all linked.</p>
        <button type="button" className="button button-primary demo-launch-button" disabled={busy} onClick={launchDemo}>{busy ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />} Launch Demo Workspace <ArrowRight size={16} /></button>
        <div className="demo-credentials"><span>DEMO ACCOUNT</span><div><small>Email</small><code>{config.demoEmail}</code></div><div><small>Password</small><code>{config.demoPassword}</code></div></div>
      </div>}
      <div className="auth-form-heading"><span className="eyebrow">{register ? 'GET STARTED' : 'OR SIGN IN'}</span><h1>{register ? 'Create your account' : 'Sign in to DevIntel'}</h1></div>
      <form className="form-stack" onSubmit={submit}>
        {register && <label>Full name<input name="name" autoComplete="name" placeholder="Your name" required /></label>}
        <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></label>
        <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} placeholder="••••••••••••" required /></label>
        {error && <div className="form-error"><AlertTriangle size={15} />{error}</div>}
        <button className={`button ${config?.demoMode && !register ? 'button-secondary' : 'button-primary'} auth-submit`} disabled={busy}>{register ? 'Create account' : 'Sign in'}<ArrowRight size={16} /></button>
      </form>
      <div className="auth-switch">{register ? 'Already have an account?' : 'New to DevIntel?'} <button onClick={() => navigate(register ? '/login' : '/register')}>{register ? 'Sign in' : 'Create an account'}</button></div>
    </div></div>
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════════════════════ */

function useDashboard() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!isProjectId(projectId)) { setData(null); setLoading(false); return; }
    try { setData(await api(`/projects/${projectId}/dashboard`)); setError(''); }
    catch (issue) { setError(issue.message); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { setLoading(true); refresh(); }, [refresh]);
  return { data, loading, error, refresh };
}

function Dashboard() {
  const { projectId } = useParams();
  const { data, loading, error, refresh } = useDashboard();
  const navigate = useNavigate();
  if (!projectId) return <PageLoading />;
  if (loading) return <PageLoading />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return <EmptyProjects />;
  const { project, metrics, health, requirements, tasks, activity } = data;
  const { requirements: rq, tasks: tk, code, quality, revalidation } = metrics;
  const base = `/projects/${project._id}`;

  return <div className="page-enter">
    <PageHeading eyebrow="ENGINEERING INTELLIGENCE" title={project.name} subtitle={project.description}>
      <button className="button button-secondary" onClick={() => navigate(`${base}/assistant`)}><Sparkles size={15} /> Ask the assistant</button>
      <button className="button button-primary" onClick={() => navigate(`${base}/requirements`)}><Target size={15} /> Requirements</button>
    </PageHeading>

    {revalidation.length > 0 && <div className="revalidation-alert">
      <RefreshCw size={18} />
      <div><strong>{revalidation.length} requirement{revalidation.length > 1 ? 's' : ''} require{revalidation.length > 1 ? '' : 's'} revalidation</strong>
        {revalidation.map((item) => <span key={item._id}><b>{item.key}</b> {item.title} — changed to revision {item.revision} {timeAgo(item.changedAt)}; {item.analyzed ? `${item.affected} affected artifacts, ${item.gaps} gaps found` : 'impact not analyzed yet'}</span>)}
      </div>
      {revalidation[0].analyzed
        ? <Link className="button button-primary" to={`${base}/impact-analysis?report=${revalidation[0].reportId}`}>View impact report <ArrowRight size={14} /></Link>
        : <Link className="button button-primary" to={`${base}/requirements/${revalidation[0]._id}`}>Analyze change impact <ArrowRight size={14} /></Link>}
    </div>}

    <section className="panel health-hero">
      <Link to={`${base}/health`} className="health-hero-score"><ScoreRing score={health.score} label="Health" /><div><div className="eyebrow">PROJECT HEALTH</div><strong className={`grade ${health.grade.toLowerCase()}`}>{health.grade.replaceAll('_', ' ')}</strong><span>{health.summary.total} open risks · {health.summary.critical} critical · {health.summary.high} high</span></div></Link>
      <div className="health-hero-stats">
        <HeroStat label="Requirement coverage" value={`${rq.requirementCoverage}%`} detail="implemented or verified" />
        <HeroStat label="Traceability coverage" value={`${rq.traceabilityCoverage}%`} detail={`${rq.fullyTraced}/${rq.total} with task → commit → file → test`} />
        <HeroStat label="Open risks" value={health.summary.total} detail={`${health.summary.critical + health.summary.high} critical or high`} tone={health.summary.critical ? 'alert' : ''} to={`${base}/health`} />
        <HeroStat label="Needs revalidation" value={rq.needsRevalidation} detail={rq.needsRevalidation ? revalidation.map((r) => r.key).join(', ') : 'all requirements validated'} tone={rq.needsRevalidation ? 'warn' : 'ok'} to={`${base}/impact-analysis`} />
      </div>
    </section>

    <div className="metric-groups">
      <MetricGroup icon={Target} title="Requirements" to={`${base}/requirements`} total={rq.total} totalLabel="total"
        stats={[['Implemented', rq.implemented], ['Verified', rq.verified], ['Changed', rq.changed, rq.changed ? 'warn' : ''], ['At risk', rq.atRisk, rq.atRisk ? 'alert' : '']]}
        bar={[{ label: 'Verified', value: rq.verified, tone: 'green' }, { label: 'Implemented', value: rq.implemented, tone: 'teal' }, { label: 'In progress', value: rq.inProgress, tone: 'violet' }, { label: 'Changed', value: rq.changed, tone: 'amber' }, { label: 'At risk', value: rq.atRisk, tone: 'red' }, { label: 'Not started', value: rq.draft, tone: 'grey' }]} />
      <MetricGroup icon={CircleDot} title="Engineering" to={`${base}/tasks`} total={tk.total} totalLabel="tasks"
        stats={[['Completed', tk.done], ['In progress', tk.inProgress + tk.review], ['To do', tk.todo], ['Blocked', tk.blocked, tk.blocked ? 'alert' : '']]}
        bar={[{ label: 'Done', value: tk.done, tone: 'green' }, { label: 'Review', value: tk.review, tone: 'amber' }, { label: 'In progress', value: tk.inProgress, tone: 'violet' }, { label: 'To do', value: tk.todo, tone: 'grey' }, { label: 'Blocked', value: tk.blocked, tone: 'red' }]} />
      <MetricGroup icon={GitCommitHorizontal} title="Code intelligence" to={`${base}/github`} total={code.commits} totalLabel="commits"
        stats={[['Pull requests', `${code.pullRequests}`, '', `${code.mergedPullRequests} merged · ${code.openPullRequests} open`], ['Files analyzed', `${code.filesAnalyzed}/${code.files}`], ['Review findings', code.findings, '', `${code.openFindings} open`], ['Resolved', code.resolvedFindings]]} />
      <MetricGroup icon={ShieldCheck} title="Quality" to={`${base}/reviews`} total={`${quality.testsLinked}`} totalLabel="tests linked to requirements"
        stats={[['Critical findings', quality.critical, quality.critical ? 'alert' : ''], ['High findings', quality.high, quality.high ? 'warn' : ''], ['Medium findings', quality.medium], ['Tests passing', `${quality.passingTests}/${quality.tests}`, quality.failingTests ? 'alert' : 'ok']]} />
    </div>

    <div className="dashboard-grid two">
      <section className="panel">
        <PanelHeading title="Requirement status" eyebrow="DELIVERY" link="All requirements" to={`${base}/requirements`} />
        <div className="req-status-list">{requirements.map((item) => <Link to={`${base}/requirements/${item._id}`} className="req-status-row" key={item._id}>
          <span className="table-key">{item.key}</span><strong>{item.title}</strong><span className="muted">{item.owner}</span><StatusBadge status={item.status} />
        </Link>)}</div>
      </section>
      <section className="panel">
        <PanelHeading title="Recent activity" eyebrow="TEAM TIMELINE" />
        {activity.length ? <ol className="activity-timeline">{activity.map((event) => <li key={event._id} className={`type-${event.type.toLowerCase()}`}>
          <span className="timeline-dot"><ActivityIcon type={event.type} /></span>
          <div><p>{event.message}</p><small>{event.actor} · {timeAgo(event.at)}</small></div>
        </li>)}</ol> : <InlineEmpty text="No activity recorded yet." />}
      </section>
    </div>

    <div className="dashboard-grid two">
      <section className="panel">
        <PanelHeading title="Top risks" eyebrow="RISK ENGINE" link="Project health" to={`${base}/health`} />
        {health.topRisks.length ? <div className="top-risks">{health.topRisks.map((risk) => <div key={risk.id} className="top-risk"><SeverityBadge severity={risk.severity} /><div><strong>{risk.title}</strong><span>{risk.recommendation}</span></div></div>)}</div> : <InlineEmpty text="No risks detected." />}
      </section>
      <section className="panel">
        <PanelHeading title="Work in progress" eyebrow="TASKS" link="Task board" to={`${base}/tasks`} />
        {tasks.filter((task) => ['IN_PROGRESS', 'REVIEW', 'BLOCKED'].includes(task.status)).map((task) => <div className="task-preview" key={task._id}><span className={`task-status-dot ${task.status.toLowerCase()}`} /><div><strong>{task.title}</strong><span>{task.key} · {task.requirement?.key} · {task.assignee}</span></div><StatusBadge status={task.status} /></div>)}
      </section>
    </div>
  </div>;
}

function HeroStat({ label, value, detail, tone = '', to }) {
  const content = <><small>{label}</small><strong className={tone}>{value}</strong><span>{detail}</span></>;
  return to ? <Link to={to} className="hero-stat">{content}</Link> : <div className="hero-stat">{content}</div>;
}

function MetricGroup({ icon: Icon, title, to, total, totalLabel, stats, bar }) {
  return <Link to={to} className="panel metric-group">
    <div className="metric-group-head"><span><Icon size={15} /></span><strong>{title}</strong><ArrowUpRight size={14} /></div>
    <div className="metric-group-total"><b>{total}</b><small>{totalLabel}</small></div>
    <div className="metric-group-stats">{stats.map(([label, value, tone = '', detail]) => <div key={label}><span>{label}</span><b className={tone}>{value}</b>{detail && <small>{detail}</small>}</div>)}</div>
    {bar && <StackedBar segments={bar} />}
  </Link>;
}

function ActivityIcon({ type }) {
  const Icon = { REQUIREMENT: Target, TASK: CircleDot, COMMIT: GitCommitHorizontal, PULL_REQUEST: GitPullRequest, REVIEW: ShieldCheck, IMPACT: RefreshCw, TEST: FlaskConical, SPRINT: Activity, PROJECT: FolderKanban }[type] ?? Activity;
  return <Icon size={12} />;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROJECTS
   ═══════════════════════════════════════════════════════════════════════════ */

function Projects() {
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const navigate = useNavigate();
  const refresh = () => api('/projects').then(({ projects: items }) => setProjects(items)).catch((issue) => setError(issue.message)).finally(() => setBusy(false));
  useEffect(() => { refresh(); }, []);
  const save = async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const { project } = await api(editing ? `/projects/${editing._id}` : '/projects', { method: editing ? 'PATCH' : 'POST', body: form });
      setEditing(null); setShowForm(false);
      window.dispatchEvent(new Event('devintel:projects-changed'));
      if (!editing) navigate(`/projects/${project._id}`);
      else setProjects((items) => items.map((item) => item._id === project._id ? project : item));
    } catch (issue) { setError(issue.message); }
  };
  const remove = async (project) => {
    if (!window.confirm(`Delete "${project.name}" and all of its project data? This cannot be undone.`)) return;
    try { await api(`/projects/${project._id}`, { method: 'DELETE' }); setProjects((items) => items.filter((item) => item._id !== project._id)); window.dispatchEvent(new Event('devintel:projects-changed')); } catch (issue) { setError(issue.message); }
  };
  return <div className="page-enter">
    <PageHeading eyebrow="YOUR WORKSPACE" title="Projects" subtitle="Keep product intent, implementation and validation connected."><button className="button button-primary" onClick={() => { setEditing(null); setShowForm(!showForm); }}><Plus size={16} /> New project</button></PageHeading>
    {error && <div className="form-error"><AlertTriangle size={15} />{error}</div>}
    {showForm && <form key={editing?._id ?? 'new-project'} className="panel project-form" onSubmit={save}><div className="form-row"><label>Project name<input name="name" required defaultValue={editing?.name ?? ''} placeholder="e.g. Customer portal" /></label><label>Repository URL <span className="optional">(optional)</span><input name="repositoryUrl" defaultValue={editing?.repository?.url ?? ''} placeholder="https://github.com/org/repo" /></label></div><label>Description<textarea name="description" rows="2" defaultValue={editing?.description ?? ''} placeholder="What is this project about?" /></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button><button className="button button-primary">{editing ? <Check size={15} /> : <Plus size={15} />}{editing ? ' Save project' : ' Create project'}</button></div></form>}
    {busy ? <PageLoading /> : projects.length ? <div className="projects-grid">{projects.map((project) => <article className="project-card" key={project._id}><Link to={`/projects/${project._id}`} className="project-card-main"><div className="project-card-top"><span className="project-card-mark"><Code2 size={18} /></span><span className={`project-status ${project.status.toLowerCase()}`}><i />{project.status}</span></div><h2>{project.name}{project.isDemo && <span className="mini-demo">DEMO</span>}</h2><p>{project.description || 'No description added yet.'}</p><div className="project-card-foot"><span><GitBranch size={14} />{project.repository?.owner && project.repository?.name ? `${project.repository.owner}/${project.repository.name}` : 'Repository not connected'}</span><ArrowUpRight size={16} /></div></Link><div className="project-card-actions"><button className="button button-secondary" onClick={() => { setEditing(project); setShowForm(true); }}><Pencil size={13} /> Edit</button>{!project.isDemo && <button className="button button-danger" onClick={() => remove(project)}><X size={13} /> Delete</button>}</div></article>)}</div> : <EmptyProjects onCreate={() => setShowForm(true)} />}
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   REQUIREMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

function Requirements() {
  const { projectId } = useParams();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const navigate = useNavigate();
  const refresh = useCallback(() => api(`/projects/${projectId}/requirements`).then(({ requirements }) => { setItems(requirements); setError(''); }).catch((issue) => setError(issue.message)), [projectId]);
  useEffect(() => { refresh(); }, [refresh]);
  const create = async (event) => {
    event.preventDefault(); setSaving(true);
    const form = Object.fromEntries(new FormData(event.currentTarget));
    form.acceptanceCriteria = String(form.acceptanceCriteria ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    try { const { requirement } = await api(`/projects/${projectId}/requirements`, { method: 'POST', body: form }); setShowForm(false); setNotice(`${requirement.key} created.`); refresh(); }
    catch (issue) { setNotice(issue.message); } finally { setSaving(false); }
  };
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!items) return <PageLoading />;
  const filtered = items.filter((item) => {
    if (filter !== 'ALL' && item.status !== filter) return false;
    const term = search.trim().toLowerCase();
    return !term || [item.key, item.title, item.description, item.owner].some((value) => (value || '').toLowerCase().includes(term));
  });
  const filterOptions = ['ALL', ...['CHANGED', 'AT_RISK', 'IN_PROGRESS', 'IMPLEMENTED', 'VERIFIED', 'READY'].filter((status) => items.some((item) => item.status === status))];
  return <div className="page-enter"><PageHeading eyebrow="PRODUCT INTENT" title="Requirements" subtitle="Every requirement is linked to the tasks, code, tests and findings that implement and prove it."><button className="button button-primary" onClick={() => setShowForm(!showForm)}><Plus size={16} /> New requirement</button></PageHeading>
    {notice && <div className="notice-banner"><Check size={15} />{notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}
    {showForm && <form className="panel requirement-form" onSubmit={create}><div className="form-row"><label>Title<input name="title" required placeholder="A clear, testable outcome" /></label><label>Type<select name="type"><option>FUNCTIONAL</option><option>NON_FUNCTIONAL</option><option>SECURITY</option><option>PERFORMANCE</option><option>USABILITY</option></select></label><label>Priority<select name="priority"><option>MEDIUM</option><option>LOW</option><option>HIGH</option><option>CRITICAL</option></select></label></div><label>Description<textarea name="description" rows="3" placeholder="Describe the user need and expected behaviour..." /></label><label>Acceptance criteria <span className="optional">(one per line)</span><textarea name="acceptanceCriteria" rows="3" /></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancel</button><button disabled={saving} className="button button-primary"><Plus size={15} /> Create requirement</button></div></form>}
    <div className="search-bar"><Search size={16} /><input placeholder="Search by key, title, description or owner..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
    <div className="list-toolbar"><div className="filter-tabs">{filterOptions.map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{status === 'ALL' ? `All ${items.length}` : `${status.replace(/_/g, ' ')} ${items.filter((i) => i.status === status).length}`}</button>)}</div><span className="muted">{filtered.length} results</span></div>
    <div className="panel table-panel">{filtered.length ? <div className="table-scroll"><table><thead><tr><th>REQUIREMENT</th><th>TYPE</th><th>PRIORITY</th><th>STATUS</th><th>OWNER</th><th>TRACE</th><th>REV</th><th>UPDATED</th><th /></tr></thead><tbody>{filtered.map((item) => <tr className="clickable-row" key={item._id} onClick={() => navigate(`/projects/${projectId}/requirements/${item._id}`)}><td><span className="table-key">{item.key}</span><strong>{item.title}</strong><small className="table-description">{item.description}</small></td><td><TypeBadge type={item.type} /></td><td><PriorityBadge priority={item.priority} /></td><td><StatusBadge status={item.status} /></td><td className="muted">{item.owner || '—'}</td><td><TraceCounts counts={item.traceCounts} /></td><td><span className="revision-tag">v{item.revision}</span></td><td className="muted">{timeAgo(item.updatedAt)}</td><td><ArrowRight size={15} className="muted" /></td></tr>)}</tbody></table></div> : <InlineEmpty text={items.length ? 'No requirements match this filter.' : 'No requirements yet. Add the first product outcome to start building traceability.'} />}</div>
  </div>;
}

function TraceCounts({ counts = {} }) {
  const entries = [['TASK', CircleDot, 'tasks'], ['COMMIT', GitCommitHorizontal, 'commits'], ['SOURCE_FILE', FileCode2, 'files'], ['TEST', FlaskConical, 'tests'], ['FINDING', AlertTriangle, 'findings']];
  return <span className="trace-counts">{entries.map(([type, Icon, label]) => <span key={type} className={counts[type] ? '' : 'zero'} title={`${counts[type] ?? 0} ${label}`}><Icon size={11} />{counts[type] ?? 0}</span>)}</span>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   REQUIREMENT DETAIL
   ═══════════════════════════════════════════════════════════════════════════ */

function RequirementDetail() {
  const { projectId, requirementId } = useParams();
  const [requirement, setRequirement] = useState(null);
  const [changeState, setChangeState] = useState(null);
  const [trace, setTrace] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    try {
      const [detail, graph, history] = await Promise.all([
        api(`/requirements/${requirementId}`),
        api(`/projects/${projectId}/traceability/${requirementId}`),
        api(`/requirements/${requirementId}/history`)
      ]);
      setRequirement(detail.requirement); setChangeState(detail.changeState); setTrace(graph); setVersions(history.versions); setLoadError('');
    } catch (error) { setLoadError(error.message); } finally { setLoading(false); }
  }, [projectId, requirementId]);
  useEffect(() => { refresh(); }, [refresh]);

  const save = async (event) => {
    event.preventDefault(); setBusy('save');
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    payload.acceptanceCriteria = String(payload.acceptanceCriteria ?? '').split('\n').map((item) => item.trim()).filter(Boolean);
    try {
      const result = await api(`/requirements/${requirementId}`, { method: 'PATCH', body: payload });
      setEditing(false);
      setNotice(result.changed
        ? { tone: 'warn', text: `Saved as revision ${result.requirement.revision}. The requirement content changed, so it is now flagged CHANGED and requires revalidation.` }
        : { tone: 'ok', text: 'Requirement updated. No content change was detected, so no new revision was created.' });
      await refresh();
      window.dispatchEvent(new Event('devintel:data-changed'));
    } catch (error) { setNotice({ tone: 'error', text: error.message }); } finally { setBusy(''); }
  };
  const analyzeImpact = async () => {
    setBusy('impact');
    try {
      const { report } = await api(`/requirements/${requirementId}/impact-analysis`, { method: 'POST' });
      window.dispatchEvent(new Event('devintel:data-changed'));
      navigate(`/projects/${projectId}/impact-analysis?report=${report._id}`);
    } catch (error) { setNotice({ tone: 'error', text: error.message }); setBusy(''); }
  };
  const revalidate = async () => {
    if (!window.confirm(`Confirm that ${requirement.key}'s implementation and tests have been updated and re-run?`)) return;
    setBusy('revalidate');
    try { await api(`/requirements/${requirementId}/revalidate`, { method: 'POST' }); setNotice({ tone: 'ok', text: `${requirement.key} revalidated and marked VERIFIED.` }); await refresh(); window.dispatchEvent(new Event('devintel:data-changed')); }
    catch (error) { setNotice({ tone: 'error', text: error.message }); } finally { setBusy(''); }
  };
  const analyzeRequirement = async () => {
    setBusy('ai');
    try { setAiAnalysis(await api(`/requirements/${requirementId}/analyze`, { method: 'POST', body: {} })); }
    catch (error) { setNotice({ tone: 'error', text: error.message }); } finally { setBusy(''); }
  };

  if (loading) return <PageLoading />;
  if (!requirement) return <ErrorState message={loadError || 'Requirement not found'} onRetry={refresh} />;
  const pending = changeState?.pendingAnalysis;
  const openReport = changeState?.openReport;

  return <div className="page-enter">
    <Link className="back-link" to={`/projects/${projectId}/requirements`}>← All requirements</Link>
    <PageHeading eyebrow={`${requirement.key} · REVISION ${requirement.revision} · OWNER ${requirement.owner || 'UNASSIGNED'}`} title={requirement.title} subtitle={requirement.description}>
      <button className="button button-secondary" onClick={analyzeRequirement} disabled={Boolean(busy)}>{busy === 'ai' ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Suggest edge cases</button>
      <button className="button button-primary" onClick={() => setEditing(!editing)}><Pencil size={15} /> {editing ? 'Close editor' : 'Edit requirement'}</button>
    </PageHeading>

    {notice && <div className={`notice-banner tone-${notice.tone}`}>{notice.tone === 'error' ? <AlertTriangle size={15} /> : <Check size={15} />}{notice.text}<button onClick={() => setNotice(null)}><X size={14} /></button></div>}

    {pending && <div className="change-callout">
      <div className="change-callout-icon"><RefreshCw size={20} /></div>
      <div><strong>Requirement changed — revision {versions[0]?.version ?? requirement.revision - 1} → {requirement.revision}</strong><span>Tasks, code and tests linked to {requirement.key} may still implement the previous behaviour. Run the impact engine to find exactly what is affected.</span></div>
      <button className="button button-primary big" onClick={analyzeImpact} disabled={Boolean(busy)}>{busy === 'impact' ? <LoaderCircle size={16} className="spin" /> : <Activity size={16} />} Analyze Change Impact</button>
    </div>}
    {!pending && openReport && <div className="change-callout analyzed">
      <div className="change-callout-icon"><AlertTriangle size={20} /></div>
      <div><strong>{requirement.key} requires revalidation</strong><span>Impact analysis {timeAgo(openReport.createdAt)}: {openReport.affected} affected artifacts and {openReport.gaps} gaps. Update the code and tests, then mark the requirement revalidated.</span></div>
      <Link className="button button-primary" to={`/projects/${projectId}/impact-analysis?report=${openReport._id}`}>View impact report <ArrowRight size={14} /></Link>
      <button className="button button-secondary" onClick={revalidate} disabled={Boolean(busy)}><Check size={14} /> Mark revalidated</button>
    </div>}

    {editing && <section className="panel edit-panel">
      <PanelHeading title="Edit requirement" eyebrow="CHANGE CONTROL" />
      <p className="edit-hint">Changing the title, description or acceptance criteria creates a new revision, snapshots the previous version and flags the requirement for change-impact analysis.</p>
      <form className="form-stack" onSubmit={save}>
        <label>Title<input name="title" defaultValue={requirement.title} required /></label>
        <label>Description<textarea name="description" rows="2" defaultValue={requirement.description} /></label>
        <label>Acceptance criteria <span className="optional">(one per line)</span><textarea name="acceptanceCriteria" rows={Math.max(4, requirement.acceptanceCriteria.length + 1)} defaultValue={requirement.acceptanceCriteria.join('\n')} /></label>
        <div className="form-row"><label>Type<select name="type" defaultValue={requirement.type}>{['FUNCTIONAL', 'NON_FUNCTIONAL', 'SECURITY', 'PERFORMANCE', 'USABILITY'].map((x) => <option key={x}>{x}</option>)}</select></label><label>Priority<select name="priority" defaultValue={requirement.priority}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((x) => <option key={x}>{x}</option>)}</select></label><label>Owner<input name="owner" defaultValue={requirement.owner} /></label></div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(false)}>Cancel</button><button className="button button-primary" disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Save changes</button></div>
      </form>
    </section>}

    {aiAnalysis && <div className="ai-suggestions"><strong><Sparkles size={15} /> {aiAnalysis.mode === 'AI_SUGGESTION' ? 'AI SUGGESTIONS · UNVERIFIED' : 'RULE-BASED SUGGESTIONS · NO AI CONFIGURED'}</strong><div className="ai-analysis-grid">{[['Edge cases', aiAnalysis.edgeCases], ['Validation rules', aiAnalysis.validationRules], ['Suggested tests', aiAnalysis.suggestedTests], ['Potential risks', aiAnalysis.potentialRisks]].filter(([, items]) => items?.length).map(([label, items]) => <div key={label}><b>{label}</b><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>)}</div><button className="icon-button" onClick={() => setAiAnalysis(null)} aria-label="Dismiss"><X size={14} /></button></div>}

    <div className="detail-meta"><TypeBadge type={requirement.type} /><PriorityBadge priority={requirement.priority} /><StatusBadge status={requirement.status} /><span className="revision-tag">Revision {requirement.revision}</span><span className="muted">Updated {timeAgo(requirement.updatedAt)}</span></div>

    {trace && <TraceExplorer key={`${requirement._id}-${requirement.revision}-${trace.reportId ?? 'none'}`} projectId={projectId} trace={trace} />}

    {versions.length > 0 && <section className="panel history-panel">
      <PanelHeading title="Change history" eyebrow="REQUIREMENT VERSIONS" />
      <div className="version-timeline">
        <div className="version-entry current"><div className="version-marker"><Target size={14} /></div><div className="version-content"><div className="version-head"><strong>Revision {requirement.revision} (current)</strong><StatusBadge status={requirement.status} /></div><p className="version-summary">{requirement.description}</p></div></div>
        {versions.map((v) => <div className="version-entry" key={v._id}>
          <div className="version-marker"><History size={14} /></div>
          <div className="version-content">
            <div className="version-head"><strong>Revision {v.version}</strong><StatusBadge status={v.impactStatus === 'PENDING' ? 'IMPACT_PENDING' : v.impactStatus === 'ANALYZED' ? 'IMPACT_ANALYZED' : 'REVALIDATED'} /><span className="muted">superseded {new Date(v.createdAt).toLocaleString()}</span></div>
            <p className="version-summary">{v.description}</p>
            <div className="version-details"><span>Change: {v.changeSummary}</span>{v.acceptanceCriteria.length > 0 && <span>Criteria: {v.acceptanceCriteria.join('; ')}</span>}</div>
          </div>
        </div>)}
      </div>
    </section>}
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRACEABILITY
   ═══════════════════════════════════════════════════════════════════════════ */

function TraceabilityIndex() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [trace, setTrace] = useState(null);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const load = useCallback(() => api(`/projects/${projectId}/traceability`).then(({ rows: items }) => { setRows(items); setError(''); }).catch((issue) => setError(issue.message)), [projectId]);
  useEffect(() => { load(); }, [load]);
  const selectedId = searchParams.get('req') ?? rows?.find((row) => row.requirement.status === 'CHANGED')?.requirement._id ?? rows?.[0]?.requirement._id;
  useEffect(() => {
    if (!selectedId) return;
    setLoadingTrace(true);
    api(`/projects/${projectId}/traceability/${selectedId}`).then(setTrace).catch((issue) => setError(issue.message)).finally(() => setLoadingTrace(false));
  }, [projectId, selectedId]);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!rows) return <PageLoading />;
  const complete = rows.filter((row) => row.stages === 4).length;
  const revalidating = rows.filter((row) => row.stages === 4 && row.completeness === 'REVALIDATE').length;

  return <div className="page-enter">
    <PageHeading eyebrow="CONNECTED ENGINEERING" title="Traceability" subtitle={`Requirement traceability matrix — ${complete} of ${rows.length} requirements have a complete task → commit → source file → test chain${revalidating ? ` (${revalidating} awaiting revalidation)` : ''}. Select a row to explore its evidence graph.`} />
    <div className="panel table-panel rtm-table-container">
      <div className="table-scroll"><table className="rtm-table">
        <thead><tr><th>REQUIREMENT</th><th>STATUS</th><th>TASKS</th><th>COMMITS</th><th>SOURCE FILES</th><th>TESTS</th><th>FINDINGS</th><th>CHAIN</th></tr></thead>
        <tbody>{rows.map((row) => {
          const openFindings = row.findings.filter((f) => f.status !== 'RESOLVED');
          return <tr key={row.requirement._id} className={`clickable-row ${row.requirement._id === selectedId ? 'selected-row' : ''}`} onClick={() => setSearchParams({ req: row.requirement._id })}>
            <td><span className="table-key">{row.requirement.key}</span><strong>{row.requirement.title}</strong></td>
            <td><StatusBadge status={row.requirement.status} /></td>
            <td>{row.tasks.length ? <div className="rtm-pills">{row.tasks.map((t) => <span key={t._id} className="rtm-pill" title={`${t.title} — ${t.status}`}><span className={`task-status-dot ${t.status.toLowerCase()}`} />{t.key}</span>)}</div> : <span className="muted">None</span>}</td>
            <td>{row.commits ? <span className="rtm-pill">{row.commits} commit{row.commits > 1 ? 's' : ''}</span> : <span className="muted">None</span>}</td>
            <td>{row.files.length ? <div className="rtm-pills">{row.files.map((f) => <span key={f._id} className="rtm-pill" title={f.path}>{fileName(f.path)}</span>)}</div> : <span className="muted">None</span>}</td>
            <td>{row.tests.length ? <div className="rtm-pills">{row.tests.map((t) => <span key={t._id} className={`rtm-pill ${t.status === 'PASSING' ? 'pass' : t.status === 'FAILING' ? 'fail' : 'warn'}`} title={t.name}>{fileName(t.path)}</span>)}</div> : <span className="rtm-pill fail">No test</span>}</td>
            <td>{openFindings.length ? <span className="rtm-pill warn">{openFindings.map((f) => f.key).join(', ')}</span> : <span className="muted">None open</span>}</td>
            <td><span className={`rtm-chain-badge ${row.completeness.toLowerCase()}`}>{{ COMPLETE: 'COMPLETE', REVALIDATE: 'REVALIDATE', PARTIAL: `${row.stages}/4 STAGES`, NONE: 'NOT STARTED' }[row.completeness]}</span></td>
          </tr>;
        })}</tbody>
      </table></div>
    </div>
    {loadingTrace && !trace ? <PageLoading /> : trace && <div className="trace-index-graph">
      <div className="trace-index-graph-head"><span>Showing <b>{trace.requirement.key}</b> · {trace.requirement.title}</span><Link className="button button-secondary" to={`/projects/${projectId}/requirements/${trace.requirement._id}`}>Open requirement <ArrowRight size={13} /></Link></div>
      <TraceExplorer key={trace.requirement._id} projectId={projectId} trace={trace} />
    </div>}
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TASKS
   ═══════════════════════════════════════════════════════════════════════════ */

function Tasks() {
  const { projectId } = useParams();
  const [tasks, setTasks] = useState(null);
  const [requirements, setRequirements] = useState([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [sprintFilter, setSprintFilter] = useState('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState('ALL');
  const [drawer, setDrawer] = useState(null);
  const refresh = useCallback(() => Promise.all([api(`/projects/${projectId}/tasks`), api(`/projects/${projectId}/requirements`)])
    .then(([taskData, reqData]) => { setTasks(taskData.tasks); setRequirements(reqData.requirements); setError(''); })
    .catch((issue) => setError(issue.message)), [projectId]);
  useEffect(() => { refresh(); }, [refresh]);
  const create = async (event) => {
    event.preventDefault(); setSaving(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    payload.dependencies = payload.dependencies ? payload.dependencies.split(',').map((s) => s.trim()).filter(Boolean) : [];
    try { const { task } = await api(`/projects/${projectId}/tasks`, { method: 'POST', body: payload }); setShowForm(false); setNotice(`${task.key} created and linked to its requirement.`); refresh(); }
    catch (issue) { setNotice(issue.message); } finally { setSaving(false); }
  };
  const move = async (task, status) => {
    setTasks((items) => items.map((item) => item._id === task._id ? { ...item, status } : item));
    try { await api(`/tasks/${task._id}`, { method: 'PATCH', body: { status } }); window.dispatchEvent(new Event('devintel:data-changed')); }
    catch (issue) { setNotice(issue.message); refresh(); }
  };
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!tasks) return <PageLoading />;
  const sprints = ['ALL', ...new Set(tasks.map((t) => t.sprint).filter(Boolean))].sort();
  const assignees = ['ALL', ...new Set(tasks.map((t) => t.assignee).filter(Boolean))];
  const filtered = tasks.filter((task) => (sprintFilter === 'ALL' || task.sprint === sprintFilter) && (assigneeFilter === 'ALL' || task.assignee === assigneeFilter));
  const columns = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED'];
  return <div className="page-enter">
    <PageHeading eyebrow="DELIVERY TRACKING" title="Task board" subtitle="Every task is tied to the requirement it implements. Click a card for its commits, files and tests.">
      <Link className="button button-secondary" to={`/projects/${projectId}/sprints`}><Activity size={15} /> Sprints</Link>
      <button className="button button-primary" onClick={() => setShowForm(!showForm)}><Plus size={16} /> New task</button>
    </PageHeading>
    {notice && <div className="notice-banner"><Check size={15} />{notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}
    {showForm && <form className="panel task-form" onSubmit={create}>
      <div className="form-row"><label>Task title<input name="title" required placeholder="Describe a clear piece of work" /></label><label>Requirement<select name="requirement" required defaultValue=""><option value="" disabled>Select requirement</option>{requirements.map((req) => <option key={req._id} value={req._id}>{req.key} · {req.title}</option>)}</select></label></div>
      <div className="form-row"><label>Assignee<input name="assignee" placeholder="Name" /></label><label>Priority<select name="priority"><option>MEDIUM</option><option>LOW</option><option>HIGH</option><option>CRITICAL</option></select></label><label>Status<select name="status">{columns.map((column) => <option key={column}>{column}</option>)}</select></label></div>
      <div className="form-row"><label>Sprint<select name="sprint" defaultValue="">{['', ...sprints.filter((s) => s !== 'ALL')].map((s) => <option key={s} value={s}>{s || 'No sprint'}</option>)}</select></label><label>Due date<input name="dueDate" type="date" /></label><label>Estimate<input name="estimate" placeholder="e.g. 3h, 2d" /></label></div>
      <div className="form-row"><label>Dependencies <span className="optional">(comma separated)</span><input name="dependencies" placeholder="TASK-001, TASK-002" /></label></div>
      <label>Description<textarea name="description" rows="2" placeholder="Implementation details..." /></label>
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="button button-primary" disabled={saving}>Create task</button></div>
    </form>}
    <div className="list-toolbar">
      <div className="filter-tabs">{sprints.map((sp) => <button key={sp} className={sprintFilter === sp ? 'selected' : ''} onClick={() => setSprintFilter(sp)}>{sp === 'ALL' ? 'All sprints' : sp}</button>)}</div>
      <label className="inline-select">Assignee <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>{assignees.map((a) => <option key={a} value={a}>{a === 'ALL' ? 'Everyone' : a}</option>)}</select><span className="muted">{filtered.length} tasks</span></label>
    </div>
    <div className="kanban-board">{columns.map((status) => {
      const columnTasks = filtered.filter((task) => task.status === status);
      return <div className={`kanban-column ${status === 'BLOCKED' ? 'kanban-blocked' : ''}`} key={status}>
        <div className="kanban-heading"><span className={`column-dot ${status.toLowerCase()}`} /><strong>{status.replace(/_/g, ' ')}</strong><span className="column-count">{columnTasks.length}</span></div>
        <div className="kanban-cards">
          {columnTasks.map((task) => <article className="kanban-card" key={task._id} onClick={() => setDrawer(task)}>
            <div className="kanban-card-meta"><span>{task.key}</span><PriorityBadge priority={task.priority} /></div>
            <h3>{task.title}</h3>
            {task.description && <p>{task.description}</p>}
            {task.estimate && <div className="kanban-estimate"><TrendingUp size={12} /> {task.estimate}</div>}
            {task.dependencies?.length > 0 && <div className="kanban-deps"><Ban size={12} /> Depends on: {task.dependencies.join(', ')}</div>}
            <div className="kanban-card-foot" onClick={(event) => event.stopPropagation()}>
              <span className="task-assignee">{task.assignee ? initials(task.assignee) : '?'} <small>{task.assignee || 'Unassigned'}</small></span>
              <select aria-label={`Move ${task.key}`} value={task.status} onChange={(event) => move(task, event.target.value)}>{columns.map((column) => <option key={column}>{column}</option>)}</select>
            </div>
            <div className="kanban-requirement"><Target size={12} />{task.requirement?.key ?? 'Unlinked'}{task.sprint ? ` · ${task.sprint}` : ''}</div>
          </article>)}
          {!columnTasks.length && <div className="kanban-empty">No tasks</div>}
        </div>
      </div>;
    })}</div>
    {drawer && <ArtifactDrawer projectId={projectId} type="TASK" id={drawer._id} onNavigate={(type, item) => setDrawer(type === 'TASK' ? item : drawer)} onClose={() => setDrawer(null)} />}
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   IMPACT ANALYSIS
   ═══════════════════════════════════════════════════════════════════════════ */

function ImpactPage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const focus = searchParams.get('report');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(() => api(`/projects/${projectId}/impact-analysis`).then((result) => { setData(result); setError(''); }).catch((issue) => setError(issue.message)), [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (focus && data) document.getElementById(`report-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus, data]);
  const analyze = async (requirement) => {
    setBusy(requirement._id);
    try { await api(`/requirements/${requirement._id}/impact-analysis`, { method: 'POST' }); await load(); window.dispatchEvent(new Event('devintel:data-changed')); }
    catch (issue) { setNotice(issue.message); } finally { setBusy(''); }
  };
  const revalidate = async (report) => {
    if (!window.confirm(`Confirm that ${report.requirement.key}'s implementation and tests have been updated and re-run?`)) return;
    setBusy(report._id);
    try { await api(`/requirements/${report.requirement._id}/revalidate`, { method: 'POST' }); setNotice(`${report.requirement.key} revalidated. The report is now resolved.`); await load(); window.dispatchEvent(new Event('devintel:data-changed')); }
    catch (issue) { setNotice(issue.message); } finally { setBusy(''); }
  };
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <PageLoading />;
  const open = data.reports.filter((r) => r.status === 'OPEN');
  const resolved = data.reports.filter((r) => r.status === 'RESOLVED');

  return <div className="page-enter">
    <PageHeading eyebrow="CHANGE MANAGEMENT" title="Change impact analysis" subtitle="When a requirement changes, DevIntel traverses its stored traceability graph and inspects linked source and test snapshots to find exactly what is affected — with evidence, confidence and verification status for every item." />
    {notice && <div className="notice-banner"><Check size={15} />{notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}

    {data.pending.map((req) => <div className="change-callout" key={req._id}>
      <div className="change-callout-icon"><RefreshCw size={20} /></div>
      <div><strong>{req.key} {req.title} changed — not analyzed yet</strong><span>Revision {req.revision} saved {timeAgo(req.changedAt)}. Run the impact engine to identify affected tasks, files, tests and findings.</span></div>
      <button className="button button-primary big" disabled={Boolean(busy)} onClick={() => analyze(req)}>{busy === req._id ? <LoaderCircle size={16} className="spin" /> : <Activity size={16} />} Analyze Change Impact</button>
    </div>)}

    {!data.pending.length && !open.length && <div className="impact-explainer"><div className="impact-explainer-icon"><Check size={18} /></div><div><strong>No requirement is awaiting revalidation.</strong><span>Edit a requirement's description or acceptance criteria to trigger change detection. Past analyses are listed below.</span></div></div>}

    {open.length > 0 && <h3 className="section-label">Open — requires revalidation</h3>}
    <div className="impact-reports">{open.map((report) => <ImpactReport key={report._id} report={report} projectId={projectId} onRevalidate={revalidate} busy={busy === report._id} />)}</div>
    {resolved.length > 0 && <h3 className="section-label">Resolved history</h3>}
    <div className="impact-reports">{resolved.map((report) => <ImpactReport key={report._id} report={report} projectId={projectId} defaultOpen={focus === report._id} />)}</div>
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROJECT HEALTH
   ═══════════════════════════════════════════════════════════════════════════ */

function ProjectHealth() {
  const { projectId } = useParams();
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api(`/projects/${projectId}/health`).then((result) => { setHealth(result); setError(''); }).catch((issue) => setError(issue.message)), [projectId]);
  useEffect(() => { load(); }, [load]);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!health) return <PageLoading />;
  const { score, risks, summary, revalidation, grade } = health;
  return <div className="page-enter">
    <PageHeading eyebrow="RISK ENGINE" title="Project health" subtitle="Calculated live from requirement status, traceability gaps, failing tests, unresolved findings, blocked work and open change-impact reports." />
    <div className="health-overview">
      <div className="health-score-card panel"><ScoreRing score={score} size="xl" label="Health score" /><div className={`grade ${grade.toLowerCase()}`}>{grade.replaceAll('_', ' ')}</div></div>
      <div className="health-summary-grid">
        {['critical', 'high', 'medium', 'low'].map((level) => <div key={level} className={`health-summary-card ${level}`}><span>{summary[level]}</span><small>{level}</small></div>)}
      </div>
    </div>
    <section className={`panel revalidation-panel ${revalidation.length ? 'active' : ''}`}>
      <PanelHeading title="Requirements requiring revalidation" eyebrow="CHANGE IMPACT" />
      {revalidation.length ? revalidation.map((item) => <div className="revalidation-row" key={item._id}>
        <span className="table-key">{item.key}</span><strong>{item.title}</strong><StatusBadge status="REQUIRES_REVALIDATION" />
        <span className="muted">revision {item.revision} · {item.analyzed ? `${item.affected} affected · ${item.gaps} gaps` : 'impact not analyzed'}</span>
        <Link className="text-link" to={item.analyzed ? `/projects/${projectId}/impact-analysis?report=${item.reportId}` : `/projects/${projectId}/requirements/${item._id}`}>{item.analyzed ? 'Impact report' : 'Analyze'} <ArrowRight size={13} /></Link>
      </div>) : <InlineEmpty text="0 requirements need revalidation — every requirement change has been analyzed and revalidated." />}
    </section>
    <div className="health-metrics-row">
      <div className="panel health-metric-card"><RefreshCw size={16} /><span>{revalidation.length}</span><small>Need revalidation</small></div>
      <div className="panel health-metric-card"><FlaskConical size={16} /><span>{summary.requirementsWithoutTests}</span><small>Without tests</small></div>
      <div className="panel health-metric-card"><Ban size={16} /><span>{summary.blockedTasks}</span><small>Blocked tasks</small></div>
      <div className="panel health-metric-card"><AlertTriangle size={16} /><span>{summary.unresolvedFindings}</span><small>High-severity findings</small></div>
      <div className="panel health-metric-card"><GitBranch size={16} /><span>{summary.incompleteTraceability}</span><small>Incomplete traces</small></div>
    </div>
    <section className="panel"><PanelHeading title="Identified risks" eyebrow={`${risks.length} RISKS DETECTED`} />
      {risks.length ? <div className="risk-list-full">{risks.map((risk) => <div className="risk-row" key={risk.id}>
        <SeverityBadge severity={risk.severity} />
        <div className="risk-content">
          <div className="risk-title-row"><strong>{risk.title}</strong><span className="risk-category-tag">{risk.category.replace(/_/g, ' ')}</span></div>
          <p>{risk.description}</p>
          {risk.requirement && <Link className="risk-req-link" to={`/projects/${projectId}/requirements/${risk.requirement._id}`}><Target size={12} /> {risk.requirement.key}: {risk.requirement.title}</Link>}
          <div className="risk-recommendation"><Sparkles size={12} /> <strong>Recommendation:</strong> {risk.recommendation}</div>
        </div>
        <StatusBadge status={risk.status} />
      </div>)}</div> : <InlineEmpty text="No risks detected." />}
    </section>
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   GITHUB
   ═══════════════════════════════════════════════════════════════════════════ */

function GithubPage() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState(null);
  const refresh = useCallback(() => api(`/projects/${projectId}/github`).then((result) => { setData(result); setError(''); }).catch((issue) => setError(issue.message)), [projectId]);
  useEffect(() => { refresh(); }, [refresh]);
  const sync = async () => {
    setSyncing(true); setError('');
    try { await api(`/projects/${projectId}/github/sync`, { method: 'POST', body: {} }); await refresh(); }
    catch (issue) { setError(issue.message); } finally { setSyncing(false); }
  };
  if (!data && error) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return <PageLoading />;
  const repo = data.repository?.owner ? `${data.repository.owner}/${data.repository.name}` : null;
  const RefChips = ({ item }) => <span className="ref-chips">{item.requirement && <span className="chip req">{item.requirement.key}</span>}{item.task && <span className="chip">{item.task.key}</span>}</span>;
  return <div className="page-enter">
    <PageHeading eyebrow="SOURCE CONTROL" title="GitHub activity" subtitle="Commits and pull requests are linked to requirements and tasks when their messages reference a REQ- or TASK- key.">
      {(data.mode === 'READY' || data.mode === 'LIVE') && <button className="button button-primary" disabled={syncing} onClick={sync}>{syncing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} Sync repository</button>}
    </PageHeading>
    {error && <div className="form-error"><AlertTriangle size={15} />{error}</div>}
    <div className={`integration-banner ${data.mode === 'DEMO' ? 'demo-mode' : ''}`}><GitBranch size={17} /><span><strong>{data.mode === 'DEMO' ? `DEMO REPOSITORY · ${repo}` : data.mode === 'LIVE' ? `LIVE · ${repo}` : data.mode === 'READY' ? `READY · ${repo}` : 'NOT CONNECTED'}</strong> · {data.notice}</span></div>
    <div className="dashboard-grid two github-grid">
      <section className="panel"><PanelHeading title="Commits" eyebrow={`${data.commits.length} COMMITS`} />{data.commits.map((item) => <button className="activity-row clickable" key={item._id} onClick={() => setDrawer({ type: 'COMMIT', id: item._id })}><div className="activity-icon"><GitCommitHorizontal size={16} /></div><div className="activity-body"><strong>{item.message}</strong><span><code>{shortSha(item.sha)}</code> · {item.author} · {timeAgo(item.committedAt)} · {item.files.length} file{item.files.length > 1 ? 's' : ''} <b className="plus">+{item.additions ?? 0}</b> <b className="minus">−{item.deletions ?? 0}</b></span></div><RefChips item={item} /></button>)}{!data.commits.length && <InlineEmpty text="No commits stored yet." />}</section>
      <section className="panel"><PanelHeading title="Pull requests" eyebrow={`${data.pullRequests.length} PULL REQUESTS`} />{data.pullRequests.map((item) => <button className="activity-row clickable" key={item._id} onClick={() => setDrawer({ type: 'PULL_REQUEST', id: item._id })}><div className="activity-icon pr-icon"><GitPullRequest size={16} /></div><div className="activity-body"><strong>#{item.number} {item.title}</strong><span>{item.author} · {item.changedFiles.map(fileName).join(', ')}</span></div><div className="pr-side"><StatusBadge status={item.state} /><RefChips item={item} /></div></button>)}{!data.pullRequests.length && <InlineEmpty text="No pull requests stored yet." />}</section>
    </div>
    {drawer && <ArtifactDrawer projectId={projectId} type={drawer.type} id={drawer.id} onNavigate={(type, item) => setDrawer({ type, id: item._id })} onClose={() => setDrawer(null)} />}
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CODE REVIEW
   ═══════════════════════════════════════════════════════════════════════════ */

function Reviews() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [requirements, setRequirements] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reviewResult, setReviewResult] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [filePath, setFilePath] = useState('');
  const [sourceCode, setSourceCode] = useState('');
  const [selectedReqId, setSelectedReqId] = useState('');
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const [drawer, setDrawer] = useState(null);

  const load = useCallback(() => Promise.all([api(`/projects/${projectId}/reviews`), api(`/projects/${projectId}/requirements`)])
    .then(([reviewData, requirementData]) => { setData(reviewData); setRequirements(requirementData.requirements); setError(''); })
    .catch((issue) => setError(issue.message)), [projectId]);
  useEffect(() => { load(); }, [load]);

  const loadFile = (path) => {
    const file = data.files.find((f) => f.path === path);
    setFilePath(path); setSourceCode(file?.content ?? ''); setSelectedReqId(file?.requirement?._id ?? ''); setReviewResult(null);
  };
  const analyze = async (event) => {
    event.preventDefault(); setBusy(true); setReviewError('');
    try {
      setReviewResult(await api(`/projects/${projectId}/reviews/analyze`, { method: 'POST', body: { filePath, sourceCode, requirementId: selectedReqId || undefined } }));
      await load(); window.dispatchEvent(new Event('devintel:data-changed'));
    } catch (issue) { setReviewError(issue.message); } finally { setBusy(false); }
  };
  const setStatus = async (finding, status) => {
    try { await api(`/findings/${finding._id}`, { method: 'PATCH', body: { status } }); await load(); window.dispatchEvent(new Event('devintel:data-changed')); }
    catch (issue) { setError(issue.message); }
  };

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <PageLoading />;
  const findings = data.findings.filter((f) => statusFilter === 'ALL' || f.status === statusFilter);
  const counts = { OPEN: data.findings.filter((f) => f.status === 'OPEN').length, RESOLVED: data.findings.filter((f) => f.status === 'RESOLVED').length, ALL: data.findings.length };

  return <div className="page-enter">
    <PageHeading eyebrow="CODE QUALITY" title="Code review" subtitle="Review source files against their linked requirement. Requirement mismatches are line-cited facts; security heuristics are flagged for confirmation." />
    <div className={`integration-banner ${data.aiConfigured ? '' : 'demo-mode'}`}><Sparkles size={17} /><span><strong>{data.aiConfigured ? 'RULE ENGINE + AI PROVIDER' : 'DETERMINISTIC RULE ENGINE'}</strong> · {data.aiConfigured ? 'AI findings are recorded as AI SUGGESTION and are never auto-verified.' : 'No AI provider is configured; reviews use the deterministic requirement-aware analyzer.'}</span></div>

    <form className="panel review-form" onSubmit={analyze}>
      <div className="review-form-title"><div><strong>Review a source file</strong><span>Load a file from the repository snapshot or paste code.</span></div><FileCode2 size={17} /></div>
      <div className="form-row">
        <label>Repository file<select value={data.files.some((f) => f.path === filePath) ? filePath : ''} onChange={(e) => loadFile(e.target.value)}><option value="">Paste code manually</option>{data.files.map((f) => <option key={f._id} value={f.path}>{f.path} {f.requirement ? `· ${f.requirement.key}` : ''}</option>)}</select></label>
        <label>File path<input value={filePath} onChange={(e) => setFilePath(e.target.value)} required placeholder="server/middleware/fileValidation.js" /></label>
        <label>Check against requirement<select value={selectedReqId} onChange={(e) => setSelectedReqId(e.target.value)}><option value="">No requirement</option>{requirements.map((req) => <option key={req._id} value={req._id}>{req.key} · {req.title}</option>)}</select></label>
      </div>
      <label>Source code<textarea className="code-input" value={sourceCode} onChange={(e) => setSourceCode(e.target.value)} required rows={12} maxLength={30000} placeholder="Paste source code here..." spellCheck={false} /></label>
      {reviewError && <div className="form-error"><AlertTriangle size={14} />{reviewError}</div>}
      <div className="form-actions"><span className="muted">{sourceCode.split('\n').length} lines</span><button className="button button-primary" disabled={busy || !sourceCode.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />} Analyze code</button></div>
    </form>
    {reviewResult && <div className="integration-banner"><CircleHelp size={16} /><span><strong>{reviewResult.mode.replaceAll('_', ' ')}</strong> · {reviewResult.notice}</span></div>}

    <div className="list-toolbar"><div className="filter-tabs">{['OPEN', 'RESOLVED', 'ALL'].map((status) => <button key={status} className={statusFilter === status ? 'selected' : ''} onClick={() => setStatusFilter(status)}>{status} {counts[status]}</button>)}</div></div>
    <div className="findings-list">
      {findings.map((finding) => <article className={`panel finding-card ${finding.status === 'RESOLVED' ? 'resolved' : ''}`} key={finding._id}>
        <div className={`finding-severity ${finding.severity.toLowerCase()}`}>{finding.severity}</div>
        <div className="finding-content">
          <div className="finding-title-row"><h3>{finding.key}: {finding.title}</h3><VerificationBadge status={finding.verificationStatus} /></div>
          <p>{finding.description}</p>
          <div className="finding-evidence"><strong>EVIDENCE</strong><span>{finding.evidence}</span></div>
          <div className="finding-foot">
            <span>{finding.category} · Confidence {Math.round((finding.confidence ?? 0) * 100)}%{finding.requirement ? ` · ${finding.requirement.key}` : ''} · {timeAgo(finding.createdAt)}</span>
            <code>{finding.filePath}</code>
            <button className="button button-secondary small" onClick={() => setDrawer(finding)}>Details</button>
            <button className="button button-secondary small" onClick={() => setStatus(finding, finding.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED')}>{finding.status === 'RESOLVED' ? <><RotateCcw size={12} /> Reopen</> : <><Check size={12} /> Mark resolved</>}</button>
          </div>
        </div>
      </article>)}
    </div>
    {!findings.length && <div className="panel empty-panel"><div className="empty-icon"><ShieldCheck size={22} /></div><h3>No {statusFilter === 'ALL' ? '' : statusFilter.toLowerCase()} findings</h3></div>}
    {drawer && <ArtifactDrawer projectId={projectId} type="FINDING" id={drawer._id} onNavigate={(type, item) => setDrawer(type === 'FINDING' ? item : drawer)} onClose={() => setDrawer(null)} />}
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASSISTANT
   ═══════════════════════════════════════════════════════════════════════════ */

const SUGGESTED_QUESTIONS = [
  'Why is REQ-006 at risk?', 'Which tasks are affected by REQ-006?', 'Which files are linked to the profile image requirement?',
  'What changed in REQ-006?', 'Which tests need revalidation?', 'Show requirements without linked tests.', 'What are the highest severity findings?'
];
const MODE_LABEL = { DATABASE: 'DATABASE-BACKED · NO AI', DATABASE_FALLBACK: 'AI UNAVAILABLE · DATABASE FALLBACK', AI_SUGGESTION: 'AI SUGGESTION · NOT VERIFIED' };

function Assistant() {
  const { projectId } = useParams();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ask = async (text = question) => {
    if (!text.trim() || busy) return;
    setQuestion(''); setError('');
    setMessages((items) => [...items, { role: 'user', text }]); setBusy(true);
    try {
      const result = await api(`/projects/${projectId}/assistant`, { method: 'POST', body: { question: text } });
      setMessages((items) => [...items, { role: 'assistant', text: result.answer, evidence: result.evidence, mode: result.mode }]);
    } catch (issue) { setError(issue.message); } finally { setBusy(false); }
  };
  return <div className="page-enter assistant-page">
    <PageHeading eyebrow="PROJECT INTELLIGENCE" title="Project assistant" subtitle="Answers are computed from the requirements, traceability links, impact reports, tests and findings stored for this project." />
    <div className="assistant-shell panel">
      <div className="assistant-top"><div className="assistant-mark"><Sparkles size={17} /></div><div><strong>DevIntel project assistant</strong><span>Grounded in project records · every answer states its source</span></div><span className="assistant-status"><i /> READY</span></div>
      <div className="assistant-messages">
        {!messages.length && <div className="assistant-welcome"><div className="welcome-spark"><Sparkles size={22} /></div><h2>Ask about this project</h2><p>Try one of these questions:</p></div>}
        {messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}>{message.role === 'assistant' && <span className="chat-icon"><Sparkles size={14} /></span>}<div>{message.mode && <span className={`answer-mode ${message.mode.toLowerCase()}`}>{MODE_LABEL[message.mode] ?? message.mode}</span>}<p>{message.text}</p>{message.evidence && <small>{message.evidence}</small>}</div></div>)}
        {busy && <div className="chat-message assistant"><span className="chat-icon"><Sparkles size={14} /></span><div className="thinking"><i /><i /><i /></div></div>}
      </div>
      <div className="suggested-questions">{SUGGESTED_QUESTIONS.map((item) => <button key={item} onClick={() => ask(item)} disabled={busy}>{item}<ArrowUpRight size={13} /></button>)}</div>
      {error && <div className="form-error chat-error">{error}</div>}
      <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); ask(); }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about risks, changes, linked files, tests, tasks..." maxLength={500} /><button className="button button-primary" disabled={!question.trim() || busy}><ArrowRight size={16} /></button></form>
    </div>
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPRINTS
   ═══════════════════════════════════════════════════════════════════════════ */

function Sprints() {
  const { projectId } = useParams();
  const [sprints, setSprints] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => Promise.all([api(`/projects/${projectId}/sprints`), api(`/projects/${projectId}/tasks`)])
    .then(([sprintData, taskData]) => { setSprints(sprintData.sprints); setTasks(taskData.tasks); setError(''); })
    .catch((issue) => setError(issue.message)), [projectId]);
  useEffect(() => { load(); }, [load]);
  const createSprint = async (event) => {
    event.preventDefault(); setSaving(true);
    try { await api(`/projects/${projectId}/sprints`, { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) }); setShowForm(false); load(); }
    catch (issue) { setError(issue.message); } finally { setSaving(false); }
  };
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!sprints) return <PageLoading />;
  return <div className="page-enter">
    <Link className="back-link" to={`/projects/${projectId}/tasks`}>← Task board</Link>
    <PageHeading eyebrow="ITERATION PLANNING" title="Sprints" subtitle="Progress is calculated from the tasks assigned to each sprint."><button className="button button-primary" onClick={() => setShowForm(!showForm)}><Plus size={16} /> New sprint</button></PageHeading>
    {showForm && <form className="panel project-form" onSubmit={createSprint}>
      <div className="form-row"><label>Sprint name<input name="name" required defaultValue={`Sprint ${sprints.length + 1}`} /></label><label>Status<select name="status" defaultValue="PLANNED"><option>PLANNED</option><option>ACTIVE</option><option>COMPLETED</option></select></label></div>
      <label>Sprint goal<textarea name="goal" rows={2} placeholder="What is the objective of this sprint?" /></label>
      <div className="form-row"><label>Starts<input name="startsAt" type="date" defaultValue={new Date().toISOString().split('T')[0]} /></label><label>Ends<input name="endsAt" type="date" defaultValue={new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]} /></label></div>
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="button button-primary" disabled={saving}>Create sprint</button></div>
    </form>}
    <div className="sprint-grid">{sprints.map((sprint) => {
      const sprintTasks = tasks.filter((task) => task.sprint === sprint.name);
      const done = sprintTasks.filter((task) => task.status === 'DONE').length;
      const progress = sprintTasks.length ? Math.round((done / sprintTasks.length) * 100) : 0;
      return <article className="panel sprint-card" key={sprint._id}>
        <span className={`sprint-state ${sprint.status.toLowerCase()}`}><i />{sprint.status}</span>
        <h2>{sprint.name}</h2>
        {sprint.goal && <p className="sprint-card-goal">{sprint.goal}</p>}
        <p>{sprintTasks.length} task{sprintTasks.length !== 1 ? 's' : ''} · {done} completed ({progress}%)</p>
        <div className="coverage-bar"><span style={{ width: `${progress}%` }} /></div>
        {sprint.startsAt && <div className="sprint-dates">{new Date(sprint.startsAt).toLocaleDateString()} → {new Date(sprint.endsAt).toLocaleDateString()}</div>}
        <div className="sprint-tasks-mini">{sprintTasks.slice(0, 4).map((t) => <div className="sprint-task-item" key={t._id}><span>{t.key} · {t.title}</span><StatusBadge status={t.status} /></div>)}{sprintTasks.length > 4 && <span className="muted">+{sprintTasks.length - 4} more</span>}</div>
      </article>;
    })}</div>
    {!sprints.length && <div className="panel empty-panel"><div className="empty-icon"><Activity size={22} /></div><h3>No sprints yet</h3></div>}
  </div>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════════════════════════ */

function SettingsPage({ user }) {
  const [system, setSystem] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  useEffect(() => { api('/system').then(setSystem).catch((issue) => setMessage(issue.message)); }, []);
  const reset = async () => {
    if (!window.confirm('Reset the demo workspace? All changes made during this session (edited requirements, impact reports, findings) will be replaced with the original seeded data.')) return;
    setResetting(true);
    try {
      const { projectId } = await api('/demo/reset', { method: 'POST' });
      window.dispatchEvent(new Event('devintel:projects-changed'));
      navigate(`/projects/${projectId}`);
    } catch (issue) { setMessage(issue.message); setResetting(false); }
  };
  const row = (label, value, ok) => <div className="settings-row"><span>{label}</span><strong className={ok === undefined ? '' : ok ? 'ok' : 'off'}>{value}</strong></div>;
  return <div className="page-enter">
    <PageHeading eyebrow="PREFERENCES" title="Settings" subtitle="Account, integrations and demo controls." />
    {message && <div className="form-error"><AlertTriangle size={15} />{message}</div>}
    <div className="dashboard-grid two">
      <section className="panel settings-card">
        <PanelHeading title="Account" eyebrow="PROFILE" />
        <div className="settings-profile"><div className="user-avatar large">{initials(user.name)}</div><div><strong>{user.name}</strong><span>{user.email}</span></div></div>
        {row('Authentication', 'JWT bearer token · 7-day expiry · bcrypt password hashing')}
      </section>
      <section className="panel settings-card">
        <PanelHeading title="System status" eyebrow="LIVE" />
        {!system ? <PageLoading label="Checking services..." /> : <>
          {row('Database', system.database.mode === 'primary' ? `MongoDB connected (${system.database.host})` : system.database.mode === 'local-fallback' ? `Local fallback (${system.database.host})` : 'Disconnected', system.database.mode === 'primary')}
          {row('AI provider', system.aiConfigured ? `Configured (${system.aiModel})` : 'Not configured — deterministic engines in use', system.aiConfigured)}
          {row('GitHub', system.githubConfigured ? 'Token configured — live sync available' : 'No token — demo repository data only', system.githubConfigured)}
          {row('Change impact engine', 'Deterministic: constraint extraction + source/test inspection', true)}
          {row('Demo mode', system.demoMode ? 'Enabled' : 'Disabled', system.demoMode)}
        </>}
      </section>
    </div>
    {system?.isDemoUser && <section className="panel settings-card demo-reset">
      <PanelHeading title="Demo workspace" eyebrow="PRESENTATION CONTROLS" />
      <p>Restore ShopSphere to its original state (REQ-006 back to 5 MB / JPEG + PNG, no open impact reports) so the live change demonstration can be repeated.</p>
      <button className="button button-danger" disabled={resetting} onClick={reset}>{resetting ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />} Reset demo workspace</button>
    </section>}
  </div>;
}

function EmptyProjects({ onCreate }) {
  return <div className="panel empty-panel"><div className="empty-icon"><FolderKanban size={22} /></div><h3>No projects to show</h3><p>Create a project to start connecting requirements, delivery and code evidence.</p>{onCreate && <button className="button button-primary" onClick={onCreate}><Plus size={15} /> Create your first project</button>}</div>;
}

export default App;
