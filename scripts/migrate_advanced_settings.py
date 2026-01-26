"""
Migration script to add ALL per-instance settings to existing databases.

This script updates existing instances to include:
- api_timeout, command_wait_delay, command_wait_attempts, max_download_queue_size
- monitored_only, skip_future_episodes, tag_processed_items
- custom_tags

Run this ONCE on existing installations to migrate old instances.
"""

from src.primary.utils.database import get_database
from src.primary.settings_manager import get_advanced_setting, load_settings
import logging

logger = logging.getLogger("huntarr.migration")

def migrate_instances_to_per_instance_settings():
    """
    Migrate existing instances to include ALL per-instance settings.
    Copies values from global settings as defaults where they existed.
    """
    db = get_database()
    
    # Get global defaults for advanced settings
    global_api_timeout = get_advanced_setting("api_timeout", 120)
    global_cmd_delay = get_advanced_setting("command_wait_delay", 1)
    global_cmd_attempts = get_advanced_setting("command_wait_attempts", 600)
    
    # Load general settings for max queue size
    general_settings = db.get_general_settings()
    global_max_queue = general_settings.get("minimum_download_queue_size", -1)
    
    apps_to_migrate = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros']
    
    for app_type in apps_to_migrate:
        logger.info(f"Migrating {app_type} instances...")
        config = db.get_app_config(app_type)
        
        if not config or 'instances' not in config:
            logger.info(f"  No instances found for {app_type}")
            continue
        
        # Get global app settings for migration
        global_monitored_only = config.get('monitored_only', True)
        global_skip_future = config.get('skip_future_episodes', True) if app_type == 'sonarr' else config.get('skip_future_releases', True)
        global_tag_processed = config.get('tag_processed_items', True)
        global_custom_tags = config.get('custom_tags', {
            'missing': 'huntarr-missing',
            'upgrade': 'huntarr-upgrade'
        })
        
        # Add shows_missing tag for Sonarr
        if app_type == 'sonarr' and 'shows_missing' not in global_custom_tags:
            global_custom_tags['shows_missing'] = 'huntarr-shows-missing'
        
        instances = config.get('instances', [])
        if not instances:
            logger.info(f"  No instances to migrate for {app_type}")
            continue
        
        updated = False
        for i, instance in enumerate(instances):
            instance_name = instance.get('name', f'Instance {i}')
            
            # Migrate advanced settings
            if 'api_timeout' not in instance:
                instance['api_timeout'] = global_api_timeout
                updated = True
                logger.info(f"  Added api_timeout={global_api_timeout} to {instance_name}")
            
            if 'command_wait_delay' not in instance:
                instance['command_wait_delay'] = global_cmd_delay
                updated = True
                logger.info(f"  Added command_wait_delay={global_cmd_delay} to {instance_name}")
            
            if 'command_wait_attempts' not in instance:
                instance['command_wait_attempts'] = global_cmd_attempts
                updated = True
                logger.info(f"  Added command_wait_attempts={global_cmd_attempts} to {instance_name}")
            
            if 'max_download_queue_size' not in instance:
                instance['max_download_queue_size'] = global_max_queue
                updated = True
                logger.info(f"  Added max_download_queue_size={global_max_queue} to {instance_name}")
            
            # Migrate per-instance options
            if 'monitored_only' not in instance:
                instance['monitored_only'] = global_monitored_only
                updated = True
                logger.info(f"  Added monitored_only={global_monitored_only} to {instance_name}")
            
            if app_type == 'sonarr' and 'skip_future_episodes' not in instance:
                instance['skip_future_episodes'] = global_skip_future
                updated = True
                logger.info(f"  Added skip_future_episodes={global_skip_future} to {instance_name}")
            
            if 'tag_processed_items' not in instance:
                instance['tag_processed_items'] = global_tag_processed
                updated = True
                logger.info(f"  Added tag_processed_items={global_tag_processed} to {instance_name}")
            
            if 'custom_tags' not in instance:
                instance['custom_tags'] = global_custom_tags.copy()
                updated = True
                logger.info(f"  Added custom_tags to {instance_name}")
        
        # Save if any updates were made
        if updated:
            db.save_app_config(app_type, config)
            logger.info(f"✅ Saved updated {app_type} configuration")
        else:
            logger.info(f"  {app_type} instances already up to date")
    
    logger.info("✅ Migration complete!")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting comprehensive migration to per-instance settings...")
    migrate_instances_to_per_instance_settings()

