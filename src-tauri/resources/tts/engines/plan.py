"""The hardware plan Terax computed for this engine (see hardware.rs).

Terax probes the machine once and passes each sidecar a JSON plan in
TERAX_TTS_PLAN: the device for the `auto` setting, the precision, the CPU
threads, int8 quantization and the diffusion steps. An adapter reads it here
instead of probing again, so Settings shows exactly what the sidecar does.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Optional

PLAN_VAR = "TERAX_TTS_PLAN"
DEVICES = ("cpu", "mps", "cuda", "mlx")
DTYPES = ("float32", "float16", "bfloat16")


@dataclass(frozen=True)
class Plan:
    device: str = "cpu"
    dtype: Optional[str] = None
    threads: Optional[int] = None
    quantize: bool = False
    steps: Optional[int] = None


def load_plan(raw: Optional[str] = None) -> Plan:
    """The plan from the environment; anything malformed reads as defaults."""
    text = os.environ.get(PLAN_VAR, "") if raw is None else raw
    try:
        data = json.loads(text) if text else {}
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    device = data.get("device")
    dtype = data.get("dtype")
    threads = data.get("threads")
    steps = data.get("steps")
    valid_threads = isinstance(threads, int) and not isinstance(threads, bool) and 0 < threads <= 256
    valid_steps = isinstance(steps, int) and not isinstance(steps, bool) and 1 <= steps <= 128
    return Plan(
        device=device if device in DEVICES else "cpu",
        dtype=dtype if dtype in DTYPES else None,
        threads=threads if valid_threads else None,
        quantize=data.get("quantize") is True,
        steps=steps if valid_steps else None,
    )


def resolve_device(requested: str, plan: Plan) -> str:
    """The user's device setting wins; `auto` takes the plan's choice."""
    if requested and requested != "auto":
        return requested
    return plan.device


def apply_threads(plan: Plan) -> None:
    """Caps torch's intra-op threads when the plan names a count."""
    if plan.threads is None:
        return
    import torch

    torch.set_num_threads(plan.threads)


def torch_dtype(name: Optional[str], device: str):
    import torch

    if device == "cpu" or not name:
        # Half precision on the CPU is slower than float32, not faster.
        return torch.float32
    return {"float16": torch.float16, "bfloat16": torch.bfloat16}.get(name, torch.float32)
