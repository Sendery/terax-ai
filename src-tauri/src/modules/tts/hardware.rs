//! What this machine can run, and how each engine should run on it.
//!
//! The probe reads the CPU, the memory and any NVIDIA GPU once per process.
//! `plan` turns that into per-engine choices: the device, the precision, the
//! CPU threads, int8 quantization, the diffusion steps and the PyTorch wheel
//! index an install should use. The plan is pure, so every choice is tested
//! against fixed machines below; the sidecar receives it as JSON and applies
//! it, and Settings shows it.

use std::process::Command;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use super::engines::Engine;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NvidiaGpu {
    pub name: String,
    pub memory_mb: Option<u64>,
    pub driver: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    /// `macos`, `linux` or `windows`.
    pub os: String,
    /// `aarch64` or `x86_64`.
    pub arch: String,
    pub cpu: Option<String>,
    pub apple_silicon: bool,
    /// Physical cores; on Apple Silicon the performance cores only.
    pub performance_cores: Option<u32>,
    pub efficiency_cores: Option<u32>,
    pub logical_cpus: u32,
    pub memory_bytes: Option<u64>,
    pub avx2: bool,
    pub avx512: bool,
    pub nvidia: Option<NvidiaGpu>,
}

/// How one engine runs on this machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnginePlan {
    pub supported: bool,
    pub unsupported_reason: Option<String>,
    /// `cpu`, `mps`, `cuda` or `mlx`, for the `auto` device setting.
    pub device: String,
    /// `float32`, `float16` or `bfloat16` for torch engines.
    pub dtype: Option<String>,
    /// CPU threads torch may use; `None` keeps the library's default.
    pub threads: Option<u32>,
    pub quantize: bool,
    /// Diffusion steps, for the engines that iterate.
    pub steps: Option<u32>,
    /// `uv pip install --torch-backend`: `cpu` keeps the CUDA wheels off a
    /// machine with no NVIDIA GPU, `auto` picks the index for its driver.
    pub torch_backend: Option<String>,
    /// One line per choice, shown in Settings as the reason for it.
    pub notes: Vec<String>,
    /// Costs worth knowing before choosing this engine here: slow on this
    /// device, tight on memory. A warning never makes an engine unsupported;
    /// only an incompatible architecture does.
    pub warnings: Vec<String>,
}

impl Hardware {
    fn is_macos(&self) -> bool {
        self.os == "macos"
    }

    /// Physical cores worth giving a CPU-bound model. Efficiency cores slow a
    /// tight synthesis loop down, so they are not counted.
    fn compute_cores(&self) -> u32 {
        self.performance_cores
            .unwrap_or_else(|| (self.logical_cpus / 2).max(1))
            .max(1)
    }

    pub fn summary(&self) -> String {
        let cpu = self.cpu.clone().unwrap_or_else(|| self.arch.clone());
        let mut parts = vec![cpu];
        if let Some(p) = self.performance_cores {
            match self.efficiency_cores {
                Some(e) if e > 0 => parts.push(format!("{p}P+{e}E cores")),
                _ => parts.push(format!("{p} cores")),
            }
        }
        if let Some(bytes) = self.memory_bytes {
            parts.push(format!("{} GB", bytes / (1024 * 1024 * 1024)));
        }
        if let Some(gpu) = &self.nvidia {
            parts.push(gpu.name.clone());
        }
        parts.join(", ")
    }
}

fn torch_backend(hw: &Hardware) -> Option<String> {
    if hw.is_macos() {
        // macOS wheels carry MPS; there is no other index to pick.
        None
    } else if hw.nvidia.is_some() {
        Some("auto".into())
    } else {
        Some("cpu".into())
    }
}

fn base(device: &str, hw: &Hardware) -> EnginePlan {
    EnginePlan {
        supported: true,
        unsupported_reason: None,
        device: device.into(),
        dtype: Some("float32".into()),
        threads: None,
        quantize: false,
        steps: None,
        torch_backend: torch_backend(hw),
        notes: Vec::new(),
        warnings: Vec::new(),
    }
}

fn wheel_note(plan: &mut EnginePlan) {
    match plan.torch_backend.as_deref() {
        Some("cpu") => plan
            .notes
            .push("Installs the CPU build of PyTorch: no GPU here to use the CUDA one.".into()),
        Some("auto") => plan
            .notes
            .push("Installs the PyTorch build that matches the NVIDIA driver.".into()),
        _ => {}
    }
}

pub fn plan(engine: Engine, hw: &Hardware) -> EnginePlan {
    let cores = hw.compute_cores();
    let mut plan = match engine {
        Engine::Kokoro | Engine::Chatterbox => {
            if hw.nvidia.is_some() {
                let mut p = base("cuda", hw);
                p.notes.push("Runs on the NVIDIA GPU.".into());
                p
            } else if hw.apple_silicon {
                let mut p = base("mps", hw);
                p.notes.push(
                    "Runs on the Apple GPU (MPS), falling back to the CPU per operation.".into(),
                );
                p
            } else {
                let mut p = base("cpu", hw);
                p.threads = Some(cores.min(8));
                p.notes.push(format!(
                    "Runs on the CPU with {} threads, one per physical core.",
                    cores.min(8)
                ));
                p
            }
        }
        Engine::Pocket => {
            if hw.apple_silicon {
                // Measured on an M4 Pro: 11.8x real time on one thread, 13.2x
                // on two, no better on four; int8 measured 11.4x to 12.4x.
                let mut p = base("cpu", hw);
                p.threads = Some(cores.min(2));
                p.notes.push(
                    "Runs on the CPU with 2 threads: about 13 times faster than real time on Apple Silicon, where the GPU and more threads add nothing.".into(),
                );
                p.notes.push(
                    "int8 quantization stays off: it measured no faster on Apple Silicon.".into(),
                );
                p
            } else if hw.nvidia.is_some() {
                let mut p = base("cuda", hw);
                p.notes
                    .push("Runs on the NVIDIA GPU, about 2.6 times faster than its CPU.".into());
                p
            } else {
                let mut p = base("cpu", hw);
                p.threads = Some(cores.min(4));
                p.quantize = hw.arch == "x86_64";
                p.notes
                    .push(format!("Runs on the CPU with {} threads.", cores.min(4)));
                if p.quantize {
                    p.notes.push(
                        "int8 dynamic quantization of the language model, for x86 CPUs.".into(),
                    );
                }
                p
            }
        }
        Engine::Omnivoice => {
            if let Some(gpu) = &hw.nvidia {
                let mut p = base("cuda", hw);
                p.dtype = Some("float16".into());
                p.steps = Some(32);
                p.notes.push(format!(
                    "Runs on {} in float16 with the full 32 diffusion steps.",
                    gpu.name
                ));
                p
            } else if hw.apple_silicon {
                let mut p = base("mps", hw);
                p.steps = Some(16);
                p.notes.push(
                    "Runs on the Apple GPU (MPS) in float32; its audio tokenizer stays on the CPU, which MPS cannot run.".into(),
                );
                p.notes.push(
                    "16 diffusion steps instead of 32, the faster setting the model card gives."
                        .into(),
                );
                p
            } else {
                let mut p = base("cpu", hw);
                p.steps = Some(16);
                p.threads = Some(cores.min(8));
                p.notes.push(format!(
                    "Runs on the CPU with {} threads and 16 diffusion steps.",
                    cores.min(8)
                ));
                p.warnings
                    .push("Slow on the CPU: a diffusion model meant for a GPU.".into());
                p
            }
        }
        Engine::Zonos3 => {
            if hw.apple_silicon {
                let mut p = base("mlx", hw);
                p.dtype = None;
                p.torch_backend = None;
                p.notes.push(
                    "Runs through Zyphra's MLX server on the Apple GPU, with the quantized backbone (Q4/Q8) and the compact decoder.".into(),
                );
                p
            } else {
                let mut p = base("cpu", hw);
                p.supported = false;
                p.dtype = None;
                p.torch_backend = None;
                p.unsupported_reason = Some(
                    "ZONOS3-Mini needs Apple Silicon here: Zyphra's CUDA and ggml servers need a build toolchain Terax does not install.".into(),
                );
                p
            }
        }
        Engine::Rumble => rumble_plan(hw, cores),
        Engine::Isolator => isolator_plan(hw, cores),
    };
    if plan.supported {
        wheel_note(&mut plan);
        if let Some(bytes) = hw.memory_bytes {
            let gb = bytes / (1024 * 1024 * 1024);
            if engine == Engine::Omnivoice && gb < 12 {
                plan.warnings.push(format!(
                    "{gb} GB of memory is tight for OmniVoice's 3.3 GB of weights."
                ));
            }
        }
    }
    plan
}

/// Seconds of processing per second of audio, measured with the pinned
/// requirements on Linux (16 CPU threads, and an RTX 3060).
const ISOLATOR_CPU_SECONDS_PER_SECOND: f32 = 8.7;
const ISOLATOR_CUDA_SECONDS_PER_SECOND: f32 = 0.35;

/// Inworld Voice Isolator. Its Mamba scan runs in plain PyTorch (the CUDA
/// kernels need a compiler toolchain), which a GPU absorbs and a CPU does not.
/// Every device stays available; the CPU one says what it costs.
fn isolator_plan(hw: &Hardware, cores: u32) -> EnginePlan {
    if let Some(gpu) = &hw.nvidia {
        let mut p = base("cuda", hw);
        p.notes.push(format!(
            "Runs on {} with bfloat16 autocast: about {:.2} s of work per second of audio on an RTX 3060.",
            gpu.name, ISOLATOR_CUDA_SECONDS_PER_SECOND
        ));
        p
    } else if hw.apple_silicon {
        let mut p = base("mps", hw);
        p.notes.push(
            "Runs on the Apple GPU (MPS) in float32; the CPU takes over when this macOS lacks the Metal FFT the model needs.".into(),
        );
        p.warnings.push(
            "Not measured on Apple Silicon yet: time a short dictation before relying on it while reading.".into(),
        );
        p
    } else {
        let mut p = base("cpu", hw);
        p.threads = Some(cores.min(8));
        p.notes.push(format!(
            "Runs on the CPU in float32 with {} threads.",
            cores.min(8)
        ));
        p.warnings.push(format!(
            "Slow on the CPU: about {:.0} s of work per second of audio. Fine for cleaning a voice sample once; dictation and reading will lag well behind real time.",
            ISOLATOR_CPU_SECONDS_PER_SECOND
        ));
        p
    }
}

/// VRAM below which a GPU is not worth it for Rumble-2-Flash: 1.0 GB of bf16
/// weights plus activations measured 1.5 GB resident on MPS.
const RUMBLE_MIN_VRAM_MB: u64 = 2048;

/// Rumble-2-Flash, the Light dictation tier: half precision on a GPU keeps it
/// near 1 GB; on a CPU, float32 is what PyTorch runs fast.
fn rumble_plan(hw: &Hardware, cores: u32) -> EnginePlan {
    let usable_gpu = hw
        .nvidia
        .as_ref()
        .filter(|gpu| gpu.memory_mb.is_none_or(|mb| mb >= RUMBLE_MIN_VRAM_MB));
    if let Some(gpu) = usable_gpu {
        let mut p = base("cuda", hw);
        p.dtype = Some("bfloat16".into());
        p.notes.push(format!(
            "Runs on {} in bfloat16: about 1.0 GB of weights, no quantization.",
            gpu.name
        ));
        p.notes.push(
            "GPUs older than Ampere, which lack bfloat16, get float16 when the model loads.".into(),
        );
        p
    } else if hw.apple_silicon {
        let mut p = base("mps", hw);
        p.dtype = Some("bfloat16".into());
        p.notes.push(
            "Runs on the Apple GPU (MPS) in bfloat16: about 1.0 GB of weights, no quantization, about 35 times faster than real time on an M4 Pro.".into(),
        );
        p
    } else {
        let mut p = base("cpu", hw);
        p.threads = Some(cores.min(8));
        p.notes.push(format!(
            "Runs on the CPU in float32 with {} threads: about 2 GB of memory, roughly 10 times faster than real time on 4 Apple cores.",
            cores.min(8)
        ));
        if let Some(gpu) = &hw.nvidia {
            p.notes.push(format!(
                "{} has less than 2 GB of memory, so the CPU is used instead.",
                gpu.name
            ));
        }
        p
    }
}

static PROBED: OnceLock<Hardware> = OnceLock::new();

/// The machine, probed once per process.
pub fn detect() -> &'static Hardware {
    PROBED.get_or_init(probe)
}

fn os_id() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    crate::modules::proc::hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

#[cfg(target_os = "macos")]
fn sysctl(key: &str) -> Option<String> {
    run("/usr/sbin/sysctl", &["-n", key])
}

fn probe() -> Hardware {
    let logical_cpus = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(1);
    #[allow(unused_mut)]
    let mut hw = Hardware {
        os: os_id().into(),
        arch: std::env::consts::ARCH.into(),
        cpu: None,
        apple_silicon: false,
        performance_cores: None,
        efficiency_cores: None,
        logical_cpus,
        memory_bytes: None,
        avx2: false,
        avx512: false,
        nvidia: None,
    };
    #[cfg(target_arch = "x86_64")]
    {
        hw.avx2 = std::arch::is_x86_feature_detected!("avx2");
        hw.avx512 = std::arch::is_x86_feature_detected!("avx512f");
    }
    #[cfg(target_os = "macos")]
    {
        hw.cpu = sysctl("machdep.cpu.brand_string");
        hw.apple_silicon = sysctl("hw.optional.arm64").as_deref() == Some("1");
        let parse = |key: &str| sysctl(key).and_then(|v| v.parse::<u32>().ok());
        hw.performance_cores =
            parse("hw.perflevel0.physicalcpu").or_else(|| parse("hw.physicalcpu"));
        hw.efficiency_cores = parse("hw.perflevel1.physicalcpu");
        hw.memory_bytes = sysctl("hw.memsize").and_then(|v| v.parse().ok());
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(info) = std::fs::read_to_string("/proc/cpuinfo") {
            hw.cpu = info
                .lines()
                .find(|l| l.starts_with("model name"))
                .and_then(|l| l.split_once(':'))
                .map(|(_, v)| v.trim().to_string());
            hw.performance_cores = parse_linux_physical_cores(&info);
        }
        if let Ok(mem) = std::fs::read_to_string("/proc/meminfo") {
            hw.memory_bytes = parse_meminfo_total(&mem);
        }
    }
    hw.nvidia = probe_nvidia();
    hw
}

fn probe_nvidia() -> Option<NvidiaGpu> {
    if cfg!(target_os = "macos") {
        return None;
    }
    let candidates: &[&str] = if cfg!(windows) {
        &[
            "nvidia-smi",
            "C:\\Windows\\System32\\nvidia-smi.exe",
            "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
        ]
    } else {
        &[
            "/usr/bin/nvidia-smi",
            "/usr/local/bin/nvidia-smi",
            "nvidia-smi",
        ]
    };
    let args = [
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits",
    ];
    candidates
        .iter()
        .find_map(|program| run(program, &args))
        .and_then(|text| parse_nvidia_smi(&text))
}

/// The first GPU of `nvidia-smi --query-gpu=name,memory.total,driver_version`.
pub fn parse_nvidia_smi(text: &str) -> Option<NvidiaGpu> {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut fields = line.split(',').map(str::trim);
    let name = fields.next().filter(|n| !n.is_empty())?.to_string();
    let memory_mb = fields.next().and_then(|m| m.parse().ok());
    let driver = fields.next().filter(|d| !d.is_empty()).map(str::to_string);
    Some(NvidiaGpu {
        name,
        memory_mb,
        driver,
    })
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_meminfo_total(text: &str) -> Option<u64> {
    let line = text.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

/// Distinct (physical id, core id) pairs, so hyperthreads count once.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_linux_physical_cores(cpuinfo: &str) -> Option<u32> {
    let mut seen = std::collections::BTreeSet::new();
    let mut physical = String::new();
    for line in cpuinfo.lines() {
        if let Some((key, value)) = line.split_once(':') {
            match key.trim() {
                "physical id" => physical = value.trim().to_string(),
                "core id" => {
                    seen.insert((physical.clone(), value.trim().to_string()));
                }
                _ => {}
            }
        }
    }
    (!seen.is_empty()).then_some(seen.len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m4_pro() -> Hardware {
        Hardware {
            os: "macos".into(),
            arch: "aarch64".into(),
            cpu: Some("Apple M4 Pro".into()),
            apple_silicon: true,
            performance_cores: Some(8),
            efficiency_cores: Some(4),
            logical_cpus: 12,
            memory_bytes: Some(48 * 1024 * 1024 * 1024),
            avx2: false,
            avx512: false,
            nvidia: None,
        }
    }

    fn linux_cpu() -> Hardware {
        Hardware {
            os: "linux".into(),
            arch: "x86_64".into(),
            cpu: Some("AMD Ryzen 7".into()),
            apple_silicon: false,
            performance_cores: Some(8),
            efficiency_cores: None,
            logical_cpus: 16,
            memory_bytes: Some(8 * 1024 * 1024 * 1024),
            avx2: true,
            avx512: false,
            nvidia: None,
        }
    }

    fn linux_cuda() -> Hardware {
        Hardware {
            nvidia: Some(NvidiaGpu {
                name: "NVIDIA GeForce RTX 4070".into(),
                memory_mb: Some(12282),
                driver: Some("580.65".into()),
            }),
            memory_bytes: Some(32 * 1024 * 1024 * 1024),
            ..linux_cpu()
        }
    }

    #[test]
    fn pocket_stays_on_two_cpu_threads_on_apple_silicon() {
        let p = plan(Engine::Pocket, &m4_pro());
        assert!(p.supported);
        assert_eq!(p.device, "cpu");
        assert_eq!(p.threads, Some(2));
        assert!(!p.quantize);
        assert_eq!(p.torch_backend, None);
    }

    #[test]
    fn pocket_quantizes_on_an_x86_cpu_and_uses_cuda_when_present() {
        let cpu = plan(Engine::Pocket, &linux_cpu());
        assert_eq!(cpu.device, "cpu");
        assert!(cpu.quantize);
        assert_eq!(cpu.threads, Some(4));
        assert_eq!(cpu.torch_backend.as_deref(), Some("cpu"));
        let gpu = plan(Engine::Pocket, &linux_cuda());
        assert_eq!(gpu.device, "cuda");
        assert!(!gpu.quantize);
        assert_eq!(gpu.torch_backend.as_deref(), Some("auto"));
    }

    #[test]
    fn omnivoice_picks_precision_and_steps_per_device() {
        let mac = plan(Engine::Omnivoice, &m4_pro());
        assert_eq!(
            (mac.device.as_str(), mac.dtype.as_deref(), mac.steps),
            ("mps", Some("float32"), Some(16))
        );
        let gpu = plan(Engine::Omnivoice, &linux_cuda());
        assert_eq!(
            (gpu.device.as_str(), gpu.dtype.as_deref(), gpu.steps),
            ("cuda", Some("float16"), Some(32))
        );
        let cpu = plan(Engine::Omnivoice, &linux_cpu());
        assert_eq!((cpu.device.as_str(), cpu.steps), ("cpu", Some(16)));
        assert!(
            cpu.warnings.iter().any(|n| n.contains("tight")),
            "8 GB must be flagged: {:?}",
            cpu.warnings
        );
    }

    #[test]
    fn zonos3_runs_on_mlx_and_is_refused_elsewhere() {
        let mac = plan(Engine::Zonos3, &m4_pro());
        assert!(mac.supported);
        assert_eq!(mac.device, "mlx");
        for hw in [linux_cpu(), linux_cuda()] {
            let p = plan(Engine::Zonos3, &hw);
            assert!(!p.supported);
            assert!(p.unsupported_reason.is_some());
        }
    }

    #[test]
    fn rumble_runs_in_half_precision_on_a_gpu_and_float32_on_a_cpu() {
        let mac = plan(Engine::Rumble, &m4_pro());
        assert!(mac.supported);
        assert_eq!(
            (mac.device.as_str(), mac.dtype.as_deref(), mac.torch_backend.as_deref()),
            ("mps", Some("bfloat16"), None)
        );
        let gpu = plan(Engine::Rumble, &linux_cuda());
        assert_eq!(
            (gpu.device.as_str(), gpu.dtype.as_deref(), gpu.torch_backend.as_deref()),
            ("cuda", Some("bfloat16"), Some("auto"))
        );
        let cpu = plan(Engine::Rumble, &linux_cpu());
        assert_eq!(
            (cpu.device.as_str(), cpu.dtype.as_deref(), cpu.threads),
            ("cpu", Some("float32"), Some(8))
        );
        assert_eq!(cpu.torch_backend.as_deref(), Some("cpu"));
        assert!(!cpu.quantize && !gpu.quantize && !mac.quantize);
    }

    #[test]
    fn rumble_skips_a_gpu_with_too_little_memory() {
        let mut small = linux_cuda();
        if let Some(gpu) = small.nvidia.as_mut() {
            gpu.memory_mb = Some(1024);
        }
        let p = plan(Engine::Rumble, &small);
        assert_eq!(p.device, "cpu");
        assert!(p.notes.iter().any(|n| n.contains("less than 2 GB")), "{:?}", p.notes);
    }

    #[test]
    fn existing_engines_keep_their_devices_and_gain_threads_on_a_cpu() {
        assert_eq!(plan(Engine::Kokoro, &m4_pro()).device, "mps");
        assert_eq!(plan(Engine::Chatterbox, &linux_cuda()).device, "cuda");
        let cpu = plan(Engine::Kokoro, &linux_cpu());
        assert_eq!((cpu.device.as_str(), cpu.threads), ("cpu", Some(8)));
    }

    #[test]
    fn every_supported_plan_explains_itself() {
        for hw in [m4_pro(), linux_cpu(), linux_cuda()] {
            for engine in Engine::ALL {
                let p = plan(engine, &hw);
                assert!(
                    !p.supported || !p.notes.is_empty(),
                    "{engine:?} on {}",
                    hw.summary()
                );
                assert_eq!(p.supported, p.unsupported_reason.is_none());
            }
        }
    }

    /// Only an incompatible architecture refuses an engine; a slow machine
    /// gets a warning and keeps the choice.
    #[test]
    fn only_an_incompatible_architecture_is_unsupported() {
        for hw in [m4_pro(), linux_cpu(), linux_cuda()] {
            for engine in Engine::ALL {
                let p = plan(engine, &hw);
                if !p.supported {
                    assert_eq!(engine, Engine::Zonos3, "{engine:?} on {}", hw.summary());
                    assert!(!hw.apple_silicon);
                }
            }
        }
    }

    #[test]
    fn the_isolator_is_offered_everywhere_and_warns_on_a_cpu() {
        let cpu = plan(Engine::Isolator, &linux_cpu());
        assert!(cpu.supported);
        assert_eq!(cpu.device, "cpu");
        assert!(
            cpu.warnings.iter().any(|w| w.contains("Slow on the CPU")),
            "{:?}",
            cpu.warnings
        );
        let gpu = plan(Engine::Isolator, &linux_cuda());
        assert!(gpu.supported);
        assert_eq!(gpu.device, "cuda");
        assert!(gpu.warnings.is_empty(), "{:?}", gpu.warnings);
        let mac = plan(Engine::Isolator, &m4_pro());
        assert!(mac.supported);
        assert_eq!(mac.device, "mps");
        assert_eq!(mac.torch_backend, None);
    }

    #[test]
    fn omnivoice_on_a_cpu_warns_instead_of_hiding() {
        let p = plan(Engine::Omnivoice, &linux_cpu());
        assert!(p.supported);
        assert!(!p.warnings.is_empty());
    }

    #[test]
    fn nvidia_smi_output_parses_and_garbage_does_not() {
        let gpu = parse_nvidia_smi("NVIDIA GeForce RTX 4090, 24564, 580.65.06\n").unwrap();
        assert_eq!(gpu.name, "NVIDIA GeForce RTX 4090");
        assert_eq!(gpu.memory_mb, Some(24564));
        assert_eq!(gpu.driver.as_deref(), Some("580.65.06"));
        assert!(parse_nvidia_smi("").is_none());
        assert!(parse_nvidia_smi("\n , ,\n").is_none());
    }

    #[test]
    fn linux_cores_and_memory_parse() {
        let cpuinfo = "processor\t: 0\nphysical id\t: 0\ncore id\t: 0\n\nprocessor\t: 1\nphysical id\t: 0\ncore id\t: 0\n\nprocessor\t: 2\nphysical id\t: 0\ncore id\t: 1\n";
        assert_eq!(parse_linux_physical_cores(cpuinfo), Some(2));
        assert_eq!(parse_linux_physical_cores("processor : 0\n"), None);
        assert_eq!(
            parse_meminfo_total("MemTotal:       16318472 kB\nMemFree: 1 kB\n"),
            Some(16318472 * 1024)
        );
    }

    #[test]
    fn the_summary_names_the_machine() {
        assert_eq!(m4_pro().summary(), "Apple M4 Pro, 8P+4E cores, 48 GB");
        assert!(linux_cuda().summary().ends_with("NVIDIA GeForce RTX 4070"));
    }

    #[test]
    fn the_probe_of_this_machine_is_consistent() {
        let hw = detect();
        assert!(hw.logical_cpus >= 1);
        if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            assert!(hw.apple_silicon);
            assert!(hw.performance_cores.is_some());
        }
    }
}
