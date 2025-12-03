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
            .setFriction(1.0) // Add friction so we don't slide forever
            .setCollisionGroups(0x0001FFFF); // Membership: Group 0, Filter: All
        world.createCollider(colliderDesc, this.body);

        this.setupInput();

        // ODM Gear Setup
        this.hooks = {
            left: {
                state: 'IDLE', // IDLE, SHOOTING, ATTACHED
                joint: null,
                line: null,
                target: new THREE.Vector3(),
                currentPos: new THREE.Vector3(), // For animation
                shootSpeed: 100.0 // Units per second
            },
            right: {
                state: 'IDLE',
                joint: null,
                line: null,
                target: new THREE.Vector3(),
                currentPos: new THREE.Vector3(),
                shootSpeed: 100.0
            }
        };
        this.aiming = { left: false, right: false };
        this.ropeMaterial = new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 2 });
    }

    setupInput() {
        this.keys = {
            w: false, a: false, s: false, d: false, space: false,
            q: false, e: false, r: false
        };

        window.addEventListener('keydown', (e) => {
            switch (e.key.toLowerCase()) {
                case 'w': this.keys.w = true; break;
                case 'a': this.keys.a = true; break;
                case 's': this.keys.s = true; break;
                case 'd': this.keys.d = true; break;
                case ' ': this.keys.space = true; break;
                case 'q':
                    if (!this.keys.q) { // Prevent repeat
                        this.keys.q = true;
                        this.shootHook('left');
                    }
                    break;
                case 'e':
                    if (!this.keys.e) {
                        this.keys.e = true;
                        this.shootHook('right');
                    }
                    break;
                case 'r': this.keys.r = true; break;
            }
        });

        window.addEventListener('keyup', (e) => {
            switch (e.key.toLowerCase()) {
                case 'w': this.keys.w = false; break;
                case 'a': this.keys.a = false; break;
                case 's': this.keys.s = false; break;
                case 'd': this.keys.d = false; break;
                case ' ': this.keys.space = false; break;
                case 'q':
                    this.keys.q = false;
                    this.releaseHook('left');
                    break;
                case 'e':
                    this.keys.e = false;
                    this.releaseHook('right');
                    break;
                case 'r': this.keys.r = false; break;
            }
        });

        // Mouse Input for Attack (LMB)
        window.addEventListener('mousedown', (e) => {
            if (document.pointerLockElement !== document.body) return;
            if (e.button === 0) {
                this.attack();
            }
        });
    }

    attack() {
        // Placeholder for Attack Logic
        const vel = this.body.linvel();
        const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
        console.log(`Attack! Speed: ${speed.toFixed(2)}`);
    }

    shootHook(side) {
        // If already active, replace it
        this.clearHook(side);

        if (!this.lastCamDir || !this.lastCamPos) return;

        // Raycast from Camera (for aiming)
        // Interaction Group: 0x00000002 (Filter: 2 -> Obstacles only, ignores Ground(4) and Player(1))
        const ray = new rapier.Ray(this.lastCamPos, this.lastCamDir);
        const hit = world.castRay(ray, 100.0, true, 0x00000002);

        if (hit) {
            const hitPoint = ray.pointAt(hit.timeOfImpact);
            const hook = this.hooks[side];

            hook.state = 'SHOOTING';
            hook.target.copy(hitPoint);

            // Initial position is at the waist
            const playerPos = this.mesh.position;
            const offset = side === 'left' ? -0.5 : 0.5;
            const waistPos = new THREE.Vector3(offset, 0, 0).applyQuaternion(this.mesh.quaternion).add(playerPos);
            hook.currentPos.copy(waistPos);

            // Store hit collider handle for joint creation later
            hook.hitColliderHandle = hit.colliderHandle;

            // Create Line Visual
            const geometry = new THREE.BufferGeometry().setFromPoints([
                waistPos,
                waistPos // Initially start and end are same
            ]);
            hook.line = new THREE.Line(geometry, this.ropeMaterial);
            this.scene.add(hook.line);
        }
    }

    releaseHook(side) {
        this.clearHook(side);
    }

    clearHook(side) {
        const hook = this.hooks[side];
        if (hook.state !== 'IDLE') {
            hook.state = 'IDLE';
            if (hook.line) {
                this.scene.remove(hook.line);
                hook.line = null;
            }
            if (hook.joint) {
                world.removeImpulseJoint(hook.joint, true);
                hook.joint = null;
            }
        }
    }

    update(camera) {
        if (this.body && this.mesh) {
            this.lastCamPos = camera.position;
            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            this.lastCamDir = camDir;

            // Zoom Logic
            const targetFov = (this.hooks.left.state !== 'IDLE' || this.hooks.right.state !== 'IDLE') ? 60 : 75;
            if (Math.abs(camera.fov - targetFov) > 0.1) {
                camera.fov += (targetFov - camera.fov) * 0.1;
                camera.updateProjectionMatrix();
            }

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

                // Apply movement force (Air Control if swinging)
                const isSwinging = this.hooks.left.state === 'ATTACHED' || this.hooks.right.state === 'ATTACHED';
                const moveSpeed = isSwinging ? speed * 0.3 : speed; // Reduced control while swinging

                this.body.setLinvel({
                    x: finalDir.x * moveSpeed,
                    y: linvel.y,
                    z: finalDir.z * moveSpeed
                }, true);

                // Rotate mesh to face movement direction
                const angle = Math.atan2(finalDir.x, finalDir.z);
                const targetRotation = new THREE.Quaternion();
                targetRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                this.mesh.quaternion.slerp(targetRotation, 0.2); // Smooth rotation
            } else {
                // Friction only if grounded and not swinging
                const isSwinging = this.hooks.left.state === 'ATTACHED' || this.hooks.right.state === 'ATTACHED';
                if (!isSwinging) {
                    this.body.setLinvel({ x: 0, y: linvel.y, z: 0 }, true);
                }
            }

            // Jump (Double Jump allowed)
            // Check ground status every frame to reset jump count
            const ray = new rapier.Ray(this.body.translation(), { x: 0, y: -1, z: 0 });
            const hit = world.castRay(ray, 1.1, true);
            const isGrounded = hit && hit.timeOfImpact < 1.1;

            if (isGrounded) {
                this.jumpCount = 0;
            }

            if (this.keys.space) {
                // Note: Jump no longer clears hooks automatically, allowing for "jump boost" while swinging?
                // User didn't specify, but usually jump helps detach or boost. 
                // Let's keep it simple: Jump adds vertical force.

                if (this.jumpCount === undefined) this.jumpCount = 0;
                if (this.jumpCount < 2) {
                    const vel = this.body.linvel();
                    this.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);
                    this.body.applyImpulse({ x: 0, y: jumpForce, z: 0 }, true);
                    this.jumpCount++;
                    this.keys.space = false;
                }
            }

            // 3. Gas Boost (R)
            if (this.keys.r) {
                // Boost in camera direction
                const boostForce = 2.0;
                this.body.applyImpulse({
                    x: camDir.x * boostForce,
                    y: camDir.y * boostForce,
                    z: camDir.z * boostForce
                }, true);
            }

            // 4. Hook Physics (Slingshot & Pendulum)
            const playerPos = this.body.translation();
            const playerVec = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);
            const dt = 1 / 60; // Approximate frame time

            ['left', 'right'].forEach(side => {
                const hook = this.hooks[side];

                // Calculate Waist Origin for Visuals
                const offset = side === 'left' ? -0.5 : 0.5;
                const waistPos = new THREE.Vector3(offset, 0, 0).applyQuaternion(this.mesh.quaternion).add(playerVec);

                if (hook.state === 'SHOOTING') {
                    // Animate Hook Travel
                    const distToTarget = hook.currentPos.distanceTo(hook.target);
                    const travelDist = hook.shootSpeed * dt;

                    if (travelDist >= distToTarget) {
                        // Hit Target
                        hook.currentPos.copy(hook.target);
                        hook.state = 'ATTACHED';
                    } else {
                        // Move towards target
                        const dir = new THREE.Vector3().subVectors(hook.target, hook.currentPos).normalize();
                        hook.currentPos.addScaledVector(dir, travelDist);
                    }

                    // Update Line
                    const positions = hook.line.geometry.attributes.position.array;
                    positions[0] = waistPos.x; positions[1] = waistPos.y; positions[2] = waistPos.z;
                    positions[3] = hook.currentPos.x; positions[4] = hook.currentPos.y; positions[5] = hook.currentPos.z;
                    hook.line.geometry.attributes.position.needsUpdate = true;

                } else if (hook.state === 'ATTACHED') {
                    // Update Line
                    const positions = hook.line.geometry.attributes.position.array;
                    positions[0] = waistPos.x; positions[1] = waistPos.y; positions[2] = waistPos.z;
                    // End point is fixed at target
                    positions[3] = hook.target.x; positions[4] = hook.target.y; positions[5] = hook.target.z;
                    hook.line.geometry.attributes.position.needsUpdate = true;

                    // Apply Physics (Hooke's Law + Reel In)
                    const dist = playerVec.distanceTo(hook.target);
                    const dir = new THREE.Vector3().subVectors(hook.target, playerVec).normalize();

                    // Spring Force
                    // F = -k * x (where x is displacement from rest length)
                    // We want to pull IN, so we treat rest length as 0 (or shortening).

                    const k = 50.0; // Stiffness
                    const forceMag = k * dist; // Pull harder the further away we are? 
                    // Or constant pull? Anime is constant reel-in.

                    // Let's use Constant Reel-In Force + Spring Damping
                    const reelForce = 80.0;

                    this.body.applyImpulse({
                        x: dir.x * reelForce * dt,
                        y: dir.y * reelForce * dt,
                        z: dir.z * reelForce * dt
                    }, true);

                    // Add "Swing" tangential force?
                    // Natural gravity handles swinging if we have a constraint. 
                    // Since we don't have a hard constraint, we rely on the pull to keep us in orbit.
                }
            });

            // Sync visual mesh position (Rotation is handled above for Y-axis, but we need to preserve it)
            const position = this.body.translation();
            this.mesh.position.set(position.x, position.y, position.z);
            // Note: We don't sync rotation from physics body because we locked it. 
            // We control mesh rotation manually for visual facing.
        }
    }
}
