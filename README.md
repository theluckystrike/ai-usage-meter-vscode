# Claude Code Usage & Codex Usage Cost Meter

See today's Claude Code and Codex tokens, estimated cost, the Claude Code 5-hour block and the Codex rate limits in the VS Code status bar, read offline from your own session files.

![The usage dashboard in VS Code with today's Claude Code and Codex tokens and cost, the time left in the 5-hour block, Codex 5-hour and weekly limits, and a 30-day stacked bar chart](images/dashboard-dark.png)

The screenshot is the extension running in VS Code 1.142 on synthetic session folders made by `scripts/make-fixtures.js`. No real session was used.

## Why use it

1. Both tools in one place. Claude Code and Codex usage sit side by side in the status bar and in one dashboard, so you don't need two meters.
2. You see the limits coming. The status bar counts down the Claude Code 5-hour block and shows how much of the Codex 5-hour and weekly limits is used, with the reset times.
3. Your prompts stay private. The extension reads only token counts, model ids, times and folder paths. It never shows or stores prompt or reply text, makes no network calls and needs no API key.
4. It stays light. It remembers where it stopped in each file and reads only the new lines, so a 2 GB history doesn't get read again every minute.

Not affiliated with Anthropic or OpenAI. Claude Code and Codex are their makers' products, named here only to say what this extension reads.

## Quick start

1. Install the extension. The status bar item appears at the bottom right once it has read your session folders.
2. Click it to open the dashboard, or run "AI Usage: Open Usage Dashboard".

## The status bar

![The status bar tooltip with today's split into input, output and cache tokens, the 5-hour block start and reset time, and the Codex limits with their reset times](images/status-tooltip.png)

The item reads like `Claude 1.2M $3.40 · Codex 410k $0.62 · 2h 13m · Codex 5h 43% wk 71%`. The clock part is the time left in the current Claude Code 5-hour block. Hover for the full split and the reset clock times. The item turns yellow when a Codex limit reaches 90%.

## The dashboard

- Tiles for today per tool, the 5-hour block (tokens, cost and a meter for the time used) and each Codex limit.
- A stacked bar chart per day for the last 7, 14, 30 or 90 days, in tokens or in estimated cost. Hover a day for its numbers.
- Tables by tool, by project folder, by model and by day. Each has input, output, cache write, cache read, total and estimated cost.

![The dashboard in a light theme showing the tables by project folder and by model](images/dashboard-light.png)

In a narrow editor the tiles stack, the chart redraws to fit and wide tables scroll sideways.

![The dashboard in a narrow editor with stacked tiles and the 30-day chart fitted to the width](images/dashboard-narrow.png)

## How the numbers are worked out

- Claude Code writes `usage` on each assistant message in `~/.claude/projects/<folder>/<session>.jsonl`. A message that was written more than once (while it streamed, or again in a resumed session) counts once. Subagent files count too.
- Codex writes running totals in `token_count` events in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Each event adds what grew since the one before, so repeated events don't double count. Codex rate limits come from the newest event that has them. When a window has already reset, the meter says so instead of showing an old percentage.
- The 5-hour block starts at the hour of your first Claude Code message after a break and lasts 5 hours. It's worked out from local timestamps, so it can differ a little from what Anthropic's servers count.
- Days follow your computer's time zone.
- Records the extension doesn't know and lines that aren't valid JSON are skipped.

## Cost is an estimate

Cost is tokens times a price table in US dollars per million tokens. The built-in prices were taken on 2026-11-06. Change any row, or price a model the table doesn't know, in the `aiUsageMeter.prices` setting. Models without a price still count tokens and are listed under the dashboard. On a Pro, Max or ChatGPT plan you aren't billed per token, so treat the cost as what the same work would cost on the API.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `aiUsageMeter.showClaudeCode` | `true` | Show Claude Code usage. |
| `aiUsageMeter.showCodex` | `true` | Show Codex usage and limits. |
| `aiUsageMeter.statusBar` | `true` | Show the status bar item. |
| `aiUsageMeter.statusBarCost` | `true` | Show the estimated cost in the status bar. |
| `aiUsageMeter.refreshSeconds` | `60` | Read new lines at least this often. File changes trigger a read within 2 seconds. |
| `aiUsageMeter.historyDays` | `90` | Days of history to read. Older files are skipped. |
| `aiUsageMeter.prices` | `{}` | Your price rows, by model id or prefix. |
| `aiUsageMeter.claudeRoots` | `[]` | Claude Code project folders. Empty means `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`. |
| `aiUsageMeter.codexRoots` | `[]` | Codex session folders. Empty means `$CODEX_HOME/sessions`, else `~/.codex/sessions`. |
| `aiUsageMeter.askForRating` | `true` | Ask once for a Marketplace rating after a few days of use. |
| `aiUsageMeter.showSupportLinks` | `true` | Show the Sponsor and More free viewers links under the dashboard. |

## Privacy

The extension only reads files. It doesn't write, move or delete session files, it sends nothing anywhere and it has no telemetry. Lines that can't hold usage data are skipped before they're parsed. The dashboard runs under a strict Content Security Policy with no remote content.

## Known limits

- Usage made on another computer, or in claude.ai and ChatGPT, isn't in your local files, so it isn't counted.
- Claude Code doesn't write its own limit percentage to disk, so the 5-hour block shows time and tokens, not a percent of your plan.
- Codex limits are only as fresh as the last Codex session that wrote them.

## Support

Zovo extensions have no ads and no tracking, and sponsors pay for the time that goes into fixes and new viewers. You can sponsor the work on [GitHub Sponsors](https://github.com/sponsors/theluckystrike).

## More viewers by Zovo

- [Context Drift](https://marketplace.visualstudio.com/items?itemName=zovo.context-drift) finds stale facts in AGENTS.md, CLAUDE.md and other agent rule files.
- [PDF Viewer & Reader with Dark Mode](https://marketplace.visualstudio.com/items?itemName=zovo.pdf-viewer-dark) reads PDFs with a real dark mode, search, an outline and thumbnails.
- [CSV, Excel & Parquet Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.table-viewer-vscode) opens Parquet, Excel and CSV files as a sortable, filterable table.
- [DOCX Viewer & Word Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.docx-viewer-vscode) previews Word files with dark mode, an outline and search.
- [HDF5 & NetCDF Explorer](https://marketplace.visualstudio.com/items?itemName=zovo.hdf5-netcdf-explorer) browses groups, variables and attributes in scientific data files.
- [PPTX Viewer for PowerPoint](https://marketplace.visualstudio.com/items?itemName=zovo.pptx-slide-viewer) shows PowerPoint slides, thumbnails and speaker notes.
- [Skill Shelf](https://marketplace.visualstudio.com/items?itemName=zovo.skill-shelf) lists, checks and toggles the Agent Skills that Claude Code, Codex and Cursor load.
- [Tensor Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.tensor-viewer) shows NPY, NPZ, Safetensors and GGUF tensors with stats and heatmaps.

Coming soon to the Marketplace, with the code on GitHub now.

- [JSONL Viewer](https://github.com/theluckystrike/jsonl-viewer-vscode) opens JSONL and NDJSON files as a table, as records or as a chat view.
- [SQLite Table Viewer](https://github.com/theluckystrike/sqlite-table-viewer) browses SQLite tables read-only and runs SELECT queries.
- [Agent Session Viewer](https://github.com/theluckystrike/agent-session-viewer) browses and searches your local Claude Code and Codex sessions.
- [Audio Preview & Loudness Meter](https://github.com/theluckystrike/audio-preview-vscode) plays audio files with a waveform, a spectrogram and LUFS loudness.
- [Video Preview with Sound](https://github.com/theluckystrike/video-preview-vscode) plays MP4, MOV, MKV and WebM files with their sound.
- [Graphviz Preview & DOT Viewer](https://github.com/theluckystrike/graphviz-preview-vscode) shows a live preview of DOT files and exports SVG or PNG.
- [TIFF Viewer](https://github.com/theluckystrike/tiff-viewer-vscode) opens 16-bit, float, multi-page and GeoTIFF images.
- [Avro, Arrow & Feather Viewer](https://github.com/theluckystrike/arrow-avro-viewer-vscode) opens Avro, Arrow and Feather files as a paged table.
- [EML & MBOX Email Viewer](https://github.com/theluckystrike/eml-viewer-vscode) reads email files with remote images blocked.
- [3D Model Viewer](https://github.com/theluckystrike/model-viewer-vscode) views GLB, glTF, STL, OBJ, PLY and 3MF models.
- [JSON Viewer & JSON Tree](https://github.com/theluckystrike/json-tree-viewer-vscode) shows large JSON files as a searchable tree, copies JSONPath and turns arrays of objects into a table.
- [PKL Viewer & Pickle Viewer](https://github.com/theluckystrike/pickle-viewer-vscode) opens Python pickle files without Python and never runs their code.
- [DXF Viewer & CAD Viewer](https://github.com/theluckystrike/dxf-viewer-vscode) opens ASCII and binary DXF drawings with layers, measuring and PNG or SVG export.
- [File Viewers Pack](https://github.com/theluckystrike/zovo-file-viewers) installs the PDF, table, Word, PowerPoint, HDF5 and tensor viewers in one step.
