import { Group, Vector3, TextureLoader, RepeatWrapping, SRGBColorSpace, MeshStandardMaterial } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { oceanAbsorptionUniform } from "../materials/OceanMaterial.js";
import { lightUniform, sunVisibilityUniform } from "../materials/SkyboxMaterial.js";
import { deltaTime } from "../scripts/Time.js";

export const island = new Group();
export const firecamp = new Group();

const loader = new GLTFLoader();
const textureLoader = new TextureLoader();

// Texture paths
const SAND_TEXTURE_PATH = 'textures/sand_04_2k/';
const CONCRETE_TEXTURE_PATH = 'textures/concrete_wall_01_2k/';
const ROCKS_TEXTURE_PATH = 'textures/ground_with_rocks_01_1k/';

// Load sand textures
const sandColorMap = textureLoader.load(SAND_TEXTURE_PATH + 'sand_04_color_2k.png');
const sandNormalMap = textureLoader.load(SAND_TEXTURE_PATH + 'sand_04_normal_gl_2k.png');
const sandRoughnessMap = textureLoader.load(SAND_TEXTURE_PATH + 'sand_04_roughness_2k.png');
const sandAOMap = textureLoader.load(SAND_TEXTURE_PATH + 'sand_04_ambient_occlusion_2k.png');
const sandDisplacementMap = textureLoader.load(SAND_TEXTURE_PATH + 'sand_04_height_2k.png');

// Load concrete textures
const concreteColorMap = textureLoader.load(CONCRETE_TEXTURE_PATH + 'concrete_wall_01_color_2k.png');
const concreteNormalMap = textureLoader.load(CONCRETE_TEXTURE_PATH + 'concrete_wall_01_normal_gl_2k.png');
const concreteRoughnessMap = textureLoader.load(CONCRETE_TEXTURE_PATH + 'concrete_wall_01_roughness_2k.png');
const concreteAOMap = textureLoader.load(CONCRETE_TEXTURE_PATH + 'concrete_wall_01_ambient_occlusion_2k.png');
const concreteDisplacementMap = textureLoader.load(CONCRETE_TEXTURE_PATH + 'concrete_wall_01_height_2k.png');

// Load rocks texture (for bottom of island)
const rocksColorMap = textureLoader.load(ROCKS_TEXTURE_PATH + 'ground_with_rocks_01_color_1k.png');

// Configure texture settings for all textures
const allTextures = [
    sandColorMap, sandNormalMap, sandRoughnessMap, sandAOMap, sandDisplacementMap,
    concreteColorMap, concreteNormalMap, concreteRoughnessMap, concreteAOMap, concreteDisplacementMap,
    rocksColorMap
];

allTextures.forEach(texture => {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(4, 4); // Tile the texture for better detail
});

// Color maps need sRGB color space for correct colors
sandColorMap.colorSpace = SRGBColorSpace;
concreteColorMap.colorSpace = SRGBColorSpace;
rocksColorMap.colorSpace = SRGBColorSpace;

// ============================================
// HEIGHT BLEND SETTINGS (easily tweakable)
// ============================================
// Height at which the blend starts (world Y coordinate)
const ROCKS_BLEND_START = -0.2;
// Height at which the blend ends (fully top texture)
const ROCKS_BLEND_END = -0.1;
// ============================================

// Texture blend state
let currentTexture = 'sand'; // 'sand' or 'concrete'
let textureBlend = 0.0; // 0 = sand, 1 = concrete
let targetBlend = 0.0;
const blendSpeed = 2.0; // How fast to transition (per second)

// Store materials that need texture blending
const blendableMaterials = [];

// Export function to toggle texture
export function toggleIslandTexture() {
    if (currentTexture === 'sand') {
        currentTexture = 'concrete';
        targetBlend = 1.0;
    } else {
        currentTexture = 'sand';
        targetBlend = 0.0;
    }
    return currentTexture;
}

// Export current texture state
export function getCurrentTexture() {
    return currentTexture;
}

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

// Function to apply ocean lighting AND texture blending to a material
function applyIslandMaterial(material, blendUniform) {
    if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial && !material.isMeshBasicMaterial) {
        console.log('Skipping material:', material.type);
        return;
    }
    
    console.log('Applying island material to:', material.type, material.name);
    
    // Force unique shader compilation with custom cache key
    material.customProgramCacheKey = () => {
        return 'island_blend_ocean_' + material.uuid;
    };
    
    material.onBeforeCompile = (shader) => {
        console.log('onBeforeCompile triggered for:', material.type);
        
        // === OCEAN LIGHTING UNIFORMS ===
        shader.uniforms.uLight = lightUniform;
        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
        shader.uniforms.uSunVisibility = sunVisibilityUniform;
        
        // === TEXTURE BLENDING UNIFORMS ===
        shader.uniforms.uTextureBlend = blendUniform;
        shader.uniforms.uSandMap = { value: sandColorMap };
        shader.uniforms.uConcreteMap = { value: concreteColorMap };
        shader.uniforms.uRocksMap = { value: rocksColorMap };
        shader.uniforms.uTextureScale = { value: 0.5 }; // World-space texture scale
        shader.uniforms.uRocksBlendStart = { value: ROCKS_BLEND_START };
        shader.uniforms.uRocksBlendEnd = { value: ROCKS_BLEND_END };
        
        // Store reference to update later
        material.userData.oceanUniforms = shader.uniforms;
        
        // === VERTEX SHADER MODIFICATIONS ===
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldPosition;
            varying vec3 vWorldNormal;`
        );
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);`
        );
        
        // === FRAGMENT SHADER MODIFICATIONS ===
        // Add all uniform declarations and triplanar function
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldPosition;
            varying vec3 vWorldNormal;
            
            // Texture blending
            uniform float uTextureBlend;
            uniform sampler2D uSandMap;
            uniform sampler2D uConcreteMap;
            uniform sampler2D uRocksMap;
            uniform float uTextureScale;
            uniform float uRocksBlendStart;
            uniform float uRocksBlendEnd;
            
            // Triplanar mapping function to eliminate UV seams
            vec4 triplanarSample(sampler2D tex, vec3 worldPos, vec3 worldNormal, float scale) {
                // Calculate blend weights based on normal direction
                vec3 blendWeights = abs(worldNormal);
                // Sharpen the blend to reduce blurry transitions
                blendWeights = pow(blendWeights, vec3(4.0));
                // Normalize weights
                blendWeights = blendWeights / (blendWeights.x + blendWeights.y + blendWeights.z);
                
                // Sample texture from 3 projections
                vec3 scaledPos = worldPos * scale;
                vec4 xProj = texture2D(tex, scaledPos.yz);
                vec4 yProj = texture2D(tex, scaledPos.xz);
                vec4 zProj = texture2D(tex, scaledPos.xy);
                
                // Blend based on normal
                return xProj * blendWeights.x + yProj * blendWeights.y + zProj * blendWeights.z;
            }
            
            ${oceanLightingPars}`
        );
        
        // Replace the entire map_fragment to use triplanar mapping with height-based rocks blend
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `// Triplanar texture sampling (replaces UV-based sampling)
            vec4 sandColor = triplanarSample(uSandMap, vWorldPosition, vWorldNormal, uTextureScale);
            vec4 concreteColor = triplanarSample(uConcreteMap, vWorldPosition, vWorldNormal, uTextureScale);
            vec4 rocksColor = triplanarSample(uRocksMap, vWorldPosition, vWorldNormal, uTextureScale);
            
            // First blend between sand and concrete based on button toggle
            vec4 topTexture = mix(sandColor, concreteColor, uTextureBlend);
            
            // Height-based blend: rocks at bottom, top texture above
            // smoothstep creates a gradual transition between uRocksBlendStart and uRocksBlendEnd
            float heightBlend = smoothstep(uRocksBlendStart, uRocksBlendEnd, vWorldPosition.y);
            
            // Mix rocks (bottom) with top texture based on height
            vec4 blendedTexture = mix(rocksColor, topTexture, heightBlend);
            
            // Apply to diffuse color
            diffuseColor *= blendedTexture;`
        );
        
        // Inject ocean lighting modifications before output
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `${oceanLightingFragment}
            #include <dithering_fragment>`
        );
        
        console.log('Island shader modified with triplanar blending and ocean lighting');
    };
    
    material.needsUpdate = true;
}

// Traverse model and apply ocean lighting to all materials (for firecamp only)
function applyOceanLightingToModel(model) {
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshBasicMaterial) {
                    // Use a simple ocean-only version for non-island objects
                    mat.customProgramCacheKey = () => 'ocean_' + mat.uuid;
                    mat.onBeforeCompile = (shader) => {
                        shader.uniforms.uLight = lightUniform;
                        shader.uniforms.uAbsorption = oceanAbsorptionUniform;
                        shader.uniforms.uSunVisibility = sunVisibilityUniform;
                        
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
                        shader.fragmentShader = shader.fragmentShader.replace(
                            '#include <common>',
                            `#include <common>
                            varying vec3 vWorldPosition;
                            ${oceanLightingPars}`
                        );
                        shader.fragmentShader = shader.fragmentShader.replace(
                            '#include <dithering_fragment>',
                            `${oceanLightingFragment}
                            #include <dithering_fragment>`
                        );
                    };
                    mat.needsUpdate = true;
                }
            });
        }
    });
}

// Apply textures and shader modifications to island
function applyIslandTextures(model) {
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            
            materials.forEach(material => {
                if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
                    console.log('Setting up island material for:', child.name);
                    
                    // Use triplanar for color (no UV seams)
                    // Displacement not used - causes gaps due to bad UVs on modified cube
                    material.map = null;
                    material.normalMap = null;
                    material.roughnessMap = null;
                    material.aoMap = null;
                    material.displacementMap = null;
                    
                    material.roughness = 0.9;
                    material.metalness = 0.0;
                    
                    // Create blend uniform for this material
                    const blendUniform = { value: 0.0 };
                    blendableMaterials.push({ material, blendUniform });
                    
                    // Apply combined shader modifications
                    applyIslandMaterial(material, blendUniform);
                }
            });
        }
    });
}

export function Start() {
    // Load island
    loader.load(
        'models/island2.glb',
        (gltf) => {
            // Apply island textures with blending support
            applyIslandTextures(gltf.scene);
            island.add(gltf.scene);
            island.position.set(islandPosition.x, islandPosition.y, islandPosition.z);
            island.scale.setScalar(islandScale);
            console.log('Island loaded with texture blending and ocean lighting');
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
        'models/firecamp2.glb',
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
    // Smoothly interpolate texture blend
    if (textureBlend !== targetBlend) {
        const diff = targetBlend - textureBlend;
        const step = blendSpeed * deltaTime;
        
        if (Math.abs(diff) < step) {
            textureBlend = targetBlend;
        } else {
            textureBlend += Math.sign(diff) * step;
        }
        
        // Update all blendable materials
        blendableMaterials.forEach(({ blendUniform }) => {
            blendUniform.value = textureBlend;
        });
    }
}
