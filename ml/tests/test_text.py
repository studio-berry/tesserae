import numpy as np

from cloudgen.text import Hashed, encoder


def test_the_hashed_encoder_is_deterministic_and_normalised():
    enc = Hashed(dim=64)
    a = enc.encode(["a teapot", "a lighthouse"])
    b = Hashed(dim=64).encode(["a teapot", "a lighthouse"])
    assert np.array_equal(a, b)
    assert np.allclose(np.linalg.norm(a, axis=1), 1.0, atol=1e-5)


def test_a_similar_phrase_lands_closer_than_an_unrelated_one():
    """The trigram encoder is not a language model, but it is not noise either."""
    enc = Hashed(dim=512)
    tea, cup, ship = enc.encode(["a teapot", "a tea cup", "a sailing ship"])
    near = float(np.dot(tea, cup))
    far = float(np.dot(tea, ship))
    assert near > far


def test_the_encoder_factory_refuses_a_name_it_does_not_know():
    assert isinstance(encoder("hashed"), Hashed)
    try:
        encoder("gpt-9")
    except ValueError as err:
        assert "unknown text encoder" in str(err)
    else:
        raise AssertionError("an unknown encoder has to be refused")
