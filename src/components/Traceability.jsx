import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, LoaderCircle, X } from 'lucide-react';
import { api } from '../services/api.js';
import {
  ARTIFACT_META, ImpactLevel, PriorityBadge, StatusBadge, VerificationBadge, fileName, shortSha, timeAgo
} from './ui.jsx';

const STAGES = ['CRITERIA', 'TASK', 'COMMIT', 'PULL_REQUEST', 'SOURCE_FILE', 'TEST', 'FINDING'];

/** Computes which artifacts are directly related to the selected one, using stored foreign keys and file paths. */
function relatedIds(selected, artifacts) {
  if (!selected) return null;
  const { type, item } = selected;
  const ids = new Set([String(item._id)]);
  const add = (list) => list.forEach((entry) => ids.add(String(entry._id)));
  const tasks = artifacts.TASK ?? [];
  const commits = artifacts.COMMIT ?? [];
  const prs = artifacts.PULL_REQUEST ?? [];
  const files = artifacts.SOURCE_FILE ?? [];
  const tests = artifacts.TEST ?? [];
  const findings = artifacts.FINDING ?? [];
  const sameTask = (entry) => item.task && String(entry._id) === String(item.task);
  if (type === 'TASK') {
    const id = String(item._id);
    const owned = [...files, ...tests].filter((f) => String(f.task) === id);
    add(commits.filter((c) => String(c.task) === id)); add(prs.filter((p) => String(p.task) === id)); add(owned);
    add(findings.filter((f) => owned.some((o) => o.path === f.filePath)));
  } else if (type === 'COMMIT') {
    add(tasks.filter(sameTask)); add([...files, ...tests].filter((f) => item.files?.includes(f.path)));
    add(prs.filter((p) => p.changedFiles?.some((path) => item.files?.includes(path))));
  } else if (type === 'PULL_REQUEST') {
    add(tasks.filter(sameTask)); add([...files, ...tests].filter((f) => item.changedFiles?.includes(f.path)));
    add(commits.filter((c) => c.files?.some((path) => item.changedFiles?.includes(path))));
  } else if (type === 'SOURCE_FILE' || type === 'TEST') {
    add(tasks.filter(sameTask)); add(commits.filter((c) => c.files?.includes(item.path)));
    add(prs.filter((p) => p.changedFiles?.includes(item.path))); add(findings.filter((f) => f.filePath === item.path));
  } else if (type === 'FINDING') {
    add(files.filter((f) => f.path === item.filePath)); add(tasks.filter(sameTask));
  }
  return ids;
}

function ArtifactCard({ type, item, index, impact, state, onClick }) {
  const Icon = ARTIFACT_META[type].icon;
  let title; let meta; let badge = null;
  if (type === 'CRITERIA') { title = item; meta = `AC${index + 1}`; }
  if (type === 'TASK') { title = item.title; meta = `${item.key} · ${item.assignee || 'Unassigned'}`; badge = <StatusBadge status={item.status} />; }
  if (type === 'COMMIT') { title = item.message; meta = <><code>{shortSha(item.sha)}</code> · {item.author} · {timeAgo(item.committedAt)}</>; }
  if (type === 'PULL_REQUEST') { title = `#${item.number} ${item.title}`; meta = `${item.author ?? ''} · ${item.changedFiles?.length ?? 0} files`; badge = <StatusBadge status={item.state} />; }
  if (type === 'SOURCE_FILE') { title = fileName(item.path); meta = item.path.split('/').slice(0, -1).join('/'); }
  if (type === 'TEST') { title = fileName(item.path); meta = item.name; badge = <StatusBadge status={item.status} />; }
  if (type === 'FINDING') { title = item.title; meta = `${item.key} · ${item.severity}${item.status === 'RESOLVED' ? ' · RESOLVED' : ''}`; badge = <VerificationBadge status={item.verificationStatus} />; }
  const clickable = type !== 'CRITERIA';
  return <button type="button" className={`trace-card ${state} ${impact ? `impact-${impact.level.toLowerCase()}` : ''} ${clickable ? '' : 'static'}`} onClick={clickable ? onClick : undefined} disabled={!clickable}>
    <span className="trace-card-top"><Icon size={13} /><span className="trace-card-meta">{meta}</span></span>
    <strong>{title}</strong>
    {(badge || impact) && <span className="trace-card-foot">{badge}{impact && <ImpactLevel level={impact.level} />}</span>}
  </button>;
}

/** Requirement → criteria → tasks → commits → PRs → files → tests → findings, as stored in the database. */
export function TraceExplorer({ projectId, trace }) {
  const [selected, setSelected] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const { requirement, artifacts, impactByArtifact = {} } = trace;
  const highlight = useMemo(() => relatedIds(selected, artifacts), [selected, artifacts]);
  const lists = { CRITERIA: requirement.acceptanceCriteria, ...artifacts };
  const total = ['TASK', 'COMMIT', 'PULL_REQUEST', 'SOURCE_FILE', 'TEST', 'FINDING'].reduce((sum, type) => sum + (artifacts[type]?.length ?? 0), 0);
  const open = (type, item) => { setSelected({ type, item }); setDrawer({ type, id: item._id }); };

  return <section className="panel trace-explorer">
    <div className="trace-explorer-head">
      <div><div className="eyebrow">PERSISTENT TRACEABILITY GRAPH</div><h2>{requirement.key} evidence chain</h2><p>{total} artifacts linked in the database. Select any artifact to highlight what it connects to and open its details.</p></div>
      {Object.keys(impactByArtifact).length > 0 && <div className="trace-legend"><ImpactLevel level="DIRECTLY_AFFECTED" /><ImpactLevel level="POTENTIALLY_AFFECTED" /><ImpactLevel level="REQUIRES_REVALIDATION" /></div>}
    </div>
    <div className="trace-lanes">
      <div className="trace-lane root">
        <div className="trace-lane-label"><span className="trace-lane-dot"><ARTIFACT_META.REQUIREMENT.icon size={14} /></span><div><strong>Requirement</strong><small>{requirement.key}</small></div></div>
        <div className="trace-lane-cards"><div className="trace-card root-card"><span className="trace-card-top"><span className="trace-card-meta">{requirement.key} · revision {requirement.revision}</span></span><strong>{requirement.title}</strong><span className="trace-root-desc">{requirement.description}</span><span className="trace-card-foot"><StatusBadge status={requirement.status} /><PriorityBadge priority={requirement.priority} /></span></div></div>
      </div>
      {STAGES.map((type) => {
        const items = lists[type] ?? [];
        const Icon = ARTIFACT_META[type].icon;
        return <div className="trace-lane" key={type}>
          <div className="trace-lane-label"><span className={`trace-lane-dot ${items.length ? 'filled' : ''}`}><Icon size={14} /></span><div><strong>{ARTIFACT_META[type].plural}</strong><small>{items.length} linked</small></div></div>
          <div className="trace-lane-cards">
            {items.length ? items.map((item, index) => {
              const id = type === 'CRITERIA' ? null : String(item._id);
              const state = !highlight || type === 'CRITERIA' ? '' : highlight.has(id) ? (selected.item._id === item._id ? 'selected' : 'related') : 'dimmed';
              return <ArtifactCard key={id ?? index} type={type} item={item} index={index} impact={id ? impactByArtifact[id] : null} state={state} onClick={() => open(type, item)} />;
            }) : <span className="trace-lane-empty">No {ARTIFACT_META[type].plural.toLowerCase()} linked yet</span>}
          </div>
        </div>;
      })}
    </div>
    {selected && <button className="trace-clear" onClick={() => setSelected(null)}><X size={13} /> Clear selection</button>}
    {drawer && <ArtifactDrawer projectId={projectId} type={drawer.type} id={drawer.id} impact={impactByArtifact[String(drawer.id)]}
      onNavigate={(type, item) => open(type, item)} onClose={() => { setDrawer(null); setSelected(null); }} />}
  </section>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ARTIFACT DRAWER
   ═══════════════════════════════════════════════════════════════════════════ */

export function ArtifactDrawer({ projectId, type, id, impact, onNavigate, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null); setError('');
    api(`/projects/${projectId}/artifacts/${type}/${id}`).then(setData).catch((issue) => setError(issue.message));
  }, [projectId, type, id]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const Icon = ARTIFACT_META[type].icon;
  const a = data?.artifact;
  const r = data?.related ?? {};
  const evidenceLines = new Set([...(impact?.evidence ?? '').matchAll(/L(\d+):/g)].map((m) => Number(m[1])));
  const nav = (navType, item) => onNavigate?.(navType, item);
  const RelatedList = ({ label, items, navType, render }) => items?.length ? <div className="drawer-section"><h4>{label} <span>{items.length}</span></h4>{items.map((item) => <button key={item._id} className="drawer-link" onClick={() => nav(navType, item)}>{render(item)}</button>)}</div> : null;

  // Portal to <body>: the animated page wrapper uses a transform, which would trap position: fixed.
  return createPortal(<>
    <button className="drawer-scrim" onClick={onClose} aria-label="Close details" />
    <aside className="drawer" role="dialog" aria-label={`${ARTIFACT_META[type].label} details`}>
      <div className="drawer-head"><span className="drawer-icon"><Icon size={16} /></span><div><small>{ARTIFACT_META[type].label.toUpperCase()}</small><strong>{a ? drawerTitle(type, a) : 'Loading…'}</strong></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button></div>
      <div className="drawer-body">
        {error && <div className="form-error">{error}</div>}
        {!a && !error && <div className="page-loading"><LoaderCircle size={16} className="spin" /> Loading details</div>}
        {a && <>
          {impact && <div className={`drawer-impact impact-${impact.level.toLowerCase()}`}><div><ImpactLevel level={impact.level} /><VerificationBadge status={impact.verificationStatus} /></div><p>{impact.reason}</p></div>}
          {a.isDemo && <div className="drawer-demo">DEMO REPOSITORY DATA</div>}
          <dl className="drawer-facts">{drawerFacts(type, a, r).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {r.requirements?.length > 0 && <div className="drawer-section"><h4>Linked requirements</h4><div className="drawer-chips">{r.requirements.map((req) => <span key={req._id} className="chip">{req.key} · {req.title}</span>)}</div></div>}
          {r.task && type !== 'TASK' && <div className="drawer-section"><h4>Task</h4><button className="drawer-link" onClick={() => nav('TASK', r.task)}><b>{r.task.key}</b> {r.task.title} <StatusBadge status={r.task.status} /></button></div>}
          {(type === 'COMMIT' || type === 'PULL_REQUEST') && <div className="drawer-section"><h4>Files changed <span>{(a.files ?? a.changedFiles).length}</span></h4>{(a.files ?? a.changedFiles).map((path) => {
            const match = [...(r.files ?? []), ...(r.tests ?? [])].find((f) => f.path === path);
            const navType = r.tests?.some((t) => t.path === path) ? 'TEST' : 'SOURCE_FILE';
            return match ? <button key={path} className="drawer-link mono" onClick={() => nav(navType, match)}>{path}</button> : <div key={path} className="drawer-link mono static">{path}</div>;
          })}</div>}
          {(type === 'SOURCE_FILE' || type === 'TEST') && a.content && <div className="drawer-section"><h4>{type === 'TEST' ? 'Test source' : 'Source snapshot'}{evidenceLines.size > 0 && <em> · {evidenceLines.size} line(s) cited as impact evidence</em>}</h4>
            <pre className="code-view">{a.content.split('\n').map((line, index) => <span key={index} className={evidenceLines.has(index + 1) ? 'hit' : ''}><i>{index + 1}</i>{line || ' '}{'\n'}</span>)}</pre>
          </div>}
          {type === 'FINDING' && <><div className="drawer-section"><h4>Description</h4><p>{a.description}</p></div><div className="drawer-section"><h4>Evidence</h4><pre className="evidence">{a.evidence}</pre></div></>}
          <RelatedList label="Commits" items={r.commits} navType="COMMIT" render={(c) => <><code>{shortSha(c.sha)}</code> {c.message}</>} />
          <RelatedList label="Pull requests" items={r.pullRequests} navType="PULL_REQUEST" render={(p) => <><b>#{p.number}</b> {p.title} <StatusBadge status={p.state} /></>} />
          {type !== 'COMMIT' && type !== 'PULL_REQUEST' && <RelatedList label="Source files" items={r.files} navType="SOURCE_FILE" render={(f) => <span className="mono">{f.path}</span>} />}
          {type !== 'COMMIT' && type !== 'PULL_REQUEST' && <RelatedList label="Tests" items={r.tests} navType="TEST" render={(t) => <><span className="mono">{t.path}</span> <StatusBadge status={t.status} /></>} />}
          <RelatedList label="Findings" items={r.findings} navType="FINDING" render={(f) => <><b>{f.key}</b> {f.title} <span className={`finding-severity ${f.severity.toLowerCase()}`}>{f.severity}</span></>} />
        </>}
      </div>
    </aside>
  </>, document.body);
}

function drawerTitle(type, a) {
  return ({ TASK: `${a.key} · ${a.title}`, COMMIT: a.message, PULL_REQUEST: `#${a.number} ${a.title}`, SOURCE_FILE: a.path, TEST: a.path, FINDING: `${a.key} · ${a.title}` })[type];
}

function drawerFacts(type, a) {
  const date = (value) => (value ? new Date(value).toLocaleString() : '—');
  if (type === 'TASK') return [['Status', <StatusBadge status={a.status} />], ['Priority', <PriorityBadge priority={a.priority} />], ['Assignee', a.assignee || 'Unassigned'], ['Estimate', a.estimate || '—'], ['Sprint', a.sprint || '—'], ['Depends on', a.dependencies?.join(', ') || 'None'], ...(a.description ? [['Description', a.description]] : [])];
  if (type === 'COMMIT') return [['SHA', <code>{a.sha}</code>], ['Author', a.author], ['Committed', date(a.committedAt)], ['Changes', <span><b className="plus">+{a.additions ?? 0}</b> <b className="minus">−{a.deletions ?? 0}</b></span>], ['Repository', a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="text-link">{a.isDemo ? 'Demo URL' : 'View on GitHub'} <ExternalLink size={11} /></a> : '—']];
  if (type === 'PULL_REQUEST') return [['State', <StatusBadge status={a.state} />], ['Author', a.author || '—'], ['Merged', a.mergedAt ? date(a.mergedAt) : 'Not merged']];
  if (type === 'SOURCE_FILE') return [['Language', a.language || '—'], ['Purpose', a.summary || '—'], ['Last analyzed', a.lastAnalyzedAt ? timeAgo(a.lastAnalyzedAt) : 'Never']];
  if (type === 'TEST') return [['Suite', a.name], ['Last result', <StatusBadge status={a.status} />], ['Last run', a.lastRunAt ? timeAgo(a.lastRunAt) : 'Never']];
  if (type === 'FINDING') return [['Severity', <span className={`finding-severity ${a.severity.toLowerCase()}`}>{a.severity}</span>], ['Category', a.category], ['Status', <StatusBadge status={a.status} />], ['Verification', <VerificationBadge status={a.verificationStatus} />], ['Confidence', `${Math.round((a.confidence ?? 0) * 100)}%`], ['File', <span className="mono">{a.filePath}</span>]];
  return [];
}
