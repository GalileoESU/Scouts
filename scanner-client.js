/**
 * CHAMELEON UNIFIED FRONTEND SCANNER & API CLIENT
 * Handles hardware camera switching, QR code streaming, and backend integration.
 */

// --- GLOBAL SCANNER STATE ENGINE ---
let html5QrCode = null;
let currentCameraId = null;
let availableCameras = [];
let cameraIndex = 0;

// Configuration defaults for the camera canvas
const SCANNER_CONFIG = { 
    fps: 15, 
    qrbox: (width, height) => {
        const size = Math.min(width, height) * 0.75;
        return { width: size, height: size };
    }
};

/**
 * Boots the camera hardware and binds the stream to a DOM element container.
 * @param {string} elementId - The ID of the HTML div (e.g., 'reader')
 * @param {function} onScanSuccessCallback - Function executed when a QR code is matched
 */
async function startScanner(elementId, onScanSuccessCallback) {
    try {
        // Clear any existing active camera context cleanly
        if (html5QrCode) {
            await html5QrCode.stop().catch(() => {});
            html5QrCode = null;
        }

        // Initialize the library wrapper targeting the container element
        html5QrCode = new Html5Qrcode(elementId);
        
        // Query the client browser/device for all physical lens modules
        availableCameras = await Html5Qrcode.getCameras();
        
        if (availableCameras && availableCameras.length > 0) {
            // Default to the last available camera track (typically the back-facing/environment lens on mobile devices)
            cameraIndex = availableCameras.length - 1;
            currentCameraId = availableCameras[cameraIndex].id;
            
            await launchCamera(onScanSuccessCallback);
        } else {
            alert("❌ System Error: No physical video capture devices or camera permissions detected.");
        }
    } catch (err) {
        console.error("Scanner Setup Failure:", err);
        alert("Failed to initialize camera interface: " + err.message);
    }
}

/**
 * Starts streaming the selected camera lens track.
 */
async function launchCamera(callback) {
    if (!html5QrCode || !currentCameraId) return;

    // Reset visual indicator border if present
    const box = document.getElementById(html5QrCode.element.id);
    if (box) box.style.borderColor = "#cbd5e1"; 

    await html5QrCode.start(
        currentCameraId, 
        SCANNER_CONFIG, 
        (decodedText) => {
            console.log("🎯 QR Decoded Successfully:", decodedText);
            
            // Provide explicit UI visual success feedback (flash the camera preview container green)
            if (box) box.style.borderColor = "#22c55e"; 
            
            // Execute the contextual action payload processing
            callback(decodedText.trim());
        },
        (errorMessage) => {
            // Silent error catching for frame scan iterations without matches
        }
    ).catch(err => {
        console.error("Failed to acquire camera stream track:", err);
    });
}

/**
 * Cylces sequentially through all available device cameras.
 * Bind this function directly to the click event of your "Switch Camera" buttons.
 * @param {function} onScanSuccessCallback - Rebinds the active callback logic to the next camera instance
 */
async function handleCameraSwitch(onScanSuccessCallback) {
    if (!html5QrCode) {
        console.warn("Cannot switch camera: Scanner is not initialized.");
        return;
    }
    if (availableCameras.length <= 1) {
        alert("ℹ️ Device Info: Only one camera track is available on this unit.");
        return;
    }

    try {
        // Stop the current active hardware preview stream
        await html5QrCode.stop();
        
        // Increment index, looping back to zero if exceeding total cameras found
        cameraIndex = (cameraIndex + 1) % availableCameras.length;
        currentCameraId = availableCameras[cameraIndex].id;
        
        // Immediately spin up the newly selected camera pipeline
        await launchCamera(onScanSuccessCallback);
    } catch (err) {
        console.error("Hardware Context Switch Exception:", err);
    }
}

/**
 * Gracefully shuts down the camera preview stream to conserve device battery.
 */
async function stopScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        await html5QrCode.stop().catch(() => {});
        html5QrCode = null;
    }
}


// --- CENTRAL BACKEND API ROUTERS ---
const API_BASE_URL = window.location.origin.includes('localhost') ? 'http://localhost:3000' : '';

/**
 * 1. PROCESS PASSPORT (Used by Catchers and Checkpoint Operators)
 * Resolves the "Green box nothing happens" bug by sending the pure token string to the updated API.
 */
async function apiProcessPassport(operatorId, scannedToken, currentCheckpoint = null) {
    // Acquire live geolocation tracking coordinates securely
    const coords = await getGeoLocation();

    try {
        const response = await fetch(`${API_BASE_URL}/api/client/process-passport`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operatorId: operatorId,
                scannedPassportString: scannedToken, // The direct 8-digit random backup_code token
                currentCheckpointContext: currentCheckpoint,
                lat: coords.latitude,
                lon: coords.longitude
            })
        });

        const result = await response.json();
        
        if (result.success) {
            alert(`✅ Success: ${result.message}`);
            return result;
        } else {
            alert(`❌ Action Denied: ${result.message}`);
            return null;
        }
    } catch (error) {
        console.error("API Error processing client token:", error);
        alert("Network connection error communicating with central data bridge.");
        return null;
    }
}

/**
 * 2. SCAN WAYPOINT (Used by standard Teams exploring fields)
 */
async function apiScanWaypoint(teamId, scannedWaypointCode) {
    const coords = await getGeoLocation();
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/client/scan-waypoint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                teamId: teamId,
                code: scannedWaypointCode, // Handles numeric or random 6-digit keys
                lat: coords.latitude,
                lon: coords.longitude
            })
        });

        const result = await response.json();
        if (result.success) {
            alert(`🎉 Waypoint ${result.code} Claimed! +10 Points added.`);
            return result;
        } else {
            alert(`❌ Scan Failed: ${result.message}`);
            return null;
        }
    } catch (error) {
        alert("Network communication error claiming waypoint.");
        return null;
    }
}

/**
 * Geolocation helper to cleanly pack coordinates
 */
function getGeoLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve({ latitude: null, longitude: null });
        }
        navigator.geolocation.getCurrentPosition(
            (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
            () => resolve({ latitude: null, longitude: null }),
            { timeout: 5000 }
        );
    });
}