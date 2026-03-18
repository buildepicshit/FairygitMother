import { html } from "hono/html";

export function layout(title: string, content: string, activeRoute = "") {
	const navLink = (href: string, label: string) =>
		html`<a href="${href}" class="${activeRoute === href ? "active" : ""}">${label}</a>`;

	return html`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${title} — FairygitMother</title>
	<script src="https://unpkg.com/htmx.org@2.0.4"></script>
	<link rel="stylesheet" href="/static/style.css" />
</head>
<body>
	<nav>
		<a href="/" class="logo">
			<span class="logo-icon">&#10024;</span>
			FairygitMother
		</a>
		<div class="nav-links">
			${navLink("/", "Grid")}
			${navLink("/bounties", "Bounties")}
			${navLink("/leaderboard", "Leaderboard")}
			${navLink("/analytics", "Analytics")}
			${navLink("/docs", "Docs")}
			${navLink("/feed", "Feed")}
		</div>
	</nav>
	<main>${content}</main>
	<footer>
		<span>FairygitMother — No token goes unused.</span>
		<a href="https://github.com/buildepicshit/FairygitMother" target="_blank">GitHub</a>
	</footer>
</body>
</html>`;
}
