# Reviewing a branch locally

Terax can review the checked-out branch against the branch it would merge into,
without pushing anything or opening a browser. **Review branch** in the Source
Control panel opens a review tab for the current branch.

## What it compares

The base defaults to whatever the remote's own HEAD points at — normally
`origin/main` — because that is the branch a pull request would target. Any
local or remote branch can be picked instead from the selector in the header.

The diff is taken from the **merge base**, the commit the two branches last
shared, not from the tip of the base branch. This is what a pull request shows:
commits that landed on the base branch after this one forked are not presented
as changes the author made. The header reports how far ahead the branch is, and
how far behind, so a stale branch is visible before the review starts.

## Working through it

The left column has two lists.

**Scope** selects what the review shows: *Whole branch*, or one of its commits.
The whole branch is the change as a reviewer would receive it; a single commit
is that commit against its own parent, which is the change its author made in
one step. A merge commit reports what it brought in, against its first parent.

**Files** lists what the current scope touched, with the status letter, the
path, and the lines added and removed. Selecting one opens it on the right.

## Reading a file

Two toggles in the header, independent of each other:

- **Unified** shows one document with the changes marked inline.
  **Side by side** shows the old and the new file in two panes.
- **Changes** collapses untouched regions to a few lines of context.
  **Whole file** shows the file in full.

Binary files are named but not rendered. A file too large to diff falls back to
its patch text rather than freezing the pane.

## What it does not do

The review reads history: nothing here stages, commits, or writes to the
repository. It also does not fetch — the base branch is compared as your last
fetch left it, so run a fetch from the Source Control panel first if the remote
has moved. Reviews are per branch and reopening returns to the one in progress;
they survive a restart with the branches they were comparing.
