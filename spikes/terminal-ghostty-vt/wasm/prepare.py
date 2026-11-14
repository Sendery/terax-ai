"""Prepare an isolated ABI32 experiment without editing the native dependency."""

import argparse
from pathlib import Path
import shutil
import subprocess

PIN = "a887df42c56f6de86c0fe6da9c4eeca37931e083"


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError(f"source shape changed: expected exactly one {before!r}")
    return text.replace(before, after)


def prepare(source, prefix):
    here = Path(__file__).resolve().parent
    repo = here.parents[2]
    actual = subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
    ).strip()
    if actual != PIN:
        raise ValueError(f"Ghostty commit must be {PIN}, got {actual}")
    if subprocess.check_output(
        ["git", "-C", str(source), "status", "--porcelain"], text=True
    ).strip():
        raise ValueError("Ghostty source must be clean")
    if not (source / "include/ghostty/vt.h").is_file():
        raise ValueError("pinned C headers are missing")
    if not (prefix / "lib/libghostty-vt.a").is_file():
        raise ValueError("build the wasm32-freestanding static library first")

    native = repo / "src-tauri/vendor/libghostty-vt-sys"
    target = here / "target"
    copied = target / "sys"
    shutil.copytree(native, copied, dirs_exist_ok=True)
    (copied / "src/bindings_wasm32.rs").unlink(missing_ok=True)
    manifest = copied / "Cargo.toml"
    manifest.write_text(replace_once(
        manifest.read_text(),
        '[dependencies.bindgen]\nversion = "0.72.1"',
        '[dependencies.bindgen]\nversion = "=0.72.1"',
    ) + '\n[workspace]\n')
    shutil.copyfile(here / "bindgen.lock", copied / "Cargo.lock")
    generator = copied / "tools/gen_bindings.rs"
    generator.write_text(replace_once(
        generator.read_text(),
        'let out = manifest_dir.join("src").join("bindings.rs");',
        'let out = manifest_dir.join("src").join("bindings_wasm32.rs");',
    ))
    lib = copied / "src/lib.rs"
    lib.write_text(replace_once(
        lib.read_text(),
        'mod bindings;',
        '#[cfg(not(target_arch = "wasm32"))]\nmod bindings;\n'
        '#[cfg(target_arch = "wasm32")]\n'
        '#[path = "bindings_wasm32.rs"]\nmod bindings;',
    ))
    snapshot = (repo / "src-tauri/src/modules/pty/engine/snapshot.rs").read_text()
    for name in ("RenderState", "RowIterator", "CellIterator"):
        snapshot = replace_once(
            snapshot, f"{name}::new()?",
            f"{name}::new_with_alloc(&libghostty_vt::alloc::Allocator::GLOBAL)?",
        )
    (target / "snapshot.rs").write_text(snapshot)
    pkgconfig = target / "pkgconfig"
    pkgconfig.mkdir(exist_ok=True)
    (pkgconfig / "libghostty-vt-static.pc").write_text(
        f"prefix={prefix}\nlibdir=${{prefix}}/lib\nincludedir={source}/include\n"
        "Name: libghostty-vt-static\nDescription: isolated pinned WASM core\n"
        "Version: 0.2.2\nLibs: -L${libdir} -lghostty-vt\nCflags: -I${includedir}\n"
    )
    if (native / "src/bindings.rs").read_bytes() != (copied / "src/bindings.rs").read_bytes():
        raise ValueError("native ABI assertions changed")
    print(f"prepared {target}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--core-prefix", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source.resolve(), args.core_prefix.resolve())
