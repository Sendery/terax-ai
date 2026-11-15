# Terax native core safe wrapper

Source: libghostty-vt 0.2.2 from crates.io, SHA256
16c7287a8dc35c3436224b39358af81ab9ea54bafa0f7ea2e068bd2a47bdcb2d.
Upstream Uzaaft/libghostty-rs commit c9876b2902d5bb3e1f3d61b6395059f1e5e7b721,
directory crates/libghostty-vt. Redistributed under its declared MIT option.
LICENSE-MIT is the same pinned repository license already preserved by the
sibling sys vendor. Cargo package metadata otherwise stays unchanged.

Two additive safe Terminal methods call the matching Terax native-core-v1 C
exports through the existing owned handle and result conversion. No pointer
layout casts or fabricated option values are used. Both methods borrow Terminal
mutably, so a raw GridRef cannot cross mutation. Tracked refs must be freshly
snapshotted afterward. Never link this wrapper with the old native archive.

Both workspace roots now patch to this safe copy after the combined prebuilt
passed native test, symbol, architecture and per-object deployment gates.

Three source files retain upstream rustdoc trailing spaces, including Markdown
hard breaks. Their scoped blank-at-eol attributes preserve original source bytes;
the added method lines contain no trailing whitespace.
