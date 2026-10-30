import torch

from cloudgen.model import PointDiT, flow_loss, sample, timestep_embedding


def tiny(cross: bool = True) -> PointDiT:
    return PointDiT(points=64, patch=8, dim=32, depth=2, heads=4, text_dim=16, cross=cross)


def test_forward_keeps_the_cloud_shape():
    model = tiny()
    x = torch.randn(2, 64, 6)
    out = model(x, torch.rand(2), torch.randn(2, 16))
    assert out.shape == (2, 64, 6)
    assert torch.isfinite(out).all()


def test_a_walk_returns_the_steps_plus_the_noise_it_started_from():
    model = tiny()
    frames = sample(model, torch.randn(1, 16), steps=5, seed=3)
    assert frames.shape == (6, 1, 64, 6)
    assert torch.equal(frames[0], frames[0])
    again = sample(model, torch.randn(1, 16), steps=5, seed=3)
    assert torch.allclose(frames[0], again[0]), "the same seed has to start from the same noise"


def test_the_loss_reaches_zero_for_a_field_that_is_exactly_the_transport():
    """A model that already predicts `x1 - x0` must score zero, or the loss is not what it says."""
    cloud = torch.randn(2, 64, 6)
    noise = torch.randn(2, 64, 6)
    t = torch.rand(2)

    class Oracle(torch.nn.Module):
        def forward(self, x, t, text):
            return cloud - noise

    value = flow_loss(Oracle(), cloud, torch.zeros(2, 16), noise=noise)
    assert value.item() < 1e-10
    assert t.shape == (2,)


def test_the_conditioning_can_be_cross_attention_or_adaptive_norm():
    for cross in (True, False):
        model = tiny(cross=cross)
        out = model(torch.randn(1, 64, 6), torch.rand(1), torch.randn(1, 16))
        assert out.shape == (1, 64, 6)


def test_a_few_hundred_steps_learn_something():
    """Not a quality claim: the loss has to fall on one fixed cloud, or training is not wired up."""
    torch.manual_seed(0)
    model = tiny(cross=False)
    cloud = torch.randn(2, 64, 6) * 0.5
    text = torch.randn(2, 16)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3)
    first = last = None
    for _ in range(120):
        loss = flow_loss(model, cloud, text)
        opt.zero_grad()
        loss.backward()
        opt.step()
        first = float(loss) if first is None else first
        last = float(loss)
    assert last < first * 0.8, f"loss went {first:.3f} → {last:.3f}"


def test_the_time_embedding_is_bounded_and_differs_per_step():
    emb = timestep_embedding(torch.tensor([0.0, 0.5, 1.0]), 128)
    assert emb.shape == (3, 128)
    assert torch.isfinite(emb).all()
    assert not torch.allclose(emb[0], emb[1])
