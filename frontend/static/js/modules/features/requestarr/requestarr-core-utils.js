/**
 * Shared Requestarr utilities - must load first in concatenated bundle.
 */
function encodeInstanceValue(appType, name) {
    return `${appType}:${name}`;
}
function decodeInstanceValue(value, defaultAppType) {
    if (defaultAppType === undefined) defaultAppType = 'radarr';
    if (!value) return { appType: defaultAppType, name: '' };
    var idx = value.indexOf(':');
    if (idx === -1) return { appType: defaultAppType, name: value };
    return { appType: value.substring(0, idx), name: value.substring(idx + 1) };
}
