(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateNotificationsForm = function (container, settings = {}) {
        // Add data-app-type attribute to container
        container.setAttribute("data-app-type", "notifications");

        container.innerHTML = `
                <div class="settings-group" style="
                    background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
                    border: 2px solid rgba(90, 109, 137, 0.3);
                    border-radius: 12px;
                    padding: 20px;
                    margin: 15px 0 25px 0;
                    box-shadow: 0 4px 12px rgba(90, 109, 137, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
                ">
                    <h3>Apprise Notifications</h3>
                    <div class="setting-item">
                        <label for="enable_notifications"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#enable-notifications" class="info-icon" title="Enable or disable notifications" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Enable Notifications:</label>
                        <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                            <input type="checkbox" id="enable_notifications" ${
                              settings.enable_notifications === true
                                ? "checked"
                                : ""
                            }>
                            <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                        </label>
                        <p class="setting-help" style="margin-left: -3ch !important;">Enable sending notifications via Apprise for media processing events</p>
                    </div>
                    <div class="setting-item">
                        <label for="notification_level"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#notification-level" class="info-icon" title="Set minimum notification level" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Notification Level:</label>
                        <select id="notification_level" name="notification_level" style="width: 200px; padding: 8px 12px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(255, 255, 255, 0.1); background-color: #1f2937; color: #d1d5db;">
                            <option value="info" ${
                              settings.notification_level === "info" ||
                              !settings.notification_level
                                ? "selected"
                                : ""
                            }>Info</option>
                            <option value="success" ${
                              settings.notification_level === "success"
                                ? "selected"
                                : ""
                            }>Success</option>
                            <option value="warning" ${
                              settings.notification_level === "warning"
                                ? "selected"
                                : ""
                            }>Warning</option>
                            <option value="error" ${
                              settings.notification_level === "error"
                                ? "selected"
                                : ""
                            }>Error</option>
                        </select>
                        <p class="setting-help" style="margin-left: -3ch !important;">Minimum level of events that will trigger notifications</p>
                    </div>
                    <div class="setting-item">
                        <label for="apprise_urls"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#apprise-urls" class="info-icon" title="Learn about Apprise URL formats" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Apprise URLs:</label>
                        <textarea id="apprise_urls" rows="4" style="width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1); background-color: #1f2937; color: #d1d5db;">${(
                          settings.apprise_urls || []
                        ).join("\n")}</textarea>
                        <p class="setting-help" style="margin-left: -3ch !important;">Enter one Apprise URL per line (e.g., discord://, telegram://, etc)</p>
                        <p class="setting-help"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#apprise-urls" target="_blank">Click here for detailed Apprise URL documentation</a></p>
                        <div style="margin-top: 10px;">
                            <button type="button" id="testNotificationBtn" class="btn btn-secondary" style="background-color: #6366f1; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px;">
                                <i class="fas fa-bell"></i> Test Notification
                            </button>
                            <span id="testNotificationStatus" style="margin-left: 10px; font-size: 14px;"></span>
                        </div>
                        <p class="setting-help" style="margin-left: -3ch !important; margin-top: 8px; font-style: italic; color: #9ca3af;">
                            <i class="fas fa-magic" style="margin-right: 4px;"></i>Testing will automatically save your current settings first
                        </p>
                    </div>
                    <div class="setting-item">
                        <label for="notify_on_missing"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#notify-on-missing" class="info-icon" title="Send notifications for missing media" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Notify on Missing:</label>
                        <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                            <input type="checkbox" id="notify_on_missing" ${
                              settings.notify_on_missing !== false ? "checked" : ""
                            }>
                            <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                        </label>
                        <p class="setting-help" style="margin-left: -3ch !important;">Send notifications when missing media is processed</p>
                    </div>
                    <div class="setting-item">
                        <label for="notify_on_upgrade"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#notify-on-upgrade" class="info-icon" title="Learn more about upgrade notifications" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Notify on Upgrade:</label>
                        <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                            <input type="checkbox" id="notify_on_upgrade" ${
                              settings.notify_on_upgrade !== false ? "checked" : ""
                            }>
                            <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                        </label>
                        <p class="setting-help" style="margin-left: -3ch !important;">Send notifications when media is upgraded</p>
                    </div>
                    <div class="setting-item">
                        <label for="notification_include_instance"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#include-instance" class="info-icon" title="Include instance name in notifications" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Include Instance:</label>
                        <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                            <input type="checkbox" id="notification_include_instance" ${
                              settings.notification_include_instance !== false
                                ? "checked"
                                : ""
                            }>
                            <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                        </label>
                        <p class="setting-help" style="margin-left: -3ch !important;">Include instance name in notification messages</p>
                    </div>
                    <div class="setting-item">
                        <label for="notification_include_app"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#include-app-name" class="info-icon" title="Include app name in notifications" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Include App Name:</label>
                        <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                            <input type="checkbox" id="notification_include_app" ${
                              settings.notification_include_app !== false
                                ? "checked"
                                : ""
                            }>
                            <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                        </label>
                        <p class="setting-help" style="margin-left: -3ch !important;">Include app name (Sonarr, Radarr, etc.) in notification messages</p>
                    </div>
                    <div style="margin-top: 20px;">
                        <button type="button" id="notifications-save-button" disabled style="
                            background: #6b7280;
                            color: #9ca3af;
                            border: 1px solid #4b5563;
                            padding: 8px 16px;
                            border-radius: 6px;
                            font-size: 14px;
                            font-weight: 500;
                            cursor: not-allowed;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            transition: all 0.2s ease;
                        ">
                            <i class="fas fa-save"></i>
                            Save Changes
                        </button>
                    </div>
                </div>
            `;

        // Set up Apprise notifications toggle functionality
        const enableNotificationsCheckbox = container.querySelector(
          "#enable_notifications"
        );
        if (enableNotificationsCheckbox) {
          // Function to toggle notification settings visibility
          const toggleNotificationSettings = function (enabled) {
            const settingsToToggle = [
              "notification_level",
              "apprise_urls",
              "testNotificationBtn",
              "notify_on_missing",
              "notify_on_upgrade",
              "notification_include_instance",
              "notification_include_app",
            ];

            // Find parent setting-item containers for each setting
            settingsToToggle.forEach((settingId) => {
              const element = container.querySelector(`#${settingId}`);
              if (element) {
                // Find the parent setting-item div
                const settingItem = element.closest(".setting-item");
                if (settingItem) {
                  if (enabled) {
                    settingItem.style.opacity = "1";
                    settingItem.style.pointerEvents = "";
                    // Re-enable form elements
                    const inputs = settingItem.querySelectorAll(
                      "input, select, textarea, button"
                    );
                    inputs.forEach((input) => {
                      input.disabled = false;
                      input.style.cursor = "";
                    });
                  } else {
                    settingItem.style.opacity = "0.4";
                    settingItem.style.pointerEvents = "none";
                    // Disable form elements
                    const inputs = settingItem.querySelectorAll(
                      "input, select, textarea, button"
                    );
                    inputs.forEach((input) => {
                      input.disabled = true;
                      input.style.cursor = "not-allowed";
                    });
                  }
                }
              }
            });

            // Special handling for test notification button and its container
            const testBtn = container.querySelector("#testNotificationBtn");
            if (testBtn) {
              testBtn.disabled = !enabled;
              testBtn.style.opacity = enabled ? "1" : "0.4";
              testBtn.style.cursor = enabled ? "pointer" : "not-allowed";

              // Also handle the button container div
              const buttonContainer = testBtn.closest("div");
              if (buttonContainer) {
                buttonContainer.style.opacity = enabled ? "1" : "0.4";
                buttonContainer.style.pointerEvents = enabled ? "" : "none";
              }
            }
          };

          // Set initial state
          toggleNotificationSettings(enableNotificationsCheckbox.checked);

          // Add change event listener
          enableNotificationsCheckbox.addEventListener("change", function () {
            toggleNotificationSettings(this.checked);
          });
        }

        // Set up test notification button
        const testBtn = container.querySelector("#testNotificationBtn");
        if (testBtn) {
          testBtn.addEventListener("click", function () {
            const statusSpan = container.querySelector("#testNotificationStatus");

            console.log(
              "[SettingsForms] Test notification - ensure settings are saved first"
            );

            // Show testing status
            if (statusSpan) {
              statusSpan.textContent = "Testing...";
              statusSpan.style.color = "#6366f1";
            }

            // Send test notification
            fetch("./api/test-notification", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
            })
              .then((response) => response.json())
              .then((data) => {
                if (statusSpan) {
                  if (data.success) {
                    statusSpan.textContent = "✓ Test sent successfully!";
                    statusSpan.style.color = "#10b981";
                  } else {
                    statusSpan.textContent = `✗ Test failed: ${
                      data.error || "Unknown error"
                    }`;
                    statusSpan.style.color = "#ef4444";
                  }

                  // Clear status after 5 seconds
                  setTimeout(() => {
                    statusSpan.textContent = "";
                  }, 5000);
                }
              })
              .catch((error) => {
                console.error("Test notification error:", error);
                if (statusSpan) {
                  statusSpan.textContent = "✗ Test failed: Network error";
                  statusSpan.style.color = "#ef4444";

                  // Clear status after 5 seconds
                  setTimeout(() => {
                    statusSpan.textContent = "";
                  }, 5000);
                }
              });
          });
        }

        // Set up manual save functionality for Notifications
        this.setupNotificationsManualSave(container, settings);
    };

    window.SettingsForms.setupNotificationsManualSave = function (container, originalSettings = {}) {
        console.log(
          "[SettingsForms] Setting up manual save for Notifications with original settings:",
          originalSettings
        );

        const saveButton = container.querySelector("#notifications-save-button");
        if (!saveButton) {
          console.error("[SettingsForms] Notifications save button not found!");
          return;
        }

        let hasChanges = false;
        let suppressInitialDetection = true; // Suppress change detection during initial setup

        // Clear any existing unsaved changes state and warnings when setting up
        window.notificationsUnsavedChanges = false;
        if (this.removeUnsavedChangesWarning) this.removeUnsavedChangesWarning();

        // Capture the actual form state as baseline instead of guessing defaults
        let normalizedSettings = {};

        // Initialize button in disabled/grey state immediately
        saveButton.disabled = true;
        saveButton.style.background = "#6b7280";
        saveButton.style.color = "#9ca3af";
        saveButton.style.borderColor = "#4b5563";
        saveButton.style.cursor = "not-allowed";
        console.log(
          "[SettingsForms] Notifications save button initialized as disabled (grey)"
        );

        // Function to update save button state
        const updateSaveButtonState = (changesDetected) => {
          hasChanges = changesDetected;
          window.notificationsUnsavedChanges = changesDetected;
          console.log(
            `[SettingsForms] Updating notifications save button state: hasChanges=${hasChanges}, global unsaved=${window.notificationsUnsavedChanges}`
          );

          if (hasChanges) {
            // Red enabled state
            saveButton.disabled = false;
            saveButton.style.background = "#dc2626";
            saveButton.style.color = "#ffffff";
            saveButton.style.borderColor = "#dc2626";
            saveButton.style.cursor = "pointer";
            console.log("[SettingsForms] Notifications save button enabled (red)");

            // Add beforeunload warning for page refresh
            if (window.SettingsForms.addUnsavedChangesWarning) window.SettingsForms.addUnsavedChangesWarning();
          } else {
            // Grey disabled state
            saveButton.disabled = true;
            saveButton.style.background = "#6b7280";
            saveButton.style.color = "#9ca3af";
            saveButton.style.borderColor = "#4b5563";
            saveButton.style.cursor = "not-allowed";
            console.log(
              "[SettingsForms] Notifications save button disabled (grey)"
            );

            // Remove beforeunload warning when no changes
            if (window.SettingsForms.removeUnsavedChangesWarning) window.SettingsForms.removeUnsavedChangesWarning();
          }
        };

        // Function to detect changes in form elements
        const detectChanges = () => {
          // Skip change detection if still in initial setup phase
          if (suppressInitialDetection) {
            console.log(
              "[SettingsForms] Notifications change detection suppressed during initial setup"
            );
            return;
          }

          // Check regular form inputs
          const inputs = container.querySelectorAll("input, select, textarea");
          let formChanged = false;

          inputs.forEach((input) => {
            // Skip disabled inputs or inputs without IDs
            if (!input.id || input.disabled) {
              return;
            }

            let key = input.id;
            let originalValue, currentValue;

            if (input.type === "checkbox") {
              originalValue =
                normalizedSettings[key] !== undefined
                  ? normalizedSettings[key]
                  : false;
              currentValue = input.checked;
            } else if (input.type === "number") {
              // Get default from input attributes or use 0
              const defaultValue =
                parseInt(input.getAttribute("value")) || parseInt(input.min) || 0;
              originalValue =
                normalizedSettings[key] !== undefined
                  ? parseInt(normalizedSettings[key])
                  : defaultValue;
              currentValue = parseInt(input.value) || 0;
            } else {
              originalValue = normalizedSettings[key] || "";
              currentValue = input.value.trim();
            }

            if (originalValue !== currentValue) {
              console.log(
                `[SettingsForms] Notifications change detected in ${key}: ${originalValue} -> ${currentValue}`
              );
              formChanged = true;
            }
          });

          // Special handling for apprise_urls which is a textarea with newlines
          const appriseUrlsElement = container.querySelector("#apprise_urls");
          if (appriseUrlsElement) {
            const originalUrls = normalizedSettings.apprise_urls || [];
            const currentUrls = appriseUrlsElement.value
              .split("\n")
              .map((url) => url.trim())
              .filter((url) => url.length > 0);

            if (
              JSON.stringify(originalUrls.sort()) !==
              JSON.stringify(currentUrls.sort())
            ) {
              console.log(
                "[SettingsForms] Notifications apprise_urls change detected"
              );
              formChanged = true;
            }
          }

          console.log(
            `[SettingsForms] Notifications change detection result: ${formChanged}`
          );
          updateSaveButtonState(formChanged);
        };

        // Add event listeners to all form elements
        const inputs = container.querySelectorAll("input, select, textarea");
        inputs.forEach((input) => {
          input.addEventListener("change", detectChanges);
          if (
            input.type === "text" ||
            input.type === "number" ||
            input.tagName.toLowerCase() === "textarea"
          ) {
            input.addEventListener("input", detectChanges);
          }
        });

        // Save button click handler
        saveButton.addEventListener("click", () => {
          if (!hasChanges) return;

          console.log("[SettingsForms] Manual save triggered for Notifications");

          // Show saving state
          saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
          saveButton.disabled = true;

          // Get settings and save
          if (window.huntarrUI && window.huntarrUI.autoSaveGeneralSettings) {
            window.huntarrUI
              .autoSaveGeneralSettings(true)
              .then(() => {
                console.log("[SettingsForms] Notifications manual save successful");

                // Reset button state and clear unsaved changes warning
                saveButton.innerHTML = '<i class="fas fa-save"></i> Save Changes';
                updateSaveButtonState(false);

                // Update original settings for future change detection
                const updatedSettings = window.huntarrUI.getFormSettings("general");
                if (updatedSettings) {
                  Object.assign(normalizedSettings, updatedSettings);
                }
              })
              .catch((error) => {
                console.error(
                  "[SettingsForms] Notifications manual save failed:",
                  error
                );

                // Reset button state
                saveButton.innerHTML = '<i class="fas fa-save"></i> Save Changes';
                updateSaveButtonState(hasChanges);
              });
          }
        });

        // Initial setup - capture actual form state as baseline
        // Use a longer timeout to ensure all form elements are properly initialized
        setTimeout(() => {
          console.log(
            "[SettingsForms] Capturing actual form state as notifications baseline"
          );

          // Capture the current form state as our baseline instead of guessing defaults
          const inputs = container.querySelectorAll("input, select, textarea");
          inputs.forEach((input) => {
            if (!input.id || input.disabled) return;

            let value;
            if (input.type === "checkbox") {
              value = input.checked;
            } else if (input.type === "number") {
              value = parseInt(input.value) || 0;
            } else if (input.id === "apprise_urls") {
              // Special handling for textarea - convert to array for comparison
              value = input.value
                .split("\n")
                .map((url) => url.trim())
                .filter((url) => url.length > 0);
            } else {
              value = input.value.trim();
            }

            normalizedSettings[input.id] = value;
          });

          // Force button to grey state and clear any changes
          saveButton.disabled = true;
          saveButton.style.background = "#6b7280";
          saveButton.style.color = "#9ca3af";
          saveButton.style.borderColor = "#4b5563";
          saveButton.style.cursor = "not-allowed";
          window.notificationsUnsavedChanges = false;
          hasChanges = false;

          // Enable change detection now that baseline is captured
          suppressInitialDetection = false;
          console.log(
            "[SettingsForms] Notifications baseline captured, change detection enabled"
          );
        }, 500);
    };
})();
