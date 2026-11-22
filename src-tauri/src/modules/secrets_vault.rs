//! Every secret of a profile in one keychain item.
//!
//! macOS decides who may read a keychain item per item. A build signed without
//! an Apple Team ID is recognised by its code hash, so each new build is a
//! stranger to every item the previous build wrote and the user is asked for
//! the keychain password once per item. One item per profile makes that one
//! question per build instead of one per stored key.
//!
//! Older builds wrote one item per secret (`service` + `account`). Those are
//! moved in as they are asked for: read, written into the vault, and removed
//! only after the vault write succeeded, so a failure at any step leaves the
//! secret where it was.
//!
//! A sandbox keeps a vault of its own. It is filled once from the installed
//! app's vault and never reads it again, so validating a build asks for the
//! installed app's item a single time rather than on every launch, and nothing
//! a sandbox does reaches the installed app's items.
//!
//! Everything here runs against `ItemStore`, so the migration and the sandbox
//! rules are tested without a keychain.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Serialize};

use super::profile;

pub const VAULT_SERVICE: &str = "terax-vault";
pub const VAULT_ACCOUNT: &str = "secrets";
const VERSION: u32 = 1;

/// One item per `(service, account)`, as the OS keychain stores them.
pub trait ItemStore {
    fn read(&self, service: &str, account: &str) -> Result<Option<String>, String>;
    fn write(&self, service: &str, account: &str, value: &str) -> Result<(), String>;
    /// Removing an item that is not there is a success.
    fn delete(&self, service: &str, account: &str) -> Result<(), String>;
}

pub fn key(service: &str, account: &str) -> String {
    format!("{service}::{account}")
}

/// The vault's own items are not secrets a caller may address by name: read as
/// a legacy item, the vault would be copied into itself and then removed.
pub fn is_reserved_service(service: &str) -> bool {
    service == VAULT_SERVICE || service == profile::scoped_service(VAULT_SERVICE, true)
}

fn vault_service(sandbox: bool) -> String {
    profile::scoped_service(VAULT_SERVICE, sandbox)
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Vault {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    secrets: BTreeMap<String, String>,
    /// Keys removed here. A legacy item, or in a sandbox the installed app's
    /// value, must not bring them back.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    hidden: BTreeSet<String>,
    /// Sandbox only: the installed app's vault has been copied in.
    #[serde(default, skip_serializing_if = "is_false")]
    seeded: bool,
    /// Fields a newer build wrote survive a save by this one.
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

fn read_vault<S: ItemStore>(store: &S, sandbox: bool) -> Result<Option<Vault>, String> {
    let Some(raw) = store.read(&vault_service(sandbox), VAULT_ACCOUNT)? else {
        return Ok(None);
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|e| format!("the secrets vault is unreadable: {e}"))
}

/// Brings the installed app's secrets into a sandbox vault. Returns whether
/// the vault changed.
fn seed_from_installed(
    vault: &mut Vault,
    installed: Result<Option<Vault>, String>,
    reset: bool,
) -> bool {
    match installed {
        Ok(Some(installed)) => {
            if reset {
                vault.secrets = installed.secrets;
                vault.hidden.clear();
            } else {
                for (key, value) in installed.secrets {
                    if !vault.hidden.contains(&key) {
                        vault.secrets.entry(key).or_insert(value);
                    }
                }
            }
            vault.seeded = true;
            true
        }
        // The installed app has not written a vault yet. Its per-secret items
        // are still read one by one, and the copy is tried again next launch.
        Ok(None) => {
            if !reset {
                return false;
            }
            let changed = !vault.secrets.is_empty() || !vault.hidden.is_empty() || vault.seeded;
            vault.secrets.clear();
            vault.hidden.clear();
            vault.seeded = false;
            changed
        }
        Err(err) => {
            log::warn!("the installed app's secrets were not copied into the sandbox: {err}");
            if reset {
                return false;
            }
            // Asked once and refused. Asking again on every launch is the
            // nuisance this exists to remove; a reset from the installed app
            // tries again.
            vault.seeded = true;
            true
        }
    }
}

enum Legacy {
    Value(String),
    Hidden,
    Absent,
}

/// What an older build left for this secret, and the item of this profile to
/// remove once the vault holds it. The installed app's item is never removed
/// by a sandbox.
fn probe_legacy<S: ItemStore>(
    store: &S,
    sandbox: bool,
    service: &str,
    account: &str,
) -> Result<(Legacy, bool), String> {
    if !sandbox {
        return Ok(match store.read(service, account)? {
            Some(value) => (Legacy::Value(value), true),
            None => (Legacy::Absent, false),
        });
    }
    match store.read(&profile::scoped_service(service, true), account)? {
        Some(value) if value == profile::DELETED_SECRET => Ok((Legacy::Hidden, true)),
        Some(value) => Ok((Legacy::Value(value), true)),
        None => Ok(match store.read(service, account)? {
            Some(value) => (Legacy::Value(value), false),
            None => (Legacy::Absent, false),
        }),
    }
}

/// The vault of this process: read from the keychain once, then served from
/// memory, so a launch touches the item a single time.
#[derive(Default)]
pub struct Session {
    state: Option<Result<Vault, String>>,
    /// Legacy items already looked at. Each is read at most once per process,
    /// including one the user refused.
    probed: HashSet<String>,
    /// Legacy items whose secret is in the vault in memory, removed after the
    /// next vault write that succeeds.
    cleanup: Vec<(String, String)>,
}

impl Session {
    pub fn is_open(&self) -> bool {
        self.state.is_some()
    }

    /// Reads the vault once. A failure is kept for the life of the process
    /// rather than retried, so a refused prompt is not repeated on every call
    /// and no write can replace a vault that could not be read.
    ///
    /// `reset` replaces a sandbox's secrets with the installed app's. Returns
    /// whether that request is settled and its marker can go.
    pub fn open<S: ItemStore>(&mut self, store: &S, sandbox: bool, reset: bool) -> Result<bool, String> {
        if let Some(state) = &self.state {
            return state.as_ref().map(|_| false).map_err(Clone::clone);
        }
        let mut vault = match read_vault(store, sandbox) {
            Ok(vault) => vault.unwrap_or_default(),
            Err(err) => {
                self.state = Some(Err(err.clone()));
                return Err(err);
            }
        };
        let reset = sandbox && reset;
        let dirty = sandbox
            && (reset || !vault.seeded)
            && seed_from_installed(&mut vault, read_vault(store, false), reset);
        self.state = Some(Ok(vault));
        if dirty {
            if let Err(err) = self.persist(store, sandbox) {
                log::warn!("the sandbox secrets vault was not saved: {err}");
                return Ok(false);
            }
        }
        Ok(reset)
    }

    fn vault(&self) -> Result<&Vault, String> {
        match &self.state {
            Some(Ok(vault)) => Ok(vault),
            Some(Err(err)) => Err(err.clone()),
            None => Err("the secrets vault is not open".into()),
        }
    }

    fn write<S: ItemStore>(&mut self, store: &S, sandbox: bool, vault: &Vault) -> Result<(), String> {
        let mut out = vault.clone();
        out.version = out.version.max(VERSION);
        let raw = serde_json::to_string(&out).map_err(|e| e.to_string())?;
        store.write(&vault_service(sandbox), VAULT_ACCOUNT, &raw)?;
        // Only now is it safe to drop the items the vault replaced.
        for (service, account) in std::mem::take(&mut self.cleanup) {
            if let Err(err) = store.delete(&service, &account) {
                log::warn!("a migrated keychain item was left behind: {err}");
            }
        }
        Ok(())
    }

    fn persist<S: ItemStore>(&mut self, store: &S, sandbox: bool) -> Result<(), String> {
        let vault = self.vault()?.clone();
        self.write(store, sandbox, &vault)
    }

    /// Reads several secrets of one service, moving any still held in legacy
    /// items into the vault with a single write.
    pub fn get_many<S: ItemStore>(
        &mut self,
        store: &S,
        sandbox: bool,
        service: &str,
        accounts: &[String],
    ) -> Vec<Result<Option<String>, String>> {
        if let Err(err) = self.vault() {
            return accounts.iter().map(|_| Err(err.clone())).collect();
        }
        let mut dirty = false;
        let mut out = Vec::with_capacity(accounts.len());
        for account in accounts {
            let key = key(service, account);
            let Some(Ok(vault)) = self.state.as_mut() else {
                unreachable!("checked above");
            };
            if let Some(value) = vault.secrets.get(&key) {
                out.push(Ok(Some(value.clone())));
                continue;
            }
            if vault.hidden.contains(&key) || !self.probed.insert(key.clone()) {
                out.push(Ok(None));
                continue;
            }
            match probe_legacy(store, sandbox, service, account) {
                Ok((found, own)) => {
                    if own {
                        self.cleanup
                            .push((profile::scoped_service(service, sandbox), account.clone()));
                    }
                    match found {
                        Legacy::Value(value) => {
                            vault.secrets.insert(key, value.clone());
                            dirty = true;
                            out.push(Ok(Some(value)));
                        }
                        Legacy::Hidden => {
                            vault.hidden.insert(key);
                            dirty = true;
                            out.push(Ok(None));
                        }
                        Legacy::Absent => out.push(Ok(None)),
                    }
                }
                Err(err) => out.push(Err(err)),
            }
        }
        if dirty {
            // The values are already in hand; an unsaved vault only means the
            // legacy items stay and are moved again next launch.
            if let Err(err) = self.persist(store, sandbox) {
                log::warn!("migrated secrets were not saved to the vault: {err}");
            }
        }
        out
    }

    pub fn get<S: ItemStore>(
        &mut self,
        store: &S,
        sandbox: bool,
        service: &str,
        account: &str,
    ) -> Result<Option<String>, String> {
        self.get_many(store, sandbox, service, &[account.to_string()])
            .pop()
            .unwrap_or(Ok(None))
    }

    pub fn set<S: ItemStore>(
        &mut self,
        store: &S,
        sandbox: bool,
        service: &str,
        account: &str,
        value: &str,
    ) -> Result<(), String> {
        let key = key(service, account);
        let mut next = self.vault()?.clone();
        next.secrets.insert(key.clone(), value.to_string());
        next.hidden.remove(&key);
        self.write(store, sandbox, &next)?;
        self.state = Some(Ok(next));
        self.drop_own_legacy(store, sandbox, service, account, key);
        Ok(())
    }

    pub fn delete<S: ItemStore>(
        &mut self,
        store: &S,
        sandbox: bool,
        service: &str,
        account: &str,
    ) -> Result<(), String> {
        let key = key(service, account);
        let mut next = self.vault()?.clone();
        let had = next.secrets.remove(&key).is_some();
        let newly_hidden = next.hidden.insert(key.clone());
        if had || newly_hidden {
            self.write(store, sandbox, &next)?;
            self.state = Some(Ok(next));
        }
        self.drop_own_legacy(store, sandbox, service, account, key);
        Ok(())
    }

    /// The vault now answers for this key, so this profile's legacy item is
    /// dead weight. Best effort: the vault already shadows it.
    fn drop_own_legacy<S: ItemStore>(
        &mut self,
        store: &S,
        sandbox: bool,
        service: &str,
        account: &str,
        key: String,
    ) {
        if !self.probed.insert(key) {
            return;
        }
        if let Err(err) = store.delete(&profile::scoped_service(service, sandbox), account) {
            log::warn!("a replaced keychain item was left behind: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const SVC: &str = "terax-ai";
    const SANDBOX_SVC: &str = "terax-ai.sandbox";
    const SANDBOX_VAULT: &str = "terax-vault.sandbox";

    #[derive(Default)]
    struct Fake {
        items: RefCell<BTreeMap<(String, String), String>>,
        reads: RefCell<Vec<(String, String)>>,
        writes: RefCell<Vec<(String, String)>>,
        deletes: RefCell<Vec<(String, String)>>,
        deny_read: RefCell<BTreeSet<(String, String)>>,
        deny_write: RefCell<bool>,
        deny_delete: RefCell<bool>,
    }

    fn id(service: &str, account: &str) -> (String, String) {
        (service.to_string(), account.to_string())
    }

    impl Fake {
        fn with(items: &[(&str, &str, &str)]) -> Self {
            let fake = Fake::default();
            for (service, account, value) in items {
                fake.put(service, account, value);
            }
            fake
        }
        fn put(&self, service: &str, account: &str, value: &str) {
            self.items.borrow_mut().insert(id(service, account), value.to_string());
        }
        fn has(&self, service: &str, account: &str) -> bool {
            self.items.borrow().contains_key(&id(service, account))
        }
        fn vault(&self, service: &str) -> Vault {
            serde_json::from_str(&self.items.borrow()[&id(service, VAULT_ACCOUNT)]).unwrap()
        }
        fn reads_of(&self, service: &str, account: &str) -> usize {
            let wanted = id(service, account);
            self.reads.borrow().iter().filter(|r| **r == wanted).count()
        }
        fn put_vault(&self, service: &str, secrets: &[(&str, &str)]) {
            let vault = Vault {
                version: VERSION,
                secrets: secrets.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
                ..Vault::default()
            };
            self.put(service, VAULT_ACCOUNT, &serde_json::to_string(&vault).unwrap());
        }
    }

    impl ItemStore for Fake {
        fn read(&self, service: &str, account: &str) -> Result<Option<String>, String> {
            self.reads.borrow_mut().push(id(service, account));
            if self.deny_read.borrow().contains(&id(service, account)) {
                return Err("user denied".into());
            }
            Ok(self.items.borrow().get(&id(service, account)).cloned())
        }
        fn write(&self, service: &str, account: &str, value: &str) -> Result<(), String> {
            if *self.deny_write.borrow() {
                return Err("write refused".into());
            }
            self.writes.borrow_mut().push(id(service, account));
            self.put(service, account, value);
            Ok(())
        }
        fn delete(&self, service: &str, account: &str) -> Result<(), String> {
            if *self.deny_delete.borrow() {
                return Err("delete refused".into());
            }
            self.deletes.borrow_mut().push(id(service, account));
            self.items.borrow_mut().remove(&id(service, account));
            Ok(())
        }
    }

    fn open(store: &Fake, sandbox: bool) -> Session {
        let mut session = Session::default();
        session.open(store, sandbox, false).unwrap();
        session
    }

    fn accounts(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    fn values(results: Vec<Result<Option<String>, String>>) -> Vec<Option<String>> {
        results.into_iter().map(|r| r.unwrap()).collect()
    }

    #[test]
    fn legacy_items_move_into_one_item_with_one_write() {
        let store = Fake::with(&[(SVC, "openai", "sk-o"), (SVC, "anthropic", "sk-a")]);
        let mut session = open(&store, false);
        let got = values(session.get_many(&store, false, SVC, &accounts(&["openai", "anthropic", "groq"])));
        assert_eq!(got, vec![Some("sk-o".into()), Some("sk-a".into()), None]);

        assert_eq!(*store.writes.borrow(), vec![id(VAULT_SERVICE, VAULT_ACCOUNT)]);
        assert!(!store.has(SVC, "openai") && !store.has(SVC, "anthropic"));
        let vault = store.vault(VAULT_SERVICE);
        assert_eq!(vault.secrets["terax-ai::openai"], "sk-o");
        assert_eq!(vault.secrets["terax-ai::anthropic"], "sk-a");

        // The next build reads one item and nothing else.
        let mut next = open(&store, false);
        store.reads.borrow_mut().clear();
        assert_eq!(next.get(&store, false, SVC, "openai").unwrap().as_deref(), Some("sk-o"));
        assert!(store.reads.borrow().is_empty());
    }

    #[test]
    fn a_launch_reads_the_vault_item_once() {
        let store = Fake::default();
        store.put_vault(VAULT_SERVICE, &[("terax-ai::openai", "sk-o")]);
        let mut session = open(&store, false);
        for _ in 0..3 {
            session.get(&store, false, SVC, "openai").unwrap();
            session.get(&store, false, SVC, "missing").unwrap();
            session.open(&store, false, false).unwrap();
        }
        assert_eq!(store.reads_of(VAULT_SERVICE, VAULT_ACCOUNT), 1);
        assert_eq!(store.reads_of(SVC, "missing"), 1);
    }

    #[test]
    fn a_failed_vault_write_keeps_the_legacy_items() {
        let store = Fake::with(&[(SVC, "openai", "sk-o")]);
        *store.deny_write.borrow_mut() = true;
        let mut session = open(&store, false);
        assert_eq!(session.get(&store, false, SVC, "openai").unwrap().as_deref(), Some("sk-o"));
        assert!(store.has(SVC, "openai"), "legacy item must survive a failed vault write");
        assert!(!store.has(VAULT_SERVICE, VAULT_ACCOUNT));
        assert!(session.set(&store, false, SVC, "groq", "sk-g").is_err());
        assert!(store.has(SVC, "openai"));

        // Once a write lands, the vault holds both and the legacy item goes.
        *store.deny_write.borrow_mut() = false;
        session.set(&store, false, SVC, "groq", "sk-g").unwrap();
        let vault = store.vault(VAULT_SERVICE);
        assert_eq!(vault.secrets["terax-ai::openai"], "sk-o");
        assert_eq!(vault.secrets["terax-ai::groq"], "sk-g");
        assert!(!store.has(SVC, "openai"));
    }

    #[test]
    fn a_failed_set_changes_nothing() {
        let store = Fake::with(&[(SVC, "openai", "sk-old")]);
        let mut session = open(&store, false);
        *store.deny_write.borrow_mut() = true;
        assert!(session.set(&store, false, SVC, "openai", "sk-new").is_err());
        assert_eq!(store.items.borrow()[&id(SVC, "openai")], "sk-old");
        assert!(store.deletes.borrow().is_empty());
        assert_eq!(session.get(&store, false, SVC, "openai").unwrap().as_deref(), Some("sk-old"));
    }

    #[test]
    fn a_refused_legacy_item_is_kept_and_asked_for_once() {
        let store = Fake::with(&[(SVC, "openai", "sk-o"), (SVC, "anthropic", "sk-a")]);
        store.deny_read.borrow_mut().insert(id(SVC, "openai"));
        let mut session = open(&store, false);
        let got = session.get_many(&store, false, SVC, &accounts(&["openai", "anthropic"]));
        assert!(got[0].is_err());
        assert_eq!(got[1].clone().unwrap().as_deref(), Some("sk-a"));
        assert!(store.has(SVC, "openai"));
        assert!(!store.has(SVC, "anthropic"));

        assert_eq!(session.get(&store, false, SVC, "openai").unwrap(), None);
        assert_eq!(store.reads_of(SVC, "openai"), 1);

        // A later launch where the user allows it migrates the item.
        store.deny_read.borrow_mut().clear();
        let mut next = open(&store, false);
        assert_eq!(next.get(&store, false, SVC, "openai").unwrap().as_deref(), Some("sk-o"));
        assert!(!store.has(SVC, "openai"));
    }

    #[test]
    fn a_legacy_item_that_cannot_be_removed_never_comes_back() {
        let store = Fake::with(&[(SVC, "openai", "sk-o")]);
        *store.deny_delete.borrow_mut() = true;
        let mut session = open(&store, false);
        assert_eq!(session.get(&store, false, SVC, "openai").unwrap().as_deref(), Some("sk-o"));
        session.delete(&store, false, SVC, "openai").unwrap();
        assert!(store.has(SVC, "openai"));

        let mut next = open(&store, false);
        assert_eq!(next.get(&store, false, SVC, "openai").unwrap(), None);
    }

    #[test]
    fn set_and_delete_shadow_an_unread_legacy_item() {
        let store = Fake::with(&[(SVC, "openai", "sk-old"), (SVC, "groq", "sk-g")]);
        let mut session = open(&store, false);
        session.set(&store, false, SVC, "openai", "sk-new").unwrap();
        session.delete(&store, false, SVC, "groq").unwrap();
        assert!(!store.has(SVC, "openai") && !store.has(SVC, "groq"));

        let mut next = open(&store, false);
        assert_eq!(next.get(&store, false, SVC, "openai").unwrap().as_deref(), Some("sk-new"));
        assert_eq!(next.get(&store, false, SVC, "groq").unwrap(), None);

        next.set(&store, false, SVC, "groq", "sk-again").unwrap();
        assert_eq!(open(&store, false).get(&store, false, SVC, "groq").unwrap().as_deref(), Some("sk-again"));
    }

    #[test]
    fn an_unreadable_vault_is_never_overwritten() {
        let store = Fake::with(&[(VAULT_SERVICE, VAULT_ACCOUNT, "{not json")]);
        let mut session = Session::default();
        assert!(session.open(&store, false, false).is_err());
        assert!(session.get(&store, false, SVC, "openai").is_err());
        assert!(session.set(&store, false, SVC, "openai", "sk").is_err());
        assert!(session.delete(&store, false, SVC, "openai").is_err());
        assert_eq!(store.items.borrow()[&id(VAULT_SERVICE, VAULT_ACCOUNT)], "{not json");
        assert_eq!(store.reads_of(VAULT_SERVICE, VAULT_ACCOUNT), 1);

        let denied = Fake::default();
        denied.put_vault(VAULT_SERVICE, &[("terax-ai::openai", "sk-o")]);
        denied.deny_read.borrow_mut().insert(id(VAULT_SERVICE, VAULT_ACCOUNT));
        let mut session = Session::default();
        assert!(session.open(&denied, false, false).is_err());
        assert!(session.set(&denied, false, SVC, "groq", "sk-g").is_err());
        assert_eq!(denied.vault(VAULT_SERVICE).secrets["terax-ai::openai"], "sk-o");
    }

    #[test]
    fn fields_from_a_newer_build_survive_a_save() {
        let store = Fake::with(&[(
            VAULT_SERVICE,
            VAULT_ACCOUNT,
            r#"{"version":7,"secrets":{"terax-ai::openai":"sk-o"},"later":{"a":1}}"#,
        )]);
        let mut session = open(&store, false);
        session.set(&store, false, SVC, "groq", "sk-g").unwrap();
        let raw: serde_json::Value =
            serde_json::from_str(&store.items.borrow()[&id(VAULT_SERVICE, VAULT_ACCOUNT)]).unwrap();
        assert_eq!(raw["version"], 7);
        assert_eq!(raw["later"]["a"], 1);
        assert_eq!(raw["secrets"]["terax-ai::openai"], "sk-o");
        assert_eq!(raw["secrets"]["terax-ai::groq"], "sk-g");
    }

    #[test]
    fn the_vault_items_are_not_addressable_as_secrets() {
        assert!(is_reserved_service(VAULT_SERVICE));
        assert!(is_reserved_service(SANDBOX_VAULT));
        assert!(!is_reserved_service(SVC));
        assert!(!is_reserved_service("terax.notes"));
    }

    #[test]
    fn a_sandbox_copies_the_installed_vault_once() {
        let store = Fake::default();
        store.put_vault(VAULT_SERVICE, &[("terax-ai::openai", "sk-o"), ("terax-ai::groq", "sk-g")]);
        let installed_before = store.items.borrow()[&id(VAULT_SERVICE, VAULT_ACCOUNT)].clone();

        let mut first = open(&store, true);
        assert_eq!(first.get(&store, true, SVC, "openai").unwrap().as_deref(), Some("sk-o"));
        assert_eq!(store.reads_of(VAULT_SERVICE, VAULT_ACCOUNT), 1);
        assert!(store.vault(SANDBOX_VAULT).seeded);

        // Later launches, and later builds, never touch the installed item.
        for _ in 0..3 {
            let mut later = open(&store, true);
            assert_eq!(later.get(&store, true, SVC, "groq").unwrap().as_deref(), Some("sk-g"));
        }
        assert_eq!(store.reads_of(VAULT_SERVICE, VAULT_ACCOUNT), 1);
        assert_eq!(store.items.borrow()[&id(VAULT_SERVICE, VAULT_ACCOUNT)], installed_before);
    }

    #[test]
    fn a_sandbox_never_changes_the_installed_apps_items() {
        let store = Fake::with(&[(SVC, "openai", "sk-o"), (SVC, "groq", "sk-g")]);
        store.put_vault(VAULT_SERVICE, &[("terax-ai::anthropic", "sk-a")]);
        let installed = store.items.borrow().clone();

        let mut session = open(&store, true);
        assert_eq!(session.get(&store, true, SVC, "openai").unwrap().as_deref(), Some("sk-o"));
        session.set(&store, true, SVC, "anthropic", "sk-sandbox").unwrap();
        session.delete(&store, true, SVC, "groq").unwrap();
        session.delete(&store, true, SVC, "openai").unwrap();

        for (item, value) in &installed {
            assert_eq!(store.items.borrow().get(item), Some(value), "{item:?} changed");
        }
        let mut next = open(&store, true);
        assert_eq!(next.get(&store, true, SVC, "anthropic").unwrap().as_deref(), Some("sk-sandbox"));
        assert_eq!(next.get(&store, true, SVC, "groq").unwrap(), None);
        assert_eq!(next.get(&store, true, SVC, "openai").unwrap(), None);
    }

    #[test]
    fn a_sandbox_moves_its_own_legacy_items_and_tombstones() {
        let store = Fake::with(&[
            (SVC, "openai", "sk-installed"),
            (SANDBOX_SVC, "openai", "sk-own"),
            (SVC, "groq", "sk-g"),
            (SANDBOX_SVC, "groq", profile::DELETED_SECRET),
            (SVC, "mistral", "sk-m"),
        ]);
        let mut session = open(&store, true);
        let got = values(session.get_many(&store, true, SVC, &accounts(&["openai", "groq", "mistral"])));
        assert_eq!(got, vec![Some("sk-own".into()), None, Some("sk-m".into())]);
        assert!(!store.has(SANDBOX_SVC, "openai") && !store.has(SANDBOX_SVC, "groq"));
        assert!(store.has(SVC, "openai") && store.has(SVC, "groq") && store.has(SVC, "mistral"));

        // The installed app's per-secret items are read once, then never again.
        store.reads.borrow_mut().clear();
        let mut next = open(&store, true);
        let again = values(next.get_many(&store, true, SVC, &accounts(&["openai", "groq", "mistral"])));
        assert_eq!(again, got);
        assert_eq!(store.reads_of(SVC, "openai") + store.reads_of(SVC, "groq") + store.reads_of(SVC, "mistral"), 0);
    }

    #[test]
    fn seeding_waits_for_the_installed_vault_and_respects_removals() {
        let store = Fake::default();
        let mut session = open(&store, true);
        session.delete(&store, true, SVC, "groq").unwrap();
        session.set(&store, true, SVC, "openai", "sk-own").unwrap();
        assert!(!store.vault(SANDBOX_VAULT).seeded);

        store.put_vault(
            VAULT_SERVICE,
            &[("terax-ai::openai", "sk-o"), ("terax-ai::groq", "sk-g"), ("terax-ai::xai", "sk-x")],
        );
        let mut next = open(&store, true);
        assert_eq!(next.get(&store, true, SVC, "openai").unwrap().as_deref(), Some("sk-own"));
        assert_eq!(next.get(&store, true, SVC, "groq").unwrap(), None);
        assert_eq!(next.get(&store, true, SVC, "xai").unwrap().as_deref(), Some("sk-x"));
        assert!(store.vault(SANDBOX_VAULT).seeded);
    }

    #[test]
    fn a_refused_installed_vault_is_asked_for_once() {
        let store = Fake::default();
        store.put_vault(VAULT_SERVICE, &[("terax-ai::openai", "sk-o")]);
        store.deny_read.borrow_mut().insert(id(VAULT_SERVICE, VAULT_ACCOUNT));
        for _ in 0..3 {
            let mut session = open(&store, true);
            assert_eq!(session.get(&store, true, SVC, "openai").unwrap(), None);
        }
        assert_eq!(store.reads_of(VAULT_SERVICE, VAULT_ACCOUNT), 1);
    }

    #[test]
    fn a_reset_replaces_the_sandbox_secrets_with_the_installed_ones() {
        let store = Fake::default();
        store.put_vault(VAULT_SERVICE, &[("terax-ai::openai", "sk-o")]);
        let mut session = open(&store, true);
        session.set(&store, true, SVC, "openai", "sk-own").unwrap();
        session.set(&store, true, SVC, "groq", "sk-only-here").unwrap();
        session.delete(&store, true, SVC, "xai").unwrap();
        store.put_vault(VAULT_SERVICE, &[("terax-ai::openai", "sk-o2"), ("terax-ai::xai", "sk-x")]);

        let mut reset = Session::default();
        assert!(reset.open(&store, true, true).unwrap());
        assert_eq!(reset.get(&store, true, SVC, "openai").unwrap().as_deref(), Some("sk-o2"));
        assert_eq!(reset.get(&store, true, SVC, "xai").unwrap().as_deref(), Some("sk-x"));
        assert_eq!(reset.get(&store, true, SVC, "groq").unwrap(), None);
        let saved = store.vault(SANDBOX_VAULT);
        assert!(saved.seeded && saved.hidden.is_empty());
    }

    #[test]
    fn a_reset_that_cannot_read_or_save_keeps_what_the_sandbox_has() {
        let store = Fake::default();
        store.put_vault(VAULT_SERVICE, &[("terax-ai::openai", "sk-o")]);
        let mut session = open(&store, true);
        session.set(&store, true, SVC, "openai", "sk-own").unwrap();

        store.deny_read.borrow_mut().insert(id(VAULT_SERVICE, VAULT_ACCOUNT));
        let mut refused = Session::default();
        assert!(refused.open(&store, true, true).unwrap());
        assert_eq!(refused.get(&store, true, SVC, "openai").unwrap().as_deref(), Some("sk-own"));

        // Unsaved: the marker stays so the next launch tries again.
        store.deny_read.borrow_mut().clear();
        *store.deny_write.borrow_mut() = true;
        let mut unsaved = Session::default();
        assert!(!unsaved.open(&store, true, true).unwrap());
        assert_eq!(store.vault(SANDBOX_VAULT).secrets["terax-ai::openai"], "sk-own");
    }

    #[test]
    fn the_installed_profile_ignores_a_reset_and_the_sandbox_items() {
        let store = Fake::with(&[(SANDBOX_SVC, "openai", "sk-sandbox")]);
        store.put_vault(SANDBOX_VAULT, &[("terax-ai::groq", "sk-g")]);
        let mut session = Session::default();
        assert!(!session.open(&store, false, true).unwrap());
        assert_eq!(session.get(&store, false, SVC, "openai").unwrap(), None);
        assert_eq!(session.get(&store, false, SVC, "groq").unwrap(), None);
        assert_eq!(store.reads_of(SANDBOX_VAULT, VAULT_ACCOUNT), 0);
        assert!(store.has(SANDBOX_SVC, "openai"));
    }
}
