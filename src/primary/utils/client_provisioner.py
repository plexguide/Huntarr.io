"""
Client Auto-Provisioner — ensures NZB Hunt and Tor Hunt are always
configured as built-in download clients for every Movie/TV Hunt instance.

Called:
  1. On startup (ensure_all_instances_have_builtin_clients)
  2. When a new Movie Hunt or TV Hunt instance is created

This replaces the manual "Add Client" step that was previously required.
"""

from src.primary.utils.logger import get_logger

logger = get_logger("client_provisioner")

# ── Default client definitions ─────────────────────────────────────────

_NZB_HUNT_CLIENT = {
    "name": "NZB Hunt",
    "type": "nzbhunt",
    "host": "internal",
    "port": 8080,
    "enabled": True,
    "api_key": "",
    "username": "",
    "password": "",
    "category": "",
    "recent_priority": "default",
    "older_priority": "default",
    "client_priority": 1,
}

_TOR_HUNT_CLIENT = {
    "name": "Tor Hunt",
    "type": "torhunt",
    "host": "internal",
    "port": 8080,
    "enabled": True,
    "api_key": "",
    "username": "",
    "password": "",
    "category": "",
    "recent_priority": "default",
    "older_priority": "default",
    "client_priority": 2,
}

# TV Hunt uses the same shape but with a UUID `id` field
_NZB_HUNT_CLIENT_TV = {
    **_NZB_HUNT_CLIENT,
    "id": "nzbhunt0",
    "category": "",
}

_TOR_HUNT_CLIENT_TV = {
    **_TOR_HUNT_CLIENT,
    "id": "torhunt0",
    "category": "",
}


def _has_builtin_client(clients: list, client_type: str) -> bool:
    """Check if a client list already contains a built-in client of the given type."""
    if not clients or not isinstance(clients, list):
        return False
    normalized = client_type.lower().replace("_", "")
    for c in clients:
        t = (c.get("type") or "").lower().replace("_", "")
        if t == normalized:
            return True
    return False


def ensure_clients_for_movie_instance(instance_id: int) -> None:
    """Ensure a Movie Hunt instance has NZB Hunt and Tor Hunt clients."""
    from src.primary.utils.database import get_database

    db = get_database()
    config = db.get_app_config_for_instance("clients", instance_id)
    clients = config.get("clients", []) if config and isinstance(config, dict) else []
    changed = False

    if not _has_builtin_client(clients, "nzbhunt"):
        clients.append(dict(_NZB_HUNT_CLIENT))
        changed = True
        logger.info(
            f"Auto-provisioned NZB Hunt client for Movie Hunt instance {instance_id}"
        )

    if not _has_builtin_client(clients, "torhunt"):
        clients.append(dict(_TOR_HUNT_CLIENT))
        changed = True
        logger.info(
            f"Auto-provisioned Tor Hunt client for Movie Hunt instance {instance_id}"
        )

    if changed:
        db.save_app_config_for_instance("clients", instance_id, {"clients": clients})


def ensure_clients_for_tv_instance(instance_id: int) -> None:
    """Ensure a TV Hunt instance has NZB Hunt and Tor Hunt clients."""
    from src.primary.utils.database import get_database

    db = get_database()
    # TV uses 'tv_hunt_clients' config key with fallback to 'clients'
    config = db.get_app_config_for_instance("tv_hunt_clients", instance_id)
    if not config or not isinstance(config, dict) or not isinstance(
        config.get("clients"), list
    ):
        # Fallback: check 'clients' key (shared with Movie Hunt in some setups)
        config = db.get_app_config_for_instance("clients", instance_id)

    clients = config.get("clients", []) if config and isinstance(config, dict) else []
    changed = False

    if not _has_builtin_client(clients, "nzbhunt"):
        clients.append(dict(_NZB_HUNT_CLIENT_TV))
        changed = True
        logger.info(
            f"Auto-provisioned NZB Hunt client for TV Hunt instance {instance_id}"
        )

    if not _has_builtin_client(clients, "torhunt"):
        clients.append(dict(_TOR_HUNT_CLIENT_TV))
        changed = True
        logger.info(
            f"Auto-provisioned Tor Hunt client for TV Hunt instance {instance_id}"
        )

    if changed:
        db.save_app_config_for_instance(
            "tv_hunt_clients", instance_id, {"clients": clients}
        )


def ensure_all_instances_have_builtin_clients() -> None:
    """Scan all Movie Hunt and TV Hunt instances and provision built-in clients
    for any that are missing them.  Safe to call on every startup."""
    from src.primary.utils.database import get_database

    try:
        db = get_database()

        # Movie Hunt instances
        movie_instances = db.get_movie_hunt_instances() or []
        for inst in movie_instances:
            inst_id = inst.get("id")
            if inst_id is not None:
                ensure_clients_for_movie_instance(int(inst_id))

        # TV Hunt instances
        tv_instances = db.get_tv_hunt_instances() or []
        for inst in tv_instances:
            inst_id = inst.get("id")
            if inst_id is not None:
                ensure_clients_for_tv_instance(int(inst_id))

        logger.info("Built-in client provisioning complete")
    except Exception as e:
        logger.error(f"Error during client auto-provisioning: {e}")
