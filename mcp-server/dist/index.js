import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

//#region mcp-server/src/runtime/config.ts
const EGO_CLI_BLOCKED = new Set([
	"--status",
	"--stop",
	"--open",
	"--spaces",
	"--spaces-daemon",
	"--prune-spaces",
	"--import-chrome-profile",
	"--install-desktop-entry",
	"--help",
	"-h"
]);
function tokenizeArgs(input) {
	if (typeof input !== "string") return [];
	const out = [];
	let cur = "";
	let i = 0;
	let quote = null;
	while (i < input.length) {
		const c = input[i];
		if (quote) {
			if (c === "\\") {
				const next = input[i + 1];
				if (next !== void 0) {
					cur += next;
					i += 2;
					continue;
				}
			} else if (c === quote) {
				quote = null;
				i += 1;
				continue;
			}
			cur += c;
			i += 1;
			continue;
		}
		if (c === "\"" || c === "'") {
			quote = c;
			i += 1;
			continue;
		}
		if (c === "\\") {
			const next = input[i + 1];
			if (next !== void 0) {
				cur += next;
				i += 2;
				continue;
			}
			i += 1;
			continue;
		}
		if (c === " " || c === "	" || c === "\n" || c === "\r") {
			if (cur !== "") {
				out.push(cur);
				cur = "";
			}
			i += 1;
			continue;
		}
		cur += c;
		i += 1;
	}
	if (cur !== "") out.push(cur);
	return out;
}
function filterArgs(raw, blocked) {
	const tokens = tokenizeArgs(raw);
	const kept = [];
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		const key = tok.includes("=") ? tok.slice(0, tok.indexOf("=")) : tok;
		if (blocked.has(key)) {
			if (!tok.includes("=") && i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) i += 1;
			continue;
		}
		kept.push(tok);
	}
	return kept;
}
const COMMON_POSIX_CHROME_BINS = [
	"google-chrome-stable",
	"google-chrome",
	"chromium",
	"chromium-browser",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/opt/google/chrome/google-chrome"
];
function windowsChromeCandidates() {
	const pf = process.env.ProgramFiles;
	const pfx86 = process.env["ProgramFiles(x86)"];
	const local = process.env.LOCALAPPDATA;
	local || `${process.env.USERPROFILE || process.env.HOME || ""}`;
	const b = (p) => p ? p.replace(/\\+$/, "") : p;
	return [
		b(pf) + "\\Google\\Chrome\\Application\\chrome.exe",
		b(pfx86) + "\\Google\\Chrome\\Application\\chrome.exe",
		b(local) + "\\Google\\Chrome\\Application\\chrome.exe",
		b(pf) + "\\Microsoft\\Edge\\Application\\msedge.exe",
		b(pfx86) + "\\Microsoft\\Edge\\Application\\msedge.exe",
		b(local) + "\\Microsoft\\Edge\\Application\\msedge.exe",
		b(pfx86) + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
		b(local) + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
	].filter(Boolean);
}
function findChromeBinary(customPath) {
	if (customPath && customPath.trim() !== "") return customPath;
	if (process.env.EGO_LINUX_CHROME) return process.env.EGO_LINUX_CHROME;
	if (process.platform === "win32") {
		for (const p of windowsChromeCandidates()) try {
			if (existsSync(p)) return p;
		} catch {}
		const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean).map((e) => e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`);
		const dirs = (process.env.PATH ?? "").split(";").map((d) => d.replace(/^"|"$/g, "")).filter(Boolean);
		for (const dir of dirs) for (const name of [
			"chrome",
			"msedge",
			"brave"
		]) for (const ext of exts) try {
			const p = `${dir}\\${name}${ext}`;
			if (existsSync(p)) return p;
		} catch {}
		return;
	}
	for (const name of COMMON_POSIX_CHROME_BINS) if (name.includes("/")) try {
		if (existsSync(name)) return name;
	} catch {}
	else for (const dir of (process.env.PATH ?? "").split(":")) {
		if (!dir) continue;
		const p = `${dir}/${name}`;
		try {
			if (existsSync(p)) return p;
		} catch {}
	}
}
function resolveVendoredBin(overrideBin) {
	if (overrideBin && overrideBin.trim() !== "") return overrideBin;
	if (process.env.EGO_BROWSER_BIN && process.env.EGO_BROWSER_BIN.trim() !== "") return process.env.EGO_BROWSER_BIN;
	try {
		const currentDir = dirname(fileURLToPath(import.meta.url));
		const candidates = [
			resolve(currentDir, "../../../runtime/ego-linux/bin/ego-browser.mjs"),
			resolve(currentDir, "../../runtime/ego-linux/bin/ego-browser.mjs"),
			resolve(process.cwd(), "runtime/ego-linux/bin/ego-browser.mjs")
		];
		for (const cand of candidates) if (existsSync(cand)) return cand;
		return candidates[0];
	} catch {
		return resolve(process.cwd(), "runtime/ego-linux/bin/ego-browser.mjs");
	}
}
function resolveEgoEnv(config = {}, { platform = process.platform, baseEnv = process.env } = {}) {
	const env = { ...baseEnv };
	const chrome = config.chromePath || findChromeBinary(config.chromePath);
	if (env.EGO_LINUX_CHROME === void 0 && chrome) env.EGO_LINUX_CHROME = chrome;
	if (env.EGO_LINUX_HEADLESS === void 0) {
		if (platform !== "win32" && platform !== "darwin") {
			if (!env.DISPLAY) env.EGO_LINUX_HEADLESS = "1";
		}
	}
	const chromeArgs = config.chromeArgs;
	if (env.EGO_LINUX_EXTRA_ARGS === void 0 && typeof chromeArgs === "string" && chromeArgs.trim() !== "") env.EGO_LINUX_EXTRA_ARGS = chromeArgs;
	if (config.dataDir && !env.EGO_LINUX_DATA_DIR) env.EGO_LINUX_DATA_DIR = config.dataDir;
	if (!env.EGO_LINUX_CURSOR_NAME) env.EGO_LINUX_CURSOR_NAME = "Hermes";
	return env;
}
function createActiveSpaceTracker(defaultSpace = "hermes-agent") {
	let activeSpace = defaultSpace;
	let activeName = typeof defaultSpace === "string" ? defaultSpace : null;
	return {
		current: () => activeSpace,
		opened: (args, result) => {
			activeName = result?.name ?? (typeof args?.name === "string" ? args.name : String(defaultSpace));
			activeSpace = result?.id ?? activeName ?? defaultSpace;
		},
		selected: (space$1) => {
			if (space$1 !== void 0 && space$1 !== "") {
				activeSpace = space$1;
				activeName = typeof space$1 === "string" ? space$1 : null;
			}
		},
		closed: (space$1, done) => {
			if (done && (String(space$1) === String(activeSpace) || activeName !== null && String(space$1) === String(activeName))) {
				activeSpace = defaultSpace;
				activeName = typeof defaultSpace === "string" ? defaultSpace : null;
			}
		}
	};
}

//#endregion
//#region mcp-server/src/runtime/lock.ts
/**
* Sequential lock to serialize all ego-browser mutations and executions.
* Chrome is a single shared instance; concurrent executions would race on task spaces / tabs.
*/
var SequentialLock = class {
	chain = Promise.resolve();
	async run(fn) {
		const next = this.chain.then(() => fn(), () => fn());
		this.chain = next.then(() => void 0, () => void 0);
		return next;
	}
};
const globalLock = new SequentialLock();

//#endregion
//#region mcp-server/src/runtime/sentinel.ts
/**
* Sentinel marker and script formatting helpers.
*/
const SENTINEL = "@@HERMES_EGO_RESULT@@";
const j = (v) => JSON.stringify(v);
const num = (v, fallback) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const bool = (v, fallback) => typeof v === "boolean" ? v : fallback;
const SAFE_FN = "function safe(v){try{return JSON.parse(JSON.stringify(v))}catch{return String(v)}}\n";
const useSpace = (name) => `const task = await taskSpaces.useOrCreate(${j(name)})\n`;
const ensureRealTab = () => "const __tabs = await browser.listTabs()\nconst __real = __tabs.find(t => !t.url.startsWith('about:') && !t.url.startsWith('chrome://')) ?? __tabs[0]\nif (__real) await browser.switchTab(__real.targetId)\n";
/**
* Scan stdout from bottom to top, find the line with SENTINEL, and parse its JSON payload.
*/
function parseSentinel(stdout) {
	const lines = stdout.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const idx = lines[i].indexOf(SENTINEL);
		if (idx === -1) continue;
		const payload = lines[i].slice(idx + 21).trim();
		try {
			return JSON.parse(payload);
		} catch {
			return;
		}
	}
}

//#endregion
//#region mcp-server/src/runtime/runner.ts
const COLD_START_SIGNS = [
	/CDP channel is not open/i,
	/DevTools.*(port|timeout|active)/i,
	/could not connect to/i,
	/browser (was |is )?not (reachable|running|ready)/i,
	/target.*(closed|not found|detached|crashed)/i,
	/ECONNREFUSED/i
];
function isColdStartError(message) {
	return COLD_START_SIGNS.some((re) => re.test(message));
}
async function withWarmupRetry(fn, { tries = 3, baseDelayMs = 600 } = {}) {
	let last;
	for (let i = 0; i < tries; i++) {
		const result = await fn();
		if (result.ok || !isColdStartError(result.error ?? "")) return result;
		last = result;
		if (i < tries - 1) await new Promise((resolve$1) => setTimeout(resolve$1, baseDelayMs * (i + 1)));
	}
	return last;
}
function describeStderr(stderr) {
	const tail = stderr.trim();
	return tail === "" ? "" : `\n--- ego-browser stderr (tail) ---\n${tail.slice(-2e3)}`;
}
function describeSpawnFailure(err, egoBin) {
	const msg = err instanceof Error ? err.message : String(err);
	if (/ENOENT|spawn .* ENOENT|not found|could not load|cannot find module/i.test(msg)) return `ego-browser CLI could not be started (${egoBin}). Make sure a Chrome/Chromium is reachable, or set EGO_BROWSER_BIN. ${msg}`;
	return `failed to start ego-browser: ${msg}`;
}
function spawnProcess(command, args, options) {
	return new Promise((resolve$1) => {
		let child;
		try {
			child = spawn(command, args, {
				cwd: options.cwd || process.cwd(),
				env: options.env,
				stdio: [
					"pipe",
					"pipe",
					"pipe"
				]
			});
		} catch (err) {
			return resolve$1({
				exitCode: null,
				signal: null,
				stdout: "",
				stderr: "",
				timedOut: false,
				error: err instanceof Error ? err : new Error(String(err))
			});
		}
		let stdout = "";
		let stderr = "";
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let timedOut = false;
		let timer = null;
		if (options.timeoutMs && options.timeoutMs > 0) timer = setTimeout(() => {
			timedOut = true;
			try {
				child.kill("SIGTERM");
			} catch {}
			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {}
			}, 1500).unref();
		}, options.timeoutMs);
		const abortHandler = () => {
			timedOut = true;
			try {
				child.kill("SIGTERM");
			} catch {}
			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {}
			}, 1500).unref();
		};
		if (options.signal) if (options.signal.aborted) abortHandler();
		else options.signal.addEventListener("abort", abortHandler, { once: true });
		child.stdout?.on("data", (chunk) => {
			const len = chunk.length;
			stdoutBytes += len;
			if (stdout.length < options.maxStdoutBytes) stdout += chunk.toString("utf8", 0, Math.min(len, options.maxStdoutBytes - stdout.length));
		});
		child.stderr?.on("data", (chunk) => {
			const len = chunk.length;
			stderrBytes += len;
			if (stderr.length < options.maxStderrBytes) stderr += chunk.toString("utf8", 0, Math.min(len, options.maxStderrBytes - stderr.length));
		});
		child.on("error", (err) => {
			if (timer) clearTimeout(timer);
			if (options.signal) options.signal.removeEventListener("abort", abortHandler);
			resolve$1({
				exitCode: null,
				signal: null,
				stdout,
				stderr,
				timedOut,
				error: err
			});
		});
		child.on("close", (exitCode, signal) => {
			if (timer) clearTimeout(timer);
			if (options.signal) options.signal.removeEventListener("abort", abortHandler);
			resolve$1({
				exitCode,
				signal,
				stdout,
				stderr,
				timedOut
			});
		});
		if (child.stdin) if (options.input !== void 0) try {
			child.stdin.write(options.input);
			child.stdin.end();
		} catch {}
		else child.stdin.end();
	});
}
var NodeEgoRunner = class {
	config;
	lock;
	constructor(config, lock) {
		this.config = {
			...config,
			egoBin: resolveVendoredBin(config.egoBin)
		};
		this.lock = lock ?? globalLock;
	}
	async runScript(script, options) {
		return this.lock.run(async () => {
			return withWarmupRetry(() => this.spawnScriptOnce(script, options));
		});
	}
	async spawnScriptOnce(script, options) {
		const extraCliArgs = filterArgs(this.config.egoCliArgs ?? "", EGO_CLI_BLOCKED);
		const argv = [
			this.config.egoBin,
			"nodejs",
			...extraCliArgs
		];
		const timeoutMs = options?.timeoutMs ?? this.config.graceMs ?? 3e4;
		const outcome = await spawnProcess(process.execPath, argv, {
			cwd: process.cwd(),
			env: resolveEgoEnv(this.config),
			input: script,
			maxStdoutBytes: this.config.maxOutputBytes || 4 * 1024 * 1024,
			maxStderrBytes: 512 * 1024,
			timeoutMs,
			signal: options?.signal
		});
		if (outcome.error) return {
			ok: false,
			error: describeSpawnFailure(outcome.error, this.config.egoBin),
			stdout: outcome.stdout,
			stderr: outcome.stderr
		};
		if (outcome.timedOut || options?.signal && options.signal.aborted) return {
			ok: false,
			error: "ego-browser tool aborted (timeout or cancellation)",
			stdout: outcome.stdout,
			stderr: outcome.stderr
		};
		if (outcome.exitCode !== 0) return {
			ok: false,
			error: /Cannot find module|MODULE_NOT_FOUND/i.test(outcome.stderr) ? describeSpawnFailure(/* @__PURE__ */ new Error(`node could not load ${this.config.egoBin}`), this.config.egoBin) : `ego-browser exited with ${outcome.exitCode !== null ? `code ${outcome.exitCode}` : `signal ${String(outcome.signal)}`}${describeStderr(outcome.stderr)}`,
			stdout: outcome.stdout,
			stderr: outcome.stderr
		};
		const value = parseSentinel(outcome.stdout);
		if (value === void 0) return {
			ok: false,
			error: `ego-browser finished but no ${SENTINEL} JSON payload was found on stdout${describeStderr(outcome.stderr)}`,
			stdout: outcome.stdout,
			stderr: outcome.stderr
		};
		return {
			ok: true,
			value,
			stdout: outcome.stdout,
			stderr: outcome.stderr
		};
	}
	async getStatus() {
		const egoBin = this.config.egoBin;
		if (!existsSync(egoBin)) return {
			ok: true,
			available: false,
			path: egoBin,
			exitCode: null,
			error: `Runtime script not found at ${egoBin}`
		};
		try {
			const outcome = await spawnProcess(process.execPath, [egoBin, "--status"], {
				cwd: process.cwd(),
				env: resolveEgoEnv(this.config),
				maxStdoutBytes: 64 * 1024,
				maxStderrBytes: 64 * 1024,
				timeoutMs: 1e4
			});
			if (outcome.error) return {
				ok: true,
				available: false,
				path: egoBin,
				exitCode: null,
				error: outcome.error.message
			};
			return {
				ok: true,
				available: outcome.exitCode === 0,
				path: egoBin,
				exitCode: outcome.exitCode,
				error: outcome.exitCode !== 0 ? outcome.stderr.trim() : void 0
			};
		} catch (err) {
			return {
				ok: true,
				available: false,
				path: egoBin,
				exitCode: null,
				error: err instanceof Error ? err.message : String(err)
			};
		}
	}
};

//#endregion
//#region mcp-server/src/tools/spaces.ts
const spaceOpenSchema = z.object({ name: z.string().min(1).max(256).describe("Short name or identifier for the task space (e.g. \"search-task\").") });
const spaceCloseSchema = z.object({
	name: z.string().min(1).max(256).describe("Task-space name or numeric id to close."),
	keep: z.boolean().optional().default(false).describe("Keep the live page open (default false: close it).")
});
function registerSpaceTools(server, runner, tracker, isAllowed) {
	if (isAllowed("ego_browser_space_open")) server.registerTool("ego_browser_space_open", {
		description: "Open (or reuse) an ego-lite task space — an isolated browsing context that inherits your login state. It becomes the active space for later calls.",
		inputSchema: spaceOpenSchema
	}, async (args) => {
		try {
			const script = `${useSpace(args.name)}console.log('${SENTINEL}' + JSON.stringify({ ok: true, id: task.id ?? null, name: task.name ?? ${j(args.name)} }))\n`;
			const result = await runner.runScript(script);
			if (!result.ok) return {
				content: [{
					type: "text",
					text: JSON.stringify({
						ok: false,
						error: result.error
					}, null, 2)
				}],
				isError: true
			};
			const value = result.value ?? { ok: true };
			tracker.opened(args, value);
			return { content: [{
				type: "text",
				text: JSON.stringify({
					...value,
					activeSpace: tracker.current()
				}, null, 2)
			}] };
		} catch (err) {
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						ok: false,
						error: String(err)
					}, null, 2)
				}],
				isError: true
			};
		}
	});
	if (isAllowed("ego_browser_space_close")) server.registerTool("ego_browser_space_close", {
		description: "Complete (close) an ego-lite task space. Must be the final call for a task — never leave a space hanging. `keep: true` keeps the page open for the user.",
		inputSchema: spaceCloseSchema
	}, async (args) => {
		try {
			const keep = bool(args.keep, false);
			const script = `const res = await taskSpaces.complete(${j(args.name)}, { keep: ${keep} })\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, done: !!res.done, skipped: !!res.skipped, reason: res.skipped ? ${j("target space was not agent-owned")} : null }))\n`;
			const result = await runner.runScript(script);
			if (!result.ok) return {
				content: [{
					type: "text",
					text: JSON.stringify({
						ok: false,
						error: result.error
					}, null, 2)
				}],
				isError: true
			};
			const value = result.value ?? { ok: true };
			tracker.closed(args.name, !!value.done);
			return { content: [{
				type: "text",
				text: JSON.stringify({
					...value,
					activeSpace: tracker.current()
				}, null, 2)
			}] };
		} catch (err) {
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						ok: false,
						error: String(err)
					}, null, 2)
				}],
				isError: true
			};
		}
	});
}

//#endregion
//#region mcp-server/src/tools/shared.ts
/**
* Resolve the target space plus a commit callback for runTool. The space is
* returned without mutating the tracker; the commit callback promotes it to
* active and runTool invokes it only after a successful run.
*/
function prepareSpace(tracker, requested) {
	const space$1 = requested || tracker.current();
	return {
		space: space$1,
		commitSpace: requested !== void 0 ? () => tracker.selected(space$1) : void 0
	};
}
function textResult(value, active) {
	const payload = active === void 0 || value === null || typeof value !== "object" || Array.isArray(value) ? value : {
		...value,
		activeSpace: active
	};
	return { content: [{
		type: "text",
		text: JSON.stringify(payload, null, 2)
	}] };
}
function errorResult(error) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [{
			type: "text",
			text: JSON.stringify({
				ok: false,
				error: message
			}, null, 2)
		}],
		isError: true
	};
}
async function runTool(runner, script, options = {}) {
	try {
		const result = await runner.runScript(script, options.timeoutMs === void 0 ? void 0 : { timeoutMs: options.timeoutMs });
		if (!result.ok) return errorResult(result.error ?? "ego-browser command failed");
		const value = result.value ?? { ok: true };
		if (value !== null && typeof value === "object" && value.ok === false) {
			const record = value;
			return errorResult(typeof record.error === "string" && record.error !== "" ? record.error : typeof record.reason === "string" && record.reason !== "" ? record.reason : "ego-browser command failed");
		}
		if (options.active !== void 0 && options.commitSpace) options.commitSpace(options.active);
		return textResult(value, options.active);
	} catch (error) {
		return errorResult(error);
	}
}
/**
* Where an artifact (screenshot/download) should be written when the caller gave no path.
* Returning a path inside a known output directory is what lets the agent host attach the
* file to a chat message (Discord/Telegram) instead of quoting a path the user cannot open.
*/
function defaultArtifactPath(outputDir, prefix, ext) {
	if (!outputDir || outputDir.trim() === "" || !isAbsolute(outputDir)) return void 0;
	try {
		mkdirSync(outputDir, { recursive: true });
	} catch {
		return;
	}
	return join(outputDir, `${prefix}-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}${ext}`);
}

//#endregion
//#region mcp-server/src/tools/navigation.ts
const navigateSchema = z.object({
	url: z.string().url().max(2048).describe("Absolute http(s) URL to open, e.g. https://example.com/path."),
	wait: z.boolean().optional().default(true).describe("Wait for document load (default true)."),
	timeout: z.number().int().min(500).max(12e4).optional().default(2e4).describe("Load wait timeout in ms (default 20000)."),
	space: z.string().max(256).optional().describe("Task-space name or id; defaults to the active space.")
});
function isHttpUrl(value) {
	try {
		const u = new URL(value);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}
function registerNavigationTools(server, runner, tracker, isAllowed) {
	if (isAllowed("ego_browser_navigate")) server.registerTool("ego_browser_navigate", {
		description: "Open a URL in the task space, or switch to the existing tab for it. Waits for document load. Returns resulting page info. Only http(s) URLs are accepted.",
		inputSchema: navigateSchema
	}, async (args) => {
		try {
			const u = args.url;
			if (!isHttpUrl(u)) return errorResult(`Unsupported URL scheme. Only http and https are allowed: ${u}`);
			const targetSpace = args.space || tracker.current();
			const wait = bool(args.wait, true);
			const timeout = num(args.timeout, 2e4);
			const script = `${useSpace(targetSpace)}${ensureRealTab()}const __existing = __tabs.find(t => t.url.split('#')[0] === ${j(u.split("#")[0])})\nconst tab = __existing ? await browser.switchTab(__existing.targetId) : await page.goto(${j(u)}, { wait: ${wait}, timeout: ${timeout} })\nconst pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, reused: !!__existing, page: pginfo }))\n`;
			const result = await runner.runScript(script, { timeoutMs: timeout + 15e3 });
			if (!result.ok) return errorResult(result.error);
			const value = result.value ?? { ok: true };
			if (args.space) tracker.selected(args.space);
			return textResult({
				...value,
				activeSpace: tracker.current()
			}, void 0);
		} catch (err) {
			return errorResult(err);
		}
	});
}

//#endregion
//#region mcp-server/src/tools/observation.ts
const snapshotSchema = z.object({
	space: z.string().min(1).max(256).optional(),
	scope: z.enum(["full_page", "only_within_viewport"]).optional().default("full_page"),
	maxChars: z.number().int().min(1e3).max(2e5).optional().default(2e4).describe("Truncate the returned tree at this many characters (default 20000) to keep long chat sessions affordable.")
});
const pageInfoSchema = z.object({ space: z.string().min(1).max(256).optional() });
function registerObservationTools(server, runner, tracker, isAllowed) {
	if (isAllowed("ego_browser_snapshot")) server.registerTool("ego_browser_snapshot", {
		description: "Read the current page semantic tree as text annotated with refs and stable locators. Retries briefly when a just-navigated page returns an empty capture.",
		inputSchema: snapshotSchema
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		const call = `await page.snapshotRaw({ scope: ${j(args.scope)} })`;
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}let s = ${call}\nlet tries = 0\nwhile (!(s.content ?? '') && tries < 3) { await page.waitForTimeout(400); s = ${call}; tries++ }\nconst full = s.content ?? ''\nconst text = full.slice(0, ${args.maxChars})\nconsole.log('${SENTINEL}' + JSON.stringify(full === '' ? { ok: false, text, tries, reason: 'snapshot returned no content after retries' } : { ok: true, text, tries, totalChars: full.length, truncated: full.length > ${args.maxChars} }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: 3e4
		});
	});
	if (isAllowed("ego_browser_page_info")) server.registerTool("ego_browser_page_info", {
		description: "Return current page URL, title, viewport, scroll offsets, dimensions, and dialog state.",
		inputSchema: pageInfoSchema
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}const pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, page: pginfo }))\n`, {
			active: space$1,
			commitSpace
		});
	});
}

//#endregion
//#region mcp-server/src/tools/interaction.ts
const clickSchema = z.object({
	selector: z.string().min(1).max(4096).optional(),
	x: z.number().finite().min(0).max(1e5).optional(),
	y: z.number().finite().min(0).max(1e5).optional(),
	label: z.string().min(1).max(120).optional(),
	double: z.boolean().optional().default(false),
	space: z.string().min(1).max(256).optional(),
	timeout: z.number().int().min(500).max(12e4).optional().default(2e4)
}).refine((v) => Boolean(v.selector) || v.x !== void 0 && v.y !== void 0, { message: "Provide selector or both x and y coordinates." });
const fillSchema = z.object({
	selector: z.string().min(1).max(4096),
	text: z.string().max(1e6),
	space: z.string().min(1).max(256).optional(),
	timeout: z.number().int().min(500).max(12e4).optional().default(2e4)
});
const waitSchema = z.object({
	ms: z.number().int().min(0).max(12e4),
	space: z.string().min(1).max(256).optional()
});
const screenshotSchema = z.object({
	selector: z.string().min(1).max(4096).optional(),
	path: z.string().min(1).max(32768).optional(),
	space: z.string().min(1).max(256).optional()
});
function registerInteractionTools(server, runner, tracker, isAllowed, config = {}) {
	if (isAllowed("ego_browser_click")) server.registerTool("ego_browser_click", {
		description: "Click a selector/ref/locator or viewport coordinates in the current task space.",
		inputSchema: clickSchema
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		let action;
		if (args.selector) {
			const options = args.label ? `{ label: ${j(args.label)} }` : "";
			action = args.double ? `await page.locator(${j(args.selector)}).dblclick(${options})` : `await page.locator(${j(args.selector)}).click(${options})`;
		} else action = args.double ? `await page.mouse.dblclick(${args.x}, ${args.y})` : `await page.mouse.click(${args.x}, ${args.y})`;
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}${action}\nconst pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, double: ${args.double}, page: pginfo }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: args.timeout + 15e3
		});
	});
	if (isAllowed("ego_browser_fill")) server.registerTool("ego_browser_fill", {
		description: "Replace the value of an input identified by CSS, xpath, loc, or snapshot ref.",
		inputSchema: fillSchema
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}await page.locator(${j(args.selector)}).fill(${j(args.text)})\nconst pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, page: pginfo }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: args.timeout + 15e3
		});
	});
	if (isAllowed("ego_browser_wait")) server.registerTool("ego_browser_wait", {
		description: "Pause the current task space for a bounded number of milliseconds.",
		inputSchema: waitSchema
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		return runTool(runner, `${useSpace(space$1)}await page.waitForTimeout(${args.ms})\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, waitedMs: ${args.ms} }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: args.ms + 15e3
		});
	});
	if (isAllowed("ego_browser_screenshot")) server.registerTool("ego_browser_screenshot", {
		description: "Capture a page or element screenshot and return its absolute file path. With EGO_BROWSER_OUTPUT_DIR set, the file lands there so the agent host can attach it to the chat.",
		inputSchema: screenshotSchema
	}, async (args) => {
		if (args.path && !isAbsolute(args.path)) return errorResult("Screenshot path must be absolute.");
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		const target = args.path ?? defaultArtifactPath(config.outputDir, "shot", ".png");
		const options = target ? `{ path: ${j(target)} }` : "";
		const shot = args.selector ? `await page.locator(${j(args.selector)}).screenshot(${options})` : `await page.screenshot(${options})`;
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}const path = ${shot}\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, path }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: 45e3
		});
	});
}

//#endregion
//#region mcp-server/src/tools/artifacts.ts
const uploadSchema = z.object({
	selector: z.string().min(1).max(4096),
	path: z.string().min(1).max(32768),
	space: z.string().min(1).max(256).optional()
});
const downloadSchema = z.object({
	triggerSelector: z.string().min(1).max(4096).optional(),
	savePath: z.string().min(1).max(32768).optional(),
	timeout: z.number().int().min(500).max(12e4).optional().default(3e4),
	space: z.string().min(1).max(256).optional()
});
function registerArtifactTools(server, runner, tracker, isAllowed, config = {}) {
	if (isAllowed("ego_browser_upload")) server.registerTool("ego_browser_upload", {
		description: "Set a verified local file on an input[type=file] element.",
		inputSchema: uploadSchema
	}, async (args) => {
		if (!isAbsolute(args.path)) return errorResult("Upload path must be absolute.");
		if (!existsSync(args.path)) return errorResult(`Upload file does not exist: ${args.path}`);
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}await page.locator(${j(args.selector)}).setInputFiles(${j(args.path)})\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, upload: ${j(args.selector)}, path: ${j(args.path)} }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: 45e3
		});
	});
	if (isAllowed("ego_browser_download")) server.registerTool("ego_browser_download", {
		description: "Wait for a browser download, optionally clicking a selector to trigger it, and return the saved path and metadata. Arbitrary trigger scripts are intentionally not allowed in the safe tool.",
		inputSchema: downloadSchema
	}, async (args) => {
		if (args.savePath && !isAbsolute(args.savePath)) return errorResult("Download savePath must be absolute.");
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		const saveDir = args.savePath ? void 0 : defaultArtifactPath(config.outputDir, "dl", "");
		const trigger = args.triggerSelector ? `await page.locator(${j(args.triggerSelector)}).click()\n` : "/* waiting for a download initiated by an earlier action */\n";
		const save = args.savePath ? `const __final = await __dl.saveAs(${j(args.savePath)}).catch(() => null)\n` : saveDir ? `const __final = await __dl.saveAs(${j(saveDir)} + (__name ? '-' + __name : '.bin')).catch(() => null)\n` : "const __final = await __dl.path().catch(() => null)\n";
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}const __dlPromise = page.waitForEvent('download', { timeout: ${args.timeout} })\n` + trigger + "const __dl = await __dlPromise\nconst __name = typeof __dl.suggestedFilename === 'function' ? __dl.suggestedFilename() : null\nconst __url = typeof __dl.url === 'function' ? __dl.url() : null\n" + save + `console.log('${SENTINEL}' + JSON.stringify(__final ? { ok: true, path: __final, suggestedFilename: __name, url: __url } : { ok: false, error: 'download completed but no file path was produced (saveAs failed)', suggestedFilename: __name, url: __url }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: args.timeout + 15e3
		});
	});
}

//#endregion
//#region mcp-server/src/tools/input.ts
const spaceArg$1 = z.string().min(1).max(256).optional().describe("Task-space name or id; defaults to the active space.");
const pressSchema = z.object({
	key: z.string().min(1).max(200).optional().describe("Key or combo to press, e.g. \"Enter\", \"Tab\", \"Escape\", \"Control+a\"."),
	text: z.string().max(1e5).optional().describe("Text to type with real key events (for editors that ignore fill)."),
	selector: z.string().min(1).max(4096).optional().describe("Optional CSS/xpath/ref/loc selector to focus before typing or pressing."),
	space: spaceArg$1
}).refine((v) => Boolean(v.key) || Boolean(v.text), { message: "Provide key, text, or both." });
const scrollSchema = z.object({
	dy: z.number().int().min(-1e5).max(1e5).optional().default(600).describe("Vertical scroll in CSS pixels (positive scrolls down)."),
	dx: z.number().int().min(-1e5).max(1e5).optional().default(0).describe("Horizontal scroll in CSS pixels."),
	space: spaceArg$1
});
const dialogSchema = z.object({
	accept: z.boolean().describe("true accepts (OK) the open native dialog, false dismisses it (Cancel)."),
	promptText: z.string().max(4096).optional().describe("Text to submit when the dialog is a prompt()."),
	space: spaceArg$1
});
function registerInputTools(server, runner, tracker, isAllowed) {
	if (isAllowed("ego_browser_press")) server.registerTool("ego_browser_press", {
		description: "Send real keyboard input: type text and/or press a key combo, optionally focusing a selector first. Use this to submit a search box with \"Enter\" after fill.",
		inputSchema: pressSchema
	}, async (args) => {
		if (!args.key && !args.text) return errorResult("Provide key, text, or both.");
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		const focus = args.selector ? `await page.locator(${j(args.selector)}).focus()\n` : "";
		const type = args.text ? `await page.keyboard.type(${j(args.text)})\n` : "";
		const press = args.key ? `await page.keyboard.press(${j(args.key)})\n` : "";
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}${focus}${type}${press}const pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, typed: ${j(args.text ?? null)}, pressed: ${j(args.key ?? null)}, page: pginfo }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: 45e3
		});
	});
	if (isAllowed("ego_browser_scroll")) server.registerTool("ego_browser_scroll", {
		description: "Scroll the page with a real wheel event and return the new scroll offsets. Needed for lazy-loaded and infinite-scroll content that a snapshot cannot reach.",
		inputSchema: scrollSchema
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}const __before = await page.info()\nawait page.mouse.wheel(${args.dx}, ${args.dy})\nawait page.waitForTimeout(400)\nconst pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, dx: ${args.dx}, dy: ${args.dy}, movedY: (pginfo.sy ?? 0) - (__before.sy ?? 0), page: pginfo }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: 45e3
		});
	});
	if (isAllowed("ego_browser_dialog")) server.registerTool("ego_browser_dialog", {
		description: "Accept or dismiss an open native alert/confirm/prompt dialog. Call this when page_info reports a `dialog` field — page JavaScript stays blocked until the dialog is handled.",
		inputSchema: dialogSchema
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		const params = args.promptText === void 0 ? `{ accept: ${args.accept} }` : `{ accept: ${args.accept}, promptText: ${j(args.promptText)} }`;
		return runTool(runner, `${useSpace(space$1)}await cdp('Page.handleJavaScriptDialog', ${params})\nconst pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, accepted: ${args.accept}, page: pginfo }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: 3e4
		});
	});
}

//#endregion
//#region mcp-server/src/tools/control.ts
const spaceArg = z.string().min(1).max(256).optional().describe("Task-space name or id; defaults to the active space.");
const controlSchema = z.object({
	action: z.enum(["handoff", "takeover"]).describe("handoff: give browser control to the human (login, CAPTCHA, payment). takeover: resume control — only after the user explicitly confirms they are done."),
	space: spaceArg
});
const spaceListSchema = z.object({});
const tabsSchema = z.object({
	action: z.enum([
		"list",
		"close",
		"switch"
	]).describe("list all tabs, close one, or switch to one."),
	targetId: z.string().min(1).max(256).optional().describe("Tab targetId from a previous list; close without it closes the current tab."),
	space: spaceArg
});
function registerControlTools(server, runner, tracker, isAllowed) {
	if (isAllowed("ego_browser_control")) server.registerTool("ego_browser_control", {
		description: "Hand browser control to the human, or take it back. Only one side holds control at a time: while the user holds it, every other browser call fails with \"user is controlling\". Never take over without an explicit user confirmation.",
		inputSchema: controlSchema
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		return runTool(runner, args.action === "handoff" ? `const res = await taskSpaces.handOff(${j(space$1)})\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, action: 'handoff', done: !!res?.done, skipped: res?.skipped ?? null }))\n` : `await taskSpaces.takeOver(${j(space$1)})\nconst pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, action: 'takeover', done: true, page: pginfo }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: 3e4
		});
	});
	if (isAllowed("ego_browser_space_list")) server.registerTool("ego_browser_space_list", {
		description: "List every task space the runtime knows about, with id, name and ownership. Use it to recover a space after a gateway restart, or to find leftover spaces to close.",
		inputSchema: spaceListSchema
	}, async () => {
		return runTool(runner, `const __spaces = await taskSpaces.list()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, spaces: (__spaces ?? []).map(s => ({ id: s.id ?? null, name: s.name ?? null, ownership: s.ownership ?? null, tabs: s.recentTabTitles ?? [] })) }))\n`, { timeoutMs: 3e4 });
	});
	if (isAllowed("ego_browser_tabs")) server.registerTool("ego_browser_tabs", {
		description: "List, close, or switch tabs inside the task space. Close scratch tabs as you go — navigate reuses tabs by URL, so they otherwise accumulate for the whole session.",
		inputSchema: tabsSchema
	}, async (args) => {
		if (args.action === "switch" && !args.targetId) return errorResult("tabs switch requires targetId (get one from tabs list).");
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		const target = args.targetId ? j(args.targetId) : "undefined";
		const body = args.action === "list" ? `const __tabs = await browser.listTabs()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, tabs: (__tabs ?? []).map(t => ({ targetId: t.targetId, url: t.url, title: t.title, active: !!t.active })) }))\n` : args.action === "close" ? `await browser.closeTab(${target})\nconst __tabs = await browser.listTabs()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, closed: ${target} ?? 'current', remaining: (__tabs ?? []).length }))\n` : `await browser.switchTab(${target})\nconst pginfo = await page.info()\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, switched: ${target}, page: pginfo }))\n`;
		return runTool(runner, `${useSpace(space$1)}${body}`, {
			active: space$1,
			commitSpace,
			timeoutMs: 3e4
		});
	});
}

//#endregion
//#region mcp-server/src/tools/advanced.ts
const ADVANCED_TOOLS = [
	"ego_browser_js",
	"ego_browser_cdp",
	"ego_browser_cli",
	"ego_browser_http"
];
const space = z.string().min(1).max(256).optional();
function registerAdvancedTools(server, runner, tracker, enabled, isAllowed) {
	if (!enabled) return;
	if (isAllowed("ego_browser_js")) server.registerTool("ego_browser_js", {
		description: "ADVANCED: evaluate a JavaScript expression in the current page.",
		inputSchema: z.object({
			expression: z.string().min(1).max(1e5),
			space
		})
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}${SAFE_FN}const result = await page.evaluate(${j(args.expression)})\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, result: safe(result) }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: 12e4
		});
	});
	if (isAllowed("ego_browser_cdp")) server.registerTool("ego_browser_cdp", {
		description: "ADVANCED: issue a raw Chrome DevTools Protocol command.",
		inputSchema: z.object({
			method: z.string().regex(/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/).max(200),
			params: z.record(z.string(), z.unknown()).optional(),
			space
		})
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		const call = args.params ? `await cdp(${j(args.method)}, ${j(args.params)})` : `await cdp(${j(args.method)})`;
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}${SAFE_FN}const result = ${call}\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, result: safe(result) }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: 12e4
		});
	});
	if (isAllowed("ego_browser_cli")) server.registerTool("ego_browser_cli", {
		description: "ADVANCED: execute an arbitrary ego-browser Node script. Disabled unless explicitly enabled and allowlisted.",
		inputSchema: z.object({ script: z.string().min(1).max(2e5) })
	}, async (args) => {
		return runTool(runner, `${args.script}\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true }))\n`, { timeoutMs: 12e4 });
	});
	if (isAllowed("ego_browser_http")) server.registerTool("ego_browser_http", {
		description: "ADVANCED: make an HTTP request from the browser context.",
		inputSchema: z.object({
			url: z.string().url().max(4096),
			method: z.enum([
				"GET",
				"POST",
				"PUT",
				"PATCH",
				"DELETE",
				"HEAD"
			]).optional().default("GET"),
			headers: z.record(z.string(), z.string()).optional().default({}),
			body: z.string().max(2e6).optional(),
			timeout: z.number().int().min(500).max(12e4).optional().default(2e4),
			space
		})
	}, async (args) => {
		const { space: space$1, commitSpace } = prepareSpace(tracker, args.space);
		const options = {
			method: args.method,
			headers: args.headers,
			timeout: args.timeout
		};
		if (args.body !== void 0) options.body = args.body;
		return runTool(runner, `${useSpace(space$1)}${ensureRealTab()}${SAFE_FN}const result = await fetch.browser(${j(args.url)}, ${j(options)})\nconst status = typeof result.status !== 'undefined' ? result.status : 200\nlet body = null\ntry { body = typeof result.text === 'function' ? await result.text() : JSON.stringify(safe(result)) } catch { body = null }\nconsole.log('${SENTINEL}' + JSON.stringify({ ok: true, status, body, url: ${j(args.url)} }))\n`, {
			active: space$1,
			commitSpace,
			timeoutMs: args.timeout + 15e3
		});
	});
}

//#endregion
//#region mcp-server/src/index.ts
const envToolList = process.env.EGO_BROWSER_TOOLS;
const DEFAULT_CONFIG = {
	egoBin: process.env.EGO_BROWSER_BIN || "",
	defaultSpace: "hermes-agent",
	maxOutputBytes: 4 * 1024 * 1024,
	graceMs: 15e3,
	enableAdvanced: process.env.EGO_BROWSER_ENABLE_ADVANCED === "true",
	outputDir: process.env.EGO_BROWSER_OUTPUT_DIR || void 0,
	allowedTools: envToolList === void 0 ? void 0 : envToolList.split(",").map((name) => name.trim()).filter(Boolean)
};
const DEFAULT_SAFE_TOOLS = [
	"ego_browser_status",
	"ego_browser_space_open",
	"ego_browser_space_close",
	"ego_browser_navigate",
	"ego_browser_snapshot",
	"ego_browser_page_info",
	"ego_browser_click",
	"ego_browser_fill",
	"ego_browser_wait",
	"ego_browser_press",
	"ego_browser_scroll",
	"ego_browser_dialog",
	"ego_browser_screenshot",
	"ego_browser_download",
	"ego_browser_upload",
	"ego_browser_control",
	"ego_browser_space_list",
	"ego_browser_tabs"
];
function createMcpServer(userConfig, customRunner) {
	const config = {
		...DEFAULT_CONFIG,
		...userConfig
	};
	const runner = customRunner ?? new NodeEgoRunner(config);
	const tracker = createActiveSpaceTracker(config.defaultSpace);
	const isAllowed = (name) => {
		if (config.allowedTools !== void 0) return config.allowedTools.includes(name);
		return DEFAULT_SAFE_TOOLS.includes(name) || config.enableAdvanced === true && ADVANCED_TOOLS.includes(name);
	};
	const server = new McpServer({
		name: "hermes-ego-browser",
		version: "0.2.0"
	});
	if (isAllowed("ego_browser_status")) server.registerTool("ego_browser_status", { description: "Check whether the ego-browser runtime is available and reachable." }, async () => {
		try {
			const status = await runner.getStatus();
			return { content: [{
				type: "text",
				text: JSON.stringify(status, null, 2)
			}] };
		} catch (err) {
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						ok: false,
						available: false,
						error: err?.message ?? String(err)
					})
				}],
				isError: true
			};
		}
	});
	registerSpaceTools(server, runner, tracker, isAllowed);
	registerNavigationTools(server, runner, tracker, isAllowed);
	registerObservationTools(server, runner, tracker, isAllowed);
	registerInteractionTools(server, runner, tracker, isAllowed, config);
	registerInputTools(server, runner, tracker, isAllowed);
	registerArtifactTools(server, runner, tracker, isAllowed, config);
	registerControlTools(server, runner, tracker, isAllowed);
	registerAdvancedTools(server, runner, tracker, config.enableAdvanced === true, isAllowed);
	return server;
}
async function main() {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) main().catch((err) => {
	console.error("Fatal error in hermes-ego-browser MCP server:", err);
	process.exit(1);
});

//#endregion
export { DEFAULT_CONFIG, DEFAULT_SAFE_TOOLS, NodeEgoRunner, createMcpServer, main };