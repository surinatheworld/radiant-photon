import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { rapier, world } from './physics.js';

export class Titan {
    constructor(scene, position = { x: 0, y: 0, z: 0 }) {
        this.scene = scene;
        this.isAlive = true;
        this.player = null; // Reference to player for chasing

        // Health system
        this.maxHealth = 100;
        this.currentHealth = this.maxHealth;
        this.createHealthUI();

        // Group for visual meshes
        this.mesh = new THREE.Group();
        this.mesh.position.set(position.x, position.y, position.z);
        this.scene.add(this.mesh);

        // Attack Logic
        this.isAttacking = false;
        this.attackCooldown = 0;
        this.dotDamageTimer = 0;
        this.projectiles = []; // Red sphere projectiles

        // Danger Zone (red warning circle at Titan's feet)
        const dangerRadius = 16; // Doubled from 8
        const dangerGeo = new THREE.RingGeometry(0.5, dangerRadius, 32);
        const dangerMat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide
        });
        this.dangerZone = new THREE.Mesh(dangerGeo, dangerMat);
        this.dangerZone.rotation.x = -Math.PI / 2;
        this.dangerZone.position.set(position.x, 0.1, position.z); // At ground level
        this.scene.add(this.dangerZone); // Add to scene, not mesh
        this.dangerRadius = dangerRadius;

        // Attack Range Spheres (red spheres at both hands for arm attack warning)
        const attackRadius = 30; // 6x bigger sphere at each hand
        const attackSphereMat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0,
            wireframe: true
        });

        // Right hand sphere
        const rightSphereGeo = new THREE.SphereGeometry(attackRadius, 16, 16);
        this.attackSphereRight = new THREE.Mesh(rightSphereGeo, attackSphereMat.clone());
        this.scene.add(this.attackSphereRight);

        // Left hand sphere  
        const leftSphereGeo = new THREE.SphereGeometry(attackRadius, 16, 16);
        this.attackSphereLeft = new THREE.Mesh(leftSphereGeo, attackSphereMat.clone());
        this.scene.add(this.attackSphereLeft);

        this.attackRadius = 10; // Total attack range

        // Load Model
        const loader = new FBXLoader();
        const baseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';

        // Add placeholder first
        const placeholderGeo = new THREE.CapsuleGeometry(1, 4, 4, 8);
        const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        this.bodyMesh = new THREE.Mesh(placeholderGeo, placeholderMat);
        this.mesh.add(this.bodyMesh);

        loader.load(`${baseUrl}titan.fbx`, (fbx) => {
            console.log("✅ Titan Model Loaded");
            this.model = fbx;
            this.model.scale.set(0.1, 0.1, 0.1); // Adjust scale as needed
            this.model.position.y = -7; // Offset to align feet with ground

            // Remove placeholder
            this.mesh.remove(this.bodyMesh);
            this.mesh.add(this.model);

            // Setup Animations
            this.mixer = new THREE.AnimationMixer(this.model);
            this.animations = {};

            const loadAnim = (name, file) => {
                loader.load(`${baseUrl}${file}`, (anim) => {
                    const clip = anim.animations[0];
                    const action = this.mixer.clipAction(clip);
                    this.animations[name] = action;
                    if (name === 'Walk') {
                        action.play();
                        this.currentAction = action;
                    }
                });
            };

            // Check if main file has animations
            if (fbx.animations.length > 0) {
                this.animations['Walk'] = this.mixer.clipAction(fbx.animations[0]);
                this.animations['Walk'].play();
                this.currentAction = this.animations['Walk'];
            } else {
                loadAnim('Walk', 'titan.fbx');
            }

            loadAnim('Attack', 'titan_attack.fbx');

            // Find Neck Bone and Hand Bones
            this.neckBone = null;
            this.rightHandBone = null;
            this.leftHandBone = null;
            fbx.traverse((child) => {
                if (child.isBone) {
                    if (child.name.includes('Neck') || child.name.includes('Head')) {
                        this.neckBone = child;
                    }
                    // Right hand
                    if (child.name.includes('RightHand') || child.name.includes('Hand_R') || child.name.includes('hand.R')) {
                        console.log('Found Right Hand:', child.name);
                        this.rightHandBone = child;
                    }
                    // Left hand
                    if (child.name.includes('LeftHand') || child.name.includes('Hand_L') || child.name.includes('hand.L')) {
                        console.log('Found Left Hand:', child.name);
                        this.leftHandBone = child;
                    }
                }
            });

            // Attach spheres to hands
            if (this.rightHandBone && this.attackSphereRight) {
                this.attackSphereRight.removeFromParent();
                this.rightHandBone.add(this.attackSphereRight);
                this.attackSphereRight.position.set(0, 0, 0);
            }
            if (this.leftHandBone && this.attackSphereLeft) {
                this.attackSphereLeft.removeFromParent();
                this.leftHandBone.add(this.attackSphereLeft);
                this.attackSphereLeft.position.set(0, 0, 0);
            }

        }, undefined, (err) => {
            console.error("❌ Error loading Titan:", err);
        });

        // Physics Body (Dynamic) - passes through buildings
        const rigidBodyDesc = rapier.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y + 7, position.z)
            .lockRotations();
        this.body = world.createRigidBody(rigidBodyDesc);

        // Only collide with ground (group 2), not buildings
        const colliderDesc = rapier.ColliderDesc.capsule(5, 2)
            .setCollisionGroups(0x00020002); // Only collide with ground
        world.createCollider(colliderDesc, this.body);

        // Nape (Weak Point)
        const napeGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
        const napeMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        this.napeMesh = new THREE.Mesh(napeGeo, napeMat);
        this.napeMesh.position.set(0, 9, -2); // Position at back of neck
        this.mesh.add(this.napeMesh); // Add to titan mesh, not scene

        const napeBodyDesc = rapier.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(position.x, position.y + 9, position.z - 2);
        this.napeBody = world.createRigidBody(napeBodyDesc);

        const napeColliderDesc = rapier.ColliderDesc.cuboid(0.3, 0.3, 0.3)
            .setSensor(true) // Sensor to detect hits without physical collision response? 
            // Actually, we want it to be hit by raycast. Sensors are fine for raycast?
            // Raycast hits everything unless filtered.
            // Let's keep it as a regular collider for now, or sensor if we handle collision events.
            // Raycast works on sensors.
            .setCollisionGroups(0x0002FFFF);
        world.createCollider(napeColliderDesc, this.napeBody);
    }

    setPlayerTarget(player) {
        this.player = player;
    }

    update(camera) {
        if (!this.isAlive) {
            if (this.healthBarContainer) this.healthBarContainer.style.display = 'none';
            return;
        }

        const dt = 1 / 60;

        // Update Animation
        if (this.mixer) this.mixer.update(dt);

        // Cooldown
        if (this.attackCooldown > 0) this.attackCooldown -= dt;

        // Update projectiles
        this.updateProjectiles(dt);

        // Movement & Attack Logic
        if (this.player && this.player.mesh && this.body) {
            const titanPos = this.body.translation();
            const playerPos = this.player.mesh.position;

            const dx = playerPos.x - titanPos.x;
            const dz = playerPos.z - titanPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            // Rotate to face player (only when in search range)
            if (dist < 100) {
                const angle = Math.atan2(dx, dz);
                const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                this.mesh.quaternion.slerp(q, 0.1);
            }

            // Attack range check
            const attackRange = 30; // Must be within 30m to attack

            if (this.isAttacking) {
                // CANCEL attack if player escaped range!
                if (dist > attackRange) {
                    this.isAttacking = false;
                    this.dangerZone.material.opacity = 0;
                    this.attackSphereRight.material.opacity = 0;
                    this.attackSphereLeft.material.opacity = 0;
                    console.log("🏃 Player escaped! Attack cancelled.");
                }

                // Must complete attack animation before doing anything else
                // Stop moving while attacking
                const currentVel = this.body.linvel();
                this.body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true);

                // Show danger zone warning at feet
                this.dangerZone.position.set(titanPos.x, 0.1, titanPos.z);
                this.dangerZone.material.opacity = 0.5 + Math.sin(Date.now() * 0.01) * 0.3;

                // Show attack spheres at both hands (follow bones automatically)
                const pulseOpacity = 0.3 + Math.sin(Date.now() * 0.015) * 0.2;
                this.attackSphereRight.material.opacity = pulseOpacity;
                this.attackSphereLeft.material.opacity = pulseOpacity;

                // DOT damage to grounded players in danger zone
                const playerY = this.player.mesh.position.y;
                const titanY = this.mesh.position.y;
                const playerOnGround = playerY < titanY + 2;

                if (dist < this.dangerRadius && playerOnGround) {
                    this.dotDamageTimer += dt;
                    if (this.dotDamageTimer >= 0.3) { // Damage every 0.3 seconds
                        this.player.takeDamage(5);
                        this.dotDamageTimer = 0;
                        console.log("🔥 Ground damage!");
                    }
                }

                // Check for hit (Simple distance check during attack)
                if (this.animations['Attack']) {
                    const time = this.animations['Attack'].time;
                    const duration = this.animations['Attack'].getClip().duration;
                    // Assume hit is around 40-60% of animation
                    if (time > duration * 0.4 && time < duration * 0.6) {
                        const armRadius = 30.0; // Titan arm reach (matches sphere)

                        // Hit player
                        if (dist < armRadius) {
                            if (!this.hasHitPlayer) {
                                this.player.takeDamage(20);
                                this.hasHitPlayer = true;
                                console.log("👊 Titan SMASH Player!");
                            }
                        }

                        // Hit allies too!
                        if (this.allyTargets) {
                            const titanPos = this.body.translation();
                            for (const ally of this.allyTargets) {
                                const adx = ally.position.x - titanPos.x;
                                const adz = ally.position.z - titanPos.z;
                                const allyDist = Math.sqrt(adx * adx + adz * adz);
                                if (allyDist < 15) { // Allies in range
                                    ally.userData.hp -= 1;
                                    console.log("👊 Titan hits Ally! HP:", ally.userData.hp);
                                }
                            }
                        }
                    }
                }

            } else {
                // Not attacking - hide danger zone and attack spheres
                this.dangerZone.material.opacity = 0;
                this.attackSphereRight.material.opacity = 0;
                this.attackSphereLeft.material.opacity = 0;
                this.dotDamageTimer = 0;

                const armRadius = 10.0;   // Arm attack range
                const footRadius = 5.0;   // Stomp range
                const searchRadius = 100; // Vision/search range

                // Check if player is on ground (low Y position relative to titan)
                const playerY = this.player.mesh.position.y;
                const titanY = this.mesh.position.y;
                const playerOnGround = playerY < titanY + 2;

                // Stomp attack - player under titan's feet
                if (dist < footRadius && playerOnGround && this.attackCooldown <= 0) {
                    this.attack();
                    console.log("🦶 Titan STOMP!");
                }
                // Arm attack - player within arm reach
                else if (dist < armRadius && this.attackCooldown <= 0) {
                    this.attack();
                    console.log("👊 Titan attacks!");
                } else if (dist <= searchRadius) {
                    // Player detected - CHASE!
                    const speed = dist > armRadius ? 6.0 : 3.0; // Faster when far
                    const dir = new THREE.Vector3(dx, 0, dz).normalize();
                    const currentVel = this.body.linvel();
                    this.body.setLinvel({ x: dir.x * speed, y: currentVel.y, z: dir.z * speed }, true);

                    // Ensure Walk is playing while chasing
                    if (this.animations && this.animations['Walk'] && this.currentAction !== this.animations['Walk']) {
                        if (this.currentAction) this.currentAction.fadeOut(0.2);
                        this.animations['Walk'].reset().fadeIn(0.2).play();
                        this.currentAction = this.animations['Walk'];
                    }
                } else {
                    // Player OUT OF RANGE - Titan stops and waits (idle)
                    const currentVel = this.body.linvel();
                    this.body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true);

                    // Stop walking animation
                    if (this.animations && this.animations['Walk'] && this.currentAction === this.animations['Walk']) {
                        this.animations['Walk'].fadeOut(0.2);
                        this.currentAction = null;
                    }
                }
            }
        }

        // Sync Mesh with Body
        if (this.body) {
            const pos = this.body.translation();
            this.mesh.position.set(pos.x, pos.y, pos.z);
        }

        // Bone Tracking for Nape
        if (this.neckBone) {
            const boneWorldPos = new THREE.Vector3();
            this.neckBone.getWorldPosition(boneWorldPos);

            const localPos = this.mesh.worldToLocal(boneWorldPos.clone());
            localPos.z -= 0.5;
            localPos.y -= 0.5; // Lowered offset
            this.napeMesh.position.copy(localPos);

            const offset = new THREE.Vector3(0, -0.5, -0.5).applyQuaternion(this.mesh.quaternion);
            const finalNapePos = boneWorldPos.clone().add(offset);

            this.napeBody.setNextKinematicTranslation(finalNapePos);
        } else if (this.body) {
            const pos = this.body.translation();
            const offset = new THREE.Vector3(0, 9, -2).applyQuaternion(this.mesh.quaternion);
            const finalPos = new THREE.Vector3(pos.x, pos.y, pos.z).add(offset);
            this.napeBody.setNextKinematicTranslation(finalPos);
        }

        // Update Health Bar Position
        if (this.healthBarContainer && this.mesh) {
            let headPos;
            if (this.neckBone) {
                headPos = new THREE.Vector3();
                this.neckBone.getWorldPosition(headPos);
                headPos.y += 2.0;
            } else {
                headPos = this.mesh.position.clone().add(new THREE.Vector3(0, 12, 0));
            }

            headPos.project(camera);

            const x = (headPos.x * .5 + .5) * window.innerWidth;
            const y = (-(headPos.y * .5) + .5) * window.innerHeight;

            if (headPos.z < 1) {
                this.healthBarContainer.style.display = 'block';
                this.healthBarContainer.style.left = `${x}px`;
                this.healthBarContainer.style.top = `${y}px`;
            } else {
                this.healthBarContainer.style.display = 'none';
            }
        }
    }

    attack() {
        if (this.isAttacking) return;

        console.log("Titan Attacking!");
        this.isAttacking = true;
        this.hasHitPlayer = false;

        if (this.animations['Attack']) {
            const action = this.animations['Attack'];
            if (this.currentAction) this.currentAction.fadeOut(0.2);
            action.reset().fadeIn(0.2).play();
            this.currentAction = action;
        }

        // Shoot projectiles toward player
        if (this.player && this.player.mesh) {
            this.shootProjectile();
        }
    }

    shootProjectile() {
        const titanPos = this.body.translation();

        for (let i = 0; i < 5; i++) {
            const sphereGeo = new THREE.SphereGeometry(0.5, 8, 8);
            const sphereMat = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: 0.9
            });
            const projectile = new THREE.Mesh(sphereGeo, sphereMat);

            projectile.position.set(titanPos.x, titanPos.y + 8, titanPos.z);

            const angle = Math.random() * Math.PI * 2;
            const upAngle = Math.random() * 0.5 + 0.3;
            const speed = 20 + Math.random() * 15;

            projectile.userData.velocity = new THREE.Vector3(
                Math.cos(angle) * speed,
                upAngle * speed,
                Math.sin(angle) * speed
            );
            projectile.userData.life = 4;

            this.scene.add(projectile);
            this.projectiles.push(projectile);
        }

        console.log("🔴 5 projectiles launched!");
    }

    updateProjectiles(dt) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];

            proj.userData.velocity.y -= 15 * dt;
            proj.position.add(proj.userData.velocity.clone().multiplyScalar(dt));

            proj.userData.life -= dt;
            if (proj.userData.life <= 0 || proj.position.y < 0) {
                this.scene.remove(proj);
                this.projectiles.splice(i, 1);
                continue;
            }

            if (this.player && this.player.mesh) {
                const dist = proj.position.distanceTo(this.player.mesh.position);
                if (dist < 3) {
                    this.player.takeDamage(15);
                    console.log("💥 Projectile hit!");
                    this.scene.remove(proj);
                    this.projectiles.splice(i, 1);
                }
            }
        }
    }

    createHealthUI() {
        // HP bar container
        this.healthBarContainer = document.createElement('div');
        this.healthBarContainer.style.cssText = `
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            width: 300px;
            height: 20px;
            background: #333;
            border: 2px solid #fff;
            border-radius: 5px;
            overflow: hidden;
        `;

        // Label
        const label = document.createElement('div');
        label.textContent = 'TITAN';
        label.style.cssText = `
            position: absolute;
            top: -20px;
            left: 50%;
            transform: translateX(-50%);
            color: #ff4444;
            font-weight: bold;
            font-size: 14px;
        `;
        this.healthBarContainer.appendChild(label);

        // HP bar fill
        this.healthBar = document.createElement('div');
        this.healthBar.style.cssText = `
            width: 100%;
            height: 100%;
            background: linear-gradient(to right, #ff0000, #ff4444);
            transition: width 0.3s;
        `;
        this.healthBarContainer.appendChild(this.healthBar);

        document.body.appendChild(this.healthBarContainer);
    }

    updateHealthUI() {
        if (this.healthBar) {
            const percentage = Math.max(0, (this.currentHealth / this.maxHealth) * 100);
            this.healthBar.style.width = `${percentage}%`;
        }
    }

    takeDamage(damage) {
        if (!this.isAlive) return;

        this.currentHealth -= damage;
        console.log(`Titan hit! Damage: ${damage.toFixed(1)} | Health: ${this.currentHealth.toFixed(1)}`);
        this.updateHealthUI();

        if (this.currentHealth <= 0) {
            this.die();
        } else {
            this.napeMesh.material.color.setHex(0xffff00);
            setTimeout(() => {
                if (this.isAlive) this.napeMesh.material.color.setHex(0xff0000);
            }, 200);
        }
    }

    die() {
        this.isAlive = false;
        console.log("TITAN SLAIN!");

        this.bodyMesh.material.color.setHex(0x333333);
        this.napeMesh.material.color.setHex(0x000000);
        if (this.healthBarContainer) this.healthBarContainer.style.display = 'none';

        this.mesh.rotation.x = -Math.PI / 2;
        this.mesh.position.y += 2;
    }
}
