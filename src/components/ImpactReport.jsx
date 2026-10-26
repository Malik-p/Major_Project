import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, Minus, Plus, RefreshCw, ShieldAlert, Sparkles, Target
} from 'lucide-react';
import { ARTIFACT_META, Confidence, ImpactLevel, SeverityBadge, StatusBadge, VerificationBadge, timeAgo } from './ui.jsx';
import { ArtifactDrawer } from './Traceability.jsx';

const LEVELS = [
  ['DIRECTLY_AFFECTED', 'Directly affected', 'Artifacts that implement the exact rules that changed.'],
  ['POTENTIALLY_AFFECTED', 'Potentially affected', 'Artifacts connected to the change that may need follow-up.'],
  ['REQUIRES_REVALIDATION', 'Requires revalidation', 'Tests and findings that must be re-run or re-checked.']
];

function ConstraintSide({ label, constraints, other, description, tone }) {
  const sizeChanged = constraints?.maxSize !== other?.maxSize;
  return <div className={`compare-side ${tone}`}>
    <span className="compare-label">{label}</span>
    {constraints?.maxSize && <div className="compare-metric"><small>Maximum size</small><strong className={sizeChanged ? 'changed' : ''}>{constraints.maxSize}</strong></div>}
    {constraints?.formats?.length > 0 && <div className="compare-metric"><small>Accepted formats</small><div className="format-chips">{constraints.formats.map((format) => {
      const added = tone === 'after' && !other.formats.includes(format);
      const removed = tone === 'before' && !other.formats.includes(format);
      return <span key={format} className={`format-chip ${added ? 'added' : ''} ${removed ? 'removed' : ''}`}>{added && <Plus size={11} />}{removed && <Minus size={11} />}{format}</span>;
    })}</div></div>}
    {constraints?.quantities?.length > 0 && <div className="compare-metric"><small>Limits</small><div className="format-chips">{constraints.quantities.map((q) => <span key={q} className={`format-chip ${other.quantities.includes(q) ? '' : tone === 'after' ? 'added' : 'removed'}`}>{q}</span>)}</div></div>}
    <p className="compare-text">“{description}”</p>
  </div>;
}

function ImpactItem({ item, onOpen }) {
  const Icon = ARTIFACT_META[item.artifactType]?.icon ?? CircleHelp;
  const clickable = item.artifact && ARTIFACT_META[item.artifactType] && item.artifactType !== 'REQUIREMENT';
  return <div className={`impact-row ${clickable ? 'clickable' : ''}`} onClick={clickable ? () => onOpen(item) : undefined}>
    <span className="impact-row-icon"><Icon size={15} /></span>
    <div className="impact-row-main">
      <div className="impact-row-title"><b>{item.key}</b><span>{item.title !== item.key ? item.title : ''}</span></div>
      <p><em>Reason:</em> {item.reason}</p>
      {item.evidence && <pre className="evidence">{item.evidence}</pre>}
    </div>
    <div className="impact-row-side"><ImpactLevel level={item.level} /><VerificationBadge status={item.verificationStatus} /><Confidence value={item.confidence} /></div>
  </div>;
}

export function ImpactReport({ report, projectId, onRevalidate, busy, defaultOpen = true }) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const [showUnaffected, setShowUnaffected] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const constraints = report.changes.find((c) => c.dimension === 'CONSTRAINTS');
  const structured = report.changes.filter((c) => ['MAX_FILE_SIZE', 'ALLOWED_FORMATS', 'QUANTITY'].includes(c.dimension));
  const criteria = report.changes.find((c) => c.dimension === 'ACCEPTANCE_CRITERIA');
  const descriptive = report.changes.filter((c) => ['TITLE', 'DESCRIPTION'].includes(c.dimension));
  const hasConstraints = constraints && (constraints.before.maxSize || constraints.after.maxSize || constraints.before.formats.length || constraints.after.formats.length || constraints.before.quantities.length || constraints.after.quantities.length);
  const revalidate = report.impacts.filter((i) => i.level === 'REQUIRES_REVALIDATION');
  const isOpen = report.status === 'OPEN';
  const req = report.requirement;

  return <article className={`panel impact-report-v2 ${isOpen ? 'open' : 'resolved'}`} id={`report-${report._id}`}>
    <header className="irv-head" onClick={() => setExpanded(!expanded)}>
      <div>
        <span className={`irv-state ${isOpen ? 'open' : 'resolved'}`}>{isOpen ? <><RefreshCw size={12} /> REQUIRES REVALIDATION</> : <><Check size={12} /> RESOLVED {report.resolvedAt ? timeAgo(report.resolvedAt) : ''}</>}</span>
        <h2>{req?.key} · {req?.title}</h2>
        <span className="muted">Revision {report.fromVersion} → {report.toVersion} · analyzed {new Date(report.createdAt).toLocaleString()} · deterministic impact engine{report.aiSuggestions?.length ? ' + AI suggestions' : ''}</span>
      </div>
      <div className="irv-counts">
        <span><b>{report.impacts.length}</b>affected</span><span><b>{report.gaps.length}</b>gaps</span><span><b>{report.risks.length}</b>risks</span>
        {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </div>
    </header>

    {expanded && <div className="irv-body">
      {/* Before vs after */}
      <section className="irv-compare">
        <ConstraintSide label="BEFORE" tone="before" constraints={hasConstraints ? constraints.before : null} other={constraints?.after} description={report.previous?.description} />
        <div className="compare-arrow"><ArrowRight size={20} /></div>
        <ConstraintSide label="AFTER" tone="after" constraints={hasConstraints ? constraints.after : null} other={constraints?.before} description={report.current?.description} />
      </section>

      {/* Three questions */}
      <section className="irv-questions">
        <div>
          <h3><span>1</span> What changed?</h3>
          <ul>
            {structured.map((c) => <li key={c.label}>{c.dimension === 'ALLOWED_FORMATS'
              ? <>Accepted formats {c.added.length > 0 && <b className="plus">+ {c.added.join(', ')}</b>} {c.removed.length > 0 && <b className="minus">− {c.removed.join(', ')}</b>}</>
              : <>{c.label}: <b>{c.before}</b> → <b>{c.after}</b>{c.direction ? <em> ({c.direction.toLowerCase()})</em> : null}</>}</li>)}
            {criteria && <li>Acceptance criteria: {criteria.added.length} added, {criteria.removed.length} removed</li>}
            {!structured.length && descriptive.map((c) => <li key={c.label}>{c.label} reworded</li>)}
          </ul>
        </div>
        <div>
          <h3><span>2</span> What is affected?</h3>
          <ul>{LEVELS.slice(0, 2).map(([level, label]) => {
            const items = report.impacts.filter((i) => i.level === level);
            return <li key={level}><b>{items.length}</b> {label.toLowerCase()}{items.length ? `: ${items.map((i) => i.key).join(', ')}` : ''}</li>;
          })}<li><b>{report.unaffected?.length ?? 0}</b> linked artifacts inspected with no impact</li></ul>
        </div>
        <div>
          <h3><span>3</span> What needs revalidation?</h3>
          <ul>
            {revalidate.map((i) => <li key={i.key}>{i.key}</li>)}
            <li>{req?.key} itself — {isOpen ? 'awaiting revalidation' : 'revalidated'}</li>
          </ul>
        </div>
      </section>

      {/* Impact by level */}
      {LEVELS.map(([level, label, help]) => {
        const items = report.impacts.filter((i) => i.level === level);
        if (!items.length) return null;
        return <section className="irv-section" key={level}>
          <div className="irv-section-head"><ImpactLevel level={level} /><h3>{label}</h3><span>{items.length}</span><p>{help}</p></div>
          {items.map((item, index) => <ImpactItem key={`${item.artifactType}-${item.key}-${index}`} item={item} onOpen={setDrawer} />)}
        </section>;
      })}

      <div className="irv-grid">
        <section className="irv-section">
          <div className="irv-section-head"><ShieldAlert size={15} /><h3>Potential gaps</h3><span>{report.gaps.length}</span></div>
          <ol className="gap-list">{report.gaps.map((gap, index) => <li key={index}><div><strong>{gap.title}</strong><VerificationBadge status={gap.verificationStatus} /></div><p>{gap.reason}</p><code>{gap.evidence}</code></li>)}</ol>
          {!report.gaps.length && <p className="muted">No gaps detected.</p>}
        </section>
        <section className="irv-section">
          <div className="irv-section-head"><ShieldAlert size={15} /><h3>Risks</h3><span>{report.risks.length}</span></div>
          {report.risks.map((risk, index) => <div className="risk-card" key={index}><div><SeverityBadge severity={risk.severity} /><strong>{risk.title}</strong></div><p>{risk.reason}</p>{risk.evidence && <pre className="evidence">{risk.evidence}</pre>}<div className="risk-card-foot"><VerificationBadge status={risk.verificationStatus} /><Confidence value={risk.confidence} /></div></div>)}
        </section>
      </div>

      <section className="irv-section">
        <div className="irv-section-head"><ClipboardCheck size={15} /><h3>Recommended actions</h3><span>{report.recommendations.length}</span></div>
        <ol className="action-list">{report.recommendations.map((action, index) => <li key={index}><span>{index + 1}</span>{action}</li>)}</ol>
      </section>

      {report.aiSuggestions?.length > 0 && <section className="irv-section ai"><div className="irv-section-head"><Sparkles size={15} /><h3>Additional AI suggestions</h3><VerificationBadge status="AI_SUGGESTION" /></div><ul>{report.aiSuggestions.map((s) => <li key={s}>{s}</li>)}</ul></section>}

      {report.unaffected?.length > 0 && <section className="irv-section muted-section">
        <button className="irv-toggle" onClick={() => setShowUnaffected(!showUnaffected)}>{showUnaffected ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Reviewed, no impact expected ({report.unaffected.length})</button>
        {showUnaffected && report.unaffected.map((item, index) => <ImpactItem key={index} item={{ ...item, level: 'NO_IMPACT' }} onOpen={setDrawer} />)}
      </section>}

      <footer className="irv-foot">
        <div className="verification-legend"><VerificationBadge status="VERIFIED" /> confirmed against stored code/test/requirement text <VerificationBadge status="REQUIRES_REVALIDATION" /> must be re-run or re-checked <VerificationBadge status="UNVERIFIED" /> inferred from traceability links only</div>
        <div className="irv-actions">
          {req?._id && <Link className="button button-secondary" to={`/projects/${projectId}/requirements/${req._id}`}><Target size={14} /> Open {req.key}</Link>}
          {isOpen && onRevalidate && <button className="button button-primary" disabled={busy} onClick={() => onRevalidate(report)}><Check size={14} /> Mark {req?.key} revalidated</button>}
          {!isOpen && <StatusBadge status="RESOLVED" />}
        </div>
      </footer>
    </div>}
    {drawer && <ArtifactDrawer projectId={projectId} type={drawer.artifactType} id={drawer.artifact} impact={drawer.level && drawer.level !== 'NO_IMPACT' ? drawer : null} onNavigate={(type, item) => setDrawer({ artifactType: type, artifact: item._id, key: item.key })} onClose={() => setDrawer(null)} />}
  </article>;
}
