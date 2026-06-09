# Changelog

## 0.5.2

- Better behaviour when an Obsidian window is popped out: the board and list now use the active window's document and cross-window-safe type checks, so popovers and inline edits work correctly in detached windows.

## 0.5.1

- Trim the plugin description to fit Obsidian's 250-character limit so installs and updates no longer error.

## 0.5.0

- Kandyban now reads SweetClaude 4.x projects, where each item's details live in a YAML block at the top of the file (issues, stories, and epics). Your board and list fill in just like they always have — no settings to change.
- Dragging a card or cycling a value writes the change back into that YAML block and leaves the rest of the file exactly as it was, the same careful, non-destructive edit Kandyban already did for older projects.
- Epics are treated as groupings rather than tasks: they don't clutter the board as cards, and the items belonging to them show their epic as a tag.
- A new **Roadmap path** setting (default `product/roadmap`) so epics under `roadmap/epics/` are picked up.
- Older SweetClaude projects keep working exactly as before — Kandyban detects each file's format automatically.

## 0.4.0

- Open the list view straight from the left ribbon — a new checklist icon, no keyboard shortcut needed.
- Board cards are now ordered by horizon within each column (soonest first), so what's most pressing rises to the top.

## 0.3.1

- Milestones now appear in the **Milestone** column, and you can filter the board and list by milestone.
- Milestone files no longer show up as if they were tasks in the list.
