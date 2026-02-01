import { isDayTime } from "../scene/Skybox.js";

// ============================================
// AUDIO SETTINGS (easily tweakable)
// ============================================
const WATER_VOLUME = 0.1;              // Constant water ambience volume
const BREEZE_VOLUME = 0.4;             // Soft breeze volume
const BREEZE_MIN_DELAY = 10;           // Min seconds between breeze sounds
const BREEZE_MAX_DELAY = 20;           // Max seconds between breeze sounds
const FIREPLACE_VOLUME_MIN = 0.0;      // Fireplace starting volume
const FIREPLACE_VOLUME_MAX = 0.35;      // Fireplace target volume
const FIREPLACE_FADE_DURATION = 3.0;   // Seconds to fade in fireplace
// ============================================

// Audio context and nodes
let audioContext = null;
let masterGain = null;

// HTML5 Audio elements - iOS treats these as "media playback"
// We connect them to AudioContext to keep GainNode control
let waterAudioElement = null;
let breezeAudioElement = null;
let fireplaceAudioElement = null;

// MediaElementSource nodes (bridge between <audio> and AudioContext)
let waterSource = null;
let breezeSource = null;
let fireplaceSource = null;

// Gain nodes for volume control
let waterGain = null;
let breezeGain = null;
let fireplaceGain = null;

// Fireplace state
let fireplaceFadeStart = 0;
let fireplaceFading = false;
let fireplaceActive = false;

// Breeze scheduling
let breezeTimeout = null;

// Track previous day state to detect transitions
let wasDay = true;

// User interaction flag (needed for audio context)
let audioInitialized = false;
let audioInitializing = false;
let listenersRemoved = false;

// Create HTML5 Audio elements - these are treated as "media playback" by iOS
// Unlike AudioBufferSource, these work in silent mode and background
function createAudioElements() {
    // Water ambient sound - loops continuously
    waterAudioElement = new Audio('audio/water3.wav');
    waterAudioElement.loop = true;
    waterAudioElement.preload = 'auto';
    
    // Breeze sound - plays occasionally
    breezeAudioElement = new Audio('audio/wind-soft-breeze.wav');
    breezeAudioElement.loop = false;
    breezeAudioElement.preload = 'auto';
    
    // Fireplace sound - plays at night
    fireplaceAudioElement = new Audio('audio/fireplace.m4a');
    fireplaceAudioElement.loop = true;
    fireplaceAudioElement.preload = 'auto';
    
    // When breeze ends, schedule the next one
    breezeAudioElement.addEventListener('ended', () => {
        scheduleBreezeSound();
    });
    
    // Error handling
    waterAudioElement.addEventListener('error', (e) => console.error('Water audio error:', e));
    breezeAudioElement.addEventListener('error', (e) => console.error('Breeze audio error:', e));
    fireplaceAudioElement.addEventListener('error', (e) => console.error('Fireplace audio error:', e));
    
    console.log('HTML5 Audio elements created');
}

function createAudioContext() {
    if (audioContext) return;
    
    // Create AudioContext - must happen in user gesture on mobile
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(audioContext.destination);
    
    console.log('AudioContext created, initial state:', audioContext.state);
}

// Media Session API - enables background playback and lock screen controls
function setupMediaSession() {
    if (!('mediaSession' in navigator)) {
        console.log('Media Session API not supported');
        return;
    }
    
    navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Ocean Ambience',
        artist: 'Leo Sato',
        album: 'Three.js Ocean Scene',
        artwork: [
            { src: 'images/sand.png', sizes: '512x512', type: 'image/png' }
        ]
    });
    
    navigator.mediaSession.playbackState = 'playing';
    
    // Handle media controls
    navigator.mediaSession.setActionHandler('play', () => {
        if (waterAudioElement) waterAudioElement.play().catch(() => {});
        if (fireplaceActive && fireplaceAudioElement) fireplaceAudioElement.play().catch(() => {});
        if (audioContext && audioContext.state === 'suspended') audioContext.resume();
        navigator.mediaSession.playbackState = 'playing';
    });
    
    navigator.mediaSession.setActionHandler('pause', () => {
        if (waterAudioElement) waterAudioElement.pause();
        if (fireplaceAudioElement) fireplaceAudioElement.pause();
        navigator.mediaSession.playbackState = 'paused';
    });
    
    navigator.mediaSession.setActionHandler('stop', () => {
        if (waterAudioElement) { waterAudioElement.pause(); waterAudioElement.currentTime = 0; }
        if (fireplaceAudioElement) { fireplaceAudioElement.pause(); fireplaceAudioElement.currentTime = 0; }
        navigator.mediaSession.playbackState = 'none';
    });
    
    console.log('Media Session API configured');
}

async function initAudio() {
    if (audioInitialized || audioInitializing) return;
    audioInitializing = true;
    
    console.log('initAudio called, context state:', audioContext ? audioContext.state : 'no context');
    
    // Create context if it doesn't exist
    if (!audioContext) {
        createAudioContext();
    }
    
    // Create HTML5 audio elements if they don't exist
    if (!waterAudioElement) {
        createAudioElements();
    }
    
    // Resume audio context if suspended
    if (audioContext.state === 'suspended') {
        console.log('Attempting to resume suspended AudioContext...');
        try {
            await audioContext.resume();
            console.log('AudioContext resumed, new state:', audioContext.state);
        } catch (e) {
            console.error('Failed to resume audio context:', e);
            audioInitializing = false;
            return;
        }
    }
    
    console.log('Final AudioContext state before connecting:', audioContext.state);
    
    try {
        // Connect HTML5 audio elements to AudioContext via createMediaElementSource
        // This gives us GainNode control while keeping iOS background playback compatibility
        
        // Water source
        waterSource = audioContext.createMediaElementSource(waterAudioElement);
        waterGain = audioContext.createGain();
        waterGain.gain.value = WATER_VOLUME;
        waterSource.connect(waterGain);
        waterGain.connect(masterGain);
        
        // Breeze source  
        breezeSource = audioContext.createMediaElementSource(breezeAudioElement);
        breezeGain = audioContext.createGain();
        breezeGain.gain.value = BREEZE_VOLUME;
        breezeSource.connect(breezeGain);
        breezeGain.connect(masterGain);
        
        // Fireplace source
        fireplaceSource = audioContext.createMediaElementSource(fireplaceAudioElement);
        fireplaceGain = audioContext.createGain();
        fireplaceGain.gain.value = FIREPLACE_VOLUME_MIN;
        fireplaceSource.connect(fireplaceGain);
        fireplaceGain.connect(masterGain);
        
        console.log('Audio sources connected to AudioContext with GainNodes');
        
        // Start water sound immediately (looping)
        startWaterSound();
        
        // Schedule first breeze
        scheduleBreezeSound();
        
        // If starting at night, start fireplace
        if (!isDayTime()) {
            startFireplaceSound();
        }
        
        // Setup Media Session
        setupMediaSession();
        
        audioInitialized = true;
        console.log('Audio system fully initialized (HTML5 + Web Audio API hybrid)');
    } catch (error) {
        console.error('Failed to initialize audio:', error);
        audioInitializing = false;
    }
}

function startWaterSound() {
    if (!waterAudioElement) return;
    
    // Play the HTML5 audio element - it's already connected to AudioContext
    waterAudioElement.play().then(() => {
        console.log('Water sound started playing');
    }).catch((error) => {
        console.error('Failed to play water sound:', error);
    });
}

function scheduleBreezeSound() {
    if (breezeTimeout) {
        clearTimeout(breezeTimeout);
    }
    
    const delay = BREEZE_MIN_DELAY + Math.random() * (BREEZE_MAX_DELAY - BREEZE_MIN_DELAY);
    
    breezeTimeout = setTimeout(() => {
        playBreezeSound();
    }, delay * 1000);
}

function playBreezeSound() {
    if (!breezeAudioElement) return;
    
    // Reset and play the breeze sound
    breezeAudioElement.currentTime = 0;
    breezeAudioElement.play().then(() => {
        console.log('Breeze sound playing');
    }).catch((error) => {
        console.error('Failed to play breeze sound:', error);
        // Still schedule next breeze even if this one failed
        scheduleBreezeSound();
    });
    // The 'ended' event listener in createAudioElements() will schedule the next breeze
}

function startFireplaceSound() {
    if (!fireplaceAudioElement || fireplaceActive) return;
    
    // Reset gain for fade-in
    if (fireplaceGain) {
        fireplaceGain.gain.value = FIREPLACE_VOLUME_MIN;
    }
    
    // Play the HTML5 audio element
    fireplaceAudioElement.currentTime = 0;
    fireplaceAudioElement.play().then(() => {
        console.log('Fireplace sound started');
    }).catch((error) => {
        console.error('Failed to play fireplace sound:', error);
    });
    
    // Start fade-in
    if (audioContext) {
        fireplaceFadeStart = audioContext.currentTime;
    }
    fireplaceFading = true;
    fireplaceActive = true;
}

function stopFireplaceSound() {
    if (!fireplaceAudioElement || !fireplaceActive) return;
    
    // Quick fade out using GainNode
    if (fireplaceGain && audioContext) {
        const fadeOutDuration = 0.5;
        fireplaceGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + fadeOutDuration);
        
        // Pause the audio after fade out
        setTimeout(() => {
            if (fireplaceAudioElement) {
                fireplaceAudioElement.pause();
                fireplaceAudioElement.currentTime = 0;
            }
        }, fadeOutDuration * 1000);
    } else {
        // Fallback: just pause immediately
        fireplaceAudioElement.pause();
        fireplaceAudioElement.currentTime = 0;
    }
    
    fireplaceActive = false;
    fireplaceFading = false;
}

// Called when user clicks the START button
export function startAudio() {
    if (listenersRemoved) return;
    listenersRemoved = true;
    
    console.log('Start button clicked, initializing audio...');
    
    // Step 1: Create AudioContext SYNCHRONOUSLY within user gesture
    createAudioContext();
    
    // Step 2: Call resume() SYNCHRONOUSLY (the call must be sync, even though it returns a promise)
    const resumePromise = audioContext.resume();
    
    console.log('resume() called synchronously, state:', audioContext.state);
    
    // Step 3: After resume promise resolves, initialize and play audio
    resumePromise.then(() => {
        console.log('AudioContext resumed, state:', audioContext.state);
        initAudio();
    }).catch(err => {
        console.error('Failed to resume AudioContext:', err);
        // Try to init anyway
        initAudio();
    });
}

export function Start() {
    wasDay = isDayTime();
    // Audio is now initialized via startAudio() called from the START button
}

export function Update() {
    // Keep trying to resume audio context if it's suspended
    // This handles edge cases where the initial resume didn't work
    if (audioContext && audioContext.state === 'suspended' && audioInitialized) {
        audioContext.resume().catch(() => {});
    }
    
    if (!audioInitialized || !audioContext) return;
    
    const isDay = isDayTime();
    
    // Detect day -> night transition
    if (wasDay && !isDay) {
        startFireplaceSound();
    }
    
    // Detect night -> day transition
    if (!wasDay && isDay) {
        stopFireplaceSound();
    }
    
    wasDay = isDay;
    
    // Handle fireplace fade-in
    if (fireplaceFading && fireplaceGain) {
        const elapsed = audioContext.currentTime - fireplaceFadeStart;
        const progress = Math.min(elapsed / FIREPLACE_FADE_DURATION, 1.0);
        const volume = FIREPLACE_VOLUME_MIN + (FIREPLACE_VOLUME_MAX - FIREPLACE_VOLUME_MIN) * progress;
        
        fireplaceGain.gain.value = volume;
        
        if (progress >= 1.0) {
            fireplaceFading = false;
        }
    }
}
