use super::blocks::{self, BlockFrames, BlockStore};
use super::search::{BlockMatch, BlockSearchState, SearchCommand};
use super::selection::{SelectionCommand, SelectionState};
use libghostty_vt::terminal::{ScrollViewport, Terminal};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum BlockCommand {
    Select {
        #[serde(rename = "blockId")]
        block_id: String,
    },
    SelectAt {
        seq: u32,
        row: u16,
    },
    Navigate {
        direction: i8,
    },
    Find {
        #[serde(rename = "blockId")]
        block_id: String,
        query: String,
    },
    Reveal {
        version: u64,
        index: u16,
    },
    ClearSearch,
}
impl BlockCommand {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Select { block_id } | Self::Find { block_id, .. } => {
                blocks::validate_id(block_id)?
            }
            Self::SelectAt { seq, row } if *seq == 0 || *row >= super::MAX_ROWS => {
                return Err("invalid terminal block coordinates".into())
            }
            Self::Navigate { direction } if !matches!(direction, -1 | 1) => {
                return Err("invalid terminal block direction".into())
            }
            Self::Reveal { version, index }
                if *version == 0 || *version > 9_007_199_254_740_991 || *index >= 500 =>
            {
                return Err("invalid terminal block search match".into())
            }
            _ => {}
        }
        if let Self::Find { query, .. } = self {
            SearchCommand::Find {
                query: query.clone(),
                forward: true,
                incremental: true,
            }
            .validate()?;
        }
        Ok(())
    }
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BlockReply {
    Selection {
        applied: bool,
        #[serde(rename = "blockId")]
        block_id: Option<String>,
        selection: Option<String>,
    },
    Matches {
        version: u64,
        matches: Vec<BlockMatch>,
    },
    Revealed {
        found: bool,
    },
    Cleared,
}
#[derive(Default)]
pub(super) struct BlockActions {
    selected: Option<String>,
    searched_block: Option<String>,
    search: BlockSearchState,
}
impl BlockActions {
    pub fn invalidate_host_context(&mut self) -> Result<(), String> {
        self.selected = None;
        self.searched_block = None;
        self.search.clear()
    }
    pub fn manual_selection(&mut self) {
        self.selected = None;
    }
    pub fn is_search_active(&self) -> bool {
        self.search.is_active()
    }
    fn select(
        &mut self,
        term: &Terminal<'_, '_>,
        blocks: &BlockStore,
        selection: &mut SelectionState,
        id: &str,
    ) -> Result<Option<u32>, String> {
        let Some(output) = blocks.output_selection(term, id)? else {
            return Ok(None);
        };
        selection.reset(term);
        term.set_selection(output.selection.as_ref())
            .map_err(|error| error.to_string())?;
        self.selected = Some(id.into());
        Ok(Some(output.start.y))
    }
    fn selection_reply(
        &self,
        term: &Terminal<'_, '_>,
        selection: &mut SelectionState,
        applied: bool,
    ) -> Result<BlockReply, String> {
        Ok(BlockReply::Selection {
            applied,
            block_id: if applied { self.selected.clone() } else { None },
            selection: selection.apply(term, &SelectionCommand::Read)?,
        })
    }
    pub fn apply(
        &mut self,
        term: &mut Terminal<'_, '_>,
        blocks: &BlockStore,
        frames: &BlockFrames,
        selection: &mut SelectionState,
        command: &BlockCommand,
    ) -> Result<BlockReply, String> {
        command.validate()?;
        match command {
            BlockCommand::Select { block_id } => {
                let applied = self.select(term, blocks, selection, block_id)?.is_some();
                self.selection_reply(term, selection, applied)
            }
            BlockCommand::SelectAt { seq, row } => {
                let frame = frames
                    .query(*seq)
                    .ok_or("terminal block frame is no longer available")?;
                if *row >= frame.viewport_rows {
                    return Err("invalid terminal block row".into());
                }
                let line = frame.viewport_offset + u64::from(*row);
                let id = frame
                    .blocks
                    .iter()
                    .find(|block| {
                        !frame.alternate_screen
                            && !block.running
                            && u64::from(block.start_line) <= line
                            && line <= u64::from(block.end_line)
                    })
                    .map(|block| block.id.clone());
                let applied = if let Some(id) = id {
                    self.select(term, blocks, selection, &id)?.is_some()
                } else {
                    false
                };
                self.selection_reply(term, selection, applied)
            }
            BlockCommand::Navigate { direction } => {
                let ids = blocks
                    .snapshot(term)?
                    .blocks
                    .into_iter()
                    .filter(|block| !block.running)
                    .map(|block| block.id)
                    .collect::<Vec<_>>();
                let current = self
                    .selected
                    .as_ref()
                    .and_then(|selected| ids.iter().position(|id| id == selected));
                let mut at = match current {
                    Some(at) => at as isize + isize::from(*direction),
                    None if *direction < 0 => ids.len() as isize - 1,
                    None => -1,
                };
                let mut applied = false;
                while at >= 0 && (at as usize) < ids.len() {
                    if let Some(row) = self.select(term, blocks, selection, &ids[at as usize])? {
                        term.scroll_viewport(ScrollViewport::Row((row as usize).saturating_sub(2)));
                        applied = true;
                        break;
                    }
                    at += isize::from(*direction);
                }
                self.selection_reply(term, selection, applied)
            }
            BlockCommand::Find { block_id, query } => {
                let output = blocks
                    .output_selection(term, block_id)?
                    .ok_or("terminal block output is no longer available")?;
                let bounds = output
                    .selection
                    .as_ref()
                    .map(|_| (output.start, output.end));
                let (version, matches) = self.search.find(term, bounds, query)?;
                self.searched_block = Some(block_id.clone());
                Ok(BlockReply::Matches { version, matches })
            }
            BlockCommand::Reveal { version, index } => {
                let valid = match &self.searched_block {
                    Some(id) => blocks.verified_range(term, id)?.is_some(),
                    None => false,
                };
                Ok(BlockReply::Revealed {
                    found: valid && self.search.reveal(term, *version, *index)?,
                })
            }
            BlockCommand::ClearSearch => {
                self.search.clear()?;
                self.searched_block = None;
                Ok(BlockReply::Cleared)
            }
        }
    }
    pub fn highlights(
        &mut self,
        term: &Terminal<'_, '_>,
        blocks: &BlockStore,
    ) -> Result<Vec<u8>, String> {
        if self.search.is_active() {
            let valid = match &self.searched_block {
                Some(id) => blocks.verified_range(term, id)?.is_some(),
                None => false,
            };
            if !valid {
                self.search.clear()?;
                self.searched_block = None;
                return Ok(Vec::new());
            }
        }
        self.search.highlights(term)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::pty::engine::{
        blocks::{BlockFrames, BlockStore},
        selection::{SelectionCommand, SelectionState},
        shell::ShellIntegration,
    };
    use libghostty_vt::{Terminal, TerminalOptions};
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    fn feed(
        term: &mut Terminal<'_, '_>,
        shell: &mut ShellIntegration,
        blocks: &mut BlockStore,
        cmd: &str,
        body: &str,
    ) {
        blocks.feed(term,shell,format!("\x1b]133;C;aid={TOKEN};cmdline_url={cmd}\x07{body}\x1b]133;D;0;aid={TOKEN}\x07\r\n").as_bytes(),1).unwrap();
    }
    fn fixture() -> (
        Terminal<'static, 'static>,
        ShellIntegration,
        BlockStore,
        BlockFrames,
        SelectionState,
        BlockActions,
    ) {
        let mut term = Terminal::new(TerminalOptions {
            cols: 20,
            rows: 5,
            max_scrollback: 1024 * 1024,
        })
        .unwrap();
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut blocks = BlockStore::default();
        feed(&mut term, &mut shell, &mut blocks, "first", "first output");
        feed(
            &mut term,
            &mut shell,
            &mut blocks,
            "second",
            "second output",
        );
        let mut frames = BlockFrames::default();
        frames.commit(1, blocks.snapshot(&term).unwrap());
        (
            term,
            shell,
            blocks,
            frames,
            SelectionState::default(),
            BlockActions::default(),
        )
    }
    fn action(value: serde_json::Value) -> BlockCommand {
        serde_json::from_value(value).unwrap()
    }
    fn selected(reply: BlockReply) -> (bool, Option<String>, Option<String>) {
        match reply {
            BlockReply::Selection {
                applied,
                block_id,
                selection,
            } => (applied, block_id, selection),
            _ => panic!("expected selection reply"),
        }
    }
    #[test]
    fn select_uses_exact_native_output_and_does_not_include_its_neighbor() {
        let (mut term, _, blocks, frames, mut selection, mut actions) = fixture();
        let reply = actions
            .apply(
                &mut term,
                &blocks,
                &frames,
                &mut selection,
                &action(serde_json::json!({"kind":"select","blockId":"b1"})),
            )
            .unwrap();
        assert_eq!(
            selected(reply),
            (true, Some("b1".into()), Some("first output".into()))
        );
        assert_eq!(
            selection
                .apply(&term, &SelectionCommand::Read)
                .unwrap()
                .as_deref(),
            Some("first output")
        );
    }
    #[test]
    fn unknown_or_damaged_blocks_preserve_manual_selection() {
        let (mut term, mut shell, mut blocks, frames, mut selection, mut actions) = fixture();
        selection
            .apply(&term, &SelectionCommand::Word { col: 0, row: 1 })
            .unwrap();
        let before = selection.apply(&term, &SelectionCommand::Read).unwrap();
        for id in ["b99", "b1"] {
            if id == "b1" {
                blocks
                    .feed(&mut term, &mut shell, b"\x1b[1;1HCHANGED", 2)
                    .unwrap();
            }
            let reply = actions
                .apply(
                    &mut term,
                    &blocks,
                    &frames,
                    &mut selection,
                    &action(serde_json::json!({"kind":"select","blockId":id})),
                )
                .unwrap();
            assert_eq!(selected(reply), (false, None, before.clone()));
        }
    }
    #[test]
    fn navigation_uses_block_identity_and_resets_after_manual_selection() {
        let (mut term, _, blocks, frames, mut selection, mut actions) = fixture();
        let previous = action(serde_json::json!({"kind":"navigate","direction":-1}));
        let next = action(serde_json::json!({"kind":"navigate","direction":1}));
        for (command, id, text) in [
            (&previous, "b2", "second output"),
            (&previous, "b1", "first output"),
            (&next, "b2", "second output"),
        ] {
            let reply = actions
                .apply(&mut term, &blocks, &frames, &mut selection, command)
                .unwrap();
            assert_eq!(selected(reply), (true, Some(id.into()), Some(text.into())));
        }
        actions.manual_selection();
        let reply = actions
            .apply(&mut term, &blocks, &frames, &mut selection, &next)
            .unwrap();
        assert!(!selected(reply).0);
    }
    #[test]
    fn pointer_lookup_uses_the_presented_frame_and_rejects_missing_frames() {
        let (mut term, mut shell, mut blocks, frames, mut selection, mut actions) = fixture();
        feed(&mut term, &mut shell, &mut blocks, "third", "third output");
        let reply = actions
            .apply(
                &mut term,
                &blocks,
                &frames,
                &mut selection,
                &action(serde_json::json!({"kind":"selectAt","seq":1,"row":0})),
            )
            .unwrap();
        assert_eq!(selected(reply).2.as_deref(), Some("first output"));
        assert!(actions
            .apply(
                &mut term,
                &blocks,
                &frames,
                &mut selection,
                &action(serde_json::json!({"kind":"selectAt","seq":99,"row":0}))
            )
            .is_err());
    }
    #[test]
    fn action_validation_is_closed_bounded_and_precedes_mutation() {
        for value in [
            serde_json::json!({"kind":"select","blockId":"b0"}),
            serde_json::json!({"kind":"navigate","direction":0}),
            serde_json::json!({"kind":"navigate","direction":2}),
            serde_json::json!({"kind":"selectAt","seq":0,"row":0}),
            serde_json::json!({"kind":"selectAt","seq":1,"row":500}),
            serde_json::json!({"kind":"find","blockId":"b1","query":"bad\nquery"}),
            serde_json::json!({"kind":"find","blockId":"b1","query":"x".repeat(4097)}),
        ] {
            assert!(action(value).validate().is_err());
        }
        assert!(serde_json::from_value::<BlockCommand>(
            serde_json::json!({"kind":"select","blockId":"b1","extra":true})
        )
        .is_err());
    }
}

#[cfg(test)]
mod scoped_search_tests {
    use super::*;
    use crate::modules::pty::engine::{
        blocks::{BlockFrames, BlockStore},
        selection::{SelectionCommand, SelectionState},
        shell::ShellIntegration,
    };
    use libghostty_vt::{Terminal, TerminalOptions};
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    fn command(value: serde_json::Value) -> BlockCommand {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn block_search_is_scoped_overlapping_unicode_aware_and_independent_from_selection() {
        let mut term = Terminal::new(TerminalOptions {
            cols: 12,
            rows: 4,
            max_scrollback: 1024 * 1024,
        })
        .unwrap();
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut blocks = BlockStore::default();
        for (cmd, body) in [
            ("first", "banana e\u{301}界\r\nbanana"),
            ("second", "banana outside"),
        ] {
            blocks.feed(&mut term,&mut shell,format!("\x1b]133;C;aid={TOKEN};cmdline_url={cmd}\x07{body}\x1b]133;D;0;aid={TOKEN}\x07\r\n").as_bytes(),1).unwrap();
        }
        let frames = BlockFrames::default();
        let mut selection = SelectionState::default();
        selection.apply(&term, &SelectionCommand::All).unwrap();
        let before = selection.apply(&term, &SelectionCommand::Read).unwrap();
        let mut actions = BlockActions::default();
        let found = actions
            .apply(
                &mut term,
                &blocks,
                &frames,
                &mut selection,
                &command(serde_json::json!({"kind":"find","blockId":"b1","query":"ana"})),
            )
            .unwrap();
        let version = match found {
            BlockReply::Matches { version, matches } => {
                assert_eq!(matches.len(), 4);
                version
            }
            _ => panic!("expected matches"),
        };
        let revealed = actions
            .apply(
                &mut term,
                &blocks,
                &frames,
                &mut selection,
                &command(serde_json::json!({"kind":"reveal","version":version,"index":2})),
            )
            .unwrap();
        assert!(matches!(revealed, BlockReply::Revealed { found: true }));
        assert!(actions.highlights(&term, &blocks).unwrap().contains(&2));
        assert_eq!(
            selection.apply(&term, &SelectionCommand::Read).unwrap(),
            before
        );
        let wide = actions
            .apply(
                &mut term,
                &blocks,
                &frames,
                &mut selection,
                &command(serde_json::json!({"kind":"find","blockId":"b1","query":"e\u{301}界"})),
            )
            .unwrap();
        match wide {
            BlockReply::Matches { matches, .. } => {
                assert_eq!(matches.len(), 1);
                assert_eq!(matches[0].col, 7);
            }
            _ => panic!("expected match"),
        };
        actions
            .apply(
                &mut term,
                &blocks,
                &frames,
                &mut selection,
                &BlockCommand::ClearSearch,
            )
            .unwrap();
        assert!(actions.highlights(&term, &blocks).unwrap().is_empty());
        let stale = actions
            .apply(
                &mut term,
                &blocks,
                &frames,
                &mut selection,
                &command(serde_json::json!({"kind":"reveal","version":version,"index":0})),
            )
            .unwrap();
        assert!(matches!(stale, BlockReply::Revealed { found: false }));
    }
    #[test]
    fn block_search_does_not_match_prompt_text_past_the_last_output_cell() {
        let mut term = Terminal::new(TerminalOptions {
            cols: 20,
            rows: 4,
            max_scrollback: 1024 * 1024,
        })
        .unwrap();
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut blocks = BlockStore::default();
        blocks
            .feed(
                &mut term,
                &mut shell,
                format!("\x1b]133;C;aid={TOKEN}\x07body\x1b]133;D;0;aid={TOKEN}\x07PROMPT")
                    .as_bytes(),
                1,
            )
            .unwrap();
        let result = BlockActions::default()
            .apply(
                &mut term,
                &blocks,
                &BlockFrames::default(),
                &mut SelectionState::default(),
                &command(serde_json::json!({"kind":"find","blockId":"b1","query":"PROMPT"})),
            )
            .unwrap();
        match result {
            BlockReply::Matches { matches, .. } => assert!(matches.is_empty()),
            _ => panic!("expected matches"),
        };
    }
}

#[cfg(test)]
mod search_edge_tests {
    use super::*;
    use crate::modules::pty::engine::{
        blocks::{BlockFrames, BlockStore},
        selection::SelectionState,
        shell::ShellIntegration,
    };
    use libghostty_vt::{Terminal, TerminalOptions};
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    fn fixture(cols: u16, body: &str, after: &str) -> (Terminal<'static, 'static>, BlockStore) {
        let mut term = Terminal::new(TerminalOptions {
            cols,
            rows: 5,
            max_scrollback: 1024 * 1024,
        })
        .unwrap();
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut blocks = BlockStore::default();
        blocks
            .feed(
                &mut term,
                &mut shell,
                format!("\x1b]133;C;aid={TOKEN}\x07{body}\x1b]133;D;0;aid={TOKEN}\x07{after}")
                    .as_bytes(),
                1,
            )
            .unwrap();
        (term, blocks)
    }
    fn find(
        actions: &mut BlockActions,
        term: &mut Terminal<'_, '_>,
        blocks: &BlockStore,
        query: &str,
    ) -> (u64, Vec<BlockMatch>) {
        let reply = actions
            .apply(
                term,
                blocks,
                &BlockFrames::default(),
                &mut SelectionState::default(),
                &BlockCommand::Find {
                    block_id: "b1".into(),
                    query: query.into(),
                },
            )
            .unwrap();
        match reply {
            BlockReply::Matches { version, matches } => (version, matches),
            _ => panic!("expected matches"),
        }
    }
    #[test]
    fn empty_output_never_searches_a_later_prompt() {
        let (mut term, blocks) = fixture(20, "", "PROMPT");
        assert!(find(&mut BlockActions::default(), &mut term, &blocks, "P")
            .1
            .is_empty());
    }
    #[test]
    fn wide_final_cell_is_searchable_without_including_the_prompt() {
        let (mut term, blocks) = fixture(20, "e\u{301}界", "PROMPT");
        let mut actions = BlockActions::default();
        let (_, matches) = find(&mut actions, &mut term, &blocks, "e\u{301}界");
        assert_eq!(matches.len(), 1);
        assert_eq!((matches[0].col, matches[0].len), (0, 3));
        assert!(find(&mut actions, &mut term, &blocks, "PROMPT")
            .1
            .is_empty());
    }
    #[test]
    fn search_match_anchors_survive_reflow_and_reject_changed_content() {
        let (mut term, mut blocks) = fixture(8, "abcdefghijklmnop", "\r\nPROMPT");
        let mut actions = BlockActions::default();
        let (version, matches) = find(&mut actions, &mut term, &blocks, "efghij");
        assert_eq!(matches.len(), 1);
        term.resize(5, 5, 0, 0).unwrap();
        let revealed = actions
            .apply(
                &mut term,
                &blocks,
                &BlockFrames::default(),
                &mut SelectionState::default(),
                &BlockCommand::Reveal { version, index: 0 },
            )
            .unwrap();
        assert!(matches!(revealed, BlockReply::Revealed { found: true }));
        assert!(actions.highlights(&term, &blocks).unwrap().contains(&2));
        term.vt_write(b"\x1b[H\x1b[2Jnew");
        blocks.prune_visible(&term).unwrap();
        assert!(actions.highlights(&term, &blocks).unwrap().is_empty());
    }
    #[test]
    fn unicode_match_across_a_soft_wrap_keeps_its_native_cells_after_reflow() {
        let body = "abcdefe\u{301}界XYZ";
        let (mut term, blocks) = fixture(8, body, "\r\nPROMPT");
        let mut actions = BlockActions::default();
        let (version, matches) = find(&mut actions, &mut term, &blocks, "e\u{301}界X");
        assert_eq!(matches.len(), 1);
        assert_eq!((matches[0].line, matches[0].col), (0, 6));
        term.resize(5, 5, 0, 0).unwrap();
        assert!(matches!(
            actions
                .apply(
                    &mut term,
                    &blocks,
                    &BlockFrames::default(),
                    &mut SelectionState::default(),
                    &BlockCommand::Reveal { version, index: 0 }
                )
                .unwrap(),
            BlockReply::Revealed { found: true }
        ));
        let overlay = actions.highlights(&term, &blocks).unwrap();
        let cells = overlay
            .iter()
            .enumerate()
            .filter_map(|(at, value)| (*value == 2).then_some(at))
            .collect::<Vec<_>>();
        assert_eq!(cells, vec![6, 7, 8, 9]);
        assert_eq!(
            blocks
                .read(&term, "b1")
                .unwrap()
                .unwrap()
                .output
                .replace('\n', ""),
            body
        );
    }
    #[test]
    fn scoped_matches_are_bounded() {
        let (mut term, blocks) = fixture(20, &"a".repeat(600), "\r\nPROMPT");
        let (_, matches) = find(&mut BlockActions::default(), &mut term, &blocks, "a");
        assert_eq!(matches.len(), 500);
        assert_eq!(matches.last().unwrap().index, 499);
    }
}
