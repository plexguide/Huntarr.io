"""
Route definitions for Swaparr API endpoints.
Enhanced with better statistics tracking and status reporting.
"""

from flask import Blueprint, request, jsonify
import os
import json
from src.primary.utils.logger import get_logger
from src.primary.settings_manager import load_settings, save_settings
from src.primary.apps.swaparr.handler import (
    process_stalled_downloads, 
    get_session_stats, 
    reset_session_stats
)
from src.primary.apps.swaparr import get_configured_instances, is_configured
from src.primary.apps.swaparr.stats_manager import get_swaparr_stats, reset_swaparr_stats
from src.primary.utils.database import get_database

# Create the blueprint directly in this file
swaparr_bp = Blueprint('swaparr', __name__)
swaparr_logger = get_logger("swaparr")

@swaparr_bp.route('/status', methods=['GET'])
def get_status():
    """Get Swaparr status and comprehensive statistics"""
    settings = load_settings("swaparr")
    enabled = settings.get("enabled", False)
    configured = is_configured()
    
    # Get strike statistics from database for all configured apps
    app_statistics = {}
    
    # Only read statistics if Swaparr is enabled to avoid unnecessary database errors
    if enabled and configured:
        try:
            db = get_database()
            
            # Get all configured instances to check for state data
            instances = get_configured_instances()
            for app_name, app_instances in instances.items():
                # Only process apps that have Swaparr enabled for at least one instance
                swaparr_enabled_for_app = any(instance.get("swaparr_enabled", False) for instance in app_instances)
                
                if not swaparr_enabled_for_app:
                    continue  # Skip apps that don't have Swaparr enabled
                
                app_stats = {"error": None}
                
                try:
                    # Load strike data from database
                    strike_data = db.get_swaparr_strike_data(app_name)
                    
                    total_items = len(strike_data)
                    removed_items = sum(1 for item in strike_data.values() if item.get("removed", False))
                    striked_items = sum(1 for item in strike_data.values() 
                                      if item.get("strikes", 0) > 0 and not item.get("removed", False))
                    
                    app_stats.update({
                        "total_tracked": total_items,
                        "currently_striked": striked_items,
                        "removed_via_strikes": removed_items
                    })
                    
                    # Load removed items data from database
                    removed_data = db.get_swaparr_removed_items(app_name)
                    
                    app_stats["total_removed"] = len(removed_data)
                    
                    # Get removal reasons breakdown
                    reasons = {}
                    for item in removed_data.values():
                        reason = item.get("reason", "Unknown")
                        reasons[reason] = reasons.get(reason, 0) + 1
                    app_stats["removal_reasons"] = reasons
                        
                except Exception as e:
                    swaparr_logger.error(f"Error reading statistics for {app_name}: {str(e)}")
                    app_stats["error"] = str(e)
                
                app_statistics[app_name] = app_stats
                
        except Exception as e:
            swaparr_logger.error(f"Error accessing database for statistics: {str(e)}")
    
    # Get session statistics
    session_stats = get_session_stats()
    
    # Get persistent statistics
    swaparr_persistent_stats = get_swaparr_stats()
    
    # Get configured instances info
    instances_info = {}
    if configured:
        instances = get_configured_instances()
        for app_name, app_instances in instances.items():
            instances_info[app_name] = [
                {
                    "instance_name": instance.get("instance_name", "Unknown"),
                    "api_url": instance.get("api_url", "Not configured"),
                    "enabled": instance.get("enabled", False),
                    "swaparr_enabled": instance.get("swaparr_enabled", False)
                }
                for instance in app_instances
            ]
    
    return jsonify({
        "enabled": enabled,
        "configured": configured,
        "total_instances": sum(len(instances) for instances in instances_info.values()),
        "settings": {
            "max_strikes": settings.get("max_strikes", 3),
            "max_download_time": settings.get("max_download_time", "2h"),
            "ignore_above_size": settings.get("ignore_above_size", "25GB"),
            "remove_from_client": settings.get("remove_from_client", True),
            "dry_run": settings.get("dry_run", False)
        },
        "app_statistics": app_statistics,
        "session_statistics": session_stats,
        "persistent_statistics": swaparr_persistent_stats,
        "configured_instances": instances_info
    })

@swaparr_bp.route('/settings', methods=['GET'])
def get_settings():
    """Get Swaparr settings"""
    settings = load_settings("swaparr")
    return jsonify(settings)

@swaparr_bp.route('/settings', methods=['POST'])
def update_settings():
    """Update Swaparr settings"""
    data = request.json
    
    if not data:
        return jsonify({"success": False, "message": "No data provided"}), 400
    
    # Load current settings
    settings = load_settings("swaparr")
    
    # Update settings with provided data
    for key, value in data.items():
        settings[key] = value
    
    # Save updated settings
    success = save_settings("swaparr", settings)
    
    if success:
        swaparr_logger.info(f"Updated Swaparr settings: {list(data.keys())}")
        return jsonify({"success": True, "message": "Settings updated successfully"})
    else:
        swaparr_logger.error("Failed to save Swaparr settings")
        return jsonify({"success": False, "message": "Failed to save settings"}), 500

@swaparr_bp.route('/reset', methods=['POST'])
def reset_strikes():
    """Reset strikes and optionally removed items for all apps or a specific app"""
    data = request.json or {}
    app_name = data.get('app_name')
    reset_removed = data.get('reset_removed', False)  # Option to also reset removed items
    
    try:
        db = get_database()
        
        if app_name:
            # Reset strikes for a specific app
            files_reset = []
            
            # Reset strikes
            db.set_swaparr_strike_data(app_name, {})
            files_reset.append("strikes")
            
            # Optionally reset removed items
            if reset_removed:
                db.set_swaparr_removed_items(app_name, {})
                files_reset.append("removed_items")
            
            swaparr_logger.info(f"Reset {', '.join(files_reset)} for {app_name}")
            return jsonify({
                "success": True, 
                "message": f"Reset {', '.join(files_reset)} for {app_name}",
                "files_reset": files_reset
            })
        else:
            # Reset strikes for all configured apps
            configured = is_configured()
            if not configured:
                return jsonify({"success": True, "message": "No configured apps to reset"})
            
            instances = get_configured_instances()
            apps_reset = []
            
            for app_name in instances.keys():
                files_reset = []
                
                # Reset strikes
                db.set_swaparr_strike_data(app_name, {})
                files_reset.append("strikes")
                
                # Optionally reset removed items
                if reset_removed:
                    db.set_swaparr_removed_items(app_name, {})
                    files_reset.append("removed_items")
                
                apps_reset.append(f"{app_name} ({', '.join(files_reset)})")
            
            swaparr_logger.info(f"Reset data for apps: {apps_reset}")
            return jsonify({
                "success": True, 
                "message": f"Reset data for {len(apps_reset)} apps",
                "apps_reset": apps_reset
            })
    except Exception as e:
        swaparr_logger.error(f"Error during reset operation: {str(e)}")
        return jsonify({"success": False, "message": f"Error during reset: {str(e)}"}), 500

@swaparr_bp.route('/reset-session', methods=['POST'])
def reset_session_statistics():
    """Reset session statistics"""
    try:
        reset_session_stats()
        swaparr_logger.info("Reset Swaparr session statistics")
        return jsonify({"success": True, "message": "Session statistics reset successfully"})
    except Exception as e:
        swaparr_logger.error(f"Error resetting session statistics: {str(e)}")
        return jsonify({"success": False, "message": f"Error resetting session statistics: {str(e)}"}), 500

@swaparr_bp.route('/reset-stats', methods=['POST'])
def reset_persistent_statistics():
    """Reset persistent statistics (the ones shown on homepage)"""
    try:
        success = reset_swaparr_stats()
        if success:
            swaparr_logger.info("Reset Swaparr persistent statistics")
            return jsonify({"success": True, "message": "Persistent statistics reset successfully"})
        else:
            return jsonify({"success": False, "message": "Failed to reset persistent statistics"}), 500
    except Exception as e:
        swaparr_logger.error(f"Error resetting persistent statistics: {str(e)}")
        return jsonify({"success": False, "message": f"Error resetting persistent statistics: {str(e)}"}), 500

@swaparr_bp.route('/reset-cycle', methods=['POST'])
def reset_cycle_endpoint():
    """Reset Swaparr cycle - forces a new cycle to start immediately"""
    try:
        from src.primary.cycle_tracker import reset_cycle
        
        # Reset the cycle timer for Swaparr
        success = reset_cycle('swaparr')
        
        if success:
            swaparr_logger.info("Reset Swaparr cycle timer - forcing new cycle to start")
            return jsonify({"success": True, "message": "Swaparr cycle reset successfully"})
        else:
            swaparr_logger.error("Failed to reset Swaparr cycle")
            return jsonify({"success": False, "message": "Failed to reset Swaparr cycle"}), 500
    except Exception as e:
        swaparr_logger.error(f"Error resetting Swaparr cycle: {str(e)}")
        return jsonify({"success": False, "message": f"Error resetting Swaparr cycle: {str(e)}"}), 500

@swaparr_bp.route('/test', methods=['POST'])
def test_configuration():
    """Test Swaparr configuration with specific instances"""
    data = request.json or {}
    test_app = data.get('app_name')  # Optional: test specific app
    
    settings = load_settings("swaparr")
    if not settings or not settings.get("enabled", False):
        return jsonify({
            "success": False, 
            "message": "Swaparr is not enabled"
        }), 400
    
    try:
        instances = get_configured_instances()
        
        if not instances or not any(len(app_instances) > 0 for app_instances in instances.values()):
            return jsonify({
                "success": False, 
                "message": "No configured Starr app instances found"
            }), 400
        
        test_results = {}
        
        for app_name, app_instances in instances.items():
            if test_app and app_name != test_app:
                continue
                
            test_results[app_name] = []
            
            for app_settings in app_instances:
                instance_name = app_settings.get("instance_name", "Unknown")
                api_url = app_settings.get("api_url")
                api_key = app_settings.get("api_key")
                
                if not api_url or not api_key:
                    test_results[app_name].append({
                        "instance": instance_name,
                        "success": False,
                        "message": "Missing API URL or API Key"
                    })
                    continue
                
                try:
                    # Test API connectivity by getting queue (dry run)
                    from src.primary.apps.swaparr.handler import get_queue_items
                    
                    queue_items = get_queue_items(app_name, api_url, api_key, 30)  # Short timeout for test
                    
                    test_results[app_name].append({
                        "instance": instance_name,
                        "success": True,
                        "message": f"Successfully connected. Found {len(queue_items)} queue items.",
                        "queue_count": len(queue_items)
                    })
                    
                except Exception as e:
                    test_results[app_name].append({
                        "instance": instance_name,
                        "success": False,
                        "message": f"Connection failed: {str(e)}"
                    })
        
        overall_success = any(
            any(result["success"] for result in app_results) 
            for app_results in test_results.values()
        )
        
        return jsonify({
            "success": overall_success,
            "message": "Configuration test completed",
            "test_results": test_results
        })
        
    except Exception as e:
        swaparr_logger.error(f"Error during configuration test: {str(e)}")
        return jsonify({
            "success": False, 
            "message": f"Test failed with error: {str(e)}"
        }), 500

@swaparr_bp.route('/run', methods=['POST'])
def manual_run():
    """Manually trigger a Swaparr run"""
    try:
        from src.primary.apps.swaparr.handler import run_swaparr
        
        settings = load_settings("swaparr")
        if not settings or not settings.get("enabled", False):
            return jsonify({
                "success": False, 
                "message": "Swaparr is not enabled"
            }), 400
        
        # Run Swaparr
        run_swaparr()
        
        # Get updated session stats
        session_stats = get_session_stats()
        
        return jsonify({
            "success": True,
            "message": "Swaparr run completed successfully",
            "session_stats": session_stats
        })
        
    except Exception as e:
        swaparr_logger.error(f"Error during manual Swaparr run: {str(e)}")
        return jsonify({
            "success": False, 
            "message": f"Manual run failed: {str(e)}"
        }), 500



 