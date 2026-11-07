# Changelog

## 0.2.3 (2026-11-08)

- The "More free viewers" list and the README now use the current Marketplace names and include the newest Zovo extensions: ZIP, GCode, EPUB, HAR, font and audio viewers.

## 0.2.2 (2026-11-07)

- Claude Code Team plans now show their weekly limit. Claude Code saves it in a newer `limits` list and leaves the old weekly field empty, so 0.2.0 showed only the 5-hour limit for those accounts. A weekly limit for one model, such as "weekly Fable", now shows in the tooltip and on the dashboard for every plan.

## 0.2.1 (2026-11-07)

- "More free viewers" now starts with the Zovo extensions most related to this one. Picking one opens its Marketplace page, where you choose to install it.
- The README has a "Support Zovo" section with GitHub Sponsors and the developer's GitHub profile, and "More tools by Zovo" lists related extensions.

## 0.2.0 (2026-11-07)

- Your Claude Code 5-hour and weekly limit in percent, in the status bar and on the dashboard. The meter reads the reading Claude Code saves in its own config file, so it needs no login, no token and no network call. Weekly Opus and Sonnet limits show when your plan has them, and a window that has reset since the last reading says "reset".
- Gemini CLI usage: tokens and estimated cost from `~/.gemini/tmp/<project>/chats`, in the status bar, the tiles, the chart and every table.
- Several Claude Code accounts. Other config folders such as `~/.claude-work` and `~/.config/claude` are found on their own, each with its own limits, and a new table splits usage by account. Turn this off with `aiUsageMeter.findClaudeAccounts`.
- The item turns yellow when any limit, Claude Code or Codex, reaches 90%.
- New name: Claude Code Usage, Codex Usage & Gemini CLI Usage Meter.

## 0.1.3 (2026-11-07)

- The footer under the viewer has a "Rate" link next to Sponsor and More free viewers. It opens the review page of this extension on the Marketplace. Nothing pops up and nothing asks you for a rating. "Hide" still hides the whole line.

## 0.1.2 (2026-11-07)

- The "More free viewers" list and the README list now show the 15 Zovo extensions on the Marketplace under their current names, and 12 that are coming soon.
- Extensions for related files now come first, starting with Claude Code History & Codex History Viewer and Agent Skills & Claude Skills (Skill Shelf).

## 0.1.1 (2026-11-06)

- New `.github/FUNDING.yml`, so the GitHub repository shows a Sponsor button like the Marketplace listing does.
- The "More free viewers" list now has the newest Zovo extensions and the current ids of JSONL Viewer and Graphviz Preview.
- The README has a short Support section and lists all Zovo extensions, with the ones that are not on the Marketplace yet linked to GitHub.
- The repository, homepage and issues links in the listing now point to the real repository, theluckystrike/ai-usage-meter-vscode.

## 0.1.0

- First release.
- Status bar item with today's Claude Code and Codex tokens and estimated cost, the time left in the Claude Code 5-hour block and the Codex rate limits.
- Dashboard with totals per day, project folder, model and tool, split into input, output, cache write and cache read, and a chart of the last 7, 14, 30 or 90 days.
- Price table in settings, with built-in prices taken on 2026-11-06.
- Reads only new lines of each session file, watches the session folders and makes no network calls.
