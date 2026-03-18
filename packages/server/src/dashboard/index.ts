import { Hono } from "hono";
import type { FairygitMotherDb } from "../db/client.js";
import { layout } from "./layout.js";
import { analyticsPage } from "./pages/analytics.js";
import { bountiesPage } from "./pages/bounties.js";
import { docsPage } from "./pages/docs.js";
import { feedPage } from "./pages/feed.js";
import { homePage } from "./pages/home.js";
import { leaderboardPage } from "./pages/leaderboard.js";
import { CSS } from "./styles.js";

export function createDashboardRoutes(db: FairygitMotherDb) {
	const app = new Hono();

	app.get("/static/style.css", (c) => {
		c.header("Content-Type", "text/css");
		c.header("Cache-Control", "public, max-age=300");
		return c.body(CSS);
	});

	app.get("/", async (c) => {
		const content = await homePage(c, db);
		return c.html(layout("Grid Overview", content, "/"));
	});

	app.get("/bounties", async (c) => {
		const content = await bountiesPage(db);
		return c.html(layout("Bounties", content, "/bounties"));
	});

	app.get("/leaderboard", async (c) => {
		const content = await leaderboardPage(db);
		return c.html(layout("Leaderboard", content, "/leaderboard"));
	});

	app.get("/analytics", async (c) => {
		const content = await analyticsPage(db);
		return c.html(layout("Analytics", content, "/analytics"));
	});

	app.get("/docs", (c) => {
		const content = docsPage();
		return c.html(layout("Documentation", content, "/docs"));
	});

	app.get("/feed", async (c) => {
		const content = await feedPage(db);
		return c.html(layout("Feed", content, "/feed"));
	});

	return app;
}
