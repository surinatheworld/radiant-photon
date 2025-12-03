import * as THREE from 'three';
import { rapier, world } from './physics.js';

export class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.body = null;

        this.init();
    }

    init() {
        // 1. Create Visual Mesh (Capsule)
        const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
        const material = new THREE.MeshStandardMaterial({ color: 0x00aaff });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        this.scene.add(this.mesh);

        // 2. Create Physics Body
        // RigidBody: Dynamic (affected by forces)
        let rigidBodyDesc = rapier.RigidBodyDesc.dynamic()
            .setTranslation(0, 5, 0)
            .setCanSleep(false)
            .lockRotations(); // Keep player upright
        this.body = world.createRigidBody(rigidBodyDesc);

        // Collider: Capsule
        let colliderDesc = rapier.ColliderDesc.capsule(0.5, 0.5)
            .setFriction(1.0); // Add friction so we don't slide forever
        world.createCollider(colliderDesc, this.body);

        this.setupInput();
    }

    setupInput() {
        this.keys = {
            w: false,
            a: false,
            s: false,
            d: false,
            space: false
        };

        window.addEventListener('keydown', (e) => {
            switch (e.key.toLowerCase()) {
                case 'w': this.keys.w = true; break;
                case 'a': this.keys.a = true; break;
                case 's': this.keys.s = true; break;
                case 'd': this.keys.d = true; break;
                case ' ': this.keys.space = true; break;
            }
        });

        window.addEventListener('keyup', (e) => {
            switch (e.key.toLowerCase()) {
                case 'w': this.keys.w = false; break;
                case 'a': this.keys.a = false; break;
                case 's': this.keys.s = false; break;
                case 'd': this.keys.d = false; break;
                case ' ': this.keys.space = false; break;
            }
        });
    }

    update(camera) {
        if (this.body && this.mesh) {
            // 1. Handle Movement
            const speed = 15.0;
            const jumpForce = 10.0;

            // Get current velocity
            const linvel = this.body.linvel();

            // Calculate desired movement direction relative to camera
            let moveDir = new THREE.Vector3(0, 0, 0);
            if (this.keys.w) moveDir.z -= 1;
            if (this.keys.s) moveDir.z += 1;
            if (this.keys.a) moveDir.x -= 1;
            if (this.keys.d) moveDir.x += 1;

            if (moveDir.length() > 0) {
                moveDir.normalize();

                // Align with camera (ignore Y)
                const camForward = new THREE.Vector3();
                camera.getWorldDirection(camForward);
                camForward.y = 0;
                camForward.normalize();

                const camRight = new THREE.Vector3();
                camRight.crossVectors(camForward, new THREE.Vector3(0, 1, 0));

                const finalDir = new THREE.Vector3()
                    .addScaledVector(camForward, -moveDir.z) // W/S moves along forward
                    .addScaledVector(camRight, moveDir.x);   // A/D moves along right

                // Apply movement force
                this.body.setLinvel({
                    x: finalDir.x * speed,
                    y: linvel.y,
                    z: finalDir.z * speed
                }, true);

                // Rotate mesh to face movement direction
                const angle = Math.atan2(finalDir.x, finalDir.z);
                const targetRotation = new THREE.Quaternion();
                targetRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                this.mesh.quaternion.slerp(targetRotation, 0.2); // Smooth rotation
            } else {
                // Stop horizontal movement if no keys pressed (friction simulation)
                this.body.setLinvel({ x: 0, y: linvel.y, z: 0 }, true);
            }

            // Jump
            if (this.keys.space) {
                // Simple ground check (raycast down)
                const ray = new rapier.Ray(this.body.translation(), { x: 0, y: -1, z: 0 });
                const hit = world.castRay(ray, 1.1, true);
                if (hit && hit.timeOfImpact < 1.1) {
                    this.body.applyImpulse({ x: 0, y: jumpForce, z: 0 }, true);
                    this.keys.space = false; // Prevent bunny hopping
                }
            }

            // Sync visual mesh position (Rotation is handled above for Y-axis, but we need to preserve it)
            const position = this.body.translation();
            this.mesh.position.set(position.x, position.y, position.z);
            // Note: We don't sync rotation from physics body because we locked it. 
            // We control mesh rotation manually for visual facing.
        }
    }
}
