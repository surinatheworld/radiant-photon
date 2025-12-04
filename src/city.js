import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { rapier, world } from './physics.js';

export class City {
    constructor(scene) {
        this.scene = scene;
        this.buildings = [];
        this.wall = null;
        this.ground = null;

        this.init();
    }

    init() {
        this.createGround();
        this.createWall();
        this.createBuildings();
    }

    createGround() {
        // Large Circular Ground
        const radius = 700;
        const geometry = new THREE.CircleGeometry(radius, 64);
        const material = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
        this.ground = new THREE.Mesh(geometry, material);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);

        // Physics
        const bodyDesc = rapier.RigidBodyDesc.fixed();
        const body = world.createRigidBody(bodyDesc);
        const colliderDesc = rapier.ColliderDesc.cylinder(0.1, radius)
            .setCollisionGroups(0x0002FFFF);
        world.createCollider(colliderDesc, body);
    }

    createWall() {
        const loader = new FBXLoader();
        const baseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
        const modelPath = `${baseUrl}wall.fbx`;

        loader.load(modelPath, (fbx) => {
            console.log('✅ Wall FBX Loaded');

            const box = new THREE.Box3().setFromObject(fbx);
            const size = new THREE.Vector3();
            box.getSize(size);

            const targetHeight = 50;
            const scale = targetHeight / size.y;
            fbx.scale.set(scale, scale, scale);

            box.setFromObject(fbx);
            const center = new THREE.Vector3();
            box.getCenter(center);

            fbx.position.set(-center.x, -center.y, -center.z);
            this.scene.add(fbx);

            // Physics
            fbx.traverse((child) => {
                if (child.isMesh) {
                    const scaledGeo = child.geometry.clone();
                    scaledGeo.scale(scale, scale, scale);

                    const scaledPositions = scaledGeo.attributes.position.array;
                    let scaledIndices = scaledGeo.index ? scaledGeo.index.array : undefined;

                    if (!scaledIndices) {
                        const count = scaledPositions.length / 3;
                        scaledIndices = new Uint32Array(count);
                        for (let i = 0; i < count; i++) scaledIndices[i] = i;
                    }

                    const bodyDesc = rapier.RigidBodyDesc.fixed();
                    const body = world.createRigidBody(bodyDesc);

                    const colliderDesc = rapier.ColliderDesc.trimesh(scaledPositions, scaledIndices);
                    if (colliderDesc) world.createCollider(colliderDesc, body);
                }
            });

        }, undefined, (err) => {
            console.error('❌ Error loading wall.fbx:', err);
        });
    }

    createBuildings() {
        const loader = new GLTFLoader();
        const baseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
        const modelPath = `${baseUrl}building.glb`;

        loader.load(modelPath, (gltf) => {
            console.log('✅ Building GLB Loaded');

            const originalModel = gltf.scene;

            // Measure original size
            const box = new THREE.Box3().setFromObject(originalModel);
            const originalSize = new THREE.Vector3();
            box.getSize(originalSize);

            // Generate random buildings (3x denser)
            const buildingConfigs = [];
            const cityRadius = 140;
            const minDistance = 20; // Min distance between buildings
            const numBuildings = 60; // 3x more buildings

            // Generate random positions
            for (let i = 0; i < numBuildings; i++) {
                let x, z, valid;
                let attempts = 0;

                do {
                    valid = true;
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 40 + Math.random() * (cityRadius - 40);
                    x = Math.cos(angle) * dist;
                    z = Math.sin(angle) * dist;

                    // Check distance from other buildings
                    for (const config of buildingConfigs) {
                        const dx = x - config.x;
                        const dz = z - config.z;
                        if (Math.sqrt(dx * dx + dz * dz) < minDistance) {
                            valid = false;
                            break;
                        }
                    }
                    attempts++;
                } while (!valid && attempts < 50);

                if (valid) {
                    // Random height: 5-25m
                    const height = 5 + Math.random() * 20;
                    const rotation = Math.random() * Math.PI * 2;
                    buildingConfigs.push({ x, z, height, rotation });
                }
            }

            buildingConfigs.forEach((config, index) => {
                // Clone the model
                const building = originalModel.clone();

                // Calculate scale for target height
                const scale = config.height / originalSize.y;
                building.scale.set(scale, scale, scale);

                // Position and rotate
                building.position.set(config.x, 0, config.z);
                building.rotation.y = config.rotation;

                // Enable shadows
                building.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                this.scene.add(building);
                this.buildings.push(building);

                // Physics - box collider based on scaled size
                const scaledWidth = originalSize.x * scale;
                const scaledHeight = originalSize.y * scale;
                const scaledDepth = originalSize.z * scale;

                const bodyDesc = rapier.RigidBodyDesc.fixed()
                    .setTranslation(config.x, 0, config.z)
                    .setRotation({
                        x: 0,
                        y: Math.sin(config.rotation / 2),
                        z: 0,
                        w: Math.cos(config.rotation / 2)
                    });
                const rigidBody = world.createRigidBody(bodyDesc);

                // Main body collider
                const bodyCollider = rapier.ColliderDesc.cuboid(
                    scaledWidth / 2,
                    scaledHeight / 2,
                    scaledDepth / 2
                ).setTranslation(0, scaledHeight / 2, 0);
                world.createCollider(bodyCollider, rigidBody);

                // Add stairs for ALL buildings (scaled to size)
                this.addStairs(rigidBody, scaledWidth, scaledHeight, scaledDepth, config.rotation);
            });

            console.log(`🏠 Spawned ${this.buildings.length} buildings with model`);

        }, undefined, (err) => {
            console.error('❌ Error loading building.glb:', err);
        });
    }

    addStairs(rigidBody, houseWidth, houseHeight, houseDepth, rotation) {
        const stairMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });

        // Scale stairs based on house size
        const scaleFactor = Math.max(houseHeight / 10, 0.5);
        const stepHeight = 0.5;
        const numSteps = Math.floor(houseHeight / stepHeight);
        const stepDepth = 1.5 * scaleFactor;
        const stepWidth = Math.min(3 * scaleFactor, houseWidth * 0.8);

        const worldPos = rigidBody.translation();
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);

        for (let s = 0; s < numSteps; s++) {
            // Local position relative to house
            const localX = houseWidth / 2 + stepDepth / 2 + (numSteps - 1 - s) * stepDepth;
            const localY = stepHeight / 2 + s * stepHeight;
            const localZ = 0;

            // Rotate around house center to get world position
            const rotX = localX * cos - localZ * sin;
            const rotZ = localX * sin + localZ * cos;
            const worldX = worldPos.x + rotX;
            const worldZ = worldPos.z + rotZ;

            // Visual stairs
            const stepGeo = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth);
            const stepMesh = new THREE.Mesh(stepGeo, stairMaterial);
            stepMesh.position.set(worldX, localY, worldZ);
            stepMesh.rotation.y = rotation;
            stepMesh.castShadow = true;
            stepMesh.receiveShadow = true;
            this.scene.add(stepMesh);

            // Physics - create separate fixed body for each step
            const stepBodyDesc = rapier.RigidBodyDesc.fixed()
                .setTranslation(worldX, localY, worldZ)
                .setRotation({
                    x: 0,
                    y: Math.sin(rotation / 2),
                    z: 0,
                    w: Math.cos(rotation / 2)
                });
            const stepBody = world.createRigidBody(stepBodyDesc);

            const stepCollider = rapier.ColliderDesc.cuboid(
                stepWidth / 2,
                stepHeight / 2,
                stepDepth / 2
            );
            world.createCollider(stepCollider, stepBody);
        }
    }
}
