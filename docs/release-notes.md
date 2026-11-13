Nova Search is a private, on-device file search with real video and music players.
No account, no server, no telemetry, and no demo data — it indexes the machine it
runs on.

**Beta 2** is the same foundation as Beta 1 with the interface rebuilt around the two
things Nova actually does: find files, and play them.

## New in this build

**A video player that behaves like one.** The transport now floats over the picture
instead of sitting in a cramped bar underneath. Controls are 34px targets (44px for
play), the seek bar is 22px tall with a knob that grows on hover, and nothing clips
when the rail is narrow.

**Fullscreen works.** It was silently failing before — the request was made on an
element and the rejection swallowed. It now enters properly, falls back to an
immersive mode when the system blocks it, keeps the icon honest however you exit,
and binds `F`. `Space` plays, `M` mutes.

**Zoom only where it makes sense.** The zoom cluster is hidden on video and audio,
where it did nothing but clutter the toolbar. On pictures it gained an actual-size
reset and prev/next.

**The music player got room to breathe.** Full-width artwork, a larger spectrum, one
clean row of controls. Before this build the card was being squeezed to 133px with
its buttons overlapping.

**Honest failures.** "This codec can't play" used to appear on perfectly good files,
because the handler fired on the transient error every video emits while its source
is swapped. Genuine failures now get a readable card naming the format, the reason,
and three actions: open in the system player, show in folder, or explain.

**Windows chrome, not macOS.** The three little coloured dots in the corner are gone,
replaced with Windows 11 caption buttons — full-height hit areas, hairline hover
fills, the standard red close.

**Ask Nova is gone.** It was a second input mode that duplicated search with a
different vocabulary. Nova is a file search: one field, one answer.

## Still true from Beta 1

Whole-PC indexing on first launch · instant search across every extension actually
present on your machine · previews for images, PDF, code and Markdown · reveal, open
and copy-path through the OS · the index survives a restart.

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
