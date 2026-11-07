# The status bar item

It sits at the right end of the status bar and shows, from left to right:

- Claude Code tokens and estimated cost since local midnight
- Codex tokens and estimated cost since local midnight
- Gemini CLI tokens and estimated cost, when Gemini CLI session files are found
- your Claude Code 5-hour and weekly limit in percent used, as Claude Code last saved them
- the Codex 5-hour and weekly limits, in percent used

When Claude Code hasn't saved a limit reading yet, a clock icon shows the time left in the current 5-hour block instead. Hover the item for the input, output and cache split, every limit with its reset time, and each Claude Code account. It turns yellow when a limit reaches 90%. Click it to open the dashboard.
