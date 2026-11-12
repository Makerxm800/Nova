Nova Search is a private, on-device file search with real video and music players.
No account, no server, no telemetry, and no demo data — it indexes the machine it
runs on.

This is the first Beta. Windows and macOS installers are attached below; there is
also `Nova Search.html`, a single double-clickable file with everything inlined if
you would rather not install anything.

## What works

- **Whole-PC indexing.** On first launch, Index this PC walks every mounted drive and
  you can search all of it. Folder-level indexing is there too, plus drag-and-drop.
- **Instant search** across every extension actually present on your machine, with a
  scope rail and counts driven by your files, not a fixed sample set.
- **Video player** — streaming with range requests, seeking, speed, picture-in-picture,
  fullscreen.
- **Music player** — live spectrum, queue, repeat, seek.
- Previews for images, PDF, code and Markdown · reveal/open/copy-path through the OS ·
  the index survives a restart.

## Fixed in this build

- Linux drive detection was inverted and always fell back to your home folder. It now
  finds real filesystems.
- A large index could not be saved: the whole-PC scan overflowed browser storage and
  silently vanished on reload. It now persists what fits and rescans the rest.
- The background refresh discarded its scan, so an already-indexed machine never
  picked up new files.

## Known limits

- Whole-drive enumeration is new in this Beta and is the part most worth reporting
  bugs against. If a drive is missing, **Index a folder** covers the same ground.
- Thumbnails read from disk do not survive a reload (the index does).
- Search covers names, paths, extensions and metadata — not document contents.

Nothing here is mocked. If a view is empty, nothing has been indexed yet.
