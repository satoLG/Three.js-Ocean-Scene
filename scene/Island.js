import { Group, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { oceanAbsorptionUniform } from "../materials/OceanMaterial.js";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial.js";

export const island = new Group();
export const firecamp = new Group();

const loader = new GLTFLoader();

// Position in front of camera (camera at Z=0, looking into -Z)
// Island slightly above water level (Y=0)
const islandPosition = { x: 0, y: 0.1, z: -3.3 };
const firecampOffset = { x: 0, y: 0.1, z: 0 }; // Offset from island position

// Scale adjustments
const islandScale = 3.0;
const firecampScale = 0.4;

// Shared uniforms for ocean effects - will be set from SkyboxMaterial after it starts
let skyboxUniforms = null;

// GLSL code to inject into materials for ocean/skybox lighting
const oceanLightingPars = /*glsl*/`
    // Ocean lighting uniforms
    uniform vec3 uLight;
    uniform vec3 uAbsorption;
    uniform float uSunVisibility;
    
    // Constants for underwater effects
    const float MAX_VIEW_DEPTH = 80.0;
    const float DENSITY = 0.35;
    const float FOG_DISTANCE = 600.0;
`;

const oceanLightingFragment = /*glsl*/`
    // Calculate underwater/fog effects based on world position
    vec3 worldPos = vWorldPosition;
    vec3 viewVec = worldPos - cameraPosition;
    float viewLen = length(viewVec);
    vec3 viewDir = viewVec / viewLen;
    
    // Above water - apply atmospheric fog
    if (worldPos.y > 0.0) {
        float fogStartLen = viewLen;
        if (cameraPosition.y < 0.0) {
            fogStartLen -= cameraPosition.y / -viewDir.y;
        }
        // Simple fog towards horizon
        float fog = clamp(fogStartLen / FOG_DISTANCE, 0.0, 1.0);
        fog = fog * fog; // Quadratic falloff
        vec3 horizonColor = mix(vec3(0.07, 0.13, 0.18), vec3(0.7, 0.85, 0.95), uSunVisibility);
        outgoingLight = mix(outgoingLight, horizonColor, fog);
    }
    // Underwater - apply absorption and underwater fog
    else {
        float uwLen = viewLen;
        float originY = cameraPosition.y;
        if (cameraPosition.y > 0.0) {
            uwLen -= cameraPosition.y / -viewDir.y;
            originY = 0.0;
        }
        uwLen = min(uwLen, MAX_VIEW_DEPTH);
        float sampleY = originY + viewDir.y * uwLen;
        vec3 underwaterLight = exp((sampleY - uwLen * DENSITY) * uAbsorption) * uLight;
        outgoingLight *= underwaterLight;
        // Fade to ocean color at distance
        float uwFog = min(uwLen / MAX_VIEW_DEPTH, 1.0);
        outgoingLight = mix(outgoingLight, underwaterLight * 0.3, uwFog);
    }
`;

// Function to apply ocean lighting to a material using onBeforeCompile
function applyOceanLighting(material) {
    if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial && !material.isMeshBasicMaterial) {
        console.log('Skipping material:', material.type);
        return;
    }
    
    console.log('Applying ocean lighting to material:', material.type, material.name);
    
    // Force unique shader compilation with custom cache key
    material.customProgramCacheKey = () => {
        return 'ocean_' + material.uuid;
    };
    
    material.onBeforeCompile = (shader) => {
        console.log('onBeforeCompile triggered for:', material.type);
        
        // Add uniforms - link directly to the shared uniforms so they update automatically
        shader.uniforms.uLight = lightUniform;
        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
        shader.uniforms.uSunVisibility = sunVisibilityUniform;
        
        // Store reference to update later
        material.userData.oceanUniforms = shader.uniforms;
        
        // Inject uniform declarations into vertex shader (for vWorldPosition)
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldPosition;`
        );
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
        );
        
        // Inject uniform declarations into fragment shader
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldPosition;
            ${oceanLightingPars}`
        );
        
        // Inject lighting modifications before output
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `${oceanLightingFragment}
            #include <dithering_fragment>`
        );
        
        console.log('Shader modified successfully');
    };
    
    material.needsUpdate = true;
}

// Traverse model and apply ocean lighting to all materials
function applyOceanLightingToModel(model) {
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(mat => applyOceanLighting(mat));
            } else {
                applyOceanLighting(child.material);
            }
        }
    });
}

export function Start() {
    // Load island
    loader.load(
        'models/island2.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            island.add(gltf.scene);
            island.position.set(islandPosition.x, islandPosition.y, islandPosition.z);
            island.scale.setScalar(islandScale);
            console.log('Island loaded with ocean lighting');
        },
        (progress) => {
            console.log('Island loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
            console.error('Error loading island:', error);
        }
    );

    // Load firecamp
    loader.load(
        'models/firecamp.glb',
        (gltf) => {
            applyOceanLightingToModel(gltf.scene);
            firecamp.add(gltf.scene);
            // Position firecamp on top of island
            firecamp.position.set(
                islandPosition.x + firecampOffset.x,
                islandPosition.y + firecampOffset.y,
                islandPosition.z + firecampOffset.z
            );
            firecamp.scale.setScalar(firecampScale);
            console.log('Firecamp loaded with ocean lighting');
        },
        (progress) => {
            console.log('Firecamp loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
            console.error('Error loading firecamp:', error);
        }
    );
}

// Collect all materials with ocean uniforms to update them
const materialsToUpdate = [];

export function Update() {
    // Update ocean uniforms for all affected materials
    // The uniforms are linked by reference to dirToLight and absorption,
    // so they update automatically. Only sunVisibility needs manual sync.
}
