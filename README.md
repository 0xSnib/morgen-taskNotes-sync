# Morgen TaskNotes Sync

This Obsidian helper keeps TaskNotes’ frontmatter `status` in step with the boolean `completed` flag that Morgen expects when importing task notes. 
Any change coming from TaskNotes is mirrored to Morgen’s property, and any change Morgen writes back is translated into the correct TaskNotes status—without bouncing the note between states.

Copy the contents of `dist/` into `.obsidian/plugins/morgen-tasknotes/` to install locally. Use `npm run dev` while developing to rebuild automatically.

- The plugin never touches the reference `taskNotes/` workspace—only notes inside your vault.
- Recurrence, reminders, and other TaskNotes properties are left alone; Morgen only needs `tags`, `priority`, `due_date`, `duration`, and the boolean `completed`.
- If you add or rename TaskNotes statuses or boolean fields, the plugin notices on the next note change and refreshes its mapping automatically.
- This is provided untested, it's for me, and I fully expect the functionality to be wrapped into either morgen-obsidian or Task Notes
- Recurrance is untested (we'll see how we go this week)
## How it Works

- Reads TaskNotes’ settings at runtime (field mapping, custom statuses, default status).
- Builds an internal map of which statuses represent “done” vs “open”.
- Chooses or reuses a boolean frontmatter property for Morgen (`completed` by default, or the first boolean user field you defined).
- Uses lightweight state tracking to avoid loops when Morgen immediately re-reads the same note after we write to it.
- Clears the cached state whenever TaskNotes’ settings change so new statuses are picked up automatically.

## Status ↔︎ Completed Mapping

- All TaskNotes statuses you have marked as “completed” become `completed: true`.
- Every other status becomes `completed: false`.
- When Morgen flips `completed` to `true`, the plugin assigns your configured *default completed status*, or falls back to a sensible built-in (`done`).
- When Morgen flips `completed` to `false`, it assigns your TaskNotes *default task status*, or the first incomplete status it knows about (falling back to `open`).
- If you store statuses or booleans as arrays (for example via templates), the plugin picks the first meaningful value it sees.

## Some housekeeping setup

- I wanted to keep this as lightweight as possible, so where we can re-use frontmatter fields, we do
- So in Task Notes change the following Task Notes - Property Fields
-- Due Date > `date`
-- Time Estimate > `duration`

## Commands

- `Sync active note with Morgen` – run the synchronisation logic for the focused file.
- `Sync all TaskNotes files` – check every markdown file in the vault (runs once on workspace load).

## Installation & Build

```bash
npm install
npm run build
```

Copy the contents of `dist/` into `.obsidian/plugins/morgen-tasknotes/` to install locally. Use `npm run dev` while developing to rebuild automatically.


