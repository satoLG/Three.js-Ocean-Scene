import { 
    Group, 
    Mesh, 
    PlaneGeometry, 
    ShaderMaterial, 
    DoubleSide, 
    AdditiveBlending,
    PointLight,
    Color,
    BufferGeometry,
    Float32BufferAttribute,
    Points
} from "three";
import { deltaTime, time } from "../scripts/Time.js";
import { isDayTime } from "./Skybox.js";

// Fire effect group - add this to the scene
export const fire = new Group();

// Point light for fire illumination
export const fireLight = new PointLight(0xff6622, 0, 8, 2);

// ============================================
// FIRE SETTINGS (easily tweakable)
// ============================================
const FIRE_SCALE = 1.3;           // Overall fire size
const FIRE_HEIGHT_OFFSET = 0.7;   // Height above firecamp base
const FIRE_LIGHT_INTENSITY = 3.0;  // Max light intensity at night
const FIRE_LIGHT_FLICKER = 0.5;    // How much the light flickers (0-1)
const FADE_SPEED = 0.6;            // How fast fire fades in/out

// EMBER/SPARK PARTICLE SETTINGS
const EMBER_COUNT = 10;            // Number of ember particles
const EMBER_SPEED = 0.4;           // How fast embers rise
const EMBER_SPREAD = 1.15;         // Horizontal spread of embers
const EMBER_SIZE = 0.015;          // Size of ember particles
const EMBER_LIFETIME = 2.5;        // How long each ember lives (seconds)
// ============================================

// Fire visibility (0 = off, 1 = fully on)
let fireIntensity = 1.0;
let targetIntensity = 1.0;

// Shader for fire effect
const fireVertexShader = /*glsl*/`
    varying vec2 vUv;
    varying float vHeight;
    
    void main() {
        vUv = uv;
        vHeight = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fireFragmentShader = /*glsl*/`
    uniform float uTime;
    uniform float uIntensity;
    
    varying vec2 vUv;
    varying float vHeight;
    
    // Simplex noise functions
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
    
    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
        m = m * m;
        m = m * m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }
    
    // Fractal brownian motion for more natural fire
    float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int i = 0; i < 4; i++) {
            value += amplitude * snoise(p * frequency);
            amplitude *= 0.5;
            frequency *= 2.0;
        }
        return value;
    }
    
    void main() {
        // Center UV horizontally
        vec2 uv = vUv;
        uv.x = uv.x * 2.0 - 1.0;
        
        // Fire shape - narrower at top
        float shape = 1.0 - abs(uv.x) * (0.8 + uv.y * 1.5);
        shape *= 1.0 - uv.y; // Fade out at top
        shape = max(shape, 0.0);
        
        // Animated noise for fire movement
        float noise1 = fbm(vec2(uv.x * 3.0, uv.y * 2.0 - uTime * 3.0));
        float noise2 = fbm(vec2(uv.x * 5.0 + 10.0, uv.y * 3.0 - uTime * 4.0));
        float noise = noise1 * 0.6 + noise2 * 0.4;
        
        // Combine shape with noise
        float fire = shape + noise * 0.4 * shape;
        fire = smoothstep(0.1, 0.9, fire);
        
        // Fire color gradient (white core -> yellow -> orange -> red)
        vec3 color;
        float t = fire;
        if (t > 0.8) {
            color = mix(vec3(1.0, 0.9, 0.5), vec3(1.0, 1.0, 0.9), (t - 0.8) / 0.2);
        } else if (t > 0.5) {
            color = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 0.9, 0.5), (t - 0.5) / 0.3);
        } else if (t > 0.2) {
            color = mix(vec3(0.8, 0.2, 0.0), vec3(1.0, 0.5, 0.0), (t - 0.2) / 0.3);
        } else {
            color = mix(vec3(0.0, 0.0, 0.0), vec3(0.8, 0.2, 0.0), t / 0.2);
        }
        
        // Alpha based on fire intensity and overall intensity uniform
        float alpha = fire * uIntensity;
        
        // Fade out at edges
        alpha *= smoothstep(0.0, 0.1, uv.y);
        alpha *= smoothstep(0.0, 0.2, shape);
        
        gl_FragColor = vec4(color, alpha);
    }
`;

// Time uniform for animation
const fireUniforms = {
    uTime: { value: 0.0 },
    uIntensity: { value: 0.0 }
};

// ============================================
// EMBER PARTICLE SYSTEM
// ============================================

// Ember particle shader
const emberVertexShader = /*glsl*/`
    attribute float aLife;
    attribute float aRandom;
    
    uniform float uTime;
    uniform float uIntensity;
    uniform float uEmberSize;
    
    varying float vLife;
    varying float vRandom;
    
    void main() {
        vLife = aLife;
        vRandom = aRandom;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        // Size based on life (smaller as it fades)
        float life01 = aLife;
        float size = uEmberSize * (0.5 + life01 * 0.5) * uIntensity;
        
        gl_PointSize = size * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const emberFragmentShader = /*glsl*/`
    uniform float uIntensity;
    
    varying float vLife;
    varying float vRandom;
    
    void main() {
        // Circular particle
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        if (dist > 0.5) discard;
        
        // Soft edge
        float alpha = smoothstep(0.5, 0.2, dist);
        
        // Fade based on life
        alpha *= vLife * uIntensity;
        
        // Color varies from yellow-orange to red based on life and randomness
        vec3 color = mix(
            vec3(1.0, 0.3, 0.0),   // Red/orange (dying)
            vec3(1.0, 0.8, 0.3),   // Yellow (fresh)
            vLife * 0.7 + vRandom * 0.3
        );
        
        // Glow effect
        color *= 1.5;
        
        gl_FragColor = vec4(color, alpha);
    }
`;

// Ember uniforms
const emberUniforms = {
    uTime: { value: 0.0 },
    uIntensity: { value: 0.0 },
    uEmberSize: { value: EMBER_SIZE }
};

// Ember particle data
let emberPositions;
let emberLifes;
let emberRandoms;
let emberVelocities;
let emberGeometry;
let emberPoints;

function initEmbers() {
    emberPositions = new Float32Array(EMBER_COUNT * 3);
    emberLifes = new Float32Array(EMBER_COUNT);
    emberRandoms = new Float32Array(EMBER_COUNT);
    emberVelocities = [];
    
    // Initialize each ember with staggered starting positions
    for (let i = 0; i < EMBER_COUNT; i++) {
        emberVelocities[i] = { x: 0, y: 0, z: 0 };
        resetEmber(i);
        // Stagger initial life so they don't all spawn at once
        emberLifes[i] = Math.random();
    }
    
    emberGeometry = new BufferGeometry();
    emberGeometry.setAttribute('position', new Float32BufferAttribute(emberPositions, 3));
    emberGeometry.setAttribute('aLife', new Float32BufferAttribute(emberLifes, 1));
    emberGeometry.setAttribute('aRandom', new Float32BufferAttribute(emberRandoms, 1));
    
    const emberMaterial = new ShaderMaterial({
        uniforms: emberUniforms,
        vertexShader: emberVertexShader,
        fragmentShader: emberFragmentShader,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false
    });
    
    emberPoints = new Points(emberGeometry, emberMaterial);
    return emberPoints;
}

function resetEmber(index) {
    const i3 = index * 3;
    
    // Start near the fire center with small random offset
    emberPositions[i3] = (Math.random() - 0.5) * 0.1;
    emberPositions[i3 + 1] = 0.1 + Math.random() * 0.2; // Start just above fire base
    emberPositions[i3 + 2] = (Math.random() - 0.5) * 0.1;
    
    // Full life
    emberLifes[index] = 1.0;
    emberRandoms[index] = Math.random();
    
    // Random velocity - mostly upward, each particle has different speed
    const speedVariation = 0.5 + Math.random() * 1.0; // 0.5x to 1.5x speed
    emberVelocities[index] = {
        x: (Math.random() - 0.5) * 0.1,  // Small horizontal drift
        y: EMBER_SPEED * speedVariation,   // Upward with variation
        z: (Math.random() - 0.5) * 0.1   // Small horizontal drift
    };
}

function updateEmbers() {
    const posAttr = emberGeometry.attributes.position;
    const lifeAttr = emberGeometry.attributes.aLife;
    
    for (let i = 0; i < EMBER_COUNT; i++) {
        const i3 = i * 3;
        const vel = emberVelocities[i];
        
        // Update position - move upward
        emberPositions[i3] += vel.x * deltaTime;
        emberPositions[i3 + 1] += vel.y * deltaTime;
        emberPositions[i3 + 2] += vel.z * deltaTime;
        
        // Add gentle wobble
        emberPositions[i3] += Math.sin(time * 3.0 + i * 2.5) * 0.003 * deltaTime * 60;
        emberPositions[i3 + 2] += Math.cos(time * 2.5 + i * 1.7) * 0.003 * deltaTime * 60;
        
        // Slow down horizontal movement over time, increase upward slightly (heat rises)
        vel.x *= 0.99;
        vel.z *= 0.99;
        
        // Decrease life
        emberLifes[i] -= deltaTime / EMBER_LIFETIME;
        
        // Update the attribute arrays directly
        posAttr.array[i3] = emberPositions[i3];
        posAttr.array[i3 + 1] = emberPositions[i3 + 1];
        posAttr.array[i3 + 2] = emberPositions[i3 + 2];
        lifeAttr.array[i] = emberLifes[i];
        
        // Reset if dead
        if (emberLifes[i] <= 0) {
            resetEmber(i);
            // Also update attribute after reset
            posAttr.array[i3] = emberPositions[i3];
            posAttr.array[i3 + 1] = emberPositions[i3 + 1];
            posAttr.array[i3 + 2] = emberPositions[i3 + 2];
            lifeAttr.array[i] = emberLifes[i];
        }
    }
    
    // Flag buffers for GPU update
    posAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
}

// Create fire planes
function createFirePlane() {
    const geometry = new PlaneGeometry(1, 1.5, 1, 1);
    const material = new ShaderMaterial({
        uniforms: fireUniforms,
        vertexShader: fireVertexShader,
        fragmentShader: fireFragmentShader,
        transparent: true,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false
    });
    return new Mesh(geometry, material);
}

export function Start() {
    // Create 3 intersecting planes for 3D fire effect
    const plane1 = createFirePlane();
    const plane2 = createFirePlane();
    const plane3 = createFirePlane();
    
    // Rotate planes to create volumetric effect
    plane1.rotation.y = 0;
    plane2.rotation.y = Math.PI / 3;
    plane3.rotation.y = -Math.PI / 3;
    
    // Scale and position
    fire.add(plane1);
    fire.add(plane2);
    fire.add(plane3);
    fire.scale.setScalar(FIRE_SCALE);
    fire.position.y = FIRE_HEIGHT_OFFSET;
    
    // Add ember particles
    const embers = initEmbers();
    fire.add(embers);
    
    // Add point light at fire position
    fireLight.position.copy(fire.position);
    fireLight.position.y += 0.05; // Slightly above fire base
    fire.add(fireLight);
    
    // Start with fire off (daytime)
    fireIntensity = 0.0;
    targetIntensity = isDayTime() ? 0.0 : 1.0;
}

export function Update() {
    // Update target based on day/night
    targetIntensity = isDayTime() ? 0.0 : 1.0;
    
    // Smoothly fade fire intensity
    if (fireIntensity !== targetIntensity) {
        const diff = targetIntensity - fireIntensity;
        const step = FADE_SPEED * deltaTime;
        
        if (Math.abs(diff) < step) {
            fireIntensity = targetIntensity;
        } else {
            fireIntensity += Math.sign(diff) * step;
        }
    }
    
    // Update shader uniforms
    fireUniforms.uTime.value = time;
    fireUniforms.uIntensity.value = fireIntensity;
    
    // Update ember particles
    emberUniforms.uTime.value = time;
    emberUniforms.uIntensity.value = fireIntensity;
    if (fireIntensity > 0.01) {
        updateEmbers();
    }
    
    // Update point light with flicker effect
    const flicker = 1.0 + (Math.sin(time * 15.0) * 0.3 + Math.sin(time * 23.0) * 0.2) * FIRE_LIGHT_FLICKER;
    fireLight.intensity = fireIntensity * FIRE_LIGHT_INTENSITY * flicker;
    
    // Animate fire color slightly
    const colorFlicker = 0.9 + Math.sin(time * 10.0) * 0.1;
    fireLight.color.setRGB(1.0, 0.4 * colorFlicker, 0.1 * colorFlicker);
    
    // Hide fire group when fully off
    fire.visible = fireIntensity > 0.001;
}

// Export fire light for use in other shaders (like ocean)
export function getFireLightData() {
    return {
        position: fireLight.getWorldPosition(new Vector3()),
        color: fireLight.color,
        intensity: fireLight.intensity
    };
}
