"""Unit tests for utility functions in tiger_slack.utils module."""

from datetime import date
from unittest.mock import patch

import pytest

from tiger_slack.utils import parse_since_flag, remove_null_bytes


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


@pytest.mark.parametrize(
    "since_str,expected",
    [
        ("2025-01-15", date(2025, 1, 15)),
        ("2024-12-31", date(2024, 12, 31)),
        ("2020-02-29", date(2020, 2, 29)),
        ("1999-03-01", date(1999, 3, 1)),
        ("1D", date(2025, 10, 22)),
        ("30D", date(2025, 9, 23)),
        ("365D", date(2024, 10, 23)),
        ("1W", date(2025, 10, 16)),
        ("4W", date(2025, 9, 25)),
        ("52W", date(2024, 10, 24)),
        ("1M", date(2025, 9, 23)),
        ("7M", date(2025, 3, 23)),
        ("12M", date(2024, 10, 23)),
        ("13M", date(2024, 9, 23)),
        ("1Y", date(2024, 10, 23)),
        ("2Y", date(2023, 10, 23)),
        ("10Y", date(2015, 10, 23)),
        ("1y", date(2024, 10, 23)),
    ],
)
def test_parse_since_flag_absolute_date(since_str, expected):
    """Test parsing absolute dates in YYYY-MM-DD format."""
    with patch("tiger_slack.utils.date") as mock_date:
        mock_date.today.return_value = date(2025, 10, 23)
        mock_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)
        assert parse_since_flag(since_str) == expected

@pytest.mark.parametrize(
    "since_str,mock_date_val,expected",
    [
        ("1M", date(2025, 1, 31), date(2024, 12, 31)),
        ("1M", date(2025, 3, 31), date(2025, 2, 28)),
        ("1M", date(2024, 3, 31), date(2024, 2, 29)),  # leap year
    ],
)
def test_parse_since_flag_month_edge_cases(since_str, mock_date_val, expected):
    """Test calendar-aware month calculations handle edge cases correctly."""
    # Jan 31 - 1M should give Dec 31 (not error)
    with patch("tiger_slack.utils.date") as mock_date:
        mock_date.today.return_value = mock_date_val
        mock_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)
        assert parse_since_flag(since_str) == expected

@pytest.mark.parametrize(
    "invalid_str",
    [
        "2025-13-01",
        "2025-02-30",
        "2025/01/15",
        "01-15-2025",
        "M7",
        "7",
        "M",
        "7X",
        "7.5M",
        "-7M",
        "abc",
        "",
    ],
)
def test_parse_since_flag_invalid_formats(invalid_str):
    """Test that invalid formats raise ValueError with helpful message."""
    with pytest.raises(ValueError, match="Invalid --since format"):
        parse_since_flag(invalid_str)
