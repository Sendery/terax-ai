//! Closed engine and model catalogue.
//!
//! Adding an engine or a model is a code change here plus a matching change in
//! the Python sidecar and the frontend list; nothing is derived from user input.

use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// Bumped whenever an engine's pins change, so an installed venv can be
/// recognised as stale without reinstalling to find out.
pub const KOKORO_SPEC_VERSION: u32 = 1;
pub const CHATTERBOX_SPEC_VERSION: u32 = 1;

pub const PYTHON_VERSION: &str = "3.11";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Kokoro,
    Chatterbox,
}

impl Engine {
    pub const ALL: [Engine; 2] = [Engine::Kokoro, Engine::Chatterbox];

    pub fn id(self) -> &'static str {
        match self {
            Engine::Kokoro => "kokoro",
            Engine::Chatterbox => "chatterbox",
        }
    }

    pub fn spec_version(self) -> u32 {
        match self {
            Engine::Kokoro => KOKORO_SPEC_VERSION,
            Engine::Chatterbox => CHATTERBOX_SPEC_VERSION,
        }
    }

    pub fn requirements_file_name(self) -> &'static str {
        match self {
            Engine::Kokoro => "requirements-kokoro.txt",
            Engine::Chatterbox => "requirements-chatterbox.txt",
        }
    }

    /// The embedded requirements file, so the pins recorded in `state.json`
    /// cannot drift from the ones actually installed.
    pub fn requirements(self) -> &'static str {
        let name = self.requirements_file_name();
        SERVER_FILES
            .iter()
            .find(|file| file.rel == name)
            .map(|file| file.body)
            .unwrap_or("")
    }

    pub fn pins(self) -> Vec<String> {
        parse_pins(self.requirements())
    }
}

/// Requirement lines, without blanks, comments or pip options. A trailing
/// comment is stripped only when it follows whitespace, because a `#` inside a
/// direct-reference URL is a fragment.
pub fn parse_pins(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let line = match line.split_once(" #") {
                Some((head, _)) => head,
                None => line,
            };
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with('-') {
                None
            } else {
                Some(line.to_string())
            }
        })
        .collect()
}

impl FromStr for Engine {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "kokoro" => Ok(Engine::Kokoro),
            "chatterbox" => Ok(Engine::Chatterbox),
            other => Err(format!("unknown tts engine: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Model {
    #[serde(rename = "kokoro-82m")]
    Kokoro82m,
    #[serde(rename = "chatterbox-multilingual")]
    ChatterboxMultilingual,
    #[serde(rename = "chatterbox-turbo")]
    ChatterboxTurbo,
    #[serde(rename = "chatterbox-nano")]
    ChatterboxNano,
}

impl Model {
    pub const ALL: [Model; 4] = [
        Model::Kokoro82m,
        Model::ChatterboxMultilingual,
        Model::ChatterboxTurbo,
        Model::ChatterboxNano,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Model::Kokoro82m => "kokoro-82m",
            Model::ChatterboxMultilingual => "chatterbox-multilingual",
            Model::ChatterboxTurbo => "chatterbox-turbo",
            Model::ChatterboxNano => "chatterbox-nano",
        }
    }

    pub fn engine(self) -> Engine {
        engine_of(self)
    }

    pub fn hf_repo(self) -> &'static str {
        match self {
            Model::Kokoro82m => "hexgrad/Kokoro-82M",
            Model::ChatterboxMultilingual => "ResembleAI/chatterbox",
            Model::ChatterboxTurbo => "ResembleAI/chatterbox-turbo",
            Model::ChatterboxNano => "ResembleAI/chatterbox-nano",
        }
    }

    /// The directory `huggingface_hub` creates for the repo inside its hub cache.
    pub fn hf_dir_name(self) -> &'static str {
        match self {
            Model::Kokoro82m => "models--hexgrad--Kokoro-82M",
            Model::ChatterboxMultilingual => "models--ResembleAI--chatterbox",
            Model::ChatterboxTurbo => "models--ResembleAI--chatterbox-turbo",
            Model::ChatterboxNano => "models--ResembleAI--chatterbox-nano",
        }
    }
}

pub fn engine_of(model: Model) -> Engine {
    match model {
        Model::Kokoro82m => Engine::Kokoro,
        Model::ChatterboxMultilingual | Model::ChatterboxTurbo | Model::ChatterboxNano => {
            Engine::Chatterbox
        }
    }
}

impl FromStr for Model {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "kokoro-82m" => Ok(Model::Kokoro82m),
            "chatterbox-multilingual" => Ok(Model::ChatterboxMultilingual),
            "chatterbox-turbo" => Ok(Model::ChatterboxTurbo),
            "chatterbox-nano" => Ok(Model::ChatterboxNano),
            other => Err(format!("unknown tts model: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Device {
    #[default]
    Auto,
    Cpu,
    Mps,
    Cuda,
}

impl Device {
    pub fn id(self) -> &'static str {
        match self {
            Device::Auto => "auto",
            Device::Cpu => "cpu",
            Device::Mps => "mps",
            Device::Cuda => "cuda",
        }
    }
}

impl FromStr for Device {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "auto" => Ok(Device::Auto),
            "cpu" => Ok(Device::Cpu),
            "mps" => Ok(Device::Mps),
            "cuda" => Ok(Device::Cuda),
            other => Err(format!("unknown tts device: {other}")),
        }
    }
}

/// One embedded sidecar source file, written into `server/` at engine install.
pub struct EmbeddedFile {
    pub rel: &'static str,
    pub body: &'static str,
}

pub const SERVER_FILES: &[EmbeddedFile] = &[
    EmbeddedFile {
        rel: "server.py",
        body: include_str!("../../../resources/tts/server.py"),
    },
    EmbeddedFile {
        rel: "download.py",
        body: include_str!("../../../resources/tts/download.py"),
    },
    EmbeddedFile {
        rel: "engines/__init__.py",
        body: include_str!("../../../resources/tts/engines/__init__.py"),
    },
    EmbeddedFile {
        rel: "engines/base.py",
        body: include_str!("../../../resources/tts/engines/base.py"),
    },
    EmbeddedFile {
        rel: "engines/fake.py",
        body: include_str!("../../../resources/tts/engines/fake.py"),
    },
    EmbeddedFile {
        rel: "engines/kokoro.py",
        body: include_str!("../../../resources/tts/engines/kokoro.py"),
    },
    EmbeddedFile {
        rel: "engines/chatterbox.py",
        body: include_str!("../../../resources/tts/engines/chatterbox.py"),
    },
    EmbeddedFile {
        rel: "requirements-kokoro.txt",
        body: include_str!("../../../resources/tts/requirements-kokoro.txt"),
    },
    EmbeddedFile {
        rel: "requirements-chatterbox.txt",
        body: include_str!("../../../resources/tts/requirements-chatterbox.txt"),
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_ids_round_trip_and_reject_anything_else() {
        for engine in Engine::ALL {
            assert_eq!(Engine::from_str(engine.id()), Ok(engine));
        }
        for bad in [
            "",
            "Kokoro",
            "kokoro ",
            "kokoro-82m",
            "piper",
            "../kokoro",
            "kokoro\n",
        ] {
            assert!(Engine::from_str(bad).is_err(), "{bad} must be rejected");
        }
    }

    #[test]
    fn model_ids_round_trip_and_reject_anything_else() {
        for model in Model::ALL {
            assert_eq!(Model::from_str(model.id()), Ok(model));
        }
        for bad in [
            "",
            "kokoro",
            "kokoro82m",
            "Kokoro-82M",
            "chatterbox",
            "chatterbox-mini",
            "kokoro-82m ",
        ] {
            assert!(Model::from_str(bad).is_err(), "{bad} must be rejected");
        }
    }

    #[test]
    fn engine_of_maps_every_model() {
        assert_eq!(engine_of(Model::Kokoro82m), Engine::Kokoro);
        assert_eq!(engine_of(Model::ChatterboxMultilingual), Engine::Chatterbox);
        assert_eq!(engine_of(Model::ChatterboxTurbo), Engine::Chatterbox);
        assert_eq!(engine_of(Model::ChatterboxNano), Engine::Chatterbox);
        for model in Model::ALL {
            assert_eq!(model.engine(), engine_of(model));
        }
    }

    #[test]
    fn hf_dir_name_matches_the_repo() {
        for model in Model::ALL {
            let (org, name) = model.hf_repo().split_once('/').expect("repo has an org");
            assert_eq!(model.hf_dir_name(), format!("models--{org}--{name}"));
        }
    }

    #[test]
    fn serde_uses_the_wire_ids() {
        assert_eq!(
            serde_json::to_string(&Model::Kokoro82m).unwrap(),
            "\"kokoro-82m\""
        );
        assert_eq!(
            serde_json::to_string(&Engine::Chatterbox).unwrap(),
            "\"chatterbox\""
        );
        assert_eq!(
            serde_json::from_str::<Model>("\"chatterbox-nano\"").unwrap(),
            Model::ChatterboxNano
        );
        assert!(serde_json::from_str::<Model>("\"kokoro\"").is_err());
        assert!(serde_json::from_str::<Engine>("\"whisper\"").is_err());
        assert_eq!(
            serde_json::from_str::<Device>("\"mps\"").unwrap(),
            Device::Mps
        );
        assert!(serde_json::from_str::<Device>("\"metal\"").is_err());
    }

    #[test]
    fn every_engine_has_a_requirements_file_among_the_embedded_sources() {
        for engine in Engine::ALL {
            let name = engine.requirements_file_name();
            assert!(
                SERVER_FILES.iter().any(|f| f.rel == name),
                "{name} must be embedded"
            );
            assert!(!engine.requirements().is_empty());
            assert!(!engine.pins().is_empty());
        }
    }

    #[test]
    fn pins_come_from_the_requirements_file_that_is_actually_installed() {
        let kokoro = Engine::Kokoro.pins();
        assert!(kokoro.contains(&"kokoro==0.9.4".to_string()), "{kokoro:?}");
        assert!(kokoro.contains(&"torch==2.6.0".to_string()), "{kokoro:?}");
        let chatterbox = Engine::Chatterbox.pins();
        assert!(
            chatterbox.contains(&"chatterbox-tts==0.1.7".to_string()),
            "{chatterbox:?}"
        );
        for engine in Engine::ALL {
            for pin in engine.pins() {
                assert!(!pin.is_empty());
                assert!(!pin.starts_with('#'), "{pin}");
                assert_eq!(pin, pin.trim());
            }
        }
    }

    #[test]
    fn pin_parsing_drops_noise_and_keeps_direct_references_intact() {
        let parsed = parse_pins(
            "# a comment\n\n  torch==2.6.0  \nnumpy<2.0 # trailing\n--index-url https://x\n-r other.txt\npkg @ https://host/p.whl#sha256=abc\n",
        );
        assert_eq!(
            parsed,
            vec![
                "torch==2.6.0".to_string(),
                "numpy<2.0".to_string(),
                "pkg @ https://host/p.whl#sha256=abc".to_string(),
            ]
        );
        assert!(parse_pins("").is_empty());
        assert!(parse_pins("# only comments\n\n").is_empty());
    }
}
