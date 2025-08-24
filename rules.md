# Huntarr Development Guidelines

Quick reference for development patterns, common issues, and critical requirements.

## 🚨 CRITICAL RULES

### 🚫 NO AUTO-COMMITTING
**NEVER automatically commit changes without explicit user approval.**
- Present fixes to user first
- Get explicit approval before committing  
- Let user decide when to commit

### 🔄 MANDATORY TESTING WORKFLOW
```bash
# ALWAYS rebuild and test changes
cd /Users/home/Huntarr/Huntarr.io && docker-compose down && COMPOSE_BAKE=true docker-compose up -d --build

# Check logs for errors
docker logs huntarr
```

### 🌐 CROSS-PLATFORM REQUIREMENTS
- **NEVER use hard-coded absolute paths** (e.g., `/config/file.json`)
- **ALWAYS use `os.path.join()`** for path construction
- **ALWAYS use relative URLs** in frontend (e.g., `./api/` not `/api/`)
- **ALWAYS test**: Docker, Windows, Mac, Linux, subpaths (`domain.com/huntarr/`)

### 🎛️ SIDEBAR NAVIGATION ARCHITECTURE
**Huntarr uses a multi-sidebar system for organized navigation:**

#### **Sidebar Types:**
1. **Main Sidebar** (`#sidebar`) - Default navigation (Home, Apps, Swaparr, Requestarr, etc.)
2. **Apps Sidebar** (`#apps-sidebar`) - App-specific navigation (Sonarr, Radarr, Lidarr, etc.)
3. **Settings Sidebar** (`#settings-sidebar`) - Settings navigation (Main, Scheduling, Notifications, Backup/Restore, User)
4. **Requestarr Sidebar** (`#requestarr-sidebar`) - Requestarr navigation (Home, History)

#### **Navigation Logic Pattern:**
```javascript
// CRITICAL: All sidebar sections must be included in initialization logic
if (this.currentSection === 'settings' || this.currentSection === 'scheduling' || 
    this.currentSection === 'notifications' || this.currentSection === 'backup-restore' || 
    this.currentSection === 'user') {
    this.showSettingsSidebar();
} else if (this.currentSection === 'requestarr' || this.currentSection === 'requestarr-history') {
    this.showRequestarrSidebar();
} else if (this.currentSection === 'apps' || this.currentSection === 'sonarr' || 
           this.currentSection === 'radarr' || this.currentSection === 'lidarr' || 
           this.currentSection === 'readarr' || this.currentSection === 'whisparr' || 
           this.currentSection === 'eros' || this.currentSection === 'prowlarr') {
    this.showAppsSidebar();
} else {
    this.showMainSidebar();
}
```

#### **Apps Navigation Behavior:**
- **Clicking "Apps"** → Automatically redirects to Sonarr (most commonly used app)
- **Apps nav item stays highlighted** when viewing any app (Sonarr, Radarr, etc.)
- **Apps sidebar provides navigation** between individual apps
- **Direct URLs still work** (`#sonarr`, `#radarr`, etc.) for bookmarking specific apps

#### **Sidebar Switching Functions:**
```javascript
showMainSidebar: function() {
    document.getElementById('sidebar').style.display = 'flex';
    document.getElementById('apps-sidebar').style.display = 'none';
    document.getElementById('settings-sidebar').style.display = 'none';
    document.getElementById('requestarr-sidebar').style.display = 'none';
},

showAppsSidebar: function() {
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('apps-sidebar').style.display = 'flex';
    document.getElementById('settings-sidebar').style.display = 'none';
    document.getElementById('requestarr-sidebar').style.display = 'none';
}
// ... etc for other sidebars
```

#### **Required Elements for New Sidebars:**
1. **HTML Structure** - Must include logo, nav-menu, return button, and section groups
2. **Navigation Logic** - Must be added to both section switching AND initialization logic
3. **localStorage Management** - Set preferences like `localStorage.setItem('huntarr-apps-sidebar', 'true')`
4. **Mobile Responsiveness** - Ensure proper display on mobile devices
5. **Return Button** - Always include return navigation to main sidebar

#### **Mobile Behavior:**
- **Desktop**: Sidebars switch seamlessly with full navigation
- **Mobile**: Sidebars collapse to icons only, maintain switching functionality
- **Touch-friendly**: All navigation elements sized appropriately for mobile interaction

## 🐛 COMMON ISSUE PATTERNS

### 1. Frontend Log Regex Issues
**Symptoms:** Logs generated but not displayed for specific apps
**Root Cause:** Malformed regex with double backslashes
**Fix:**
```javascript
// ❌ BROKEN
const logRegex = /^(?:\\[(\\w+)\\]\\s)?([\\d\\-]+\\s[\\d:]+)\\s-\\s([\\w\\.]+)\\s-\\s(\\w+)\\s-\\s(.*)$/;

// ✅ FIXED  
const logRegex = /^(?:\[(\w+)\]\s)?([^\s]+\s[^\s]+)\s-\s([\w\.]+)\s-\s(\w+)\s-\s(.*)$/;
```
**File:** `/frontend/static/js/new-main.js` - `connectEventSource()` method

### 2. DEBUG Log Filtering Race Condition
**Symptoms:** DEBUG logs appear in wrong filters (Info, Warning, Error)
**Root Cause:** EventSource adds logs without checking current filter
**Fix:** Apply filter to new entries as they arrive
```javascript
// In EventSource onmessage handler, after appendChild:
const currentLogLevel = this.elements.logLevelSelect ? this.elements.logLevelSelect.value : 'all';
if (currentLogLevel !== 'all') {
    this.applyFilterToSingleEntry(logEntry, currentLogLevel);
}
```
**File:** `/frontend/static/js/new-main.js` - `connectEventSource()` method

### 3. Database Connection Issues
**Symptoms:** "Database error", "No such table", settings not persisting
**Root Cause:** Database path issues or missing tables
**Fix:** Use DatabaseManager with environment detection
```python
# ❌ BROKEN - Direct SQLite calls with hardcoded paths
import sqlite3
conn = sqlite3.connect('/config/huntarr.db')

# ✅ FIXED - Use DatabaseManager with auto-detection
from src.primary.utils.database import DatabaseManager
db = DatabaseManager()
db.get_setting('sonarr', 'api_key')
```
**Debug Steps:**
1. Check database exists: `docker exec huntarr ls -la /config/huntarr.db`
2. Verify tables: `docker exec huntarr sqlite3 /config/huntarr.db ".tables"`
3. Check environment detection: Look for `/config` directory existence
4. Test local vs Docker paths: `./data/huntarr.db` vs `/config/huntarr.db`

### 4. Hard-Coded Path Issues (Legacy)
**Symptoms:** "Error Loading" on bare metal, works in Docker
**Root Cause:** Hard-coded Docker paths don't exist on bare metal
**Fix:** Environment detection pattern (now handled by DatabaseManager)
```python
# ❌ LEGACY - Old JSON file approach
def _detect_environment():
    return os.path.exists('/config') and os.path.exists('/app')

def _get_paths():
    if _detect_environment():
        return {'data': '/config/tally/sleep.json'}
    else:
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        return {'data': os.path.join(base_dir, 'data', 'tally', 'sleep.json')}

# ✅ NEW - Database approach
from src.primary.utils.database import DatabaseManager
db = DatabaseManager()  # Automatically detects environment and uses correct database path
```

### 4. JavaScript Variable Undefined Errors
**Symptoms:** `ReferenceError: variableName is not defined` in settings
**Root Cause:** Missing variable declarations in form generation
**Fix:** Ensure all variables are declared before use
```javascript
generateAppForm: function(container, settings = {}) {
    let instancesHtml = `...`;
    let searchSettingsHtml = `...`;  // CRITICAL - must declare
    container.innerHTML = instancesHtml + searchSettingsHtml;
}
```
**File:** `/frontend/static/js/settings_forms.js`

### 5. Subpath Compatibility Breaks
**Symptoms:** Works at root domain but fails in subdirectories
**Root Cause:** Absolute URLs in JavaScript/templates
**Fix:** Use relative URLs everywhere
```javascript
// ❌ BROKEN
window.location.href = '/';
fetch('/api/endpoint');

// ✅ FIXED
window.location.href = './';
fetch('./api/endpoint');
```

### 6. CSS Loading Order/Specificity Issues
**Symptoms:** Inline component CSS styles not applying, especially mobile responsive changes
**Root Cause:** External CSS files (`responsive-fix.css`, `new-style.css`) load after component templates and override inline styles
**Fix:** Add critical responsive CSS to external files with higher specificity
```css
/* ❌ BROKEN - Inline component CSS gets overridden */
<!-- In component template -->
<style>
.app-stats-card.swaparr .stats-numbers {
    grid-template-columns: 1fr !important;
}
</style>

/* ✅ FIXED - Add to external CSS file */
/* File: frontend/static/css/responsive-fix.css */
@media (max-width: 768px) {
    .app-stats-card.swaparr .stats-numbers {
        display: grid !important;
        grid-template-columns: 1fr !important;
        /* Debug border for testing */
        border: 2px solid lime !important;
    }
}
```
**Debugging Technique:** Use colored debug borders to confirm CSS is loading
**Files:** `/frontend/static/css/responsive-fix.css`, `/frontend/static/css/new-style.css`

### 7. Info Icon Documentation Link Issues
**Symptoms:** Info icons (i) linking to wrong domains, localhost, or broken forum links
**Root Cause:** Hard-coded old links instead of GitHub documentation links
**Fix:** Use proper GitHub documentation pattern with specific anchors
```javascript
// ❌ BROKEN - Old forum or localhost links
<label><a href="https://huntarr.io/threads/name-field.18/" class="info-icon">
<label><a href="/Huntarr.io/docs/#/configuration" class="info-icon">
<label><a href="#" class="info-icon">

// ✅ FIXED - GitHub documentation with anchors
<label><a href="https://plexguide.github.io/Huntarr.io/apps/radarr.html#instances" class="info-icon">
<label><a href="https://plexguide.github.io/Huntarr.io/apps/radarr.html#skip-future-movies" class="info-icon">
<label><a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#enable-swaparr" class="info-icon">
```
**Pattern:** `https://plexguide.github.io/Huntarr.io/apps/[app-name].html#[anchor]`
**Requirements:**
- Always use `https://plexguide.github.io/Huntarr.io/` domain
- Include `target="_blank" rel="noopener"` attributes
- Use specific anchors that match documentation headers
- Ensure documentation anchors exist before linking
**File:** `/frontend/static/js/settings_forms.js`

### 8. GitHub API Rate Limiting & Timeout Issues
**Symptoms:** Sponsor sections showing timeouts, empty data, or rate limit errors
**Root Cause:** Direct GitHub API calls from each installation hitting rate limits
**Fix:** Use GitHub Actions + static manifest approach (Matthieu's solution)
```python
# ❌ BROKEN - Direct API calls from each installation
response = requests.post('https://api.github.com/graphql', json={'query': query}, headers=headers)

# ✅ FIXED - Fetch from static manifest updated by GitHub Actions
response = requests.get("https://plexguide.github.io/Huntarr.io/manifest.json", timeout=10)
manifest_data = response.json()
sponsors = manifest_data.get('sponsors', [])
```
**Solution Pattern:**
1. **GitHub Action** runs on releases + daily schedule
2. **Fetches sponsors** using authenticated GraphQL API  
3. **Publishes manifest.json** to GitHub Pages with sponsors + version data
4. **Installations fetch** from static manifest (no authentication needed)
5. **No rate limits** since only the GitHub Action hits the API

**Benefits:**
- Each installation doesn't need GitHub API access
- No rate limiting issues for users
- Faster response times (static file vs API call)
- Automatic updates via GitHub Actions
- Fallback to cached data if manifest unavailable

**Files:** 
- `.github/workflows/update-manifest.yml` - GitHub Action workflow
- `src/primary/web_server.py` - Backend API endpoint
- GitHub Pages serves `manifest.json` automatically

## 🗄️ DATABASE ARCHITECTURE (SQLite Migration Complete)

### Overview
**Huntarr has migrated from JSON files to SQLite database for all persistent data storage.**

**Database Location:**
- **Docker:** `/config/huntarr.db` (persistent volume)
- **Local Development:** `{project_root}/data/huntarr.db`
- **Auto-detection:** Uses environment detection to choose correct path

### Database Tables & Schema
```sql
-- Settings storage (replaces settings.json)
CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(app_name, setting_key)
);

-- Stateful management (replaces stateful.json)
CREATE TABLE stateful_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tally/sleep data (replaces tally/sleep.json files)
CREATE TABLE tally_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- History tracking (replaces history.json)
CREATE TABLE history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Scheduler data (replaces scheduler.json)
CREATE TABLE scheduler_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- State management (replaces state.json)
CREATE TABLE state_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reset requests (replaces reset_requests.json)
CREATE TABLE reset_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL,
    request_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Database Manager (`src/primary/utils/database.py`)
**Core database operations with automatic environment detection:**

```python
class DatabaseManager:
    def _get_database_path(self):
        """Auto-detect environment and return appropriate database path"""
        if os.path.exists('/config'):  # Docker environment
            return '/config/huntarr.db'
        else:  # Local development
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            return os.path.join(project_root, 'data', 'huntarr.db')
    
    def get_setting(self, app_name, setting_key, default=None)
    def set_setting(self, app_name, setting_key, setting_value)
    def get_stateful_data(self, app_name, default=None)
    def set_stateful_data(self, app_name, data)
    # ... other methods for each table
```

### Local Development Setup
```bash
# 1. Set up Python virtual environment
cd /Users/home/Huntarr/Huntarr.io
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Database will be auto-created at: ./data/huntarr.db
# 4. Run locally for development
python main.py

# 5. For Docker testing
docker-compose down && COMPOSE_BAKE=true docker-compose up -d --build
```

### Migration Status
**✅ COMPLETED MIGRATIONS:**
- Settings management (settings.json → settings table)
- Stateful data (stateful.json → stateful_data table)
- Tally/sleep data (tally/*.json → tally_data table)
- History tracking (history.json → history table)
- Scheduler data (scheduler.json → scheduler_data table)
- State management (state.json → state_data table)
- Reset requests (reset_requests.json → reset_requests table)

**🗑️ REMOVED FILES:**
- All JSON files in `/data/` directory
- Migration utilities (`db_manager.py`, `migrate_configs.py`)
- Test files for migration process

### Database Debugging Commands
```bash
# Access database in Docker container
docker exec -it huntarr sqlite3 /config/huntarr.db

# Common queries for debugging
.tables                                    # List all tables
.schema settings                          # Show table schema
SELECT * FROM settings WHERE app_name='sonarr';  # Check app settings
SELECT COUNT(*) FROM history;             # Check history entries
SELECT app_name, COUNT(*) FROM settings GROUP BY app_name;  # Settings per app

# Check database file size and location
docker exec huntarr ls -la /config/huntarr.db
docker exec huntarr du -h /config/huntarr.db
```

### Database Best Practices
1. **Always use DatabaseManager class** - Never direct SQLite calls
2. **Environment detection is automatic** - Don't hardcode paths
3. **JSON data stored as TEXT** - Complex data serialized as JSON strings
4. **Timestamps are automatic** - created_at/updated_at handled by database
5. **Unique constraints prevent duplicates** - app_name combinations are unique
6. **Transactions for consistency** - DatabaseManager handles commit/rollback

## 💾 BACKUP & RESTORE SYSTEM

### Overview
**Huntarr includes a comprehensive backup and restore system for database protection and recovery.**

**Key Features:**
- **Automatic scheduled backups** based on user-defined frequency
- **Manual backup creation** with progress tracking
- **Multi-database backup** (huntarr.db, logs.db, manager.db)
- **Database integrity verification** before and after operations
- **Cross-platform backup storage** with environment detection
- **Backup retention management** with automatic cleanup
- **Safe restoration** with pre-restore backup creation

### Backup Storage Structure
```
/config/backups/                           # Docker environment
├── scheduled_backup_2025-08-24_02-05-16/  # Backup folder (timestamp-based)
│   ├── backup_info.json                   # Backup metadata
│   ├── huntarr.db                        # Main database backup
│   ├── logs.db                           # Logs database backup
│   └── manager.db                        # Manager database backup (if exists)
└── manual_backup_2025-08-24_14-30-00/    # Manual backup folder
    ├── backup_info.json
    └── [database files...]
```

**Storage Locations:**
- **Docker:** `/config/backups/` (persistent volume)
- **Windows:** `%APPDATA%/Huntarr/backups/`
- **Local Development:** `{project_root}/data/backups/`

### Backup System Architecture

#### **BackupManager Class** (`src/routes/backup_routes.py`)
```python
class BackupManager:
    def create_backup(self, backup_type='manual', name=None)  # Creates verified backup
    def restore_backup(self, backup_id)                      # Restores with pre-backup
    def list_backups(self)                                   # Lists available backups
    def delete_backup(self, backup_id)                       # Deletes specific backup
    def get_backup_settings(self)                            # Gets user settings
    def save_backup_settings(self, settings)                 # Saves user settings
    def _cleanup_old_backups(self)                           # Retention management
```

#### **BackupScheduler Class** (`src/routes/backup_routes.py`)
```python
class BackupScheduler:
    def start(self)                    # Starts background scheduler thread
    def stop(self)                     # Gracefully stops scheduler
    def _should_create_backup(self)    # Checks if backup is due
    def _scheduler_loop(self)          # Main scheduling loop (hourly checks)
```

### API Endpoints
```python
# Backup Settings
GET/POST /api/backup/settings          # Get/set backup frequency & retention

# Backup Operations  
POST /api/backup/create               # Create manual backup
GET  /api/backup/list                 # List available backups
POST /api/backup/restore              # Restore from backup
POST /api/backup/delete               # Delete specific backup
GET  /api/backup/next-scheduled       # Get next scheduled backup time

# Destructive Operations
POST /api/backup/delete-database      # Delete current database (testing/reset)
```

### Frontend Integration

#### **Settings Navigation** (`frontend/templates/components/sidebar.html`)
```html
<!-- Added to Settings Sidebar -->
<a href="./#backup-restore" class="nav-item" id="settingsBackupRestoreNav">
    <div class="nav-icon-wrapper">
        <i class="fas fa-database"></i>
    </div>
    <span>Backup / Restore</span>
</a>
```

#### **Section Handling** (`frontend/static/js/new-main.js`)
```javascript
// CRITICAL: backup-restore must be included in settings sections
if (this.currentSection === 'settings' || this.currentSection === 'scheduling' || 
    this.currentSection === 'notifications' || this.currentSection === 'backup-restore' || 
    this.currentSection === 'user') {
    this.showSettingsSidebar();
}

// Section initialization
} else if (section === 'backup-restore' && document.getElementById('backupRestoreSection')) {
    document.getElementById('backupRestoreSection').classList.add('active');
    document.getElementById('backupRestoreSection').style.display = 'block';
    if (document.getElementById('settingsBackupRestoreNav')) 
        document.getElementById('settingsBackupRestoreNav').classList.add('active');
    this.currentSection = 'backup-restore';
    this.showSettingsSidebar();
    this.initializeBackupRestore();
}
```

#### **JavaScript Module** (`frontend/static/js/backup-restore.js`)
```javascript
const BackupRestore = {
    initialize: function()              // Main initialization
    createManualBackup: function()      // Manual backup with progress
    restoreBackup: function()           // Restore with confirmations
    deleteDatabase: function()          # Destructive operation with safeguards
    loadBackupList: function()          // Refresh backup list
    validateRestoreConfirmation: function()  // "RESTORE" confirmation
    validateDeleteConfirmation: function()   // "huntarr" confirmation
}
```

### Safety & Security Features

#### **Multi-Level Confirmations**
1. **Restore Operations:**
   - Select backup from dropdown
   - Type "RESTORE" to enable button
   - Final browser confirmation dialog
   - Pre-restore backup creation

2. **Database Deletion:**
   - Type "huntarr" to enable deletion
   - Final browser confirmation dialog
   - Multiple warning messages

#### **Data Integrity**
```python
def _verify_database_integrity(self, db_path):
    """Verify database integrity using SQLite PRAGMA"""
    conn = sqlite3.connect(db_path)
    result = conn.execute("PRAGMA integrity_check").fetchone()
    return result and result[0] == "ok"
```

#### **Backup Verification Process**
1. **Pre-backup:** Force WAL checkpoint
2. **During backup:** Copy all database files
3. **Post-backup:** Verify each backup file integrity
4. **Cleanup:** Remove corrupted backups automatically

### Configuration & Settings

#### **Default Settings**
```python
backup_settings = {
    'frequency': 3,    # Days between automatic backups
    'retention': 3     # Number of backups to keep
}
```

#### **Settings Storage** (Database)
```sql
-- Stored in general_settings table
INSERT INTO general_settings (setting_key, setting_value) VALUES 
('backup_frequency', '3'),
('backup_retention', '3'),
('last_backup_time', '2025-08-24T02:05:16');
```

### Troubleshooting Backup Issues

#### **Common Problems & Solutions**

1. **Backup Directory Not Writable**
   ```python
   # System falls back to alternative locations
   # Windows: Documents/Huntarr/ if AppData fails
   # Check logs for "Database directory not writable"
   ```

2. **Database Corruption During Backup**
   ```bash
   # Check integrity manually
   docker exec huntarr sqlite3 /config/huntarr.db "PRAGMA integrity_check"
   
   # Backup system auto-detects and handles corruption
   # Creates corrupted_backup_[timestamp].db for recovery
   ```

3. **Scheduler Not Running**
   ```bash
   # Check logs for scheduler startup
   docker logs huntarr | grep -i "backup scheduler"
   
   # Should see: "Backup scheduler started"
   ```

4. **Restore Failures**
   ```python
   # System creates pre-restore backup automatically
   # Check /config/backups/ for pre_restore_backup_[timestamp] folders
   # Original data preserved even if restore fails
   ```

#### **Debugging Commands**
```bash
# Check backup directory
docker exec huntarr ls -la /config/backups/

# Verify backup integrity
docker exec huntarr sqlite3 /config/backups/[backup_folder]/huntarr.db "PRAGMA integrity_check"

# Check backup settings
docker exec huntarr sqlite3 /config/huntarr.db "SELECT * FROM general_settings WHERE setting_key LIKE 'backup_%'"

# Monitor backup scheduler
docker logs huntarr | grep -i backup
```

### Development Guidelines for Backup System

#### **Adding New Database Files**
```python
def _get_all_database_paths(self):
    """Update this method when adding new database files"""
    databases = {
        'huntarr': str(main_db_path),
        'logs': str(logs_db_path),
        'manager': str(manager_db_path),
        'new_db': str(new_db_path)  # Add new databases here
    }
    return databases
```

#### **Backup Metadata Format**
```json
{
    "id": "backup_name",
    "name": "backup_name", 
    "type": "manual|scheduled|pre-restore",
    "timestamp": "2025-08-24T02:05:16",
    "databases": [
        {
            "name": "huntarr",
            "size": 249856,
            "path": "/config/backups/backup_name/huntarr.db"
        }
    ],
    "size": 1331200
}
```

#### **Critical Requirements**
1. **Always verify backup integrity** before considering backup complete
2. **Create pre-restore backup** before any restore operation
3. **Use cross-platform paths** - never hardcode `/config/`
4. **Handle backup corruption gracefully** with user notifications
5. **Implement proper cleanup** based on retention settings
6. **Provide clear user feedback** for all operations

## 🔧 DEVELOPMENT WORKFLOW

### Before Any Changes
- [ ] Check current working directory: `/Users/home/Huntarr/Huntarr.io`
- [ ] Ensure you're on correct branch
- [ ] Review .github/listen.md for latest patterns
- [ ] **NEW:** Activate venv for local development: `source venv/bin/activate`

### Making Changes
- [ ] Edit source code (never modify inside container)
- [ ] **For local testing:** `python main.py` (uses ./data/huntarr.db)
- [ ] **For Docker testing:** `docker-compose down && COMPOSE_BAKE=true docker-compose up -d --build`
- [ ] Check logs: `docker logs huntarr`
- [ ] **NEW:** Verify database operations work in both environments
- [ ] Test functionality

### Before Committing
- [ ] Test in Docker environment (database at /config/huntarr.db)
- [ ] Test in local environment (database at ./data/huntarr.db)
- [ ] Test cross-platform compatibility
- [ ] Test subpath scenarios (`domain.com/huntarr/`)
- [ ] Check browser console for errors
- [ ] **NEW:** Verify database persistence across container restarts
- [ ] **NEW:** Test backup/restore functionality if modified:
  - [ ] Verify backup creation and integrity
  - [ ] Test backup scheduler startup
  - [ ] Verify backup directory creation (`/config/backups/`)
  - [ ] Test restore confirmation workflow
- [ ] Get user approval before committing

### Proactive Violation Scanning
**Run these before every release to catch violations early:**
```bash
# 1. Absolute URL violations (most critical for subpath deployment)
echo "=== SCANNING FOR ABSOLUTE URL VIOLATIONS ==="
grep -r "fetch('/api/" frontend/ --include="*.js" | wc -l | xargs echo "fetch() absolute URLs:"
grep -r "window.location.href.*= '/" frontend/ --include="*.js" --include="*.html" | wc -l | xargs echo "redirect absolute URLs:"

# 2. Documentation link violations  
echo "=== SCANNING FOR DOCUMENTATION LINK VIOLATIONS ==="
grep -r "href.*plexguide.github.io" frontend/ --include="*.js" | grep -v "plexguide.github.io/Huntarr.io" | wc -l | xargs echo "wrong domain links:"

# 3. Hard-coded path violations
echo "=== SCANNING FOR HARD-CODED PATH VIOLATIONS ==="
grep -r "/config" src/ --include="*.py" | grep -v "_detect_environment\|_get.*path" | wc -l | xargs echo "hard-coded /config paths:"
grep -r "/app" src/ --include="*.py" | grep -v "_detect_environment\|_get.*path" | wc -l | xargs echo "hard-coded /app paths:"

# 4. Frontend-docs alignment check
echo "=== CHECKING FRONTEND-DOCS ALIGNMENT ==="
echo "Frontend anchor references:"
grep -r "href.*plexguide\.github\.io.*#" frontend/static/js/ | grep -o "#[^\"]*" | sort | uniq | wc -l
echo "Documentation anchors available:"
grep -r 'id="[^"]*"' docs/apps/ | grep -o 'id="[^"]*"' | sort | uniq | wc -l
```

### Database & Path Hunting Commands
```bash
# Search for database violations
grep -r "sqlite3.connect\|import sqlite3" src/ --include="*.py" | grep -v "database.py"
grep -r "\.json\|json.load\|json.dump" src/ --include="*.py" | grep -v "requests.*json\|response.json\|Content-Type.*json"
grep -r "/config/.*\.db\|/app/.*\.db" src/ --include="*.py" | grep -v "DatabaseManager\|_get_database_path"

# Search for legacy hard-coded paths
grep -r "/config" src/ --include="*.py" | grep -v "_detect_environment\|_get.*path\|DatabaseManager"
grep -r "/app" src/ --include="*.py" | grep -v "_detect_environment\|_get.*path\|DatabaseManager"

# Search for frontend URL violations
grep -r "href=\"/" frontend/
grep -r "window.location.href = '/" frontend/
grep -r "fetch('/api/" frontend/ --include="*.js"
```

## 📁 KEY FILE LOCATIONS

### Backend Core
- `/src/routes.py` - API endpoints
- `/src/primary/cycle_tracker.py` - Timer functionality
- `/src/primary/utils/logger.py` - Logging configuration
- `/src/primary/utils/database.py` - **NEW:** DatabaseManager class (replaces settings_manager.py)
- `/src/routes/backup_routes.py` - **NEW:** Backup & Restore API endpoints and BackupManager

### Frontend Core  
- `/frontend/static/js/new-main.js` - Main UI logic
- `/frontend/static/js/settings_forms.js` - Settings forms
- `/frontend/static/js/backup-restore.js` - **NEW:** Backup & Restore functionality
- `/frontend/templates/components/` - UI components
- `/frontend/templates/components/backup_restore_section.html` - **NEW:** Backup & Restore UI

### Database & Storage
- `/config/huntarr.db` - **Docker:** Main database file (persistent)
- `./data/huntarr.db` - **Local:** Main database file (development)
- `/config/backups/` - **Docker:** Backup storage directory (persistent)
- `./data/backups/` - **Local:** Backup storage directory (development)
- `/src/primary/utils/database.py` - DatabaseManager with auto-detection
- **REMOVED:** All JSON files (settings.json, stateful.json, etc.)

### Critical Files for Cross-Platform
- `/src/primary/utils/database.py` - **NEW:** Database operations with environment detection
- `/src/primary/cycle_tracker.py` - Timer functionality (now uses database)
- Any `*_routes.py` files

## 🎯 DEBUGGING QUICK REFERENCE

### Systematic Issue Discovery
**When things don't work, don't guess - scan systematically:**
```bash
# 1. Check for violation patterns first
./violation_scan.sh  # From proactive practices above

# 2. Specific issue hunting
grep -r "EXACT_ERROR_TEXT" frontend/ src/ --include="*.js" --include="*.py"
grep -r "functionName\|variableName" frontend/ --include="*.js"
```

### Subpath Deployment Issues
**Symptoms:** Works on localhost, fails on domain.com/huntarr/
**Root Cause:** Absolute URLs that don't work in subdirectories
**Debug Process:**
1. Check browser network tab for 404s on absolute URLs
2. Search for absolute patterns: `grep -r "fetch('/api" frontend/`
3. Check redirects: `grep -r "window.location.href.*= '/" frontend/`
4. Verify all URLs are relative: `./api/` not `/api/`

### Frontend-Documentation Link Issues  
**Symptoms:** Info icons (i) lead to 404 or wrong pages
**Root Cause:** Mismatched frontend links vs documentation anchors
**Debug Process:**
1. Extract frontend anchor references: `grep -r "href.*#" frontend/static/js/ | grep -o "#[^\"]*"`
2. Extract doc anchors: `grep -r 'id="[^"]*"' docs/ | grep -o 'id="[^"]*"'`
3. Compare lists to find mismatches
4. Add missing anchors or fix links

### Log Issues
1. Check logs in database: `docker exec huntarr python3 -c "import sys; sys.path.insert(0, '/app/src'); from primary.utils.logs_database import get_logs_database; db = get_logs_database(); logs = db.get_logs(limit=10); [print(f'{log[\"timestamp\"]} - {log[\"app_type\"]} - {log[\"level\"]} - {log[\"message\"]}') for log in logs]"`
2. Test backend streaming: `curl -N -s "http://localhost:9705/logs?app=[app]"`
3. Check browser console for JavaScript errors
4. Verify regex patterns in `new-main.js`

### Database Issues
1. **Check database exists and is accessible:**
   ```bash
   # Docker environment
   docker exec huntarr ls -la /config/huntarr.db
   docker exec huntarr sqlite3 /config/huntarr.db ".tables"
   
   # Local environment
   ls -la ./data/huntarr.db
   sqlite3 ./data/huntarr.db ".tables"
   ```

2. **Verify table schemas and data:**
   ```bash
   # Check specific table structure
   docker exec huntarr sqlite3 /config/huntarr.db ".schema settings"
   
   # Check data exists
   docker exec huntarr sqlite3 /config/huntarr.db "SELECT COUNT(*) FROM settings;"
   docker exec huntarr sqlite3 /config/huntarr.db "SELECT app_name, COUNT(*) FROM settings GROUP BY app_name;"
   ```

3. **Test DatabaseManager operations:**
   ```python
   # In Python console or test script
   from src.primary.utils.database import DatabaseManager
   db = DatabaseManager()
   
   # Test basic operations
   db.set_setting('test_app', 'test_key', 'test_value')
   result = db.get_setting('test_app', 'test_key')
   print(f"Database test result: {result}")
   ```

4. **Check environment detection:**
   ```python
   import os
   print(f"Docker environment detected: {os.path.exists('/config')}")
   print(f"Database path would be: {'/config/huntarr.db' if os.path.exists('/config') else './data/huntarr.db'}")
   ```

5. **Database migration verification:**
   ```bash
   # Ensure no old JSON files exist
   find . -name "*.json" -path "./data/*" 2>/dev/null || echo "No JSON files found (good)"
   
   # Check database size (should be > 0 if data exists)
   docker exec huntarr du -h /config/huntarr.db
   ```

### Path Issues (Legacy)
1. Check environment detection logic
2. Verify paths exist in target environment  
3. Test with both Docker and bare metal
4. Check file permissions
5. **LEGACY:** Scan for hard-coded paths: `grep -r "/config\|/app" src/ | grep -v "_detect_environment"`
6. **NEW:** Use DatabaseManager instead of direct file operations

### JavaScript Issues
1. Check browser console for errors
2. Search for undefined variables: `grep -r "variableName" frontend/`
3. Verify HTML structure matches selectors
4. Compare with working functions
5. **NEW:** Check for absolute URL patterns causing 404s in subpaths

### CSS Issues
1. Check browser console for errors
2. Add debug borders: `border: 2px solid lime !important;`
3. Verify CSS loading order (external files vs inline)
4. Test specificity with `!important` declarations
5. Search for conflicting rules: `grep -r "className" frontend/static/css/`

### Settings Issues
1. Check form generation functions
2. Verify `getFormSettings()` method
3. Test save/load cycle
4. Check API endpoints
5. **NEW:** Verify info icon links point to existing documentation anchors

### Documentation Issues
**Symptoms:** Broken links, 404s, outdated information
**Debug Process:**
1. Test all links manually or with link checker
2. Verify features mentioned actually exist in codebase
3. Check frontend alignment with documentation
4. Audit FAQ against real support requests

## 📊 RECENT IMPROVEMENTS

### Systematic Code Violation Fixes (2024-12)
**Issue:** 71 systematic code violations discovered through comprehensive codebase analysis
**Root Cause:** Lack of proactive violation scanning and systematic fixing approach
**Solution:** Implemented systematic approach to finding and fixing violations

**Fixed Violations:**
1. **51 absolute fetch URLs** - All `/api/` calls converted to `./api/` for subpath compatibility
2. **15 outdated documentation links** - Fixed old domain references in settings_forms.js
3. **5 window.location.href absolute URLs** - Converted `/` redirects to `./` 
4. **Missing documentation anchors** - Added proper IDs to all referenced doc sections

**Key Files Modified:**
- `/frontend/static/js/settings_forms.js` - Documentation links and form generation
- `/frontend/static/js/new-main.js` - URL handling and redirects
- `/frontend/static/js/apps.js` - API calls and fetch operations
- All documentation files - Added missing anchor IDs

**Prevention Strategy:** Use systematic grep searches to catch violations early:
```bash
# Catch absolute URLs before they become problems
grep -r "fetch('/api/" frontend/ --include="*.js"
grep -r "window.location.href.*= '/" frontend/ --include="*.js" --include="*.html"
grep -r "href.*plexguide.github.io" frontend/ --include="*.js" | grep -v "plexguide.github.io/Huntarr.io"
```

### Documentation Reality Check & User Experience (2024-12)
**Issue:** Documentation promised features that didn't exist (standalone logs/history pages)
**Root Cause:** Feature documentation grew organically without reality checks
**Solution:** Systematic audit of promised vs actual features

**Changes:**
- Removed broken links to non-existent logs.html and history.html
- Updated features page to reflect actual functionality (Swaparr, Search Automation)
- Completely rewrote FAQ with real-world Docker problems and practical solutions
- Added prominent community help section on homepage with proper user flow

**Lessons Learned:**
- **Document what exists, not what's planned** - Only link to documentation that actually exists
- **FAQ should solve real problems** - Base content on actual support requests, not theoretical issues
- **User journey matters** - Help → Explanation → Setup → Community is better than promotional content

### Frontend-Documentation Alignment System (2024-12)
**Issue:** Frontend info icons linked to anchors that didn't exist in documentation
**Root Cause:** No systematic checking of frontend links against actual documentation
**Solution:** Implemented verification system for frontend→docs alignment

**Process:**
1. Extract all documentation links from frontend: `grep -r "plexguide.github.io.*#" frontend/`
2. Extract all anchor IDs from docs: `grep -r 'id="[^"]*"' docs/`
3. Cross-reference and fix mismatches
4. Add missing anchor IDs where content exists but ID missing

**Prevention:** Before any documentation changes, verify link alignment:
```bash
# Extract frontend links
grep -r "href.*plexguide\.github\.io.*#" frontend/static/js/ | grep -o "#[^\"]*" | sort | uniq

# Extract doc anchors  
grep -r 'id="[^"]*"' docs/apps/ | grep -o 'id="[^"]*"' | sort | uniq

# Compare results to catch mismatches
```

### Radarr Release Date Consistency (2024-12)
**Issue:** Missing movie searches respected `skip_future_releases` setting, but upgrade searches ignored it
**Solution:** Made upgrade behavior consistent with missing movie logic
**Changes:**
- Updated `src/primary/apps/radarr/upgrade.py` to check release dates
- Both missing and upgrade searches now respect `skip_future_releases` and `process_no_release_dates`
- Documentation updated to clarify behavior affects both search types

### Apps Navigation Redesign (2024-12)
**Issue:** Apps section showed a dashboard that users had to navigate through to reach individual app settings
**User Feedback:** "Instead of an apps dashboard; make it where when a user clicks apps, it goes to the sonarr apps being selected by default"
**Solution:** Direct navigation to Sonarr when clicking Apps, eliminating the dashboard step

**Implementation Changes:**

1. **Modified Apps Section Navigation** (`frontend/static/js/new-main.js`):
   ```javascript
   // OLD: Showed apps dashboard
   } else if (section === 'apps') {
       document.getElementById('appsSection').classList.add('active');
       // ... dashboard logic
   
   // NEW: Direct redirect to Sonarr
   } else if (section === 'apps') {
       console.log('[huntarrUI] Apps section requested - redirecting to Sonarr by default');
       this.switchSection('sonarr');
       window.location.hash = '#sonarr';
       return;
   ```

2. **Updated Navigation Highlighting** (`frontend/templates/components/sidebar.html`):
   ```javascript
   // Keep "Apps" nav item active when viewing Sonarr
   } else if (currentHash === '#apps' || currentHash === '#sonarr') {
       selector = '#appsNav';
   ```

3. **Preserved Apps Sidebar Functionality**:
   - Apps sidebar still provides navigation between all apps (Sonarr, Radarr, Lidarr, etc.)
   - Return button allows going back to main navigation
   - Individual app sections remain fully functional

**User Experience Improvements:**
- **Faster Access**: Click "Apps" → Immediately see Sonarr settings (most commonly used)
- **Intuitive Navigation**: Apps nav item stays highlighted when viewing any app
- **Preserved Functionality**: All apps still accessible via Apps sidebar
- **Consistent Behavior**: Maintains existing sidebar switching patterns

**Navigation Flow:**
```
Main Sidebar: Apps → Sonarr (default)
Apps Sidebar: Sonarr ↔ Radarr ↔ Lidarr ↔ Readarr ↔ Whisparr V2 ↔ Whisparr V3 ↔ Prowlarr
```

**Files Modified:**
- `frontend/static/js/new-main.js` - Apps section redirect logic
- `frontend/templates/components/sidebar.html` - Navigation highlighting logic
- Removed dashboard functionality from `frontend/templates/components/apps_section.html`

**Benefits:**
- Eliminates unnecessary dashboard step
- Provides direct access to most commonly used app (Sonarr)
- Maintains all existing functionality through sidebar navigation
- Improves user workflow efficiency
- Frontend info icons fixed to use GitHub documentation links

**User Benefit:** Consistent behavior - no more unexpected future movie upgrades

### Complete Database Migration (2024-12)
**Issue:** JSON file-based storage caused data loss, concurrency issues, and deployment complexity
**Root Cause:** Multiple JSON files scattered across filesystem with no transactional consistency
**Solution:** Complete migration to SQLite database with automatic environment detection

**Migration Scope:**
- **Settings:** `settings.json` → `settings` table (7 tables total)
- **Stateful Data:** `stateful.json` → `stateful_data` table  
- **Tally/Sleep:** `tally/*.json` → `tally_data` table
- **History:** `history.json` → `history` table
- **Scheduler:** `scheduler.json` → `scheduler_data` table
- **State:** `state.json` → `state_data` table
- **Reset Requests:** `reset_requests.json` → `reset_requests` table

**Key Improvements:**
- **Persistent Storage:** Database survives container updates/rebuilds
- **Environment Detection:** Auto-detects Docker vs local development
- **Transactional Consistency:** ACID compliance prevents data corruption
- **Simplified Deployment:** Single database file instead of multiple JSON files
- **Better Performance:** SQLite indexing and query optimization
- **Automatic Timestamps:** created_at/updated_at handled by database

**Database Locations:**
- **Docker:** `/config/huntarr.db` (persistent volume)
- **Local:** `{project_root}/data/huntarr.db`
- **Auto-detection:** Uses `/config` directory existence to choose path

**Development Impact:**
- **Local Setup:** Added `venv` requirement for Python dependencies
- **Testing:** Must verify both Docker and local database operations
- **Debugging:** New SQLite commands for data inspection
- **No Backward Compatibility:** JSON files completely removed

**Files Modified:**
- `src/primary/utils/database.py` - New DatabaseManager class
- All app modules updated to use DatabaseManager instead of JSON
- Development workflow updated for dual-environment testing
- Removed migration utilities after completion

**User Benefits:**
- ✅ No more data loss on container recreation
- ✅ Faster application startup (no JSON parsing)
- ✅ Consistent data across app restarts
- ✅ Better error handling and recovery
- ✅ Simplified backup (single database file)

## ⚠️ ANTI-PATTERNS TO AVOID

1. **❌ Direct SQLite calls:** Use DatabaseManager class, never `sqlite3.connect()` directly
2. **❌ Hard-coded database paths:** `/config/huntarr.db` - Use DatabaseManager auto-detection
3. **❌ JSON file operations:** All data storage must use database tables
4. **❌ Absolute URLs in frontend:** `/api/endpoint`, `window.location.href = '/'`
5. **❌ Modifying files inside containers**
6. **❌ Creating temporary/helper files instead of fixing source**
7. **❌ Auto-committing without approval**
8. **❌ Double backslashes in regex patterns**
9. **❌ Testing only in Docker (must test bare metal with local database)**
10. **❌ Adding responsive CSS to component templates (use external CSS files)**
11. **❌ Not using debug borders to test CSS loading**
12. **❌ Inconsistent behavior between missing/upgrade logic** - Always check both implement same filtering
13. **❌ Reactive violation fixing** - Don't wait for problems to appear, scan proactively
14. **❌ Documentation that promises non-existent features** - Only document what actually exists
15. **❌ Frontend links without verifying documentation anchors exist** - Always cross-check
16. **❌ Organic feature growth without reality checks** - Audit promised vs actual features regularly
17. **❌ Theoretical FAQ content** - Base FAQ on real user problems and support requests
18. **❌ Skipping venv activation** - Always use virtual environment for local development
19. **❌ Not testing database persistence** - Verify data survives container restarts

## 🚨 PROACTIVE DEVELOPMENT PRACTICES

### Pre-Commit Violation Scanning
**ALWAYS run before any commit to catch violations early:**
```bash
# Create violation_scan.sh for easy reuse
echo "=== HUNTARR VIOLATION SCAN ==="
echo "1. Absolute URL violations (breaks subpath deployment):"
echo "   fetch() absolute URLs: $(grep -r "fetch('/api/" frontend/ --include="*.js" | wc -l)"
echo "   redirect absolute URLs: $(grep -r "window.location.href.*= '/" frontend/ --include="*.js" --include="*.html" | wc -l)"
echo ""
echo "2. Documentation violations:"
echo "   Wrong domain links: $(grep -r "href.*plexguide.github.io" frontend/ --include="*.js" | grep -v "plexguide.github.io/Huntarr.io" | wc -l)"
echo ""
echo "3. Database violations:"
echo "   Direct SQLite calls: $(grep -r "sqlite3.connect\|import sqlite3" src/ --include="*.py" | grep -v "database.py" | wc -l)"
echo "   JSON file operations: $(grep -r "\.json\|json.load\|json.dump" src/ --include="*.py" | grep -v "requests.*json\|response.json\|Content-Type.*json" | wc -l)"
echo "   Hard-coded DB paths: $(grep -r "/config/.*\.db\|/app/.*\.db" src/ --include="*.py" | grep -v "DatabaseManager\|_get_database_path" | wc -l)"
echo ""
echo "4. Legacy path violations:"
echo "   /config paths: $(grep -r "/config" src/ --include="*.py" | grep -v "_detect_environment\|_get.*path\|DatabaseManager" | wc -l)"
echo "   /app paths: $(grep -r "/app" src/ --include="*.py" | grep -v "_detect_environment\|_get.*path\|DatabaseManager" | wc -l)"
echo ""
echo "5. Frontend-docs alignment:"
echo "   Frontend anchors: $(grep -r "href.*plexguide\.github\.io.*#" frontend/static/js/ 2>/dev/null | grep -o "#[^\"]*" | sort | uniq | wc -l)"
echo "   Doc anchors: $(grep -r 'id="[^"]*"' docs/apps/ 2>/dev/null | grep -o 'id="[^"]*"' | sort | uniq | wc -l)"
echo "=== SCAN COMPLETE ==="
```

### Documentation Reality Audit Process
**Before any documentation changes:**
1. **Verify features exist**: Don't document planned features, only existing ones
2. **Check all links work**: Test every link in documentation
3. **Verify frontend alignment**: Ensure info icons point to existing anchors
4. **FAQ reality check**: Base content on actual support requests, not theoretical issues

**Commands to audit documentation:**
```bash
# 1. Find all links in documentation
grep -r "href=" docs/ | grep -v "^#" | cut -d'"' -f2 | sort | uniq

# 2. Find all frontend documentation links
grep -r "plexguide.github.io" frontend/static/js/ | grep -o "https://[^\"]*"

# 3. Check anchor mismatches
diff <(grep -r "href.*#" frontend/static/js/ | grep -o "#[^\"]*" | sort | uniq) \
     <(grep -r 'id="[^"]*"' docs/ | grep -o 'id="[^"]*"' | sed 's/id="//' | sed 's/"$//' | sort | uniq)
```

### User Experience Validation
**Before major UI changes:**
1. **Test user journey**: Help → Explanation → Setup → Community
2. **Verify community links work**: Discord, GitHub Issues, Reddit
3. **Check mobile responsiveness**: Test all breakpoints
4. **Validate against real user problems**: Base features on actual use cases

## 🚀 DATABASE-FIRST DEVELOPMENT PATTERN

**Use DatabaseManager for all data operations - no direct file operations needed:**

```python
# ✅ CORRECT - Use DatabaseManager (handles environment detection automatically)
from src.primary.utils.database import DatabaseManager

db = DatabaseManager()  # Auto-detects Docker vs local environment

# Settings operations
db.set_setting('sonarr', 'api_key', 'your_api_key')
api_key = db.get_setting('sonarr', 'api_key')

# Stateful data operations  
db.set_stateful_data('sonarr', {'last_run': '2024-12-25'})
state = db.get_stateful_data('sonarr', {})

# History operations
db.add_history('sonarr', 'search_completed', 'Found 5 missing episodes')
history = db.get_history('sonarr', limit=10)
```

**Legacy Environment Detection (for non-database operations only):**
```python
import os

def _detect_environment():
    """Detect if running in Docker or bare metal"""
    return os.path.exists('/config')  # Simplified - just check /config

def _get_cross_platform_path(relative_path):
    """Get appropriate path based on environment (for logs, temp files only)"""
    if _detect_environment():
        # Docker environment
        return os.path.join('/config', relative_path)
    else:
        # Bare metal environment  
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        return os.path.join(project_root, 'data', relative_path)
```

**Note:** Only use legacy pattern for non-database files (logs, temp files). All persistent data should use DatabaseManager.

## 📝 MEMORY GUIDELINES

**Create memories for:**
- ✅ Bug fixes with root cause analysis
- ✅ New features
- ✅ Cross-platform compatibility fixes
- ✅ Performance improvements

**Format:**
```
Title: Brief description
Content: Root cause, files modified, solution approach, testing notes
Tags: ["bug_fix", "feature", "frontend", "backend"]
```

---

*Quick reference for Huntarr development. Update when new patterns are discovered.*
