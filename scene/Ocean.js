import { BufferAttribute, BufferGeometry, Mesh, PlaneGeometry } from "three";
import * as oceanMaterials from "../materials/OceanMaterial.js";
import { camera } from "../scripts/Scene.js";

export const surface = new Mesh();
export const volume = new Mesh();

export function Start()
{
    oceanMaterials.Start();

    const halfSize = 1500;
    const depth = 1000;

    // Use PlaneGeometry with subdivisions for vertex displacement waves
    // 64 segments = 65x65 = 4,225 vertices - enough for visible horizon waves
    const surfaceGeometry = new PlaneGeometry(halfSize * 2, halfSize * 2, 64, 64);
    surfaceGeometry.rotateX(-Math.PI / 2); // Rotate to be horizontal (XZ plane)

    surface.geometry = surfaceGeometry;
    surface.material = oceanMaterials.surface;

    const volumeVertices = new Float32Array
    ([
        -halfSize, -depth, -halfSize,
        halfSize, -depth, -halfSize,
        -halfSize, -depth, halfSize,
        halfSize, -depth, halfSize,

        -halfSize, 0, -halfSize,
        halfSize, 0, -halfSize,
        -halfSize, 0, halfSize,
        halfSize, 0, halfSize
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
}

export function Update()
{   
    surface.position.set(camera.position.x, 0, camera.position.z);
}