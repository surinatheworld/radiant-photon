import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { rapier, world } from './physics.js';

export class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.body = null;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;
        this.init();
    }

    init() {
        // Temporary placeholder
        const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
        const material = new THREE.MeshStandardMaterial({ color: 0xffff00, transparent: true, opacity: 0.5 });
        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);

        // Load Model
        const loader = new FBXLoader();
        const baseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
        const modelPath = `${baseUrl}go.fbx`;
        console.log('Loading model from:', modelPath);

        loader.load(modelPath, (fbx) => {
            console.log('✅ FBX Loaded', fbx);

            fbx.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            // Auto-scale
            const box = new THREE.Box3().setFromObject(fbx);
            const size = new THREE.Vector3();
            box.getSize(size);
            const targetHeight = 2.5;
            const scaleFactor = targetHeight / size.y;
            fbx.scale.set(scaleFactor, scaleFactor, scaleFactor);
            fbx.position.y = -1.0;

            // Replace placeholder
            this.scene.remove(this.mesh);
            this.mesh = new THREE.Group();
            this.mesh.add(fbx);
            this.scene.add(this.mesh);

            // Animation
            this.mixer = new THREE.AnimationMixer(fbx);
            if (fbx.animations && fbx.animations.length > 0) {
                const action = this.mixer.clipAction(fbx.animations[0]);
                this.animations['Walk'] = action;
                this.currentAction = action;
                action.play();
                console.log('✅ Animation playing');
            }

            // Load Run animation
            const runLoader = new FBXLoader();
            runLoader.load(`${baseUrl}run.fbx`, (runFbx) => {
                console.log('✅ Run FBX loaded');
                if (runFbx.animations && runFbx.animations.length > 0) {
                    const runAction = this.mixer.clipAction(runFbx.animations[0]);
                    this.animations['Run'] = runAction;
                    console.log('✅ Run animation added');
                }
            });

        }, undefined, (error) => {
            console.error('❌ Error loading model:', error);
        });

        // Physics
        let rigidBodyDesc = rapier.RigidBodyDesc.dynamic()
            .setTranslation(0, 5, 0)
            .setCanSleep(false)
            .lockRotations();
        this.body = world.createRigidBody(rigidBodyDesc);

        let colliderDesc = rapier.ColliderDesc.capsule(0.5, 0.5)
            .setFriction(1.0)
            .setCollisionGroups(0x0001FFFF);
        world.createCollider(colliderDesc, this.body);

        this.setupInput();

        // ODM Gear
        this.hooks = {
            left: { state: 'IDLE', joint: null, line: null, arrow: null, target: new THREE.Vector3(), currentPos: new THREE.Vector3(), shootSpeed: 80.0 },
            right: { state: 'IDLE', joint: null, line: null, arrow: null, target: new THREE.Vector3(), currentPos: new THREE.Vector3(), shootSpeed: 80.0 }
        };
        this.ropeMaterial = new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 2 });
        this.arrowGeometry = new THREE.ConeGeometry(0.2, 0.5, 8);
        this.arrowGeometry.rotateX(Math.PI / 2);
        this.arrowMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });

        this.prevSpace = false;
        this.jumpCooldown = 0;
        this.maxHookDistance = 80.0;
    }

    setupInput() {
        this.keys = { w: false, a: false, s: false, d: false, space: false, q: false, e: false, r: false, shift: false };

        window.addEventListener('keydown', (e) => {
            switch (e.key.toLowerCase()) {
                case 'w': this.keys.w = true; break;
                case 'a': this.keys.a = true; break;
                case 's': this.keys.s = true; break;
                case 'd': this.keys.d = true; break;
                case ' ': this.keys.space = true; break;
                case 'shift': this.keys.shift = true; break;
                case 'q': if (!this.keys.q) { this.keys.q = true; this.shootHook('right'); } break;
                case 'e': if (!this.keys.e) { this.keys.e = true; this.shootHook('left'); } break;
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
                case 'q': this.keys.q = false; break;
                case 'e': this.keys.e = false; break;
                case 'r': this.keys.r = false; break;
            }
        });

        window.addEventListener('mousedown', (e) => {
            if (document.pointerLockElement !== document.body) return;
            if (e.button === 0) this.attack();
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

            const geometry = new THREE.BufferGeometry().setFromPoints([hook.currentPos, hook.currentPos]);
            hook.line = new THREE.Line(geometry, this.ropeMaterial);
            this.scene.add(hook.line);

            hook.arrow = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial);
            hook.arrow.position.copy(hook.currentPos);
            this.scene.add(hook.arrow);
        }
    }

    clearHook(side) {
        const hook = this.hooks[side];
        if (hook.state !== 'IDLE') {
            hook.state = 'IDLE';
            if (hook.line) { this.scene.remove(hook.line); hook.line = null; }
            if (hook.arrow) { this.scene.remove(hook.arrow); hook.arrow = null; }
            if (hook.joint) { world.removeImpulseJoint(hook.joint, true); hook.joint = null; }
        }
    }

    update(camera) {
        if (!this.body) return;

        this.lastCamPos = camera.position;
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        this.lastCamDir = camDir;
        const dt = 1 / 60;

        // Animation
        if (this.mixer) this.mixer.update(dt);

        const walkSpeed = 10.0;
        const runSpeed = 25.0;
        const speed = this.keys.shift ? runSpeed : walkSpeed;
        const jumpForce = 10.0;
        const linvel = this.body.linvel();

        // Animation State Machine (AFTER linvel is declared)
        const horizontalSpeed = Math.sqrt(linvel.x * linvel.x + linvel.z * linvel.z);
        const isMoving = horizontalSpeed > 0.5;

        if (this.animations['Walk'] && this.animations['Run']) {
            let targetAction = null;

            if (isMoving) {
                targetAction = this.keys.shift ? this.animations['Run'] : this.animations['Walk'];
            }

            if (this.currentAction !== targetAction) {
                if (this.currentAction) {
                    this.currentAction.fadeOut(0.2);
                }
                this.currentAction = targetAction;
                if (this.currentAction) {
                    this.currentAction.reset().fadeIn(0.2).play();
                }
            }
        }

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

            this.body.setLinvel({ x: finalDir.x * moveSpeed, y: linvel.y, z: finalDir.z * moveSpeed }, true);

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

        // Jump
        const origin = this.body.translation();
        const feetPos = { x: origin.x, y: origin.y - 1.05, z: origin.z };
        const ray = new rapier.Ray(feetPos, { x: 0, y: -1, z: 0 });
        const hit = world.castRay(ray, 0.5, true, 0x00010006);
        const velY = this.body.linvel().y;
        const isGrounded = hit && hit.timeOfImpact < 0.1 && velY <= 0.1;

        if (this.jumpCooldown > 0) this.jumpCooldown -= dt;

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
            this.body.applyImpulse({ x: camDir.x * boostForce, y: camDir.y * boostForce, z: camDir.z * boostForce }, true);
        }

        // Hook Physics
        const playerPos = this.body.translation();
        const playerVec = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);

        ['left', 'right'].forEach(side => {
            const hook = this.hooks[side];
            if (hook.state === 'SHOOTING') {
                const distToTarget = hook.currentPos.distanceTo(hook.target);
                const travelDist = hook.shootSpeed * dt;

                if (travelDist >= distToTarget) {
                    hook.currentPos.copy(hook.target);
                    hook.state = 'ATTACHED';
                    const dir = new THREE.Vector3().subVectors(hook.target, playerVec).normalize();
                    const initialImpulse = 20.0;
                    this.body.applyImpulse({ x: dir.x * initialImpulse, y: dir.y * initialImpulse, z: dir.z * initialImpulse }, true);
                } else {
                    const dir = new THREE.Vector3().subVectors(hook.target, hook.currentPos).normalize();
                    hook.currentPos.addScaledVector(dir, travelDist);
                }

                const offset = side === 'left' ? -0.5 : 0.5;
                const waistPos = new THREE.Vector3(offset, 0, 0).applyQuaternion(this.mesh.quaternion).add(playerVec);
                const positions = hook.line.geometry.attributes.position.array;
                positions[0] = waistPos.x; positions[1] = waistPos.y; positions[2] = waistPos.z;
                positions[3] = hook.currentPos.x; positions[4] = hook.currentPos.y; positions[5] = hook.currentPos.z;
                hook.line.geometry.attributes.position.needsUpdate = true;

                if (hook.arrow) {
                    hook.arrow.position.copy(hook.currentPos);
                    hook.arrow.lookAt(hook.target);
                }
            } else if (hook.state === 'ATTACHED') {
                const offset = side === 'left' ? -0.5 : 0.5;
                const waistPos = new THREE.Vector3(offset, 0, 0).applyQuaternion(this.mesh.quaternion).add(playerVec);
                const positions = hook.line.geometry.attributes.position.array;
                positions[0] = waistPos.x; positions[1] = waistPos.y; positions[2] = waistPos.z;
                positions[3] = hook.target.x; positions[4] = hook.target.y; positions[5] = hook.target.z;
                hook.line.geometry.attributes.position.needsUpdate = true;

                if (hook.arrow) hook.arrow.position.copy(hook.target);

                const dist = playerVec.distanceTo(hook.target);
                const dir = new THREE.Vector3().subVectors(hook.target, playerVec).normalize();

                if (dist < 3.0) {
                    this.clearHook(side);
                    const vel = this.body.linvel();
                    if (vel.y > 0) this.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);
                    return;
                }

                const reelForce = 120.0;
                this.body.applyImpulse({ x: dir.x * reelForce * dt, y: dir.y * reelForce * dt, z: dir.z * reelForce * dt }, true);
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

        // Sync mesh
        const position = this.body.translation();
        this.mesh.position.set(position.x, position.y, position.z);
    }
}
