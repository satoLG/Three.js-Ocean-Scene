import { BufferAttribute, BufferGeometry, Mesh, PlaneGeometry } from "three";
import * as oceanMaterials from "../materials/OceanMaterial.js";

export const surface = new Mesh();
export const volume = new Mesh();

// Ocean dimensions - sized to cover view from scroll camera
// Camera at (0, Y, 0) looking down -Z axis
const oceanWidth = 400;   // X axis (left-right from camera view)
const oceanDepth = 400;   // Z axis (forward from camera - along -Z)
const oceanVolumeDepth = 100; // How deep underwater

export function Start()
{
    oceanMaterials.Start();

    // Create surface geometry
    // PlaneGeometry creates a plane on XY, we rotate to XZ
    // High segment count for smooth vertex displacement waves
    const surfaceGeometry = new PlaneGeometry(oceanWidth, oceanDepth, 512, 512);
    surfaceGeometry.rotateX(-Math.PI / 2); // Now on XZ plane

    surface.geometry = surfaceGeometry;
    surface.material = oceanMaterials.surface;

    const halfWidth = oceanWidth / 2;
    const halfDepth = oceanDepth / 2;

    // Volume box - underwater area
    const volumeVertices = new Float32Array
    ([
        -halfWidth, -oceanVolumeDepth, -halfDepth,
        halfWidth, -oceanVolumeDepth, -halfDepth,
        -halfWidth, -oceanVolumeDepth, halfDepth,
        halfWidth, -oceanVolumeDepth, halfDepth,

        -halfWidth, 0, -halfDepth,
        halfWidth, 0, -halfDepth,
        -halfWidth, 0, halfDepth,
        halfWidth, 0, halfDepth
    ]);

    const volumeIndices = 
    [
        2, 3, 0, 3, 1, 0,
        0, 1, 4, 1, 5, 4,
        1, 3, 5, 3, 7, 5,
        3, 2, 7, 2, 6, 7,
        2, 0, 6, 0, 4, 6
    ];

    const volumeGeometry = new BufferGeometry();
    volumeGeometry.setAttribute("position", new BufferAttribute(volumeVertices, 3));
    volumeGeometry.setIndex(volumeIndices);

    volume.geometry = volumeGeometry;
    volume.material = oceanMaterials.volume;

    volume.parent = surface;
    surface.add(volume);
    
    // Position ocean in front of camera (camera looks along -Z)
    // Ocean center at Z = -halfDepth so back edge is at Z = 0 (where camera is)
    surface.position.set(0, 0, -halfDepth);
}

export function Update()
{   
    // Ocean is static - no need to follow camera
}