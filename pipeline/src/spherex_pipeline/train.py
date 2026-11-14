"""Train the mover classifier on real SPHEREx star pairs with synthetic sub-pixel shifts.

Every training example is a real star seen in two survey passes. For a positive, the second
pass is slid by a known offset, so the PSF, noise and brightness changes are all real.
Both passes go through the same interpolation, so the model cannot use blur as a cue.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

from .movers import CROP_HALF, STAMP_HALF, STATIC_MATCH_RADIUS_PX, crop, detect_sources, nearest

ROOT = Path(__file__).resolve().parents[2]
FIELDS_DIR = ROOT / "data" / "fields"
MODEL_DIR = ROOT / "data" / "model"
STAMP = 2 * STAMP_HALF + 1
MAX_SHIFT_PX = 6.0
MIN_SHIFT_PX = 0.35
JITTER_PX = 0.8
POSITIVE_FRACTION = 0.5
VALIDATION_FRACTION = 0.2
BATCH = 256
SHIFT_LOSS_WEIGHT = 1.0


class MoverNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 24, 3), nn.ReLU(),
            nn.Conv2d(24, 48, 3), nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(48, 64, 3), nn.ReLU(),
        )
        self.head = nn.Sequential(nn.Flatten(), nn.Linear(64 * 3 * 3, 96), nn.ReLU(), nn.Linear(96, 3))

    def forward(self, stamps: torch.Tensor) -> torch.Tensor:
        return self.head(self.features(stamps))


def load_pairs(fields_dir: Path) -> tuple[np.ndarray, np.ndarray]:
    crops, field_ids = [], []
    for field_id, path in enumerate(sorted(fields_dir.glob("*.npz"))):
        frames = np.load(path)["frames"]
        first, last = frames[0], frames[-1]
        later = detect_sources(last)
        for source in detect_sources(first):
            match, distance = nearest(source, later)
            if match is None or distance > STATIC_MATCH_RADIUS_PX:
                continue
            a, b = crop(first, source.x, source.y, CROP_HALF), crop(last, source.x, source.y, CROP_HALF)
            if a is None or b is None:
                continue
            crops.append(np.stack([a, b]))
            field_ids.append(field_id)
    return np.array(crops, dtype=np.float32), np.array(field_ids)


def translate(images: torch.Tensor, shift_px: torch.Tensor) -> torch.Tensor:
    n, _, h, w = images.shape
    theta = torch.zeros(n, 2, 3, device=images.device)
    theta[:, 0, 0] = theta[:, 1, 1] = 1.0
    theta[:, 0, 2] = -shift_px[:, 0] * 2 / w
    theta[:, 1, 2] = -shift_px[:, 1] * 2 / h
    grid = F.affine_grid(theta, list(images.shape), align_corners=False)
    return F.grid_sample(images, grid, mode="bicubic", padding_mode="border", align_corners=False)


def make_batch(crops: torch.Tensor, generator: torch.Generator) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    n = crops.shape[0]
    device = crops.device
    rand = lambda *shape: torch.rand(*shape, device=device, generator=generator)
    is_mover = rand(n) < POSITIVE_FRACTION
    magnitude = MIN_SHIFT_PX + (MAX_SHIFT_PX - MIN_SHIFT_PX) * rand(n) ** 1.5
    angle = 2 * np.pi * rand(n)
    motion = torch.stack([magnitude * torch.cos(angle), magnitude * torch.sin(angle)], dim=1) * is_mover[:, None]
    jitter = (rand(n, 2) - 0.5) * 2 * JITTER_PX
    flip = rand(n) < 0.5
    pair = torch.where(flip[:, None, None, None], crops.flip(1), crops)
    brightness = torch.exp((rand(n, 1, 1) - 0.5) * 1.2)
    first = translate(pair[:, 0:1], jitter)
    second = translate(pair[:, 1:2], jitter + motion) * brightness[:, None]
    return build_input(first, second), is_mover.float(), motion


def build_input(first: torch.Tensor, second: torch.Tensor) -> torch.Tensor:
    lo, hi = CROP_HALF - STAMP_HALF, CROP_HALF + STAMP_HALF + 1
    first, second = first[:, :, lo:hi, lo:hi], second[:, :, lo:hi, lo:hi]
    scale = torch.amax(torch.maximum(first, second), dim=(1, 2, 3), keepdim=True).clamp_min(1e-6)
    first, second = (first / scale).clamp(-0.5, 1.5), (second / scale).clamp(-0.5, 1.5)
    return torch.cat([first, second, second - first], dim=1)


def evaluate(model: MoverNet, crops: torch.Tensor, generator: torch.Generator) -> dict[str, float]:
    model.eval()
    with torch.no_grad():
        inputs, labels, motion = make_batch(crops.repeat(4, 1, 1, 1), generator)
        out = model(inputs)
    prob = torch.sigmoid(out[:, 0])
    movers = labels > 0.5
    threshold = torch.quantile(prob[~movers], 0.99)
    recall = (prob[movers] > threshold).float().mean()
    error = (out[movers, 1:] - motion[movers]).norm(dim=1)
    slow = movers & (motion.norm(dim=1) < 1.0)
    return {
        "recall_at_1pct_false_alarms": float(recall),
        "recall_below_1px_shift": float((prob[slow] > threshold).float().mean()),
        "median_shift_error_px": float(error.median()),
        "threshold": float(threshold),
        "accuracy": float(((prob > 0.5) == movers).float().mean()),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--fields", type=Path, default=FIELDS_DIR)
    args = parser.parse_args()
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    torch.manual_seed(0)
    crops_np, field_ids = load_pairs(args.fields)
    fields = np.unique(field_ids)
    np.random.default_rng(0).shuffle(fields)
    held_out = set(fields[: max(1, int(len(fields) * VALIDATION_FRACTION))].tolist())
    is_val = np.array([f in held_out for f in field_ids])
    train = torch.tensor(crops_np[~is_val], device=device)
    val = torch.tensor(crops_np[is_val], device=device)
    print(f"{len(crops_np)} star pairs from {len(fields)} fields; {len(train)} train, {len(val)} held out", flush=True)

    model = MoverNet().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    steps_per_epoch = max(1, len(train) // BATCH) * 4
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=3e-3, total_steps=args.epochs * steps_per_epoch)
    generator = torch.Generator(device=device).manual_seed(0)
    for epoch in range(args.epochs):
        model.train()
        for _ in range(steps_per_epoch):
            picks = torch.randint(0, len(train), (BATCH,), device=device, generator=generator)
            inputs, labels, motion = make_batch(train[picks], generator)
            out = model(inputs)
            loss = F.binary_cross_entropy_with_logits(out[:, 0], labels) + SHIFT_LOSS_WEIGHT * F.smooth_l1_loss(out[:, 1:].contiguous(), motion.contiguous())
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            scheduler.step()
        if (epoch + 1) % 10 == 0 or epoch == args.epochs - 1:
            print(epoch + 1, f"loss {loss.item():.4f}", evaluate(model, val, generator), flush=True)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    metrics = evaluate(model, val, generator)
    metrics.update({"star_pairs": int(len(crops_np)), "fields": int(len(fields)), "held_out_pairs": int(len(val))})
    model.cpu().eval()
    torch.save(model.state_dict(), MODEL_DIR / "movernet.pt")
    layers = []
    blob = bytearray()
    for name, tensor in model.state_dict().items():
        values = tensor.numpy().astype("<f4")
        layers.append({"name": name, "shape": list(values.shape), "offset": len(blob) // 4})
        blob += values.tobytes()
    (MODEL_DIR / "movernet.bin").write_bytes(bytes(blob))
    metrics["layers"] = layers
    metrics["stamp"] = STAMP
    (MODEL_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print("saved", metrics, flush=True)


if __name__ == "__main__":
    main()
