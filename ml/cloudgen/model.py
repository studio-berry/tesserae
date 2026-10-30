"""The denoiser: a small transformer over patches of points, trained with rectified flow.

The plan asks for a point-cloud diffusion transformer that fits in a browser tab. This is the
denoiser half of that, at the size the baseline can actually train in an evening on one card. The
transport is rectified flow rather than an epsilon-prediction: the training target is the straight
line from noise to data, so a sample is an Euler walk over the same field, and the walk *is* the
trajectory the app replays as an assembly animation.

Points are grouped into patches of `patch` points, 4096 points into 256 tokens, and every token
carries its 16 points' xyz and normals (6 channels). Point i stays point i in every frame, which is
what lets the stage spring from one step to the next with no correspondence step.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

CHANNELS = 6  # x, y, z, nx, ny, nz


def timestep_embedding(t: torch.Tensor, dim: int) -> torch.Tensor:
    half = dim // 2
    freqs = torch.exp(-math.log(10_000.0) * torch.arange(half, device=t.device) / half)
    args = t[:, None].float() * freqs[None]
    return torch.cat([torch.cos(args), torch.sin(args)], dim=-1)


def modulate(x: torch.Tensor, shift: torch.Tensor, scale: torch.Tensor) -> torch.Tensor:
    return x * (1 + scale.unsqueeze(1)) + shift.unsqueeze(1)


class Block(nn.Module):
    def __init__(self, dim: int, heads: int, cond_dim: int, cross: bool):
        super().__init__()
        self.norm1 = nn.LayerNorm(dim, elementwise_affine=False)
        self.attn = nn.MultiheadAttention(dim, heads, batch_first=True)
        self.norm2 = nn.LayerNorm(dim, elementwise_affine=False)
        self.mlp = nn.Sequential(nn.Linear(dim, dim * 4), nn.GELU(approximate="tanh"), nn.Linear(dim * 4, dim))
        self.cross = cross
        if cross:
            self.norm3 = nn.LayerNorm(dim, elementwise_affine=False)
            self.cross_attn = nn.MultiheadAttention(dim, heads, batch_first=True)
        self.mods = nn.Sequential(nn.SiLU(), nn.Linear(cond_dim, dim * (9 if cross else 6)))
        nn.init.zeros_(self.mods[-1].weight)
        nn.init.zeros_(self.mods[-1].bias)

    def forward(self, x: torch.Tensor, cond: torch.Tensor, memory: torch.Tensor) -> torch.Tensor:
        m = self.mods(cond).chunk(9 if self.cross else 6, dim=-1)
        x = modulate(self.norm1(x), m[0], m[1])
        x = x + m[2].unsqueeze(1) * self.attn(x, x, x, need_weights=False)[0]
        if self.cross:
            x = modulate(self.norm3(x), m[6], m[7])
            x = x + m[8].unsqueeze(1) * self.cross_attn(x, memory, memory, need_weights=False)[0]
        x = modulate(self.norm2(x), m[3], m[4])
        return x + m[5].unsqueeze(1) * self.mlp(x)


class PointDiT(nn.Module):
    """Velocity field v(x_t, t, text) for 4096-point clouds with xyz and normals."""

    def __init__(
        self,
        points: int = 4096,
        patch: int = 16,
        dim: int = 384,
        depth: int = 10,
        heads: int = 6,
        text_dim: int = 384,
        cross: bool = True,
    ):
        super().__init__()
        if points % patch:
            raise ValueError(f"{points} points do not split into patches of {patch}")
        self.points = points
        self.patch = patch
        self.tokens = points // patch
        self.dim = dim
        self.inp = nn.Linear(patch * CHANNELS, dim)
        self.out = nn.Linear(dim, patch * CHANNELS)
        self.time = nn.Sequential(nn.Linear(128, dim), nn.SiLU(), nn.Linear(dim, dim))
        self.text = nn.Sequential(nn.Linear(text_dim, dim), nn.SiLU(), nn.Linear(dim, dim))
        self.memory = nn.Linear(text_dim, dim)
        self.blocks = nn.ModuleList([Block(dim, heads, dim, cross) for _ in range(depth)])
        self.norm = nn.LayerNorm(dim, elementwise_affine=False)
        self.zero = nn.Parameter(torch.zeros(dim))

    def forward(self, x: torch.Tensor, t: torch.Tensor, text: torch.Tensor) -> torch.Tensor:
        b = x.shape[0]
        tokens = x.reshape(b, self.tokens, self.patch * CHANNELS)
        h = self.inp(tokens)
        cond = self.time(timestep_embedding(t, 128)) + self.text(text)
        memory = self.memory(text).unsqueeze(1)
        for block in self.blocks:
            h = block(h, cond, memory)
        h = self.norm(h) * (1 + self.zero) + self.zero
        return self.out(h).reshape(b, self.points, CHANNELS)

    def parameters_count(self) -> int:
        return sum(p.numel() for p in self.parameters())


@torch.no_grad()
def sample(model: PointDiT, text: torch.Tensor, steps: int = 32, seed: int | None = None, start: torch.Tensor | None = None):
    """Euler walk from noise to shape. Returns every frame, `[steps + 1, B, P, 6]`.

    The first frame is the noise the walk started from, because the app draws that frame too: the
    drifting dust the object assembles out of is the seed, not a decoration.
    """
    device = text.device
    b = text.shape[0]
    x = torch.randn(b, model.points, CHANNELS, device=device, generator=None) if start is None else start
    if seed is not None and start is None:
        gen = torch.Generator(device=device).manual_seed(seed)
        x = torch.randn(b, model.points, CHANNELS, device=device, generator=gen)
    frames = [x.clone()]
    dt = 1.0 / steps
    for i in range(steps):
        t = torch.full((b,), i * dt, device=device)
        x = x + dt * model(x, t, text)
        frames.append(x.clone())
    return torch.stack(frames)


def flow_loss(model: PointDiT, cloud: torch.Tensor, text: torch.Tensor, noise: torch.Tensor | None = None) -> torch.Tensor:
    b = cloud.shape[0]
    x0 = torch.randn_like(cloud) if noise is None else noise
    t = torch.rand(b, device=cloud.device)
    xt = x0 * (1 - t[:, None, None]) + cloud * t[:, None, None]
    target = cloud - x0
    return F.mse_loss(model(xt, t, text), target)
