export const CSS = `
:root {
	--bg: #0D1117;
	--surface: #161B22;
	--surface-raised: #1C2128;
	--border: #30363D;
	--text: #E6EDF3;
	--text-dim: #848D97;
	--text-faint: #484F58;
	--accent: #3DDC84;
	--accent-dim: #26883F;
	--accent-glow: rgba(61,220,132,0.10);
	--teal: #00BFA5;
	--red: #F85149;
	--orange: #D29922;
	--purple: #BC8CFF;
	--cyan: #39C5CF;
	--blue: #6DB0FF;
	--gold: #D4A017;
	--silver: #A0A0A0;
	--bronze: #CD7F32;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
	font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', monospace;
	background: var(--bg);
	color: var(--text);
	line-height: 1.6;
	min-height: 100vh;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Nav ─────────────────────────────────────────────────── */

nav {
	position: sticky;
	top: 0;
	z-index: 100;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.75rem 2rem;
	border-bottom: 1px solid var(--border);
	background: rgba(13,17,23,0.85);
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
}

.logo {
	font-size: 1.1rem;
	font-weight: bold;
	color: var(--accent);
	text-decoration: none;
	display: flex;
	align-items: center;
	gap: 0.5rem;
}
.logo:hover { text-decoration: none; opacity: 0.9; }
.logo-icon { font-size: 1.3rem; }

.nav-links { display: flex; gap: 1.25rem; }
.nav-links a {
	color: var(--text-dim);
	text-decoration: none;
	font-size: 0.85rem;
	padding: 0.25rem 0;
	border-bottom: 2px solid transparent;
	transition: color 0.15s, border-color 0.15s;
}
.nav-links a:hover { color: var(--text); text-decoration: none; }
.nav-links a.active {
	color: var(--accent);
	border-bottom-color: var(--accent);
}

/* ── Main + Footer ───────────────────────────────────────── */

main {
	max-width: 1100px;
	margin: 0 auto;
	padding: 2rem 1.5rem;
}

footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 1.5rem 2rem;
	color: var(--text-faint);
	border-top: 1px solid var(--border);
	margin-top: 4rem;
	font-size: 0.8rem;
}
footer a { color: var(--text-dim); }
footer a:hover { color: var(--accent); }

/* ── Hero ────────────────────────────────────────────────── */

.hero {
	text-align: center;
	padding: 3rem 0 2rem;
	position: relative;
}
.hero::before {
	content: '';
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	width: 400px;
	height: 400px;
	background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
	pointer-events: none;
}
.hero-number {
	font-size: clamp(3rem, 8vw, 5rem);
	font-weight: 800;
	color: var(--accent);
	line-height: 1;
	position: relative;
}
.hero-tagline {
	font-size: 1.1rem;
	color: var(--text-dim);
	margin-top: 0.5rem;
	font-style: italic;
}
.hero-desc {
	font-size: 0.85rem;
	color: var(--text-faint);
	margin-top: 1rem;
	max-width: 600px;
	margin-left: auto;
	margin-right: auto;
	line-height: 1.7;
}

/* ── Stats Grid ──────────────────────────────────────────── */

.stats-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
	gap: 0.75rem;
	margin: 2rem 0;
}
.stat-card {
	background: var(--surface);
	border: 1px solid var(--border);
	border-top: 2px solid var(--accent);
	border-radius: 8px;
	padding: 1.25rem;
	text-align: center;
	transition: background 0.15s;
}
.stat-card:hover { background: var(--surface-raised); }
.stat-value {
	display: block;
	font-size: 1.75rem;
	font-weight: bold;
	color: var(--accent);
}
.stat-label {
	display: block;
	font-size: 0.7rem;
	color: var(--text-dim);
	margin-top: 0.4rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

/* ── Section headers ─────────────────────────────────────── */

.section-header {
	display: flex;
	align-items: baseline;
	gap: 1rem;
	margin-bottom: 1rem;
}
.section-header h1 { font-size: 1.4rem; }
.section-header .count {
	font-size: 0.8rem;
	color: var(--text-faint);
}

/* ── Tables ──────────────────────────────────────────────── */

.table-wrap { overflow-x: auto; margin: 0.5rem 0; }

table { width: 100%; border-collapse: collapse; }
th, td { padding: 0.65rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
th {
	color: var(--text-faint);
	font-size: 0.7rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	font-weight: 600;
}
td { font-size: 0.85rem; }
td a { color: var(--accent); text-decoration: none; }
td a:hover { text-decoration: underline; }
tr:hover { background: var(--surface-raised); }
tbody tr { transition: background 0.1s; }

/* ── Status badges ───────────────────────────────────────── */

.status {
	display: inline-block;
	padding: 0.15rem 0.5rem;
	border-radius: 4px;
	font-size: 0.72rem;
	font-weight: 600;
	white-space: nowrap;
}
.status-queued       { background: #1A2744; color: var(--blue); }
.status-assigned     { background: #1A2D1A; color: var(--accent); }
.status-diff_submitted { background: #2A1F44; color: var(--purple); }
.status-in_review    { background: #2A1F44; color: var(--purple); }
.status-approved     { background: #1A2D1A; color: var(--accent); }
.status-rejected     { background: #2D1A1A; color: var(--red); }
.status-pr_submitted { background: #0D2A2E; color: var(--cyan); }
.status-pr_merged    { background: #1A3A1A; color: var(--accent); border: 1px solid var(--accent-dim); }
.status-pr_closed    { background: #2D1F10; color: var(--orange); }
.status-timeout      { background: #2A2A2A; color: var(--text-dim); }
.status-idle         { background: #1A2744; color: var(--blue); }
.status-busy         { background: #1A2D1A; color: var(--accent); }
.status-reviewing    { background: #2A1F44; color: var(--purple); }
.status-offline      { background: #2D1A1A; color: var(--red); }

/* ── Rank badges ─────────────────────────────────────────── */

.rank { font-weight: bold; }
.rank-1 { color: var(--gold); }
.rank-2 { color: var(--silver); }
.rank-3 { color: var(--bronze); }

/* ── Empty states ────────────────────────────────────────── */

.empty-state {
	text-align: center;
	padding: 3rem;
	color: var(--text-dim);
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 8px;
}

/* ── Feed ────────────────────────────────────────────────── */

.feed { display: flex; flex-direction: column; gap: 0.5rem; }
.feed-item {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.75rem 1rem;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 6px;
	transition: background 0.15s;
}
.feed-item:hover { background: var(--surface-raised); }
.feed-item .feed-meta {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: 1rem;
}
.feed-item time { color: var(--text-faint); font-size: 0.75rem; }
.feed-item a { color: var(--accent); text-decoration: none; font-size: 0.85rem; }
.feed-issue { color: var(--text-dim); font-size: 0.8rem; }

/* ── Analytics ───────────────────────────────────────────── */

.analytics-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
	gap: 1rem;
	margin: 1.5rem 0;
}
.analytics-card {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 1.5rem;
}
.analytics-card h3 {
	font-size: 0.8rem;
	color: var(--text-dim);
	text-transform: uppercase;
	letter-spacing: 0.05em;
	margin-bottom: 1rem;
}

.bar-chart { display: flex; flex-direction: column; gap: 0.75rem; }
.bar-row { display: flex; align-items: center; gap: 0.75rem; }
.bar-label {
	width: 140px;
	font-size: 0.8rem;
	color: var(--text);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	flex-shrink: 0;
}
.bar-track {
	flex: 1;
	height: 20px;
	background: var(--surface-raised);
	border-radius: 4px;
	overflow: hidden;
	position: relative;
}
.bar-fill {
	height: 100%;
	border-radius: 4px;
	transition: width 0.3s ease;
}
.bar-fill-green { background: var(--accent); }
.bar-fill-red { background: var(--red); }
.bar-fill-teal { background: var(--teal); }
.bar-fill-purple { background: var(--purple); }
.bar-value {
	font-size: 0.75rem;
	color: var(--text-dim);
	min-width: 40px;
	text-align: right;
	flex-shrink: 0;
}

.model-table { margin-top: 1.5rem; }
.model-table .solve-rate { color: var(--accent); font-weight: bold; }
.model-table .merge-rate { color: var(--teal); font-weight: bold; }

/* ── How-it-works cards ──────────────────────────────────── */

.features {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
	gap: 1rem;
	margin: 2rem 0;
}
.feature-card {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 1.5rem;
}
.feature-card h3 {
	color: var(--accent);
	font-size: 0.95rem;
	margin-bottom: 0.5rem;
}
.feature-card p {
	color: var(--text-dim);
	font-size: 0.82rem;
	line-height: 1.7;
}

/* ── Code blocks ─────────────────────────────────────────── */

h1 { font-size: 1.4rem; margin-bottom: 1rem; }
h2 { font-size: 1.1rem; margin: 2rem 0 0.5rem; color: var(--text-dim); }
h3 { font-size: 0.95rem; margin: 1.25rem 0 0.5rem; }
p { margin-bottom: 0.75rem; line-height: 1.7; }

pre {
	background: var(--surface);
	border: 1px solid var(--border);
	padding: 1rem;
	border-radius: 6px;
	overflow-x: auto;
	margin: 0.5rem 0 1rem;
	font-size: 0.8rem;
	line-height: 1.6;
}
code { font-family: inherit; }
p code, li code, td code {
	background: var(--surface);
	padding: 0.1rem 0.35rem;
	border-radius: 3px;
	font-size: 0.85em;
}
pre code { background: none; padding: 0; }

/* ── Docs page ───────────────────────────────────────────── */

.docs-toc {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 1.5rem;
	margin-bottom: 2rem;
}
.docs-toc h3 {
	margin: 0 0 0.75rem;
	color: var(--accent);
	font-size: 0.8rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}
.docs-toc ul {
	list-style: none;
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem 1.5rem;
}
.docs-toc a { color: var(--text-dim); font-size: 0.82rem; }
.docs-toc a:hover { color: var(--accent); }

.docs-section {
	padding-top: 1rem;
	margin-bottom: 3rem;
	border-top: 1px solid var(--border);
}
.docs-section:first-of-type { border-top: none; }
.docs-section h2 { font-size: 1.3rem; color: var(--text); margin-bottom: 0.75rem; }
.docs-section h2 a { color: inherit; text-decoration: none; }
.docs-section h2 a:hover { color: var(--accent); }
.docs-section h3 { font-size: 0.95rem; color: var(--text-dim); margin-top: 1.5rem; margin-bottom: 0.5rem; }
.docs-section h4 { font-size: 0.85rem; color: var(--text); margin-top: 1.25rem; margin-bottom: 0.5rem; }
.docs-section p { color: var(--text); line-height: 1.7; }
.docs-section ul, .docs-section ol { margin: 0.5rem 0 1rem 1.5rem; line-height: 1.8; }
.docs-section li { margin-bottom: 0.25rem; }

/* Flow diagram */
.flow-diagram { display: flex; flex-direction: column; gap: 0; margin: 1.5rem 0; }
.flow-step {
	display: flex;
	align-items: flex-start;
	gap: 1rem;
	padding: 1rem;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 6px;
}
.flow-number {
	min-width: 2rem;
	height: 2rem;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--accent);
	color: var(--bg);
	border-radius: 50%;
	font-weight: bold;
	font-size: 0.85rem;
	flex-shrink: 0;
}
.flow-content { display: flex; flex-direction: column; gap: 0.25rem; }
.flow-content strong { color: var(--text); }
.flow-content span { color: var(--text-dim); font-size: 0.82rem; }
.flow-arrow { width: 2px; height: 0.75rem; background: var(--border); margin-left: 2rem; }

/* Mode cards */
.mode-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
.mode-card {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 1.25rem;
}
.mode-card h3 { margin: 0 0 0.5rem; display: flex; align-items: center; gap: 0.75rem; color: var(--text); }
.mode-card p { font-size: 0.82rem; margin-bottom: 0.75rem; }
.mode-card ul { font-size: 0.82rem; margin: 0.5rem 0 0 1.25rem; line-height: 1.7; }

.badge-trusted {
	display: inline-block;
	background: #1A2D2A;
	color: var(--teal);
	padding: 0.15rem 0.5rem;
	border-radius: 4px;
	font-size: 0.72rem;
	font-weight: 600;
}

/* Security list */
.security-list { counter-reset: security; list-style: none; margin-left: 0; padding: 0; }
.security-list li {
	counter-increment: security;
	padding: 1rem;
	margin-bottom: 0.5rem;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 6px;
}
.security-list li strong { color: var(--accent); display: block; margin-bottom: 0.25rem; }
.security-list li strong::before { content: counter(security) ". "; color: var(--text-dim); }
.security-list li p { margin: 0; font-size: 0.82rem; color: var(--text-dim); }

/* Reputation table */
.rep-positive { color: var(--accent); font-weight: bold; }
.rep-negative { color: var(--red); font-weight: bold; }

/* Transparency example */
.transparency-example {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 1.5rem;
	margin: 1rem 0;
}
.transparency-example h4 { margin: 0 0 0.75rem; color: var(--text); }
.transparency-example p { margin-bottom: 0.5rem; }
.transparency-example hr { border: none; border-top: 1px solid var(--border); margin: 1rem 0; }
.transparency-example blockquote {
	border-left: 3px solid var(--accent);
	padding-left: 1rem;
	color: var(--text-dim);
	font-size: 0.82rem;
}
.transparency-example blockquote p { margin-bottom: 0.5rem; color: var(--text-dim); }
.transparency-example blockquote ul { margin: 0.5rem 0 0.5rem 1.25rem; list-style: disc; }
.transparency-example blockquote a { color: var(--accent); }

/* ── Responsive ──────────────────────────────────────────── */

@media (max-width: 700px) {
	nav { padding: 0.5rem 1rem; }
	.nav-links { gap: 0.75rem; }
	.nav-links a { font-size: 0.75rem; }
	main { padding: 1rem; }
	.mode-cards { grid-template-columns: 1fr; }
	.hero-number { font-size: 2.5rem; }
	footer { flex-direction: column; gap: 0.5rem; text-align: center; }
}
`;
