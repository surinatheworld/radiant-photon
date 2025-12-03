import * as THREE from 'three';
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
        const radius = 150;
        const geometry = new THREE.CircleGeometry(radius, 64);
        const material = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
        this.ground = new THREE.Mesh(geometry, material);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);

        // Physics
        const bodyDesc = rapier.RigidBodyDesc.fixed();
        const body = world.createRigidBody(bodyDesc);
        // Cylinder collider for ground (radius, half-height)
        const colliderDesc = rapier.ColliderDesc.cylinder(0.1, radius)
            .setCollisionGroups(0x0002FFFF); // Group 2 (Ground)
        world.createCollider(colliderDesc, body);
    }

    createWall() {
        // Giant Circular Wall
        const radius = 150;
        const height = 50;
        const thickness = 5;

        // Visuals: Cylinder with open top/bottom, double sided
        const geometry = new THREE.CylinderGeometry(radius, radius, height, 64, 1, true);
        const material = new THREE.MeshStandardMaterial({ color: 0x888888, side: THREE.DoubleSide });
        this.wall = new THREE.Mesh(geometry, material);
        this.wall.position.y = height / 2;
        this.wall.receiveShadow = true;
        this.wall.castShadow = true;
        this.scene.add(this.wall);

        // Physics: Trimesh for accurate hollow cylinder collision
        // We need to extract vertices and indices from the geometry
        const positions = geometry.attributes.position.array;
        const indices = geometry.index.array;

        const bodyDesc = rapier.RigidBodyDesc.fixed()
            .setTranslation(0, height / 2, 0);
        const body = world.createRigidBody(bodyDesc);

        const colliderDesc = rapier.ColliderDesc.trimesh(positions, indices)
            .setCollisionGroups(0x0001FFFF); // Group 1 (Obstacles)
        world.createCollider(colliderDesc, body);
    }

    createBuildings() {
        const count = 100;
        const minRadius = 20; // Don't spawn too close to center (spawn area)
        const maxRadius = 130; // Leave space near wall

        const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
        const boxMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });

        for (let i = 0; i < count; i++) {
            // Random Position in Annulus
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random() * (maxRadius ** 2 - minRadius ** 2) + minRadius ** 2);
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;

            // Random Size
            const w = 5 + Math.random() * 10;
            const d = 5 + Math.random() * 10;
            const h = 10 + Math.random() * 30; // Height 10m - 40m

            // Visuals
            const mesh = new THREE.Mesh(boxGeometry, boxMaterial);
            mesh.position.set(x, h / 2, z);
            mesh.scale.set(w, h, d);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.buildings.push(mesh);

            // Physics
            const bodyDesc = rapier.RigidBodyDesc.fixed()
                .setTranslation(x, h / 2, z);
            const body = world.createRigidBody(bodyDesc);
            const colliderDesc = rapier.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
                .setCollisionGroups(0x0001FFFF); // Group 1 (Obstacles)
            world.createCollider(colliderDesc, body);
        }
    }
}
