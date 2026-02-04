"""
Stable instance identifiers for *arr instances.
Instance ID is immutable so renaming (name field) does not break tracking.
Format: app_type-YYMMDDHHMMxxx (year month day hour minute + 3 random alphanumeric).
"""

import random
import string
from datetime import datetime
from typing import Set


def generate_instance_id(app_type: str, existing_ids: Set[str]) -> str:
    """
    Generate a unique instance ID: app_type-YYMMDDHHMM + 3 random alphanumeric.
    existing_ids: set of IDs already in use for this app (to avoid collision).
    """
    time_part = datetime.utcnow().strftime("%y%m%d%H%M")
    prefix = f"{app_type}-{time_part}"
    alphabet = string.ascii_lowercase + string.digits
    for _ in range(100):
        suffix = "".join(random.choices(alphabet, k=3))
        candidate = f"{prefix}{suffix}"
        if candidate not in existing_ids:
            return candidate
    # Fallback: add more randomness
    suffix = "".join(random.choices(alphabet, k=6))
    return f"{prefix}{suffix}"
