#!/bin/bash

echo "🔍 Quick Log Spam Check"
echo "======================="

# Run the monitoring script once
python3 monitor_logs.py

echo ""
echo "💡 Tips:"
echo "   - Run 'python3 monitor_logs.py --continuous 30' for continuous monitoring"
echo "   - Press Ctrl+C to stop continuous monitoring"
echo "   - Logs are considered spam if they repeat more than 5 times"
echo "   - Timestamps are suspicious if they appear more than 2 times" 