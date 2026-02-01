import { isDayTime } from "../scene/Skybox.js";

// ============================================
// AUDIO SETTINGS (easily tweakable)
// ============================================
const WATER_VOLUME = 0.15;              // Constant water ambience volume
const BREEZE_VOLUME = 0.3;             // Soft breeze volume
const BREEZE_MIN_DELAY = 10;           // Min seconds between breeze sounds
const BREEZE_MAX_DELAY = 20;           // Max seconds between breeze sounds
const FIREPLACE_VOLUME_MAX = 0.35;     // Fireplace target volume
const FIREPLACE_FADE_DURATION = 3.0;   // Seconds to fade in fireplace (desktop only)
// ============================================

// Pure HTML5 Audio elements - NO AudioContext connection
// This is the key to iOS background playback!
// We use TWO water audio elements for seamless crossfade looping
let waterAudio1 = null;
let waterAudio2 = null;
let activeWaterAudio = null;  // Points to the currently playing water audio
let breezeAudio = null;
let fireplaceAudio = null;

// Crossfade settings for seamless water loop
const CROSSFADE_DURATION = 1.0;  // Seconds to crossfade between water loops
let waterCrossfading = false;

// Fireplace state
let fireplaceActive = false;
let fireplaceFading = false;
let fireplaceFadeStart = 0;

// Breeze scheduling
let breezeTimeout = null;

// Track previous day state to detect transitions
let wasDay = true;

// Initialization flags
let audioInitialized = false;
let listenersRemoved = false;

// Detect iOS for fade workaround
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Create pure HTML5 Audio elements - exactly like the old working code
function createAudioElements() {
    // Water ambient sound - TWO elements for seamless crossfade looping
    waterAudio1 = new Audio('audio/water3.wav');
    waterAudio1.loop = false;  // We handle looping manually with crossfade
    waterAudio1.volume = WATER_VOLUME;
    waterAudio1.preload = 'auto';
    
    waterAudio2 = new Audio('audio/water3.wav');
    waterAudio2.loop = false;
    waterAudio2.volume = 0;  // Starts silent, fades in during crossfade
    waterAudio2.preload = 'auto';
    
    // Set up crossfade loop handling
    setupWaterCrossfade(waterAudio1, waterAudio2);
    setupWaterCrossfade(waterAudio2, waterAudio1);
    
    // Breeze sound - plays occasionally
    breezeAudio = new Audio('audio/wind-soft-breeze.wav');
    breezeAudio.loop = false;
    breezeAudio.volume = BREEZE_VOLUME;
    breezeAudio.preload = 'auto';
    
    // Fireplace sound - plays at night
    fireplaceAudio = new Audio('audio/fireplace.m4a');
    fireplaceAudio.loop = true;
    fireplaceAudio.volume = isIOS ? FIREPLACE_VOLUME_MAX : 0;
    fireplaceAudio.preload = 'auto';
    
    // When breeze ends, schedule the next one
    breezeAudio.addEventListener('ended', () => {
        scheduleBreezeSound();
    });
    
    // Error handling
    waterAudio1.addEventListener('error', (e) => console.error('Water audio 1 error:', e));
    waterAudio2.addEventListener('error', (e) => console.error('Water audio 2 error:', e));
    breezeAudio.addEventListener('error', (e) => console.error('Breeze audio error:', e));
    fireplaceAudio.addEventListener('error', (e) => console.error('Fireplace audio error:', e));
    
    // Preload all audio
    waterAudio1.load();
    waterAudio2.load();
    breezeAudio.load();
    fireplaceAudio.load();
    
    console.log('HTML5 Audio elements created (pure, no AudioContext, seamless water loop)');
}

// Setup crossfade between two water audio elements for seamless looping
function setupWaterCrossfade(currentAudio, nextAudio) {
    currentAudio.addEventListener('timeupdate', () => {
        if (!currentAudio.duration || waterCrossfading) return;
        
        const timeRemaining = currentAudio.duration - currentAudio.currentTime;
        
        // Start crossfade when approaching the end
        if (timeRemaining <= CROSSFADE_DURATION && timeRemaining > 0) {
            waterCrossfading = true;
            
            // Start the next audio from the beginning
            nextAudio.currentTime = 0;
            nextAudio.volume = 0;
            nextAudio.play().catch(() => {});
            
            // Crossfade using requestAnimationFrame
            const fadeStartTime = performance.now();
            const startVolume = currentAudio.volume;
            
            const doCrossfade = () => {
                const elapsed = (performance.now() - fadeStartTime) / 1000;
                const progress = Math.min(elapsed / CROSSFADE_DURATION, 1);
                
                // Fade out current, fade in next
                currentAudio.volume = WATER_VOLUME * (1 - progress);
                nextAudio.volume = WATER_VOLUME * progress;
                
                if (progress < 1) {
                    requestAnimationFrame(doCrossfade);
                } else {
                    // Crossfade complete - stop the old audio
                    currentAudio.pause();
                    currentAudio.currentTime = 0;
                    currentAudio.volume = WATER_VOLUME;  // Reset for next time
                    activeWaterAudio = nextAudio;
                    waterCrossfading = false;
                }
            };
            
            requestAnimationFrame(doCrossfade);
        }
    });
}

// Media Session API - enables lock screen controls
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
        if (activeWaterAudio) activeWaterAudio.play().catch(() => {});
        if (fireplaceActive && fireplaceAudio) fireplaceAudio.play().catch(() => {});
        navigator.mediaSession.playbackState = 'playing';
    });
    
    navigator.mediaSession.setActionHandler('pause', () => {
        if (waterAudio1) waterAudio1.pause();
        if (waterAudio2) waterAudio2.pause();
        if (fireplaceAudio) fireplaceAudio.pause();
        navigator.mediaSession.playbackState = 'paused';
    });
    
    navigator.mediaSession.setActionHandler('stop', () => {
        if (waterAudio1) { waterAudio1.pause(); waterAudio1.currentTime = 0; }
        if (waterAudio2) { waterAudio2.pause(); waterAudio2.currentTime = 0; }
        if (fireplaceAudio) { fireplaceAudio.pause(); fireplaceAudio.currentTime = 0; }
        navigator.mediaSession.playbackState = 'none';
    });
    
    console.log('Media Session API configured');
}

// Initialize audio - called from START button
function initAudio() {
    if (audioInitialized) return;
    
    console.log('Initializing audio system (pure HTML5)...');
    
    // Create audio elements if they don't exist
    if (!waterAudio1) {
        createAudioElements();
    }
    
    // Start water sound immediately (looping via crossfade)
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
    console.log('Audio system fully initialized (pure HTML5 - iOS background compatible)');
}

function startWaterSound() {
    if (!waterAudio1) return;
    
    // Start with the first water audio element
    activeWaterAudio = waterAudio1;
    waterAudio1.volume = WATER_VOLUME;
    waterAudio1.currentTime = 0;
    
    waterAudio1.play().then(() => {
        console.log('Water sound started playing (seamless loop enabled)');
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
    if (!breezeAudio) return;
    
    breezeAudio.currentTime = 0;
    breezeAudio.play().then(() => {
        console.log('Breeze sound playing');
    }).catch((error) => {
        console.error('Failed to play breeze sound:', error);
        scheduleBreezeSound();
    });
}

function startFireplaceSound() {
    if (!fireplaceAudio || fireplaceActive) return;
    
    fireplaceAudio.currentTime = 0;
    
    if (isIOS) {
        // iOS: Set full volume immediately (no fade - volume property unreliable for changes)
        fireplaceAudio.volume = FIREPLACE_VOLUME_MAX;
        fireplaceFading = false;
    } else {
        // Desktop: Start at 0 volume and fade in
        fireplaceAudio.volume = 0;
        fireplaceFadeStart = performance.now();
        fireplaceFading = true;
    }
    
    fireplaceAudio.play().then(() => {
        console.log('Fireplace sound started' + (isIOS ? ' (iOS - no fade)' : ' (fading in)'));
    }).catch((error) => {
        console.error('Failed to play fireplace sound:', error);
    });
    
    fireplaceActive = true;
}

function stopFireplaceSound() {
    if (!fireplaceAudio || !fireplaceActive) return;
    
    if (isIOS) {
        // iOS: Just stop immediately
        fireplaceAudio.pause();
        fireplaceAudio.currentTime = 0;
    } else {
        // Desktop: Quick fade out using volume property
        const fadeOutDuration = 500; // ms
        const startVolume = fireplaceAudio.volume;
        const startTime = performance.now();
        
        const fadeOut = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / fadeOutDuration, 1);
            fireplaceAudio.volume = startVolume * (1 - progress);
            
            if (progress < 1) {
                requestAnimationFrame(fadeOut);
            } else {
                fireplaceAudio.pause();
                fireplaceAudio.currentTime = 0;
            }
        };
        
        requestAnimationFrame(fadeOut);
    }
    
    fireplaceActive = false;
    fireplaceFading = false;
}

// Called when user clicks the START button
export function startAudio() {
    if (listenersRemoved) return;
    listenersRemoved = true;
    
    console.log('Start button clicked, initializing audio...');
    initAudio();
}

export function Start() {
    wasDay = isDayTime();
    // Audio is now initialized via startAudio() called from the START button
}

export function Update() {
    if (!audioInitialized) return;
    
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
    
    // Handle fireplace fade-in (desktop only - uses volume property)
    if (fireplaceFading && fireplaceAudio && !isIOS) {
        const elapsed = (performance.now() - fireplaceFadeStart) / 1000;
        const progress = Math.min(elapsed / FIREPLACE_FADE_DURATION, 1.0);
        const volume = FIREPLACE_VOLUME_MAX * progress;
        
        fireplaceAudio.volume = volume;
        
        if (progress >= 1.0) {
            fireplaceFading = false;
        }
    }
}
