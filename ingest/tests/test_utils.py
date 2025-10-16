"""Unit tests for utility functions in tiger_slack.utils module."""

import pytest

from tiger_slack.utils import remove_null_bytes


@pytest.mark.parametrize(
    "input_val,expected",
    [
        ("Hello World", "Hello World"),
        ("Hello\x00World", "HelloWorld"),
        ("\x00Hello\x00World\x00Test\x00", "HelloWorldTest"),
        ("Hello\u0000World", "HelloWorld"),
        ("Hello\\u0000World", "Hello\\u0000World"),
        ("Hello\\u0000World\x00", "Hello\\u0000World"),
        ("Hello\x00\\u0000World", "Hello\\u0000World"),
        (
            ["HelloWorld", "Test\x00String", "Test\\u0000String"],
            ["HelloWorld", "TestString", "Test\\u0000String"],
        ),
        (
            {
                "key1": "Hello\x00World",
                "key2": ["Test\x00String", "Another\\u0000Test"],
            },
            {"key1": "HelloWorld", "key2": ["TestString", "Another\\u0000Test"]},
        ),
        (12345, 12345),
        (False, False),
        (None, None),
    ],
)
def test_remove_null_bytes(input_val, expected):
    """Test that actual null bytes are removed from strings."""
    assert remove_null_bytes(input_val) == expected


def test_remove_null_bytes_escaped():
    """Test that escaped null bytes are removed from strings."""
    assert remove_null_bytes("Hello\\u0000World\\\\u0000Word", escaped=True) == "HelloWorld\\\\u0000Word"
