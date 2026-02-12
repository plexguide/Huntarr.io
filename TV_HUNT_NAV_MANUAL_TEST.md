# TV Hunt Navigation - Manual Testing Guide
**URL:** http://10.0.0.10:9720  
**Date:** 2026-02-12

---

## ⚠️ IMPORTANT: Browser Automation Unavailable

Due to MCP configuration limitations, I cannot directly interact with the browser. Please follow this manual testing guide.

---

## TV Hunt Sidebar Structure (From Code)

Based on the actual HTML template, the TV Hunt sidebar has this structure:

```
TV Hunt Sidebar
├── Huntarr
│   └── Home
├── TV Hunt
│   ├── TV Collection
│   │   └── Calendar (sub-item)
│   ├── Activity
│   │   ├── Queue
│   │   ├── History
│   │   ├── Blocklist
│   │   └── Logs
│   └── Settings
│       ├── TV Management
│       ├── Profiles
│       ├── Sizes
│       ├── Custom Formats
│       ├── Indexers
│       ├── Clients
│       ├── Import Lists
│       └── Root Folders
```

---

## Navigation URLs (From Code)

| Nav Item | Expected URL | Element ID |
|----------|-------------|------------|
| TV Collection | `#tv-hunt-collection` | `tvHuntCollectionNav` |
| Calendar | `#tv-hunt-calendar` | `tvHuntCalendarNav` |
| Activity (parent) | `#tv-hunt-activity-queue` | `tvHuntActivityNav` |
| Queue | `#tv-hunt-activity-queue` | `tvHuntActivityQueueNav` |
| History | `#tv-hunt-activity-history` | `tvHuntActivityHistoryNav` |
| Blocklist | `#tv-hunt-activity-blocklist` | `tvHuntActivityBlocklistNav` |
| Logs | `#logs-tv-hunt` | `tvHuntLogsNav` |
| Settings (parent) | `#tv-hunt-settings` | `tvHuntSettingsNav` |
| TV Management | `#tv-hunt-settings-tv-management` | `tvHuntSettingsTVManagementNav` |
| Profiles | `#tv-hunt-settings-profiles` | `tvHuntSettingsProfilesNav` |
| Sizes | `#tv-hunt-settings-sizes` | `tvHuntSettingsSizesNav` |
| Custom Formats | `#tv-hunt-settings-custom-formats` | `tvHuntSettingsCustomFormatsNav` |
| Indexers | `#tv-hunt-settings-indexers` | `tvHuntSettingsIndexersNav` |
| Clients | `#tv-hunt-settings-clients` | `tvHuntSettingsClientsNav` |
| Import Lists | `#tv-hunt-settings-import-lists` | `tvHuntSettingsImportListsNav` |
| Root Folders | `#tv-hunt-settings-root-folders` | `tvHuntSettingsRootFoldersNav` |

---

## 🎯 Quick Test (2 minutes)

### Prerequisites
1. Open http://10.0.0.10:9720 in browser
2. Navigate to TV Hunt section (click "TV Hunt" in main sidebar or go to `#tv-hunt-collection`)
3. Verify TV Hunt sidebar is visible on the left

### Quick Navigation Test

**Test 1: Settings Expansion**
1. Click "Settings" in TV Hunt sidebar
2. ✅ Expected: Settings sub-items expand (8 items visible)
3. ❌ If fails: Settings section doesn't expand, or sub-items don't appear

**Test 2: Navigate to Profiles**
1. Click "Profiles" under Settings
2. ✅ Expected: URL changes to `#tv-hunt-settings-profiles`, Profiles section loads
3. ❌ If fails: Nothing happens, wrong page loads, or console errors

**Test 3: Navigate to Queue**
1. Click "Activity" to expand (if not already expanded)
2. Click "Queue" under Activity
3. ✅ Expected: URL changes to `#tv-hunt-activity-queue`, Queue section loads
4. ❌ If fails: Nothing happens, wrong page loads, or console errors

**Test 4: Back to Collection**
1. Click "TV Collection" in sidebar
2. ✅ Expected: URL changes to `#tv-hunt-collection`, Collection view loads
3. ❌ If fails: Nothing happens, wrong page loads, or console errors

**Test 5: Console Check**
1. Press F12 to open DevTools
2. Go to Console tab
3. ✅ Expected: No red JavaScript errors
4. ❌ If fails: Errors like "switchSection is not defined" or "Cannot read property..."

---

## 📋 Complete Test Sequence (15 minutes)

### Step 1: Initial Setup
**Action:** Navigate to http://10.0.0.10:9720/#tv-hunt-collection

**Check:**
- [ ] Page loads without errors
- [ ] TV Hunt sidebar visible on left
- [ ] TV Collection view visible in main area
- [ ] Browser console clean (F12 → Console)

**Screenshot:** `01-tv-hunt-initial.png`

---

### Step 2: Home Navigation
**Action:** Click "Home" under Huntarr section

**Check:**
- [ ] URL changes to `#home`
- [ ] Main Huntarr home page loads
- [ ] Can navigate back to TV Hunt

**Screenshot:** `02-home-nav.png`

---

### Step 3: TV Collection
**Action:** Click "TV Collection" in TV Hunt section

**Check:**
- [ ] URL is `#tv-hunt-collection`
- [ ] Collection view loads
- [ ] Shows TV shows or empty state
- [ ] Instance selector visible (if instances configured)

**Screenshot:** `03-tv-collection.png`

---

### Step 4: Calendar Sub-Item
**Action:** Click "Calendar" under TV Collection

**Check:**
- [ ] URL changes to `#tv-hunt-calendar`
- [ ] Calendar view loads
- [ ] Shows upcoming episodes or empty state

**Screenshot:** `04-calendar.png`

---

### Step 5: Activity - Queue
**Action:** Click "Activity" to expand, then click "Queue"

**Check:**
- [ ] Activity section expands (if not already)
- [ ] URL changes to `#tv-hunt-activity-queue`
- [ ] Queue view loads
- [ ] Shows download queue or "No items in queue"

**Screenshot:** `05-queue.png`

---

### Step 6: Activity - History
**Action:** Click "History" under Activity

**Check:**
- [ ] URL changes to `#tv-hunt-activity-history`
- [ ] History view loads
- [ ] Shows history table or empty state
- [ ] Columns: Show, Episode, Quality, Date, Status

**Screenshot:** `06-history.png`

---

### Step 7: Activity - Blocklist
**Action:** Click "Blocklist" under Activity

**Check:**
- [ ] URL changes to `#tv-hunt-activity-blocklist`
- [ ] Blocklist view loads
- [ ] Shows blocked releases or empty state
- [ ] Clear Blocklist button visible

**Screenshot:** `07-blocklist.png`

---

### Step 8: Activity - Logs
**Action:** Click "Logs" under Activity

**Check:**
- [ ] URL changes to `#logs-tv-hunt`
- [ ] Logs view loads
- [ ] Shows log entries with timestamp, level, message
- [ ] Refresh button visible
- [ ] Filter options visible

**Screenshot:** `08-logs.png`

---

### Step 9: Settings Expansion
**Action:** Click "Settings" in TV Hunt sidebar

**Check:**
- [ ] Settings section expands
- [ ] 8 sub-items visible:
  - [ ] TV Management
  - [ ] Profiles
  - [ ] Sizes
  - [ ] Custom Formats
  - [ ] Indexers
  - [ ] Clients
  - [ ] Import Lists
  - [ ] Root Folders
- [ ] No console errors

**Screenshot:** `09-settings-expanded.png`

**⚠️ Note:** Settings sub-items only appear if TV Hunt instances are configured. If no instances, the sub-menu stays hidden (by design, see line 220 in sidebar.html).

---

### Step 10: Settings - TV Management
**Action:** Click "TV Management" under Settings

**Check:**
- [ ] URL changes to `#tv-hunt-settings-tv-management`
- [ ] TV Management settings page loads
- [ ] Shows settings form with options like:
  - [ ] Episode Title Required
  - [ ] Ignore Deleted Episodes
  - [ ] Download Propers
  - [ ] Analyze Video Files
  - [ ] Rescan After Refresh
- [ ] Save button visible

**Screenshot:** `10-tv-management.png`

---

### Step 11: Settings - Profiles
**Action:** Click "Profiles" under Settings

**Check:**
- [ ] URL changes to `#tv-hunt-settings-profiles`
- [ ] Profiles section loads
- [ ] Shows quality profiles list or empty state
- [ ] Add Profile button visible
- [ ] Each profile shows name, quality settings

**Screenshot:** `11-profiles.png`

---

### Step 12: Settings - Sizes
**Action:** Click "Sizes" under Settings

**Check:**
- [ ] URL changes to `#tv-hunt-settings-sizes`
- [ ] Sizes section loads
- [ ] Shows min/max file size settings
- [ ] Save button visible

**Screenshot:** `12-sizes.png`

---

### Step 13: Settings - Custom Formats
**Action:** Click "Custom Formats" under Settings

**Check:**
- [ ] URL changes to `#tv-hunt-settings-custom-formats`
- [ ] Custom Formats section loads
- [ ] Shows custom formats list or empty state
- [ ] Add Custom Format button visible

**Screenshot:** `13-custom-formats.png`

---

### Step 14: Settings - Indexers
**Action:** Click "Indexers" under Settings

**Check:**
- [ ] URL changes to `#tv-hunt-settings-indexers`
- [ ] Indexers section loads
- [ ] Shows indexer list or empty state
- [ ] Add Indexer button visible
- [ ] Each indexer shows name, status, priority

**Screenshot:** `14-indexers.png`

---

### Step 15: Settings - Clients
**Action:** Click "Clients" under Settings

**Check:**
- [ ] URL changes to `#tv-hunt-settings-clients`
- [ ] Download Clients section loads
- [ ] Shows client list or empty state
- [ ] Add Client button visible
- [ ] Each client shows name, type, host

**Screenshot:** `15-clients.png`

---

### Step 16: Settings - Import Lists
**Action:** Click "Import Lists" under Settings

**Check:**
- [ ] URL changes to `#tv-hunt-settings-import-lists`
- [ ] Import Lists section loads
- [ ] Shows import list configuration or empty state
- [ ] Add Import List button visible

**Screenshot:** `16-import-lists.png`

---

### Step 17: Settings - Root Folders
**Action:** Click "Root Folders" under Settings

**Check:**
- [ ] URL changes to `#tv-hunt-settings-root-folders`
- [ ] Root Folders section loads
- [ ] Shows root folder list or empty state
- [ ] Add Root Folder button visible
- [ ] Each folder shows path, free space

**Screenshot:** `17-root-folders.png`

---

### Step 18: Navigate Back to Collection
**Action:** Click "TV Collection" in sidebar

**Check:**
- [ ] URL changes back to `#tv-hunt-collection`
- [ ] Collection view loads
- [ ] Settings section collapses or stays expanded
- [ ] No console errors

**Screenshot:** `18-back-to-collection.png`

---

## 🔍 Known Issues to Check

### Issue 1: Settings Sub-Items Hidden
**Symptom:** Clicking "Settings" doesn't show sub-items  
**Cause:** No TV Hunt instances configured (by design)  
**Solution:** Configure at least one TV Hunt instance first

**Code Reference:** Lines 215-227 in sidebar.html
```javascript
fetch('./api/tv-hunt/instances')
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var instances = data.instances || [];
        var hasInstances = instances.length > 0;
        subGroup.style.display = hasInstances ? '' : 'none';
        // Settings sub-menu only shows if instances exist
    })
```

### Issue 2: Logs Navigation Different
**Symptom:** Logs URL is `#logs-tv-hunt` not `#tv-hunt-activity-logs`  
**Cause:** Logs use a different routing pattern  
**Expected:** This is by design (shared logs page)

### Issue 3: Activity Parent Click
**Symptom:** Clicking "Activity" navigates to Queue  
**Cause:** Activity parent has href to Queue (line 149-151)  
**Expected:** This is by design (parent click goes to first sub-item)

---

## 📊 Test Results Template

### Navigation Test Results

| # | Nav Item | URL | Loads? | Highlighted? | Notes |
|---|----------|-----|--------|--------------|-------|
| 1 | Home | `#home` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 2 | TV Collection | `#tv-hunt-collection` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 3 | Calendar | `#tv-hunt-calendar` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 4 | Queue | `#tv-hunt-activity-queue` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 5 | History | `#tv-hunt-activity-history` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 6 | Blocklist | `#tv-hunt-activity-blocklist` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 7 | Logs | `#logs-tv-hunt` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 8 | TV Management | `#tv-hunt-settings-tv-management` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 9 | Profiles | `#tv-hunt-settings-profiles` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 10 | Sizes | `#tv-hunt-settings-sizes` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 11 | Custom Formats | `#tv-hunt-settings-custom-formats` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 12 | Indexers | `#tv-hunt-settings-indexers` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 13 | Clients | `#tv-hunt-settings-clients` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 14 | Import Lists | `#tv-hunt-settings-import-lists` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |
| 15 | Root Folders | `#tv-hunt-settings-root-folders` | ⬜ Yes / ⬜ No | ⬜ Yes / ⬜ No | |

### Summary

**Total Items:** 15  
**Passed:** ___ / 15  
**Failed:** ___ / 15  
**Critical Issues:** ___  
**Major Issues:** ___  
**Minor Issues:** ___  

**Console Errors:** ⬜ None / ⬜ Some / ⬜ Many

**Overall Status:** ⬜ Pass / ⬜ Fail / ⬜ Pass with Issues

---

## 🐛 Issue Report Template

### Issue #1
**Nav Item:** [Item name]  
**Severity:** ⬜ Critical / ⬜ Major / ⬜ Minor / ⬜ Cosmetic  
**Description:** [What went wrong]  
**Expected:** [What should happen]  
**Actual:** [What actually happened]  
**Screenshot:** [filename]  
**Console Error:** [Copy error message if any]  
**Reproducible:** ⬜ Always / ⬜ Sometimes / ⬜ Once  

**Steps to Reproduce:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

---

## 🚀 Quick API Test

Before testing navigation, verify TV Hunt is accessible:

```bash
# Check if TV Hunt instances exist
curl -s http://10.0.0.10:9720/api/tv-hunt/instances | jq '.'

# Expected: {"instances": [...]} or {"instances": []}
# If 404: TV Hunt may not be fully configured
```

---

## ✅ Success Criteria

**Must Pass:**
- [ ] All 15 navigation items load correct page
- [ ] URL changes correctly for each item
- [ ] Active item highlighted in sidebar
- [ ] No JavaScript console errors
- [ ] Settings sub-items appear (if instances configured)
- [ ] Activity sub-items appear
- [ ] Can navigate back to Collection from any page

**Should Pass:**
- [ ] Navigation responds in <500ms
- [ ] No visual glitches during navigation
- [ ] Browser back button works
- [ ] Refresh preserves current page
- [ ] Sub-groups expand/collapse smoothly

**Nice to Pass:**
- [ ] Smooth animations
- [ ] Keyboard navigation works (Tab, Enter)
- [ ] Works in all browsers (Chrome, Firefox, Safari)

---

## 📝 Tester Sign-Off

**Tester Name:** ___________________  
**Date:** ___________________  
**Time Spent:** ___ minutes  
**Browser:** Chrome / Firefox / Safari / Edge  
**Browser Version:** ___________________  

**Recommendation:**
- [ ] Ready for use
- [ ] Minor issues, usable
- [ ] Major issues, needs fixes
- [ ] Critical issues, unusable

**Signature:** ___________________

---

## 📚 Additional Resources

- **Full QA Checklist:** `QA_TEST_CHECKLIST.md`
- **Visual Guide:** `VISUAL_QA_GUIDE.md`
- **API Verification:** `QA_API_VERIFICATION.md`
- **Quick Reference:** `QA_QUICK_REFERENCE.txt`
