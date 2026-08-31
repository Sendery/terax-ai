use serde::Serialize;

pub(crate) const DEFAULT_TIMEOUT_SECS: u64 = 30;
pub(crate) const NETWORK_TIMEOUT_SECS: u64 = 120;
pub(crate) const MAX_TIMEOUT_SECS: u64 = 180;
pub(crate) const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub(crate) const MIN_GIT_VERSION: &str = "2.23";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub repo_root: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub is_detached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub status_label: String,
    pub added: u32,
    pub removed: u32,
    pub is_binary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSnapshot {
    pub repo_root: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_detached: bool,
    pub truncated: bool,
    pub changed_files: Vec<GitChangedFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPanelSnapshot {
    pub repo: Option<GitRepoInfo>,
    pub status: Option<GitStatusSnapshot>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardEntry {
    pub path: String,
    pub untracked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub diff_text: String,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffContentResult {
    pub original_content: String,
    pub modified_content: String,
    pub is_binary: bool,
    pub fallback_patch: String,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub commit_sha: String,
    pub summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileChange {
    pub path: String,
    pub original_path: Option<String>,
    pub status: String,
    pub status_label: String,
    pub added: u32,
    pub removed: u32,
    pub is_binary: bool,
}

/// What a decoration on a commit points at. `git log --decorate=full` spells
/// these out as ref paths, so they are distinguished here rather than guessed
/// from a short name: a local branch may legitimately be called `origin/x`.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitRefKind {
    Branch,
    Remote,
    Tag,
    /// Detached HEAD, or a ref namespace the view does not model.
    Other,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
    /// Display name: the branch, remote branch or tag, without its ref prefix.
    pub name: String,
    pub kind: GitRefKind,
    /// True when HEAD points here, so the view can mark the checked-out ref.
    pub is_head: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub author_email: String,
    pub timestamp_secs: i64,
    pub parents: Vec<String>,
    pub subject: String,
    /// Commit message beyond the subject, trailing whitespace trimmed.
    pub body: String,
    /// Branches, remote branches and tags pointing at this commit.
    pub refs: Vec<GitRef>,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchList {
    /// Checked-out branch, absent on a detached HEAD.
    pub current: Option<String>,
    pub local: Vec<String>,
    pub remote: Vec<String>,
    /// Branch a review should default to comparing against.
    pub default_base: Option<String>,
}

/// One file changed across a review range.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRangeFile {
    pub path: String,
    /// Previous path when the change is a rename or copy.
    pub original_path: Option<String>,
    /// Porcelain status letter: A, M, D, R, C or T.
    pub status: String,
    pub status_label: String,
    pub added: u32,
    pub removed: u32,
    pub is_binary: bool,
}

/// What a branch contains relative to the branch it would merge into.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRangeSummary {
    /// Commit the two branches last shared, which is what the review diffs from.
    pub merge_base: String,
    pub base: String,
    pub head: String,
    /// Commits on head that base does not have.
    pub ahead: u32,
    /// Commits on base that head does not have, so the reviewer knows it is stale.
    pub behind: u32,
    pub files: Vec<GitRangeFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub pushed: bool,
}

pub(crate) struct GitOutput {
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) timed_out: bool,
    pub(crate) truncated: bool,
}

pub(crate) enum TextSource {
    Missing,
    Binary,
    Text(String),
}

impl TextSource {
    pub(crate) fn into_text(self) -> String {
        match self {
            TextSource::Text(text) => text,
            TextSource::Missing | TextSource::Binary => String::new(),
        }
    }
}
