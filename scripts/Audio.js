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

// Sound sources
let waterSource = null;
let waterGain = null;
let waterBuffer = null;

let breezeBuffer = null;
let breezeGain = null;
let breezeTimeout = null;

let fireplaceSource = null;
let fireplaceGain = null;
let fireplaceBuffer = null;
let fireplaceFadeStart = 0;
let fireplaceFading = false;
let fireplaceActive = false;

// Track previous day state to detect transitions
let wasDay = true;

// User interaction flag (needed for audio context)
let audioInitialized = false;
let audioInitializing = false;

async function loadAudioBuffer(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return await audioContext.decodeAudioData(arrayBuffer);
}

function initAudioContext() {
    if (audioContext) return;
    
    // Create AudioContext - must happen in user gesture on mobile
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(audioContext.destination);
}

// Synchronous part that MUST run inside user gesture
function unlockAudio() {
    if (audioContext) {
        // If context exists but is suspended, resume it
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        return;
    }
    
    // Create the context inside the user gesture
    initAudioContext();
    
    // iOS hack: play a silent buffer to unlock audio
    // This must happen synchronously within the user gesture
    const silentBuffer = audioContext.createBuffer(1, 1, 22050);
    const silentSource = audioContext.createBufferSource();
    silentSource.buffer = silentBuffer;
    silentSource.connect(audioContext.destination);
    silentSource.start(0);
    
    // Also try to resume if suspended
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

async function initAudio() {
    if (audioInitialized || audioInitializing) return;
    audioInitializing = true;
    
    // Make sure context exists and is running
    if (!audioContext) {
        initAudioContext();
    }
    
    // Resume audio context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
        } catch (e) {
            console.warn('Failed to resume audio context:', e);
        }
    }
    
    // Wait for context to be running
    if (audioContext.state !== 'running') {
        // Try waiting for state change
        await new Promise((resolve) => {
            const checkState = () => {
                if (audioContext.state === 'running') {
                    resolve();
                } else {
                    setTimeout(checkState, 100);
                }
            };
            // Timeout after 2 seconds
            setTimeout(resolve, 2000);
            checkState();
        });
    }
    
    try {
        // Load all audio buffers
        [waterBuffer, breezeBuffer, fireplaceBuffer] = await Promise.all([
            loadAudioBuffer('audio/water3.wav'),
            loadAudioBuffer('audio/wind-soft-breeze.wav'),
            loadAudioBuffer('audio/fireplace.m4a')
        ]);
        
        // Start water sound immediately (looping)
        startWaterSound();
        
        // Schedule first breeze
        scheduleBreezeSound();
        
        // If starting at night, start fireplace
        if (!isDayTime()) {
            startFireplaceSound();
        }
        
        audioInitialized = true;
        console.log('Audio system initialized, context state:', audioContext.state);
    } catch (error) {
        console.error('Failed to load audio:', error);
        audioInitializing = false;
    }
}

function startWaterSound() {
    if (!waterBuffer || waterSource) return;
    
    waterGain = audioContext.createGain();
    waterGain.gain.value = WATER_VOLUME;
    waterGain.connect(masterGain);
    
    waterSource = audioContext.createBufferSource();
    waterSource.buffer = waterBuffer;
    waterSource.loop = true;
    waterSource.connect(waterGain);
    waterSource.start();
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
    if (!breezeBuffer || !audioContext) return;
    
    breezeGain = audioContext.createGain();
    breezeGain.gain.value = BREEZE_VOLUME;
    breezeGain.connect(masterGain);
    
    const breezeSource = audioContext.createBufferSource();
    breezeSource.buffer = breezeBuffer;
    breezeSource.loop = false;
    breezeSource.connect(breezeGain);
    breezeSource.start();
    
    // Schedule next breeze after this one ends
    breezeSource.onended = () => {
        scheduleBreezeSound();
    };
}

function startFireplaceSound() {
    if (!fireplaceBuffer || fireplaceActive) return;
    
    fireplaceGain = audioContext.createGain();
    fireplaceGain.gain.value = FIREPLACE_VOLUME_MIN;
    fireplaceGain.connect(masterGain);
    
    fireplaceSource = audioContext.createBufferSource();
    fireplaceSource.buffer = fireplaceBuffer;
    fireplaceSource.loop = true;
    fireplaceSource.connect(fireplaceGain);
    fireplaceSource.start();
    
    // Start fade-in
    fireplaceFadeStart = audioContext.currentTime;
    fireplaceFading = true;
    fireplaceActive = true;
}

function stopFireplaceSound() {
    if (!fireplaceSource || !fireplaceActive) return;
    
    // Quick fade out
    const fadeOutDuration = 0.5;
    fireplaceGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + fadeOutDuration);
    
    // Stop after fade out
    const sourceToStop = fireplaceSource;
    setTimeout(() => {
        sourceToStop.stop();
    }, fadeOutDuration * 1000);
    
    fireplaceSource = null;
    fireplaceGain = null;
    fireplaceActive = false;
    fireplaceFading = false;
}

export function Start() {
    wasDay = isDayTime();
    
    // Initialize audio on first user interaction
    // Mobile browsers require AudioContext creation inside user gesture
    const initOnInteraction = (e) => {
        // Unlock audio synchronously first (critical for iOS)
        unlockAudio();
        
        // Then load and start sounds asynchronously
        initAudio();
        
        // Remove all listeners after first interaction
        document.removeEventListener('click', initOnInteraction);
        document.removeEventListener('keydown', initOnInteraction);
        document.removeEventListener('touchstart', initOnInteraction);
        document.removeEventListener('touchend', initOnInteraction);
        document.removeEventListener('pointerdown', initOnInteraction);
        document.removeEventListener('pointerup', initOnInteraction);
    };
    
    // Use multiple event types for maximum compatibility:
    // - click: desktop and some mobile
    // - keydown: keyboard interaction
    // - touchstart/touchend: iOS Safari
    // - pointerdown/pointerup: Android Chrome and modern browsers
    document.addEventListener('click', initOnInteraction);
    document.addEventListener('keydown', initOnInteraction);
    document.addEventListener('touchstart', initOnInteraction, { passive: true });
    document.addEventListener('touchend', initOnInteraction, { passive: true });
    document.addEventListener('pointerdown', initOnInteraction, { passive: true });
    document.addEventListener('pointerup', initOnInteraction, { passive: true });
}

export function Update() {
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
