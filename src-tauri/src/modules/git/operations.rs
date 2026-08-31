use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::Path;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::parser::parse_porcelain_v2;
use crate::modules::git::process::{
    ensure_git_available, ensure_success, git_show_text, git_stdout_line_opt, git_stdout_lines,
    read_text_file, run_git,
};
use crate::modules::git::types::{
    DiscardEntry, GitChangedFile, GitCommitFileChange, GitCommitResult, GitDiffContentResult,
    GitBranchList, GitDiffResult, GitLogEntry, GitOutput, GitPanelSnapshot, GitPushResult,
    GitRangeFile, GitRangeSummary, GitRef,
    GitRefKind, GitRepoInfo,
    GitStatusSnapshot, TextSource, DEFAULT_TIMEOUT_SECS, NETWORK_TIMEOUT_SECS,
};
use crate::modules::git::utils::{
    authorized_repo_root, canonical_dir, resolve_within_repo, split_upstream, ResolvedGitDirectory,
};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

pub fn resolve_repo(
    registry: &WorkspaceRegistry,
    cwd: &str,
    workspace: &WorkspaceEnv,
) -> Result<Option<GitRepoInfo>> {
    let cwd = canonical_dir(registry, cwd, workspace)?;
    if !registry.is_authorized(&cwd.local_path) {
        return Err(GitError::PathOutsideWorkspace(cwd.local_path));
    }
    ensure_git_available(&cwd.workspace)?;
    resolve_repo_in_authorized(registry, &cwd)
}

fn resolve_repo_in_authorized(
    registry: &WorkspaceRegistry,
    cwd: &ResolvedGitDirectory,
) -> Result<Option<GitRepoInfo>> {
    let Some(root_line) = git_stdout_line_opt(
        &cwd.workspace,
        &cwd.git_path,
        ["rev-parse", "--show-toplevel"],
    )?
    else {
        return Ok(None);
    };
    let canonical_root = canonical_dir(registry, &root_line, &cwd.workspace)?;
    let _ = registry.authorize(&canonical_root.local_path);

    let head = match git_stdout_lines(
        &canonical_root.workspace,
        &canonical_root.git_path,
        ["rev-parse", "--abbrev-ref", "HEAD"],
    )?
    .into_iter()
    .next()
    {
        Some(h) => h,
        None => git_stdout_line_opt(
            &canonical_root.workspace,
            &canonical_root.git_path,
            ["symbolic-ref", "--short", "HEAD"],
        )?
        .ok_or(GitError::CommandFailed {
            context: "failed to resolve HEAD",
            detail: String::new(),
        })?,
    };

    let upstream = git_stdout_line_opt(
        &canonical_root.workspace,
        &canonical_root.git_path,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?;

    Ok(Some(GitRepoInfo {
        repo_root: canonical_root.git_path,
        branch: head.clone(),
        upstream,
        is_detached: head == "HEAD",
    }))
}

pub fn panel_snapshot(
    registry: &WorkspaceRegistry,
    cwd: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitPanelSnapshot> {
    let cwd = canonical_dir(registry, cwd, workspace)?;
    if !registry.is_authorized(&cwd.local_path) {
        return Err(GitError::PathOutsideWorkspace(cwd.local_path));
    }
    ensure_git_available(&cwd.workspace)?;
    let Some(root_line) = git_stdout_line_opt(
        &cwd.workspace,
        &cwd.git_path,
        ["rev-parse", "--show-toplevel"],
    )?
    else {
        return Ok(GitPanelSnapshot {
            repo: None,
            status: None,
        });
    };
    let canonical_root = canonical_dir(registry, &root_line, &cwd.workspace)?;
    let _ = registry.authorize(&canonical_root.local_path);

    let status = status_inner(&canonical_root)?;
    let repo = GitRepoInfo {
        repo_root: canonical_root.git_path.clone(),
        branch: status.branch.clone(),
        upstream: status.upstream.clone(),
        is_detached: status.is_detached,
    };
    Ok(GitPanelSnapshot {
        repo: Some(repo),
        status: Some(status),
    })
}

pub fn status(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitStatusSnapshot> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    status_inner(&repo_root)
}

fn status_inner(repo_root: &ResolvedGitDirectory) -> Result<GitStatusSnapshot> {
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git status failed")?;

    let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
    let mut parsed = parse_porcelain_v2(stdout);
    if !parsed.files.is_empty() {
        apply_status_numstat(repo_root, &mut parsed.files)?;
    }

    Ok(GitStatusSnapshot {
        repo_root: repo_root.git_path.clone(),
        branch: parsed.branch,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        is_detached: parsed.is_detached,
        truncated: output.truncated,
        changed_files: parsed.files,
    })
}

#[derive(Clone, Copy, Default)]
struct StatusNumstat {
    added: u32,
    removed: u32,
    is_binary: bool,
}

fn apply_status_numstat(
    repo_root: &ResolvedGitDirectory,
    files: &mut [GitChangedFile],
) -> Result<()> {
    let mut stats: HashMap<String, StatusNumstat> = HashMap::new();
    collect_status_numstat(repo_root, true, &mut stats)?;
    collect_status_numstat(repo_root, false, &mut stats)?;

    for file in files {
        if let Some(stat) = stats.get(&file.path) {
            file.added = stat.added;
            file.removed = stat.removed;
            file.is_binary = stat.is_binary;
        }
    }
    Ok(())
}

fn collect_status_numstat(
    repo_root: &ResolvedGitDirectory,
    staged: bool,
    stats: &mut HashMap<String, StatusNumstat>,
) -> Result<()> {
    let mut args: Vec<OsString> = vec![
        "diff".into(),
        "--no-ext-diff".into(),
        "--numstat".into(),
        "-z".into(),
    ];
    if staged {
        args.push("--cached".into());
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git diff --numstat failed")?;
    merge_status_numstat(stats, &output.stdout);
    Ok(())
}

fn merge_status_numstat(stats: &mut HashMap<String, StatusNumstat>, bytes: &[u8]) {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let tokens: Vec<&str> = s.split('\0').filter(|t| !t.is_empty()).collect();
    let mut idx = 0;
    while idx < tokens.len() {
        let header = tokens[idx];
        idx += 1;
        let mut cols = header.splitn(3, '\t');
        let added_raw = cols.next().unwrap_or("0");
        let removed_raw = cols.next().unwrap_or("0");
        let inline_path = cols.next().unwrap_or("");
        let is_binary = added_raw == "-" && removed_raw == "-";
        let added: u32 = if is_binary {
            0
        } else {
            added_raw.parse().unwrap_or(0)
        };
        let removed: u32 = if is_binary {
            0
        } else {
            removed_raw.parse().unwrap_or(0)
        };

        let path = if inline_path.is_empty() {
            idx += 1;
            let new_path = tokens.get(idx).copied().unwrap_or("");
            idx += 1;
            new_path
        } else {
            inline_path
        };
        if path.is_empty() {
            continue;
        }
        let entry = stats.entry(path.to_string()).or_default();
        entry.added = entry.added.saturating_add(added);
        entry.removed = entry.removed.saturating_add(removed);
        entry.is_binary |= is_binary;
    }
}

pub fn diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    path: Option<&str>,
    staged: bool,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    diff_inner(&repo_root, path, staged)
}

fn diff_inner(
    repo_root: &ResolvedGitDirectory,
    path: Option<&str>,
    staged: bool,
) -> Result<GitDiffResult> {
    let mut args: Vec<OsString> = vec!["diff".into(), "--no-ext-diff".into()];
    if staged {
        args.push("--cached".into());
    }
    let pathspec = match path.filter(|p| !p.is_empty()) {
        Some(p) => Some(pathspec_from_input(&repo_root.local_path, p)?),
        None => None,
    };
    if let Some(spec) = pathspec.as_ref() {
        args.push("--".into());
        args.push(spec.clone().into());
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git diff failed")?;

    let diff_text = match String::from_utf8(output.stdout) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
    };
    Ok(GitDiffResult {
        diff_text,
        truncated: output.truncated,
    })
}

pub fn diff_content(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    path: &str,
    staged: bool,
    original_path: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffContentResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let worktree_path = resolve_within_repo(&repo_root.local_path, path)?;
    let rel_path = pathspec(&repo_root.local_path, &worktree_path);

    let original_rel = match original_path {
        Some(orig) if !orig.is_empty() => {
            let resolved = resolve_within_repo(&repo_root.local_path, orig)?;
            Some(pathspec(&repo_root.local_path, &resolved))
        }
        _ => None,
    };

    let original = if staged {
        let spec = original_rel.as_deref().unwrap_or(&rel_path);
        git_show_text(
            &repo_root.workspace,
            &repo_root.git_path,
            &format!("HEAD:{spec}"),
        )?
    } else {
        git_show_text(
            &repo_root.workspace,
            &repo_root.git_path,
            &format!(":{rel_path}"),
        )?
    };
    let modified = if staged {
        git_show_text(
            &repo_root.workspace,
            &repo_root.git_path,
            &format!(":{rel_path}"),
        )?
    } else {
        read_text_file(&worktree_path)?
    };
    let patch = diff_inner(&repo_root, Some(&rel_path), staged)?;
    let is_binary =
        matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

    Ok(GitDiffContentResult {
        original_content: original.into_text(),
        modified_content: modified.into_text(),
        is_binary,
        fallback_patch: patch.diff_text,
        truncated: patch.truncated,
    })
}

pub fn stage(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    paths: &[String],
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if paths.is_empty() {
        return Ok(());
    }
    let resolved = resolve_pathspecs(&repo_root.local_path, paths)?;
    let mut args: Vec<OsString> = vec!["add".into(), "--".into()];
    for p in &resolved {
        args.push(p.clone().into());
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git add failed")
}

pub fn unstage(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    paths: &[String],
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if paths.is_empty() {
        return Ok(());
    }
    let resolved = resolve_pathspecs(&repo_root.local_path, paths)?;
    let mut reset_args: Vec<OsString> = vec!["reset".into(), "HEAD".into(), "--".into()];
    for p in &resolved {
        reset_args.push(p.clone().into());
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        reset_args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.exit_code == Some(0) {
        return Ok(());
    }
    if !looks_like_no_head(&output) {
        return ensure_success(&output, "git reset failed");
    }
    let mut rm_args: Vec<OsString> = vec![
        "rm".into(),
        "--cached".into(),
        "-r".into(),
        "--".into(),
    ];
    for p in &resolved {
        rm_args.push(p.clone().into());
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        rm_args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git rm --cached failed")
}

fn looks_like_no_head(output: &GitOutput) -> bool {
    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    stderr.contains("ambiguous argument 'head'")
        || stderr.contains("unknown revision")
        || stderr.contains("does not have any commits yet")
        || stderr.contains("bad revision 'head'")
}

pub fn discard(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    entries: &[DiscardEntry],
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if entries.is_empty() {
        return Ok(());
    }

    let mut tracked: Vec<String> = Vec::with_capacity(entries.len());
    let mut untracked: Vec<String> = Vec::new();
    for entry in entries {
        let resolved = pathspec_from_input(&repo_root.local_path, &entry.path)?;
        if entry.untracked {
            untracked.push(resolved);
        } else {
            tracked.push(resolved);
        }
    }

    if !tracked.is_empty() {
        let mut args: Vec<OsString> = vec!["restore".into(), "--worktree".into(), "--".into()];
        for p in &tracked {
            args.push(p.clone().into());
        }
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            args,
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git restore failed")?;
    }

    if !untracked.is_empty() {
        let mut args: Vec<OsString> = vec!["clean".into(), "-f".into(), "-d".into(), "--".into()];
        for p in &untracked {
            args.push(p.clone().into());
        }
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            args,
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git clean failed")?;
    }

    Ok(())
}

pub fn commit(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    message: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitCommitResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(GitError::EmptyCommitMessage);
    }

    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [OsStr::new("commit"), OsStr::new("-m"), OsStr::new(trimmed)],
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.exit_code != Some(0) && nothing_to_commit(&output) {
        return Err(GitError::command("git commit", "nothing staged"));
    }
    ensure_success(&output, "git commit failed")?;

    let combined = git_stdout_lines(
        &repo_root.workspace,
        &repo_root.git_path,
        ["show", "-s", "--format=%H%n%s", "HEAD"],
    )?;
    let sha = combined.first().cloned().ok_or(GitError::CommandFailed {
        context: "failed to resolve commit sha",
        detail: String::new(),
    })?;
    let summary = combined.get(1).cloned().unwrap_or_default();

    Ok(GitCommitResult {
        commit_sha: sha,
        summary,
    })
}

pub fn push(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitPushResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;

    let upstream = git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?;
    if upstream.is_none() {
        return Err(GitError::NoUpstream);
    }

    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["push"],
        NETWORK_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git push failed")?;

    let upstream = upstream.unwrap();
    let (remote, branch) = split_upstream(&upstream);
    Ok(GitPushResult {
        remote,
        branch,
        pushed: true,
    })
}

// Records are framed with \x1e because %b is multi-line; fields inside a
// record use \x1f. %D carries the decorations and must come before %s so the
// body can stay last, where the --shortstat line lands after it.
const LOG_FORMAT: &str = "%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%D%x1f%s%x1f%b";
const MAX_LOG_LIMIT: u32 = 200;

pub fn log(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    limit: u32,
    before_sha: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitLogEntry>> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let bounded = limit.clamp(1, MAX_LOG_LIMIT);
    let count_arg = format!("--max-count={bounded}");
    let format_arg = format!("--format={LOG_FORMAT}");
    let cursor = match before_sha {
        Some(sha) if !sha.is_empty() => {
            if !sha_is_safe(sha) {
                return Err(GitError::command("git log", "invalid cursor sha"));
            }
            Some(format!("{sha}^"))
        }
        _ => None,
    };
    // Without --diff-merges a merge prints no --shortstat line at all, so every
    // merge in the view reads as an empty commit. Diffing against the first
    // parent is what a merge brought in, which is the number a history view
    // wants. The option landed in git 2.31, so a git that rejects it falls back
    // to the old behaviour rather than failing the whole view.
    let build_args = |with_diff_merges: bool| {
        let mut args: Vec<&OsStr> = vec![
            OsStr::new("log"),
            OsStr::new("--no-color"),
            OsStr::new("--decorate=full"),
            OsStr::new("--shortstat"),
        ];
        if with_diff_merges {
            args.push(OsStr::new("--diff-merges=first-parent"));
        }
        args.push(OsStr::new(&count_arg));
        args.push(OsStr::new(&format_arg));
        if let Some(spec) = cursor.as_deref() {
            args.push(OsStr::new(spec));
        }
        args
    };

    let mut output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        build_args(true),
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.exit_code != Some(0)
        && !output.timed_out
        && String::from_utf8_lossy(&output.stderr).contains("diff-merges")
    {
        output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            build_args(false),
            DEFAULT_TIMEOUT_SECS,
        )?;
    }
    if output.timed_out {
        return Err(GitError::TimedOut("git log"));
    }
    if output.exit_code != Some(0) {
        let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
        if stderr.contains("does not have any commits yet")
            || stderr.contains("bad default revision")
            || stderr.contains("unknown revision")
            || stderr.contains("ambiguous argument 'head'")
        {
            return Ok(Vec::new());
        }
        return ensure_success(&output, "git log failed").map(|_| Vec::new());
    }
    let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
    Ok(parse_log_records(stdout))
}

/// Splits `git log` output into commits.
///
/// Each record starts with \x1e and holds unit-separated fields, the last of
/// which is the body. `--shortstat` prints its line after the body, so the tail
/// of that field is inspected for the exact shape git emits and stripped.
fn parse_log_records(stdout: &str) -> Vec<GitLogEntry> {
    let mut entries: Vec<GitLogEntry> = Vec::new();
    for record in stdout.split('\x1e').skip(1) {
        let mut fields = record.splitn(8, '\x1f');
        let sha = fields.next().unwrap_or("").trim().to_string();
        if !sha_is_safe(&sha) {
            continue;
        }
        let author = fields.next().unwrap_or("").to_string();
        let author_email = fields.next().unwrap_or("").to_string();
        let timestamp_secs = fields
            .next()
            .unwrap_or("0")
            .trim()
            .parse::<i64>()
            .unwrap_or(0);
        let parents: Vec<String> = fields
            .next()
            .unwrap_or("")
            .split_ascii_whitespace()
            .map(str::to_string)
            .collect();
        let refs = parse_decorations(fields.next().unwrap_or(""));
        let subject = fields.next().unwrap_or("").to_string();
        let (body, stat) = split_body_and_shortstat(fields.next().unwrap_or(""));
        let (files_changed, insertions, deletions) =
            stat.map_or((0, 0, 0), parse_shortstat);
        let short_sha = sha.chars().take(7).collect::<String>();
        entries.push(GitLogEntry {
            sha,
            short_sha,
            author,
            author_email,
            timestamp_secs,
            parents,
            subject,
            body,
            refs,
            files_changed,
            insertions,
            deletions,
        });
    }
    entries
}

/// True for the exact line `--shortstat` emits, so a body line that merely
/// mentions changed files is not mistaken for one.
fn is_shortstat_line(line: &str) -> bool {
    let mut parts = line.trim().split(", ");
    let Some(files) = parts.next() else {
        return false;
    };
    let Some(count) = files
        .strip_suffix(" file changed")
        .or_else(|| files.strip_suffix(" files changed"))
    else {
        return false;
    };
    if count.is_empty() || !count.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    parts.all(|part| {
        part.strip_suffix(" insertions(+)")
            .or_else(|| part.strip_suffix(" insertion(+)"))
            .or_else(|| part.strip_suffix(" deletions(-)"))
            .or_else(|| part.strip_suffix(" deletion(-)"))
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
    })
}

fn split_body_and_shortstat(tail: &str) -> (String, Option<&str>) {
    let mut lines: Vec<&str> = tail.lines().collect();
    let mut stat = None;
    while let Some(last) = lines.last() {
        if last.trim().is_empty() {
            lines.pop();
            continue;
        }
        if stat.is_none() && is_shortstat_line(last) {
            stat = Some(*last);
            lines.pop();
            continue;
        }
        break;
    }
    (lines.join("\n").trim_end().to_string(), stat)
}

/// Turns `%D` output into typed refs.
///
/// `--decorate=full` keeps the ref path, so a local branch named `origin/x` is
/// never mistaken for a remote one. `refs/remotes/<remote>/HEAD` is dropped: it
/// is a symbolic pointer at another ref already listed, not a place to go.
fn parse_decorations(raw: &str) -> Vec<GitRef> {
    let mut refs = Vec::new();
    for piece in raw.split(", ") {
        let piece = piece.trim();
        if piece.is_empty() {
            continue;
        }
        let (is_head, target) = match piece.strip_prefix("HEAD -> ") {
            Some(rest) => (true, rest.trim()),
            None if piece == "HEAD" => {
                refs.push(GitRef {
                    name: "HEAD".to_string(),
                    kind: GitRefKind::Other,
                    is_head: true,
                });
                continue;
            }
            None => (false, piece),
        };
        let target = target.strip_prefix("tag: ").unwrap_or(target);
        let (kind, name) = if let Some(name) = target.strip_prefix("refs/heads/") {
            (GitRefKind::Branch, name)
        } else if let Some(name) = target.strip_prefix("refs/remotes/") {
            (GitRefKind::Remote, name)
        } else if let Some(name) = target.strip_prefix("refs/tags/") {
            (GitRefKind::Tag, name)
        } else {
            (GitRefKind::Other, target)
        };
        if name.is_empty() || (kind == GitRefKind::Remote && name.ends_with("/HEAD")) {
            continue;
        }
        refs.push(GitRef {
            name: name.to_string(),
            kind,
            is_head,
        });
    }
    refs
}

pub fn show_commit_diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if !sha_is_safe(sha) {
        return Err(GitError::command("git show", "invalid commit identifier"));
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("show"),
            OsStr::new("--no-color"),
            OsStr::new("--no-ext-diff"),
            OsStr::new("--patch-with-stat"),
            OsStr::new(sha),
            OsStr::new("--"),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git show failed")?;
    let diff_text = match String::from_utf8(output.stdout) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
    };
    Ok(GitDiffResult {
        diff_text,
        truncated: output.truncated,
    })
}

fn parse_shortstat(tail: &str) -> (u32, u32, u32) {
    // Looks for a line like " 5 files changed, 12 insertions(+), 3 deletions(-)"
    for line in tail.lines() {
        let trimmed = line.trim();
        if !(trimmed.contains("file changed") || trimmed.contains("files changed")) {
            continue;
        }
        let mut files = 0u32;
        let mut ins = 0u32;
        let mut del = 0u32;
        for part in trimmed.split(',') {
            let part = part.trim();
            let num_str = part.split_ascii_whitespace().next().unwrap_or("0");
            let n: u32 = num_str.parse().unwrap_or(0);
            if part.contains("file") {
                files = n;
            } else if part.contains("insertion") {
                ins = n;
            } else if part.contains("deletion") {
                del = n;
            }
        }
        return (files, ins, del);
    }
    (0, 0, 0)
}

fn sha_is_safe(sha: &str) -> bool {
    !sha.is_empty() && sha.len() <= 64 && sha.chars().all(|c| c.is_ascii_hexdigit())
}

/// Whether a branch name may be passed to git as an argument.
///
/// The caller is asking for a branch, so anything that means something else to
/// the revision parser is refused rather than interpreted: a leading dash would
/// be read as an option, and `..`, `~`, `^`, `:` and `@{` all select something
/// other than the ref named. The remaining rules are the ones
/// `git check-ref-format` enforces, so a name accepted here is a name git will
/// recognise.
fn ref_is_safe(name: &str) -> bool {
    if name.is_empty() || name.len() > 255 {
        return false;
    }
    if name.starts_with('-') || name.starts_with('/') || name.ends_with('/') {
        return false;
    }
    if name.ends_with('.') || name.ends_with(".lock") || name.contains("//") {
        return false;
    }
    if name.contains("..") || name.contains("@{") {
        return false;
    }
    if name
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
    {
        return false;
    }
    // No path component may start with a dot or end in .lock.
    name.split('/')
        .all(|part| !part.is_empty() && !part.starts_with('.') && !part.ends_with(".lock"))
}

pub fn commit_files(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitCommitFileChange>> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if !sha_is_safe(sha) {
        return Err(GitError::command("git diff-tree", "invalid commit sha"));
    }

    // Two calls, and both against the first parent.
    //
    // git diff-tree honours only one of --name-status and --numstat, so asking
    // for both at once silently drops the counts and every file reads as +0 -0.
    // And without `-m --first-parent` a merge produces no output at all, so a
    // reviewer stepping through a branch saw every merge as an empty commit;
    // the first-parent diff is what the merge brought in, which is also what
    // `commit_file_diff` already shows for one.
    let statuses = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("diff-tree"),
            OsStr::new("--no-commit-id"),
            OsStr::new("-r"),
            OsStr::new("-z"),
            OsStr::new("-m"),
            OsStr::new("--first-parent"),
            OsStr::new("--name-status"),
            OsStr::new(sha),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&statuses, "git diff-tree --name-status failed")?;
    let counts = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("diff-tree"),
            OsStr::new("--no-commit-id"),
            OsStr::new("-r"),
            OsStr::new("-z"),
            OsStr::new("-m"),
            OsStr::new("--first-parent"),
            OsStr::new("--numstat"),
            OsStr::new(sha),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&counts, "git diff-tree --numstat failed")?;

    let mut files = parse_diff_tree_name_status(&statuses.stdout);
    apply_numstat(&mut files, &counts.stdout);
    Ok(files)
}


pub fn commit_file_diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
    path: &str,
    original_path: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffContentResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if !sha_is_safe(sha) {
        return Err(GitError::command("git show", "invalid commit sha"));
    }
    let resolved = resolve_within_repo(&repo_root.local_path, path)?;
    let rel = resolved
        .strip_prefix(&repo_root.local_path)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.replace('\\', "/"));

    let original_rel = match original_path {
        Some(orig) if !orig.is_empty() => {
            let resolved_orig = resolve_within_repo(&repo_root.local_path, orig)?;
            resolved_orig
                .strip_prefix(&repo_root.local_path)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| orig.replace('\\', "/"))
        }
        _ => rel.clone(),
    };

    let parent = git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        ["rev-parse", &format!("{sha}^")],
    )?;
    let original = match parent.as_deref() {
        Some(p) => git_show_text(
            &repo_root.workspace,
            &repo_root.git_path,
            &format!("{p}:{original_rel}"),
        )?,
        None => TextSource::Missing,
    };
    let modified = git_show_text(
        &repo_root.workspace,
        &repo_root.git_path,
        &format!("{sha}:{rel}"),
    )?;

    let mut diff_args: Vec<OsString> = vec![
        "show".into(),
        "--no-color".into(),
        "--no-ext-diff".into(),
        "--format=".into(),
        "-m".into(),
        "--first-parent".into(),
        sha.into(),
        "--".into(),
    ];
    diff_args.push(rel.clone().into());
    if original_rel != rel {
        diff_args.push(original_rel.clone().into());
    }
    let patch_output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        diff_args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&patch_output, "git show <commit> -- <path> failed")?;
    let patch_text = match String::from_utf8(patch_output.stdout) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
    };

    let is_binary =
        matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

    Ok(GitDiffContentResult {
        original_content: original.into_text(),
        modified_content: modified.into_text(),
        is_binary,
        fallback_patch: patch_text,
        truncated: patch_output.truncated,
    })
}

pub fn remote_url(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    name: &str,
    workspace: &WorkspaceEnv,
) -> Result<Option<String>> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if name.is_empty() || name.len() > 64 || !name.chars().all(is_remote_name_char) {
        return Ok(None);
    }
    git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        ["config", "--get", &format!("remote.{name}.url")],
    )
}

fn is_remote_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'
}

fn parse_diff_tree_name_status(bytes: &[u8]) -> Vec<GitCommitFileChange> {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let mut tokens = s.split('\0').filter(|t| !t.is_empty());
    let mut files: Vec<GitCommitFileChange> = Vec::new();
    while let Some(status_tok) = tokens.next() {
        let status_char = status_tok.chars().next().unwrap_or(' ');
        if status_char == 'R' || status_char == 'C' {
            let original = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            let new_path = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            files.push(GitCommitFileChange {
                path: new_path,
                original_path: Some(original),
                status: status_char.to_string(),
                status_label: status_label_for(status_char),
                added: 0,
                removed: 0,
                is_binary: false,
            });
        } else {
            let path = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            files.push(GitCommitFileChange {
                path,
                original_path: None,
                status: status_char.to_string(),
                status_label: status_label_for(status_char),
                added: 0,
                removed: 0,
                is_binary: false,
            });
        }
    }
    files
}

fn apply_numstat(files: &mut [GitCommitFileChange], bytes: &[u8]) {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let tokens: Vec<&str> = s.split('\0').filter(|t| !t.is_empty()).collect();
    let mut idx = 0;
    while idx < tokens.len() {
        let header = tokens[idx];
        idx += 1;
        let mut cols = header.splitn(3, '\t');
        let added_raw = cols.next().unwrap_or("0");
        let removed_raw = cols.next().unwrap_or("0");
        let inline_path = cols.next().unwrap_or("");
        let is_binary = added_raw == "-" && removed_raw == "-";
        let added: u32 = if is_binary {
            0
        } else {
            added_raw.parse().unwrap_or(0)
        };
        let removed: u32 = if is_binary {
            0
        } else {
            removed_raw.parse().unwrap_or(0)
        };

        let (path, original) = if inline_path.is_empty() {
            let original = tokens.get(idx).map(|s| s.to_string()).unwrap_or_default();
            idx += 1;
            let new_path = tokens.get(idx).map(|s| s.to_string()).unwrap_or_default();
            idx += 1;
            (new_path, Some(original))
        } else {
            (inline_path.to_string(), None)
        };

        if path.is_empty() {
            continue;
        }
        if let Some(file) = files.iter_mut().find(|f| f.path == path) {
            file.added = added;
            file.removed = removed;
            file.is_binary = is_binary;
            if file.original_path.is_none() {
                if let Some(orig) = original {
                    if !orig.is_empty() && orig != file.path {
                        file.original_path = Some(orig);
                    }
                }
            }
        }
    }
}

/// Pairs `--name-status -z` with `--numstat -z` for a review range.
///
/// Both list the same files in the same order but in different shapes. In
/// name-status a record is `M\0path` and a rename is `R086\0old\0new`; in
/// numstat it is `added\tremoved\tpath` and a rename leaves the path empty and
/// puts `old` and `new` in the two records that follow. So the two are walked
/// in step rather than joined by path, which a rename would break anyway.
fn parse_range_files(name_status: &str, numstat: &str) -> Vec<GitRangeFile> {
    let mut counts: Vec<(u32, u32, bool)> = Vec::new();
    let mut numstat_fields = numstat.split('\0').filter(|f| !f.is_empty()).peekable();
    while let Some(record) = numstat_fields.next() {
        let mut parts = record.splitn(3, '\t');
        let (Some(added), Some(removed)) = (parts.next(), parts.next()) else {
            continue;
        };
        // `-` marks a binary file, where a line count would be a fiction.
        let is_binary = added == "-" || removed == "-";
        // A rename leaves the path empty here and follows with old and new.
        if parts.next().is_none_or(str::is_empty) {
            numstat_fields.next();
            numstat_fields.next();
        }
        counts.push((
            added.parse().unwrap_or(0),
            removed.parse().unwrap_or(0),
            is_binary,
        ));
    }

    let mut out = Vec::new();
    let mut records = name_status.split('\0').filter(|f| !f.is_empty());
    let mut index = 0usize;
    while let Some(status_field) = records.next() {
        let Some(code) = status_field.chars().next() else {
            continue;
        };
        let Some(first_path) = records.next() else { break };
        let (path, original_path) = if code == 'R' || code == 'C' {
            match records.next() {
                Some(second) => (second.to_string(), Some(first_path.to_string())),
                None => (first_path.to_string(), None),
            }
        } else {
            (first_path.to_string(), None)
        };
        let (added, removed, is_binary) = counts.get(index).copied().unwrap_or((0, 0, false));
        index += 1;
        out.push(GitRangeFile {
            path,
            original_path,
            status: code.to_string(),
            status_label: status_label_for(code),
            added,
            removed,
            is_binary,
        });
    }
    out
}

/// Reads `rev-list --left-right --count base...head`, which prints the count on
/// base first and the count on head second.
fn parse_ahead_behind(line: &str) -> (u32, u32) {
    let mut parts = line.split_whitespace();
    let behind = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let ahead = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    (ahead, behind)
}

fn status_label_for(c: char) -> String {
    match c {
        'A' => "Added".into(),
        'M' => "Modified".into(),
        'D' => "Deleted".into(),
        'R' => "Renamed".into(),
        'C' => "Copied".into(),
        'T' => "Type changed".into(),
        'U' => "Unmerged".into(),
        _ => format!("Status {c}"),
    }
}

pub fn fetch(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["fetch", "--prune"],
        NETWORK_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git fetch failed")
}

pub fn pull_ff_only(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["pull", "--ff-only"],
        NETWORK_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git pull --ff-only failed")
}

fn nothing_to_commit(output: &GitOutput) -> bool {
    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    stderr.contains("nothing to commit") || stdout.contains("nothing to commit")
}

fn resolve_pathspecs(repo_root: &Path, paths: &[String]) -> Result<Vec<String>> {
    let mut out = Vec::with_capacity(paths.len());
    for p in paths {
        out.push(pathspec_from_input(repo_root, p)?);
    }
    Ok(out)
}

fn pathspec_from_input(repo_root: &Path, rel: &str) -> Result<String> {
    let resolved = resolve_within_repo(repo_root, rel)?;
    Ok(pathspec(repo_root, &resolved))
}

fn pathspec(repo_root: &Path, absolute: &Path) -> String {
    absolute
        .strip_prefix(repo_root)
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| absolute.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha_is_safe_accepts_hex() {
        assert!(sha_is_safe("abc123"));
        assert!(sha_is_safe(&"a".repeat(40)));
        assert!(sha_is_safe(&"f".repeat(64)));
    }

    #[test]
    fn sha_is_safe_rejects_non_hex_or_oversize() {
        assert!(!sha_is_safe(""));
        assert!(!sha_is_safe("abcg"));
        assert!(!sha_is_safe("abc 123"));
        assert!(!sha_is_safe(&"a".repeat(65)));
        assert!(!sha_is_safe(";rm -rf /"));
    }

    #[test]
    fn is_remote_name_char_allows_word_and_punct() {
        for c in "abcXYZ012-_.".chars() {
            assert!(is_remote_name_char(c));
        }
        for c in " /:\\?\"'".chars() {
            assert!(!is_remote_name_char(c));
        }
    }

    #[test]
    fn parse_shortstat_pulls_three_counts() {
        let line = " 5 files changed, 12 insertions(+), 3 deletions(-)";
        assert_eq!(parse_shortstat(line), (5, 12, 3));
    }

    #[test]
    fn parse_shortstat_handles_singular_file() {
        let line = " 1 file changed, 1 insertion(+)";
        assert_eq!(parse_shortstat(line), (1, 1, 0));
    }

    #[test]
    fn parse_shortstat_returns_zeros_when_absent() {
        assert_eq!(parse_shortstat("no stat here"), (0, 0, 0));
    }

    #[test]
    fn status_label_for_known_chars() {
        assert_eq!(status_label_for('A'), "Added");
        assert_eq!(status_label_for('M'), "Modified");
        assert_eq!(status_label_for('D'), "Deleted");
        assert_eq!(status_label_for('R'), "Renamed");
        assert_eq!(status_label_for('C'), "Copied");
    }

    #[test]
    fn status_label_for_unknown_falls_back() {
        assert_eq!(status_label_for('X'), "Status X");
    }

    #[test]
    fn looks_like_no_head_recognizes_phrases() {
        let mk = |s: &str| GitOutput {
            stdout: Vec::new(),
            stderr: s.as_bytes().to_vec(),
            exit_code: Some(128),
            timed_out: false,
            truncated: false,
        };
        assert!(looks_like_no_head(&mk(
            "fatal: ambiguous argument 'HEAD': unknown revision"
        )));
        assert!(looks_like_no_head(&mk(
            "fatal: your current branch 'main' does not have any commits yet"
        )));
        assert!(!looks_like_no_head(&mk("fatal: pathspec did not match")));
    }
}

#[cfg(test)]
mod log_parse_tests {
    use super::*;

    fn record(fields: &[&str]) -> String {
        format!("\x1e{}", fields.join("\x1f"))
    }

    #[test]
    fn parses_a_plain_commit() {
        let out = record(&[
            "a".repeat(40).as_str(),
            "Ada",
            "ada@example.com",
            "1700000000",
            "b".repeat(40).as_str(),
            "",
            "do the thing",
            "",
        ]) + "\n\n 3 files changed, 12 insertions(+), 4 deletions(-)\n";

        let entries = parse_log_records(&out);

        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.short_sha, "aaaaaaa");
        assert_eq!(e.author, "Ada");
        assert_eq!(e.subject, "do the thing");
        assert_eq!(e.parents, vec!["b".repeat(40)]);
        assert_eq!((e.files_changed, e.insertions, e.deletions), (3, 12, 4));
        assert!(e.body.is_empty());
        assert!(e.refs.is_empty());
    }

    #[test]
    fn keeps_a_multi_line_body_without_the_diffstat() {
        let out = record(&[
            "a".repeat(40).as_str(),
            "Ada",
            "ada@example.com",
            "1700000000",
            "",
            "",
            "subject",
            "first paragraph\n\nsecond paragraph\n",
        ]) + "\n 1 file changed, 2 insertions(+)\n";

        let entries = parse_log_records(&out);

        assert_eq!(entries[0].body, "first paragraph\n\nsecond paragraph");
        assert_eq!(entries[0].files_changed, 1);
    }

    #[test]
    fn keeps_a_body_line_that_merely_looks_like_a_diffstat() {
        // Only the exact shape git emits is stripped, and only from the tail.
        let body = "we saw 3 files changed here\n";
        let out = record(&[
            "a".repeat(40).as_str(),
            "Ada",
            "a@e.com",
            "1",
            "",
            "",
            "subject",
            body,
        ]) + "\n 2 files changed, 1 insertion(+)\n";

        let entries = parse_log_records(&out);

        assert_eq!(entries[0].body, "we saw 3 files changed here");
        assert_eq!(entries[0].files_changed, 2);
    }

    #[test]
    fn reads_branches_remotes_and_tags_from_full_decorations() {
        let out = record(&[
            "a".repeat(40).as_str(),
            "Ada",
            "a@e.com",
            "1",
            "",
            "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.2.0",
            "subject",
            "",
        ]);

        let refs = &parse_log_records(&out)[0].refs;

        assert_eq!(refs.len(), 3);
        assert_eq!(refs[0].name, "main");
        assert_eq!(refs[0].kind, GitRefKind::Branch);
        assert!(refs[0].is_head);
        assert_eq!(refs[1].name, "origin/main");
        assert_eq!(refs[1].kind, GitRefKind::Remote);
        assert!(!refs[1].is_head);
        assert_eq!(refs[2].name, "v1.2.0");
        assert_eq!(refs[2].kind, GitRefKind::Tag);
    }

    #[test]
    fn reports_a_detached_head() {
        let out = record(&[
            "a".repeat(40).as_str(),
            "Ada",
            "a@e.com",
            "1",
            "",
            "HEAD",
            "subject",
            "",
        ]);

        let refs = &parse_log_records(&out)[0].refs;

        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].name, "HEAD");
        assert_eq!(refs[0].kind, GitRefKind::Other);
        assert!(refs[0].is_head);
    }

    #[test]
    fn drops_the_origin_head_pointer_that_names_no_commit_of_its_own() {
        let out = record(&[
            "a".repeat(40).as_str(),
            "Ada",
            "a@e.com",
            "1",
            "",
            "refs/remotes/origin/HEAD, refs/remotes/origin/main",
            "subject",
            "",
        ]);

        let refs = &parse_log_records(&out)[0].refs;

        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].name, "origin/main");
    }

    #[test]
    fn parses_several_commits_including_one_without_a_diffstat() {
        let out = record(&[
            "a".repeat(40).as_str(), "A", "a@e.com", "1", "", "", "first", "",
        ]) + "\n\n 1 file changed, 1 insertion(+)\n"
            + &record(&[
                "b".repeat(40).as_str(), "B", "b@e.com", "2", "", "", "second", "",
            ])
            + "\n";

        let entries = parse_log_records(&out);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].files_changed, 1);
        assert_eq!(entries[1].files_changed, 0);
        assert_eq!(entries[1].subject, "second");
    }

    #[test]
    fn skips_a_record_whose_sha_is_not_a_sha() {
        let out = record(&["not-a-sha", "A", "a@e.com", "1", "", "", "s", ""]);

        assert!(parse_log_records(&out).is_empty());
    }
}

#[cfg(test)]
mod ref_safety_tests {
    use super::*;

    #[test]
    fn accepts_the_branch_names_people_actually_use() {
        for name in [
            "main",
            "develop",
            "origin/main",
            "feature/pr-review",
            "release/v1.2.0",
            "fix_123",
            "user.name/topic",
        ] {
            assert!(ref_is_safe(name), "{name} should be accepted");
        }
    }

    #[test]
    fn rejects_a_name_git_would_read_as_an_option() {
        // A ref reaches git as an argument; a leading dash makes it a flag.
        assert!(!ref_is_safe("--upload-pack=touch /tmp/pwn"));
        assert!(!ref_is_safe("-x"));
    }

    #[test]
    fn rejects_revision_syntax_rather_than_resolving_it() {
        // The caller asks for a branch. Anything that means something else to
        // the revision parser is refused instead of being interpreted.
        for name in ["main..HEAD", "main...HEAD", "HEAD~1", "HEAD^", "main@{u}", "main:path"] {
            assert!(!ref_is_safe(name), "{name} should be rejected");
        }
    }

    #[test]
    fn rejects_glob_and_shell_significant_characters() {
        for name in ["ma?n", "ma*n", "ma[in]", "main\\x", "main space", "main\ttab"] {
            assert!(!ref_is_safe(name), "{name:?} should be rejected");
        }
    }

    #[test]
    fn rejects_control_characters_and_the_empty_name() {
        assert!(!ref_is_safe(""));
        assert!(!ref_is_safe("main\nrm -rf /"));
        assert!(!ref_is_safe("main\0"));
        assert!(!ref_is_safe("main\x7f"));
    }

    #[test]
    fn rejects_the_shapes_git_check_ref_format_forbids() {
        for name in [
            "main/",
            "/main",
            "main.lock",
            "main//topic",
            ".hidden",
            "topic/.hidden",
            "main.",
        ] {
            assert!(!ref_is_safe(name), "{name} should be rejected");
        }
    }

    #[test]
    fn bounds_the_length() {
        assert!(!ref_is_safe(&"a".repeat(256)));
        assert!(ref_is_safe(&"a".repeat(255)));
    }
}

#[cfg(test)]
mod range_parse_tests {
    use super::*;

    #[test]
    fn pairs_name_status_with_numstat() {
        let name_status = "M\0src/a.ts\0A\0src/b.ts\0D\0src/c.ts\0";
        let numstat = "3\t1\tsrc/a.ts\x0010\t0\tsrc/b.ts\x000\t7\tsrc/c.ts\0";

        let files = parse_range_files(name_status, numstat);

        assert_eq!(files.len(), 3);
        assert_eq!(files[0].path, "src/a.ts");
        assert_eq!(files[0].status, "M");
        assert_eq!((files[0].added, files[0].removed), (3, 1));
        assert_eq!(files[1].status_label, "Added");
        assert_eq!(files[2].status_label, "Deleted");
        assert_eq!((files[2].added, files[2].removed), (0, 7));
    }

    #[test]
    fn reads_a_rename_as_two_paths() {
        // -M reports a rename as `R<score>` with old and new, and numstat
        // leaves its path empty and follows with the same pair, so the two
        // lists only stay aligned if both halves are consumed together.
        let name_status = "R086\0src/old.ts\0src/new.ts\0M\0src/after.ts\0";
        let numstat = "10\t10\t\0src/old.ts\0src/new.ts\x004\t2\tsrc/after.ts\0";

        let files = parse_range_files(name_status, numstat);

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "src/new.ts");
        assert_eq!(files[0].original_path.as_deref(), Some("src/old.ts"));
        assert_eq!(files[0].status, "R");
        assert_eq!(files[0].status_label, "Renamed");
        assert_eq!((files[0].added, files[0].removed), (10, 10));
        // The file after a rename must still get its own counts.
        assert_eq!(files[1].path, "src/after.ts");
        assert_eq!((files[1].added, files[1].removed), (4, 2));
    }

    #[test]
    fn marks_a_binary_file_instead_of_inventing_counts() {
        let files = parse_range_files("M\0logo.png\0", "-\t-\tlogo.png\0");

        assert!(files[0].is_binary);
        assert_eq!((files[0].added, files[0].removed), (0, 0));
    }

    #[test]
    fn keeps_a_file_whose_counts_never_arrived() {
        let files = parse_range_files("M\0src/a.ts\0", "");

        assert_eq!(files.len(), 1);
        assert_eq!((files[0].added, files[0].removed), (0, 0));
    }

    #[test]
    fn ignores_trailing_separators_and_blank_records() {
        assert!(parse_range_files("", "").is_empty());
        assert!(parse_range_files("\0\0", "\0\0").is_empty());
    }

    #[test]
    fn reads_ahead_and_behind_in_the_order_git_prints_them() {
        // `rev-list --left-right --count base...head` prints behind then ahead.
        assert_eq!(parse_ahead_behind("4\t7"), (7, 4));
        assert_eq!(parse_ahead_behind("0\t0"), (0, 0));
        assert_eq!(parse_ahead_behind("nonsense"), (0, 0));
    }

}

/// Branches a review can compare against.
///
/// Remote-tracking refs are listed as well as local ones because a review is
/// normally against what the remote has, not a local copy that may have moved.
pub fn branches(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitBranchList> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;

    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("for-each-ref"),
            OsStr::new("--format=%(refname)"),
            OsStr::new("refs/heads"),
            OsStr::new("refs/remotes"),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git for-each-ref"));
    }
    ensure_success(&output, "git for-each-ref failed")?;

    let mut local = Vec::new();
    let mut remote = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some(name) = line.strip_prefix("refs/heads/") {
            if ref_is_safe(name) {
                local.push(name.to_string());
            }
        } else if let Some(name) = line.strip_prefix("refs/remotes/") {
            // `<remote>/HEAD` is a symbolic pointer at a branch already listed.
            if !name.ends_with("/HEAD") && ref_is_safe(name) {
                remote.push(name.to_string());
            }
        }
    }
    local.sort();
    remote.sort();

    let current = git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
    )?
    .filter(|name| ref_is_safe(name));

    let default_base = pick_default_base(&local, &remote, current.as_deref(), || {
        git_stdout_line_opt(
            &repo_root.workspace,
            &repo_root.git_path,
            ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        )
        .ok()
        .flatten()
    });

    Ok(GitBranchList {
        current,
        local,
        remote,
        default_base,
    })
}

/// Branch a review should start from.
///
/// The remote's own HEAD is the best answer when it is set, since that is the
/// branch pull requests target. Otherwise fall back to the conventional names,
/// preferring the remote copy, and never to the branch being reviewed.
fn pick_default_base(
    local: &[String],
    remote: &[String],
    current: Option<&str>,
    remote_head: impl FnOnce() -> Option<String>,
) -> Option<String> {
    let usable = |name: &String| Some(name.as_str()) != current;
    if let Some(head) = remote_head() {
        if remote.contains(&head) && Some(head.as_str()) != current {
            return Some(head);
        }
    }
    for candidate in ["main", "master", "develop", "trunk"] {
        if let Some(found) = remote
            .iter()
            .find(|name| name.ends_with(&format!("/{candidate}")) && usable(name))
        {
            return Some(found.clone());
        }
        if let Some(found) = local.iter().find(|name| *name == candidate && usable(name)) {
            return Some(found.clone());
        }
    }
    remote
        .iter()
        .chain(local.iter())
        .find(|name| usable(name))
        .cloned()
}

/// What `head` adds on top of `base`, as a pull request would show it.
///
/// The diff is taken from the merge base, not from the tip of `base`, so
/// commits that landed on the base branch after this one forked do not appear
/// as changes the author made.
pub fn range_summary(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    base: &str,
    head: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitRangeSummary> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if !ref_is_safe(base) || !ref_is_safe(head) {
        return Err(GitError::command("git diff", "invalid branch name"));
    }

    let merge_base = git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        ["merge-base", base, head],
    )?
    .ok_or_else(|| GitError::command("git merge-base", "branches share no history"))?;

    let counts = git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        [
            "rev-list",
            "--left-right",
            "--count",
            &format!("{base}...{head}"),
        ],
    )?
    .unwrap_or_default();
    let (ahead, behind) = parse_ahead_behind(&counts);

    let name_status = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("diff"),
            OsStr::new("--no-color"),
            OsStr::new("--name-status"),
            OsStr::new("-M"),
            OsStr::new("-z"),
            OsStr::new(&merge_base),
            OsStr::new(head),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&name_status, "git diff --name-status failed")?;
    let numstat = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("diff"),
            OsStr::new("--no-color"),
            OsStr::new("--numstat"),
            OsStr::new("-M"),
            OsStr::new("-z"),
            OsStr::new(&merge_base),
            OsStr::new(head),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&numstat, "git diff --numstat failed")?;

    Ok(GitRangeSummary {
        merge_base,
        base: base.to_string(),
        head: head.to_string(),
        ahead,
        behind,
        files: parse_range_files(
            &String::from_utf8_lossy(&name_status.stdout),
            &String::from_utf8_lossy(&numstat.stdout),
        ),
    })
}

/// A file as it looked at the merge base and as it looks on the branch tip.
///
/// This is the whole-branch view of one file; reviewing a single commit uses
/// `commit_file_diff`, which is scoped to that commit's parent.
pub fn range_file_diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    base_rev: &str,
    head_rev: &str,
    path: &str,
    original_path: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffContentResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    // The base is a resolved merge base, the head a branch name.
    if !sha_is_safe(base_rev) || !ref_is_safe(head_rev) {
        return Err(GitError::command("git diff", "invalid revision"));
    }
    let resolved = resolve_within_repo(&repo_root.local_path, path)?;
    let rel = resolved
        .strip_prefix(&repo_root.local_path)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.replace('\\', "/"));
    let original_rel = match original_path {
        Some(orig) if !orig.is_empty() => {
            let resolved_orig = resolve_within_repo(&repo_root.local_path, orig)?;
            resolved_orig
                .strip_prefix(&repo_root.local_path)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| orig.replace('\\', "/"))
        }
        _ => rel.clone(),
    };

    let original = git_show_text(
        &repo_root.workspace,
        &repo_root.git_path,
        &format!("{base_rev}:{original_rel}"),
    )?;
    let modified = git_show_text(
        &repo_root.workspace,
        &repo_root.git_path,
        &format!("{head_rev}:{rel}"),
    )?;

    let mut diff_args: Vec<OsString> = vec![
        "diff".into(),
        "--no-color".into(),
        "--no-ext-diff".into(),
        "-M".into(),
        base_rev.into(),
        head_rev.into(),
        "--".into(),
        rel.clone().into(),
    ];
    if original_rel != rel {
        diff_args.push(original_rel.clone().into());
    }
    let patch = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        diff_args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&patch, "git diff <range> -- <path> failed")?;

    let is_binary =
        matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

    Ok(GitDiffContentResult {
        original_content: original.into_text(),
        modified_content: modified.into_text(),
        is_binary,
        fallback_patch: String::from_utf8_lossy(&patch.stdout).into_owned(),
        truncated: patch.truncated,
    })
}

#[cfg(test)]
mod commit_files_counts_tests {
    use super::*;

    #[test]
    fn a_commit_file_list_carries_its_line_counts() {
        // `git diff-tree` honours only one of --name-status and --numstat, so
        // asking for both in one call returned name-status alone and every
        // file reported +0 -0. The two lists now come from separate calls.
        let name_status = b"M\x00TERAX.md\x00A\x00src/new.ts\x00";
        let numstat = b"1\t1\tTERAX.md\x0042\t0\tsrc/new.ts\x00";

        let mut files = parse_diff_tree_name_status(name_status);
        apply_numstat(&mut files, numstat);

        assert_eq!((files[0].added, files[0].removed), (1, 1));
        assert_eq!((files[1].added, files[1].removed), (42, 0));
    }
}
