#!/usr/bin/env python3
"""
Huntarr Log Spam Monitor
Monitors Docker logs for excessive spam messages and duplicate timestamps
"""

import subprocess
import time
import re
from collections import defaultdict, Counter
from datetime import datetime, timedelta
import sys

class LogSpamMonitor:
    def __init__(self):
        self.message_counts = Counter()
        self.timestamp_counts = Counter()
        self.recent_messages = []
        self.spam_threshold = 5  # Messages repeated more than this are considered spam
        self.time_window = 60  # Monitor last 60 seconds
        self.duplicate_threshold = 2  # Same timestamp appearing more than this is suspicious
        
    def extract_timestamp_and_message(self, log_line):
        """Extract timestamp and clean message from log line"""
        # Pattern to match: "2025-06-13 05:08:14 UTC - huntarr - LEVEL - message"
        pattern = r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC.*?- (.*)'
        match = re.search(pattern, log_line)
        
        if match:
            timestamp_str = match.group(1)
            message = match.group(2).strip()
            
            # Clean up the message by removing variable parts
            # Remove session IDs, IP addresses, etc.
            message = re.sub(r'session_id: [a-f0-9]+', 'session_id: [REDACTED]', message)
            message = re.sub(r'IP address: [\d\.]+', 'IP address: [REDACTED]', message)
            message = re.sub(r'path \'[^\']+\'', 'path [REDACTED]', message)
            
            return timestamp_str, message
        
        return None, None
    
    def analyze_logs(self, lines):
        """Analyze log lines for spam and duplicates"""
        current_time = datetime.now()
        spam_detected = []
        duplicate_timestamps = []
        
        # Clear old data
        self.message_counts.clear()
        self.timestamp_counts.clear()
        
        for line in lines:
            timestamp_str, message = self.extract_timestamp_and_message(line)
            
            if timestamp_str and message:
                # Count message occurrences
                self.message_counts[message] += 1
                
                # Count timestamp occurrences (down to the second)
                self.timestamp_counts[timestamp_str] += 1
        
        # Detect spam messages
        for message, count in self.message_counts.items():
            if count > self.spam_threshold:
                spam_detected.append({
                    'message': message,
                    'count': count,
                    'type': 'repeated_message'
                })
        
        # Detect duplicate timestamps
        for timestamp, count in self.timestamp_counts.items():
            if count > self.duplicate_threshold:
                duplicate_timestamps.append({
                    'timestamp': timestamp,
                    'count': count,
                    'type': 'duplicate_timestamp'
                })
        
        return spam_detected, duplicate_timestamps
    
    def get_recent_logs(self, tail_lines=100):
        """Get recent logs from Docker container"""
        try:
            result = subprocess.run(
                ['docker-compose', 'logs', 'huntarr', '--tail', str(tail_lines)],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                return result.stdout.strip().split('\n')
            else:
                print(f"Error getting logs: {result.stderr}")
                return []
                
        except subprocess.TimeoutExpired:
            print("Timeout getting logs")
            return []
        except Exception as e:
            print(f"Exception getting logs: {e}")
            return []
    
    def print_report(self, spam_detected, duplicate_timestamps):
        """Print a formatted report of detected issues"""
        print(f"\n{'='*80}")
        print(f"LOG SPAM MONITOR REPORT - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*80}")
        
        if spam_detected:
            print(f"\n🚨 SPAM MESSAGES DETECTED ({len(spam_detected)} types):")
            print("-" * 60)
            for spam in spam_detected:
                print(f"  Count: {spam['count']:3d} | Message: {spam['message'][:100]}...")
        
        if duplicate_timestamps:
            print(f"\n⚠️  DUPLICATE TIMESTAMPS DETECTED ({len(duplicate_timestamps)} timestamps):")
            print("-" * 60)
            for dup in duplicate_timestamps:
                print(f"  Count: {dup['count']:3d} | Timestamp: {dup['timestamp']}")
        
        if not spam_detected and not duplicate_timestamps:
            print("\n✅ NO SPAM OR DUPLICATE TIMESTAMPS DETECTED")
            print("   Logs appear to be clean!")
        
        print(f"\nThresholds: Spam > {self.spam_threshold} messages, Duplicates > {self.duplicate_threshold} timestamps")
        print(f"{'='*80}\n")
    
    def monitor_continuously(self, interval=30):
        """Monitor logs continuously"""
        print(f"🔍 Starting continuous log monitoring (checking every {interval} seconds)")
        print(f"   Spam threshold: {self.spam_threshold} repeated messages")
        print(f"   Duplicate threshold: {self.duplicate_threshold} same timestamps")
        print("   Press Ctrl+C to stop\n")
        
        try:
            while True:
                lines = self.get_recent_logs(tail_lines=200)
                if lines:
                    spam_detected, duplicate_timestamps = self.analyze_logs(lines)
                    
                    # Only print report if issues are detected
                    if spam_detected or duplicate_timestamps:
                        self.print_report(spam_detected, duplicate_timestamps)
                    else:
                        # Just print a brief status
                        print(f"✅ {datetime.now().strftime('%H:%M:%S')} - Logs clean (checked {len(lines)} lines)")
                
                time.sleep(interval)
                
        except KeyboardInterrupt:
            print("\n\n🛑 Monitoring stopped by user")
        except Exception as e:
            print(f"\n❌ Error during monitoring: {e}")
    
    def single_check(self):
        """Perform a single check of the logs"""
        print("🔍 Performing single log spam check...")
        lines = self.get_recent_logs(tail_lines=200)
        
        if lines:
            spam_detected, duplicate_timestamps = self.analyze_logs(lines)
            self.print_report(spam_detected, duplicate_timestamps)
            
            # Return True if issues were found
            return len(spam_detected) > 0 or len(duplicate_timestamps) > 0
        else:
            print("❌ Could not retrieve logs")
            return False

def main():
    monitor = LogSpamMonitor()
    
    if len(sys.argv) > 1 and sys.argv[1] == '--continuous':
        # Continuous monitoring mode
        interval = 30
        if len(sys.argv) > 2:
            try:
                interval = int(sys.argv[2])
            except ValueError:
                print("Invalid interval, using default 30 seconds")
        
        monitor.monitor_continuously(interval)
    else:
        # Single check mode
        issues_found = monitor.single_check()
        sys.exit(1 if issues_found else 0)

if __name__ == "__main__":
    main() 