import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActiveSpaceTracker } from '../runtime/config.ts'
import { j, SENTINEL, useSpace } from '../runtime/sentinel.ts'
import type { EgoRunner } from '../types.ts'
import { errorResult, prepareSpace, runTool } from './shared.ts'

const spaceArg = z.string().min(1).max(256).optional().describe('Task-space name or id; defaults to the active space.')

export const controlSchema = z.object({
  action: z
    .enum(['handoff', 'takeover'])
    .describe(
      'handoff: give browser control to the human (login, CAPTCHA, payment). takeover: resume control — only after the user explicitly confirms they are done.',
    ),
  space: spaceArg,
})

export const spaceListSchema = z.object({})

export const tabsSchema = z.object({
  action: z.enum(['list', 'close', 'switch']).describe('list all tabs, close one, or switch to one.'),
  targetId: z.string().min(1).max(256).optional().describe('Tab targetId from a previous list; close without it closes the current tab.'),
  space: spaceArg,
})

export function registerControlTools(
  server: McpServer,
  runner: EgoRunner,
  tracker: ActiveSpaceTracker,
  isAllowed: (name: string) => boolean,
): void {
  if (isAllowed('ego_browser_control')) {
    server.registerTool(
      'ego_browser_control',
      {
        description:
          'Hand browser control to the human, or take it back. Only one side holds control at a time: while the user holds it, every other browser call fails with "user is controlling". Never take over without an explicit user confirmation.',
        inputSchema: controlSchema,
      },
      async (args) => {
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const body =
          args.action === 'handoff'
            ? `const res = await taskSpaces.handOff(${j(space)})\n` +
              `console.log('${SENTINEL}' + JSON.stringify({ ok: true, action: 'handoff', done: !!res?.done, ` +
              `skipped: res?.skipped ?? null }))\n`
            : `await taskSpaces.takeOver(${j(space)})\n` +
              `const pginfo = await page.info()\n` +
              `console.log('${SENTINEL}' + JSON.stringify({ ok: true, action: 'takeover', done: true, page: pginfo }))\n`
        // No useOrCreate here: handOff/takeOver select the space themselves, and
        // useOrCreate throws once the space is delegated to the user.
        return runTool(runner, body, { active: space, commitSpace, timeoutMs: 30_000 })
      },
    )
  }

  if (isAllowed('ego_browser_space_list')) {
    server.registerTool(
      'ego_browser_space_list',
      {
        description:
          'List every task space the runtime knows about, with id, name and ownership. Use it to recover a space after a gateway restart, or to find leftover spaces to close.',
        inputSchema: spaceListSchema,
      },
      async () => {
        const script =
          `const __spaces = await taskSpaces.list()\n` +
          `console.log('${SENTINEL}' + JSON.stringify({ ok: true, spaces: (__spaces ?? []).map(s => (` +
          `{ id: s.id ?? null, name: s.name ?? null, ownership: s.ownership ?? null, tabs: s.recentTabTitles ?? [] })) }))\n`
        return runTool(runner, script, { timeoutMs: 30_000 })
      },
    )
  }

  if (isAllowed('ego_browser_tabs')) {
    server.registerTool(
      'ego_browser_tabs',
      {
        description:
          'List, close, or switch tabs inside the task space. Close scratch tabs as you go — navigate reuses tabs by URL, so they otherwise accumulate for the whole session.',
        inputSchema: tabsSchema,
      },
      async (args) => {
        if (args.action === 'switch' && !args.targetId) {
          return errorResult('tabs switch requires targetId (get one from tabs list).')
        }
        const { space, commitSpace } = prepareSpace(tracker, args.space)
        const target = args.targetId ? j(args.targetId) : 'undefined'
        const body =
          args.action === 'list'
            ? `const __tabs = await browser.listTabs()\n` +
              `console.log('${SENTINEL}' + JSON.stringify({ ok: true, tabs: (__tabs ?? []).map(t => (` +
              `{ targetId: t.targetId, url: t.url, title: t.title, active: !!t.active })) }))\n`
            : args.action === 'close'
              ? `await browser.closeTab(${target})\n` +
                `const __tabs = await browser.listTabs()\n` +
                `console.log('${SENTINEL}' + JSON.stringify({ ok: true, closed: ${target} ?? 'current', remaining: (__tabs ?? []).length }))\n`
              : `await browser.switchTab(${target})\n` +
                `const pginfo = await page.info()\n` +
                `console.log('${SENTINEL}' + JSON.stringify({ ok: true, switched: ${target}, page: pginfo }))\n`
        const script = `${useSpace(space)}${body}`
        return runTool(runner, script, { active: space, commitSpace, timeoutMs: 30_000 })
      },
    )
  }
}
