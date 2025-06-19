#!/usr/bin/env python3
"""
Scheduler API Routes
Handles API endpoints for scheduler management
"""

import os
import json
import logging
from flask import Blueprint, jsonify, request, Response
from datetime import datetime

# Import the scheduler engine to get execution history
from src.primary.scheduler_engine import get_execution_history

# Import database
from src.primary.utils.database import get_database

# Create logger
scheduler_logger = logging.getLogger("scheduler")

# Create blueprint
scheduler_api = Blueprint('scheduler_api', __name__)

# No longer using instance list generator or file system operations

@scheduler_api.route('/api/scheduler/load', methods=['GET'])
def load_schedules():
    """Load schedules from the database"""
    try:
        db = get_database()
        schedules = db.get_schedules()
        
        # Schedules loaded - spam reduced
        
        # Add CORS headers
        response = Response(json.dumps(schedules))
        response.headers['Content-Type'] = 'application/json'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    
    except Exception as e:
        error_msg = f"Error loading schedules from database: {str(e)}"
        scheduler_logger.error(error_msg)
        return jsonify({"error": error_msg}), 500
        

@scheduler_api.route('/api/scheduler/history', methods=['GET'])
def get_scheduler_history():
    """Return the execution history for the scheduler"""
    try:
        history = get_execution_history()
        response = Response(json.dumps({
            "success": True,
            "history": history,
            "timestamp": datetime.now().isoformat()
        }))
        response.headers['Content-Type'] = 'application/json'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    
    except Exception as e:
        error_msg = f"Error getting scheduler history: {str(e)}"
        scheduler_logger.error(error_msg)
        return jsonify({"error": error_msg}), 500

# API route for instance list generation has been removed

@scheduler_api.route('/api/scheduler/save', methods=['POST'])
def save_schedules():
    """Save schedules to the database"""
    try:
        # Get schedule data from request
        schedules = request.json
        
        if not schedules or not isinstance(schedules, dict):
            return jsonify({"error": "Invalid schedule data format"}), 400
        
        # Save to database
        db = get_database()
        db.save_schedules(schedules)
        
        total_schedules = sum(len(s) for s in schedules.values())
        # Schedules saved - no need to log every successful save
        
        # Add timestamp to response
        response_data = {
            "success": True,
            "message": "Schedules saved successfully",
            "timestamp": datetime.now().isoformat(),
            "count": total_schedules
        }
        
        # Add CORS headers
        response = Response(json.dumps(response_data))
        response.headers['Content-Type'] = 'application/json'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    
    except Exception as e:
        error_msg = f"Error saving schedules to database: {str(e)}"
        scheduler_logger.error(error_msg)
        return jsonify({"error": error_msg}), 500
