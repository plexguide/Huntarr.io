"""Processing loop helpers and command wait logic for app modules."""

from src.primary.stats_manager import check_hourly_cap_exceeded


def should_continue_processing(app_type, stop_check, logger):
    """Check stop_check() and hourly cap. Returns False if processing should stop.

    Designed to be called at the top of each iteration in a processing loop:
        for item in items:
            if not should_continue_processing("radarr", stop_check, logger):
                break
            # ... process item ...

    Args:
        app_type: e.g. "radarr" (for hourly cap checking)
        stop_check: Callable that returns True if shutdown is requested
        logger: Logger instance

    Returns:
        True if processing should continue, False if it should stop.
    """
    if stop_check():
        logger.info("Stop requested during %s processing. Aborting...", app_type)
        return False

    try:
        if check_hourly_cap_exceeded(app_type):
            logger.warning(
                "API hourly limit reached for %s - stopping processing.", app_type
            )
            return False
    except Exception as e:
        logger.error("Error checking hourly API cap for %s: %s", app_type, e)
        # Continue processing if cap check fails - safer than stopping

    return True


def wait_for_command(api_module, api_url, api_key, api_timeout,
                     command_id, delay, attempts, logger):
    """Wait for an Arr command to complete. Used by all apps.

    Delegates to the app's API module wait_for_command, which handles
    the polling loop and state checking.

    Args:
        api_module: App API module with wait_for_command()
        api_url: API URL
        api_key: API key
        api_timeout: Request timeout
        command_id: ID of the command to wait for
        delay: Seconds between status checks
        attempts: Maximum number of status checks
        logger: Logger instance

    Returns:
        True if the command completed successfully, False otherwise.
    """
    try:
        return api_module.wait_for_command(
            api_url, api_key, api_timeout,
            command_id, delay, attempts
        )
    except Exception as e:
        logger.error("Error waiting for command %s: %s", command_id, e)
        return False
