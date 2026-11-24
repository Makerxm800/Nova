Nova Search is a private, on-device file search with real video and music players.
No account, no server, no telemetry, and no demo data — it indexes the machine it
runs on.

**Beta 3** is the same search core as Beta 2 with the interface tightened around the
one thing the app exists to do: show you results.

## New in this build

**The home screen is a start panel, not a billboard.** The old hero was tall enough
to push the search field down the window. It is now one eyebrow line, one sentence,
a row of quick filters, recent searches and the format strip — the field stays where
your eyes already are, and the empty state still tells you exactly what to do next.

**Locations tell the truth.** The Location column used to show only the parent
folder, so `report.pdf` in two different `Documents` folders looked identical. It
now shows the real directory, trimmed from the left so the deepest — most
distinctive — segments always fit, with the full path on hover.

**Rows are denser and easier to scan.** 56px rows (47px in compact), a fixed-width
location column in mono, names at heavier weight, and an honest header: Location is
a plain label now, instead of a button that quietly sorted by Format.

**The aurora calmed down.** Softer, slower background glow, a lighter grid veil,
half the film grain, and brighter body text in both themes. Same violet-and-cyan
identity — less noise between you and the results.

**One line of formats.** The coverage strip holds all twelve format chips on a
single row instead of dropping the last one onto a second line.

**Windows collapse cleanly.** Narrow the window and the Location and Format columns
retire together — header and cells — leaving Name, Size and Modified aligned
instead of leaving orphaned gaps.

## Still true from Beta 2

Whole-PC indexing on first launch · instant search across every extension actually
present on your machine · previews for images, PDF, code and Markdown · reveal, open
and copy-path through the OS · the index survives a restart · the video and music
players, fullscreen, and honest codec failures · one field, one answer.

## Known limits

- These builds are unsigned. Windows SmartScreen will ask you to confirm; macOS
  needs **System Settings → Privacy & Security → Open Anyway** the first time.
- Whole-drive enumeration is new and is the part most worth reporting bugs against.
  If a drive is missing, **Index a folder** covers the same ground.
- Thumbnails read from disk do not survive a reload (the index does).
- Search covers names, paths, extensions and metadata — not document contents.
- MKV, WMV and some HEVC files need system codecs; Nova will tell you and offer to
  open them in your player of choice.

Nothing here is mocked. If a view is empty, nothing has been indexed yet.
