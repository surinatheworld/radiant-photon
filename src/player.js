import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { rapier, world } from './physics.js';

export class Player {
    constructor(scene, position = { x: 0, y: 5, z: 0 }) {
        this.scene = scene;
        this.mesh = null;
        this.body = null;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;
        this.init(position);
    }

    init(position) {
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

            // Load Attack animation
            const attackLoader = new FBXLoader();
            attackLoader.load(`${baseUrl}attack.fbx`, (attackFbx) => {
                console.log('✅ Attack FBX loaded');
                if (attackFbx.animations && attackFbx.animations.length > 0) {
                    const attackAction = this.mixer.clipAction(attackFbx.animations[0]);
                    attackAction.setLoop(THREE.LoopOnce); // Play only once
                    attackAction.clampWhenFinished = true; // Stop at last frame
                    attackAction.timeScale = 0.5; // Slow down to 50% speed (make it longer)
                    this.animations['Attack'] = attackAction;
                    console.log('✅ Attack animation added');

                    // Return to Idle/Run after attack finishes
                    this.mixer.addEventListener('finished', (e) => {
                        if (e.action === attackAction) {
                            attackAction.fadeOut(0.2);
                            this.currentAction = this.animations['Idle']; // Default back to idle
                            if (this.currentAction) this.currentAction.reset().fadeIn(0.2).play();
                        }
                    });
                }
            }, undefined, (err) => {
                console.warn('⚠️ Attack animation file missing (attack.fbx)');
            });

        }, undefined, (error) => {
            console.error('❌ Error loading model:', error);
        });

        // Physics
        let rigidBodyDesc = rapier.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
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
        this.maxHookDistance = 200.0; // Max hook range (200m)
        this.prevVelocity = new THREE.Vector3(); // Track previous velocity for wall detection

        // Health Logic
        this.maxHealth = 100;
        this.currentHealth = 100;
        this.healthBar = document.getElementById('player-health-bar');
        this.updateHealthUI();
    }

    updateHealthUI() {
        if (this.healthBar) {
            const percentage = Math.max(0, (this.currentHealth / this.maxHealth) * 100);
            this.healthBar.style.width = `${percentage}%`;
        }
    }

    takeDamage(damage) {
        this.currentHealth -= damage;
        this.updateHealthUI();
        console.log(`Player hit! Health: ${this.currentHealth}`);
        if (this.currentHealth <= 0) {
            console.log("PLAYER DIED");
            // Handle death (respawn, game over, etc.)
        }
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

    setTitanTarget(titan) {
        this.titan = titan;
    }

    attack() {
        const vel = this.body.linvel();
        const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
        console.log(`Attack! Speed: ${speed.toFixed(2)}`);

        // Play Animation
        if (this.animations['Attack']) {
            const action = this.animations['Attack'];
            if (this.currentAction !== action) {
                if (this.currentAction) this.currentAction.fadeOut(0.1);
                this.currentAction = action;
                action.reset().fadeIn(0.1).play();
            }
        }

        // Attack Logic
        if (this.titan && this.titan.isAlive && this.titan.napeMesh) {
            // Check distance to Nape
            const playerPos = this.mesh.position;
            const napePos = this.titan.napeMesh.getWorldPosition(new THREE.Vector3());
            const dist = playerPos.distanceTo(napePos);

            // Attack Range: 3 meters
            if (dist < 3.0) {
                // Calculate Damage based on Speed
                // Base damage: 10
                // Speed bonus: +2 damage per 1 m/s of speed
                const damage = 10 + (speed * 2.0);

                this.titan.takeDamage(damage);
            }
        }
    }

    shootHook(side) {
        this.clearHook(side);
        if (!this.lastCamDir || !this.lastCamPos) return;

        const ray = new rapier.Ray(this.lastCamPos, this.lastCamDir);
        // Cast ray to hit all surfaces (buildings, walls, ground, titan)
        const hit = world.castRay(ray, this.maxHookDistance, true);

        if (!hit) {
            // No hit - cannot shoot hook into air
            console.log('🚫 Hook needs a surface to attach to!');
            return;
        }

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
        const jumpForce = 15.0; // Higher jump
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

        // Wall Collision Detection (like Naraka Bladepoint)
        // When grappling, if velocity suddenly drops (hit wall), detach hooks
        const currentVel = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
        const isHooked = this.hooks.left.state === 'ATTACHED' || this.hooks.right.state === 'ATTACHED';

        if (isHooked && this.prevVelocity.length() > 5) { // Only check if moving fast
            const velChange = this.prevVelocity.length() - currentVel.length();

            // If velocity dropped significantly (hit obstacle)
            if (velChange > 8) {
                this.clearHook('left');
                this.clearHook('right');
                console.log('Wall impact - hooks detached');
            }
        }
        this.prevVelocity.copy(currentVel);

        // Hook Physics
        const playerPos = this.body.translation();
        const playerVec = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);

        // Check if both hooks are attached for dual vector logic
        const leftHook = this.hooks.left;
        const rightHook = this.hooks.right;
        const isDualHook = leftHook.state === 'ATTACHED' && rightHook.state === 'ATTACHED';

        // Anti-gravity while swinging (prevent falling when hooked)
        const isHookedNow = leftHook.state === 'ATTACHED' || rightHook.state === 'ATTACHED' ||
            leftHook.state === 'SHOOTING' || rightHook.state === 'SHOOTING';
        if (isHookedNow) {
            const vel = this.body.linvel();
            // Reduce gravity effect - keep player floating while hooked
            if (vel.y < 0) {
                this.body.setLinvel({ x: vel.x, y: vel.y * 0.8, z: vel.z }, true); // Slow down falling
            }
        }

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

                // Update Visuals
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
                // Visual Update
                const offset = side === 'left' ? -0.5 : 0.5;
                const waistPos = new THREE.Vector3(offset, 0, 0).applyQuaternion(this.mesh.quaternion).add(playerVec);
                const positions = hook.line.geometry.attributes.position.array;
                positions[0] = waistPos.x; positions[1] = waistPos.y; positions[2] = waistPos.z;
                positions[3] = hook.target.x; positions[4] = hook.target.y; positions[5] = hook.target.z;
                hook.line.geometry.attributes.position.needsUpdate = true;

                if (hook.arrow) hook.arrow.position.copy(hook.target);

                // Physics Logic
                const dist = playerVec.distanceTo(hook.target);

                // Auto-detach / Vault Check
                if (dist < 3.0) {
                    // Wall Climb / Vault Logic
                    // Only climb if airborne AND touching a wall
                    if (!isGrounded) {
                        // Check for wall in front
                        const origin = this.body.translation();
                        const forwardDir = new THREE.Vector3().subVectors(hook.target, playerVec).normalize();
                        forwardDir.y = 0; // Keep forward component horizontal
                        forwardDir.normalize();

                        const ray = new rapier.Ray(origin, { x: forwardDir.x, y: forwardDir.y, z: forwardDir.z });
                        const hit = world.castRay(ray, 1.5, true, 0xFFFFFFFF); // Check 1.5m in front (ANYTHING)

                        if (hit) {
                            this.clearHook(side);

                            const vaultForceY = 15.0;
                            const vaultForceFwd = 10.0;

                            this.body.setLinvel({
                                x: forwardDir.x * vaultForceFwd,
                                y: vaultForceY,
                                z: forwardDir.z * vaultForceFwd
                            }, true);

                            console.log("🧗 Wall Vault (Contact Confirmed)!");
                            return;
                        }
                    }

                    this.clearHook(side);
                    const vel = this.body.linvel();
                    if (vel.y > 0) this.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);
                    return;
                }

                // Apply Force
                let dir;
                if (isDualHook) {
                    // Calculate center vector
                    const dirLeft = new THREE.Vector3().subVectors(leftHook.target, playerVec).normalize();
                    const dirRight = new THREE.Vector3().subVectors(rightHook.target, playerVec).normalize();
                    dir = new THREE.Vector3().addVectors(dirLeft, dirRight).normalize();
                } else {
                    dir = new THREE.Vector3().subVectors(hook.target, playerVec).normalize();
                }

                // Add upward boost when target is above player (helps climb onto roofs)
                const heightDiff = hook.target.y - playerVec.y;
                let upwardBoost = 0;
                if (heightDiff > 2) {
                    // Target is above - add extra upward force to arc over walls
                    upwardBoost = Math.min(heightDiff * 0.5, 10); // Cap at 10
                }

                const reelForce = 120.0;
                this.body.applyImpulse({
                    x: dir.x * reelForce * dt,
                    y: dir.y * reelForce * dt + upwardBoost * dt,
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

        // Sync mesh
        const position = this.body.translation();
        this.mesh.position.set(position.x, position.y, position.z);
    }
}
