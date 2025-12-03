import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { rapier, world } from './physics.js';

export class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.body = null;
        this.mixer = null; // Animation Mixer
        this.mixer = null; // Animation Mixer
        this.animations = {}; // Store animations (Map: Name -> Action)
        this.currentAction = null; // Currently playing action

        this.init();
    }

    init() {
        // Create a temporary placeholder mesh until model loads to avoid errors in update()
        if (!this.mesh) {
            const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
            // Yellow = Loading
            const material = new THREE.MeshStandardMaterial({ color: 0xffff00, transparent: true, opacity: 0.5 });
            this.mesh = new THREE.Mesh(geometry, material);
            this.scene.add(this.mesh);
        }

        // 1. Load Visual Mesh (GLB)
        const loader = new GLTFLoader();
        // Use BASE_URL to handle deployment path correctly
        const baseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
        const modelPath = `${baseUrl}player.glb`;
        console.log('Loading model from:', modelPath);

        loader.load(modelPath, (gltf) => {
            const object = gltf.scene;
            console.log('GLB Loaded', object);

            object.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            // Auto-scale logic
            const box = new THREE.Box3().setFromObject(object);
            const size = new THREE.Vector3();
            box.getSize(size);

            const targetHeight = 2.5; // Target height in meters
            const scaleFactor = targetHeight / size.y;
            object.scale.set(scaleFactor, scaleFactor, scaleFactor);

            // Adjust Y position to align feet
            object.position.y = -1.0;
            object.rotation.y = 0;

            // Remove placeholder if it exists
            if (this.mesh) {
                this.scene.remove(this.mesh);
                this.mesh = new THREE.Group();
                this.mesh.add(object);
                this.scene.add(this.mesh);
            }

            // Add BoxHelper to visualize
            const boxHelper = new THREE.BoxHelper(object, 0xffff00);
            this.scene.add(boxHelper);

            // Animation Setup
            this.mixer = new THREE.AnimationMixer(object);

            // Store Idle Animation (from GLB)
            if (gltf.animations.length > 0) {
                const idleAction = this.mixer.clipAction(gltf.animations[0]);
                this.animations['Idle'] = idleAction;
                this.currentAction = idleAction;
                this.currentAction.play();
            }

            // Load Run Animation (Run.fbx)
            const runLoader = new FBXLoader();
            const runPath = `${baseUrl}Run.fbx`;
            console.log('Loading Run animation from:', runPath);

            runLoader.load(runPath, (runObject) => {
                console.log('Run FBX Loaded', runObject);
                if (runObject.animations.length > 0) {
                    const runClip = runObject.animations[0];
                    const runAction = this.mixer.clipAction(runClip);
                    this.animations['Run'] = runAction;
                    console.log('Run animation added');
                }
            });

        }, undefined, (error) => {
            console.error('An error happened loading the model:', error);
        });

        // 2. Create Physics Body
        let rigidBodyDesc = rapier.RigidBodyDesc.dynamic()
            .setTranslation(0, 5, 0)
            .setCanSleep(false)
            .lockRotations();
        this.body = world.createRigidBody(rigidBodyDesc);

        // Collider: Capsule
        let colliderDesc = rapier.ColliderDesc.capsule(0.5, 0.5)
            .setFriction(1.0)
            .setCollisionGroups(0x0001FFFF);
        world.createCollider(colliderDesc, this.body);

        this.setupInput();

        // ODM Gear Setup
        this.hooks = {
            left: {
                state: 'IDLE', // IDLE, SHOOTING, ATTACHED
                joint: null,
                line: null,
                arrow: null,
                target: new THREE.Vector3(),
                currentPos: new THREE.Vector3(),
                shootSpeed: 80.0 // Slower shoot speed
            },
            right: {
                state: 'IDLE',
                joint: null,
                line: null,
                arrow: null,
                target: new THREE.Vector3(),
                currentPos: new THREE.Vector3(),
                shootSpeed: 80.0
            }
        };
        this.aiming = { left: false, right: false };
        this.ropeMaterial = new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 2 });

        // Arrow Geometry (Cone)
        this.arrowGeometry = new THREE.ConeGeometry(0.2, 0.5, 8);
        this.arrowGeometry.rotateX(Math.PI / 2); // Point along Z
        this.arrowMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });

        this.prevSpace = false;
        this.jumpCooldown = 0;
        this.maxHookDistance = 80.0; // Limit range
    }

    setupInput() {
        this.keys = {
            w: false, a: false, s: false, d: false, space: false,
            q: false, e: false, r: false, shift: false
        };

        window.addEventListener('keydown', (e) => {
            switch (e.key.toLowerCase()) {
                case 'w': this.keys.w = true; break;
                case 'a': this.keys.a = true; break;
                case 's': this.keys.s = true; break;
                case 'd': this.keys.d = true; break;
                case ' ': this.keys.space = true; break;
                case 'shift': this.keys.shift = true; break;
                case 'q':
                    if (!this.keys.q) {
                        this.keys.q = true;
                        this.shootHook('right'); // SWAPPED: Q -> Right
                    }
                    break;
                case 'e':
                    if (!this.keys.e) {
                        this.keys.e = true;
                        this.shootHook('left'); // SWAPPED: E -> Left
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
                case 'shift': this.keys.shift = false; break;
                case 'q':
                    this.keys.q = false;
                    break;
                case 'e':
                    this.keys.e = false;
                    break;
                case 'r': this.keys.r = false; break;
            }
        });

        window.addEventListener('mousedown', (e) => {
            if (document.pointerLockElement !== document.body) return;
            if (e.button === 0) {
                this.attack();
            }
        });
    }

    attack() {
        const vel = this.body.linvel();
        const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
        console.log(`Attack! Speed: ${speed.toFixed(2)}`);
    }

    shootHook(side) {
        this.clearHook(side);

        if (!this.lastCamDir || !this.lastCamPos) return;

        const ray = new rapier.Ray(this.lastCamPos, this.lastCamDir);
        const hit = world.castRay(ray, this.maxHookDistance, true, 0x00000002);

        if (hit) {
            const hitPoint = ray.pointAt(hit.timeOfImpact);
            const hook = this.hooks[side];

            hook.state = 'SHOOTING';
            hook.target.copy(hitPoint);

            const playerPos = this.mesh.position;
            const offset = side === 'left' ? -0.5 : 0.5;
            const waistPos = new THREE.Vector3(offset, 0, 0).applyQuaternion(this.mesh.quaternion).add(playerPos);
            hook.currentPos.copy(waistPos);

            hook.hitColliderHandle = hit.colliderHandle;

            const geometry = new THREE.BufferGeometry().setFromPoints([
                waistPos,
                waistPos
            ]);
            hook.line = new THREE.Line(geometry, this.ropeMaterial);
            this.scene.add(hook.line);

            hook.arrow = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial);
            hook.arrow.position.copy(waistPos);
            this.scene.add(hook.arrow);
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
            if (hook.arrow) {
                this.scene.remove(hook.arrow);
                hook.arrow = null;
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
            const dt = 1 / 60;

            if (this.mixer) {
                this.mixer.update(dt);
            }

            // Animation State Machine
            if (this.animations['Idle'] && this.animations['Run']) {
                const vel = this.body.linvel();
                const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
                const isMoving = horizontalSpeed > 0.5; // Threshold

                const targetAction = isMoving ? this.animations['Run'] : this.animations['Idle'];

                if (this.currentAction !== targetAction) {
                    const prevAction = this.currentAction;
                    this.currentAction = targetAction;

                    if (prevAction) {
                        prevAction.fadeOut(0.2);
                    }
                    this.currentAction.reset().fadeIn(0.2).play();
                }
            }

            // 1. Handle Movement
            const walkSpeed = 10.0;
            const runSpeed = 25.0;
            const speed = this.keys.shift ? runSpeed : walkSpeed;
            const jumpForce = 10.0;

            const linvel = this.body.linvel();

            let moveDir = new THREE.Vector3(0, 0, 0);
            if (this.keys.w) moveDir.z -= 1;
            if (this.keys.s) moveDir.z += 1;
            if (this.keys.a) moveDir.x -= 1;
            if (this.keys.d) moveDir.x += 1;

            if (moveDir.length() > 0) {
                moveDir.normalize();

                const camForward = new THREE.Vector3();
                camera.getWorldDirection(camForward);
                camForward.y = 0;
                camForward.normalize();

                const camRight = new THREE.Vector3();
                camRight.crossVectors(camForward, new THREE.Vector3(0, 1, 0));

                const finalDir = new THREE.Vector3()
                    .addScaledVector(camForward, -moveDir.z)
                    .addScaledVector(camRight, moveDir.x);

                const isSwinging = this.hooks.left.state === 'ATTACHED' || this.hooks.right.state === 'ATTACHED';
                const moveSpeed = isSwinging ? speed * 0.3 : speed;

                this.body.setLinvel({
                    x: finalDir.x * moveSpeed,
                    y: linvel.y,
                    z: finalDir.z * moveSpeed
                }, true);

                const angle = Math.atan2(finalDir.x, finalDir.z);
                const targetRotation = new THREE.Quaternion();
                targetRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                this.mesh.quaternion.slerp(targetRotation, 0.2);
            } else {
                const isSwinging = this.hooks.left.state === 'ATTACHED' || this.hooks.right.state === 'ATTACHED';
                if (!isSwinging) {
                    this.body.setLinvel({ x: 0, y: linvel.y, z: 0 }, true);
                }
            }

            // Jump Logic
            const origin = this.body.translation();
            const feetPos = { x: origin.x, y: origin.y - 1.05, z: origin.z };
            const ray = new rapier.Ray(feetPos, { x: 0, y: -1, z: 0 });

            const hit = world.castRay(ray, 0.5, true, 0x00010006);

            const velY = this.body.linvel().y;
            const isGrounded = hit && hit.timeOfImpact < 0.1 && velY <= 0.1;

            // Debug Ray
            if (!this.debugRay) {
                const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
                const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
                this.debugRay = new THREE.Line(geometry, material);
                this.scene.add(this.debugRay);
            }
            const rayEnd = new THREE.Vector3(feetPos.x, feetPos.y - 0.5, feetPos.z);
            const rayStartVec = new THREE.Vector3(feetPos.x, feetPos.y, feetPos.z);
            const positions = this.debugRay.geometry.attributes.position.array;
            positions[0] = rayStartVec.x; positions[1] = rayStartVec.y; positions[2] = rayStartVec.z;
            positions[3] = rayEnd.x; positions[4] = rayEnd.y; positions[5] = rayEnd.z;
            this.debugRay.geometry.attributes.position.needsUpdate = true;
            this.debugRay.material.color.setHex(isGrounded ? 0x00ff00 : 0xff0000);

            // Debug Log
            const log = document.getElementById('debug-log');
            if (log) {
                let hitInfo = 'None';
                if (hit) {
                    hitInfo = `Dist: ${hit.timeOfImpact.toFixed(2)}`;
                }
                log.innerHTML = `
                    Grounded: ${isGrounded} <br>
                    RayHit: ${hitInfo} <br>
                    Vel Y: ${velY.toFixed(2)} <br>
                    Cooldown: ${this.jumpCooldown > 0 ? this.jumpCooldown.toFixed(2) : 'Ready'}
                `;
            }

            if (this.jumpCooldown > 0) {
                this.jumpCooldown -= dt;
            }

            if (this.keys.space) {
                if (!this.prevSpace) {
                    if (isGrounded && this.jumpCooldown <= 0) {
                        const vel = this.body.linvel();
                        this.body.setLinvel({ x: vel.x, y: jumpForce, z: vel.z }, true);
                        this.jumpCooldown = 0.5;
                    }
                }
                this.prevSpace = true;
            } else {
                this.prevSpace = false;
            }

            // Gas Boost
            if (this.keys.r) {
                const boostForce = 2.0;
                this.body.applyImpulse({
                    x: camDir.x * boostForce,
                    y: camDir.y * boostForce,
                    z: camDir.z * boostForce
                }, true);
            }

            // Hook Physics
            const playerPos = this.body.translation();
            const playerVec = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);

            ['left', 'right'].forEach(side => {
                const hook = this.hooks[side];
                const offset = side === 'left' ? -0.5 : 0.5;
                const waistPos = new THREE.Vector3(offset, 0, 0).applyQuaternion(this.mesh.quaternion).add(playerVec);

                if (hook.state === 'SHOOTING') {
                    const distToTarget = hook.currentPos.distanceTo(hook.target);
                    const travelDist = hook.shootSpeed * dt;

                    if (travelDist >= distToTarget) {
                        hook.currentPos.copy(hook.target);
                        hook.state = 'ATTACHED';

                        const dir = new THREE.Vector3().subVectors(hook.target, playerVec).normalize();
                        const initialImpulse = 20.0;
                        this.body.applyImpulse({
                            x: dir.x * initialImpulse,
                            y: dir.y * initialImpulse,
                            z: dir.z * initialImpulse
                        }, true);

                    } else {
                        const dir = new THREE.Vector3().subVectors(hook.target, hook.currentPos).normalize();
                        hook.currentPos.addScaledVector(dir, travelDist);
                    }

                    const positions = hook.line.geometry.attributes.position.array;
                    positions[0] = waistPos.x; positions[1] = waistPos.y; positions[2] = waistPos.z;
                    positions[3] = hook.currentPos.x; positions[4] = hook.currentPos.y; positions[5] = hook.currentPos.z;
                    hook.line.geometry.attributes.position.needsUpdate = true;

                    if (hook.arrow) {
                        hook.arrow.position.copy(hook.currentPos);
                        hook.arrow.lookAt(hook.target);
                    }

                } else if (hook.state === 'ATTACHED') {
                    const positions = hook.line.geometry.attributes.position.array;
                    positions[0] = waistPos.x; positions[1] = waistPos.y; positions[2] = waistPos.z;
                    positions[3] = hook.target.x; positions[4] = hook.target.y; positions[5] = hook.target.z;
                    hook.line.geometry.attributes.position.needsUpdate = true;

                    if (hook.arrow) {
                        hook.arrow.position.copy(hook.target);
                    }

                    const dist = playerVec.distanceTo(hook.target);
                    const dir = new THREE.Vector3().subVectors(hook.target, playerVec).normalize();

                    if (dist < 3.0) {
                        this.clearHook(side);

                        const vel = this.body.linvel();
                        if (vel.y > 0) {
                            this.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);
                        }

                        return;
                    }

                    const reelForce = 120.0; // Reduced force

                    this.body.applyImpulse({
                        x: dir.x * reelForce * dt,
                        y: dir.y * reelForce * dt,
                        z: dir.z * reelForce * dt
                    }, true);
                }
            });

            // Jump Cancel Hooks
            if (this.keys.space && !this.prevSpace) {
                if (this.hooks.left.state !== 'IDLE' || this.hooks.right.state !== 'IDLE') {
                    this.clearHook('left');
                    this.clearHook('right');

                    const vel = this.body.linvel();
                    this.body.setLinvel({ x: vel.x, y: vel.y + 10, z: vel.z }, true);
                    this.jumpCooldown = 0.5;
                }
            }

            const position = this.body.translation();
            this.mesh.position.set(position.x, position.y, position.z);
        }
    }
}
