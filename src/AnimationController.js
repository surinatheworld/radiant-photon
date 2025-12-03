import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class AnimationController {
    constructor(scene) {
        this.scene = scene;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;
        this.mesh = null;
    }

    loadModel(onLoad) {
        const loader = new GLTFLoader();
        const baseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
        const modelPath = `${baseUrl}player.glb`;

        console.log('🔄 Loading model from:', modelPath);

        loader.load(modelPath, (gltf) => {
            const object = gltf.scene;
            this.mesh = object;

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

            const targetHeight = 2.5;
            const scaleFactor = targetHeight / size.y;
            object.scale.set(scaleFactor, scaleFactor, scaleFactor);
            object.position.y = -1.0;

            // ADD TO SCENE
            this.scene.add(object);
            console.log('✅ Model added to scene');

            this.mixer = new THREE.AnimationMixer(object);

            // Store Idle Animation from GLB
            if (gltf.animations.length > 0) {
                const idleAction = this.mixer.clipAction(gltf.animations[0]);
                this.animations['Idle'] = idleAction;
                this.currentAction = idleAction;
                this.currentAction.play();
                console.log('✅ Idle animation loaded from GLB');
            }

            // Load external animations
            this.loadExternalAnimations(baseUrl);

            if (onLoad) {
                console.log('🔄 Calling onLoad callback...');
                onLoad(object);
            }
        }, undefined, (error) => {
            console.error('❌ Failed to load model:', error);
        });
    }

    loadExternalAnimations(baseUrl) {
        const loader = new FBXLoader();

        // Load go.fbx for WALKING
        console.log('🔄 Loading go.fbx (Walk)...');
        loader.load(`${baseUrl}go.fbx`, (obj) => {
            console.log('✅ go.fbx loaded');
            if (obj.animations.length > 0) {
                const clip = obj.animations[0];
                console.log(`   Animation: "${clip.name}", Tracks: ${clip.tracks.length}`);

                const action = this.mixer.clipAction(clip);
                action.loop = THREE.LoopRepeat;
                this.animations['Walk'] = action;
                console.log('✅ Walk animation registered');
            } else {
                console.error('❌ go.fbx has no animations!');
            }
        }, undefined, (error) => {
            console.error('❌ Failed to load go.fbx:', error);
        });

        // Load run.fbx for RUNNING (when Shift is pressed)
        console.log('🔄 Loading run.fbx (Run)...');
        loader.load(`${baseUrl}run.fbx`, (obj) => {
            console.log('✅ run.fbx loaded');
            if (obj.animations.length > 0) {
                const clip = obj.animations[0];
                console.log(`   Animation: "${clip.name}", Tracks: ${clip.tracks.length}`);

                const action = this.mixer.clipAction(clip);
                action.loop = THREE.LoopRepeat;
                this.animations['Run'] = action;
                console.log('✅ Run animation registered');
            } else {
                console.error('❌ run.fbx has no animations!');
            }
        }, undefined, (error) => {
            console.error('❌ Failed to load run.fbx:', error);
        });
    }

    update(dt, speed, isShiftPressed) {
        if (this.mixer) {
            this.mixer.update(dt);
        }

        if (this.animations['Idle'] && this.animations['Run'] && this.animations['Walk']) {
            const isMoving = speed > 0.5;
            let targetAction = this.animations['Idle'];

            if (isMoving) {
                // If Shift is pressed while moving -> Run, otherwise -> Walk
                targetAction = isShiftPressed ? this.animations['Run'] : this.animations['Walk'];
            }

            if (this.currentAction !== targetAction) {
                const prevAction = this.currentAction;
                this.currentAction = targetAction;

                // Log animation transition
                const prevName = prevAction ? Object.keys(this.animations).find(k => this.animations[k] === prevAction) : 'none';
                const newName = Object.keys(this.animations).find(k => this.animations[k] === targetAction);
                console.log(`🎬 Animation: ${prevName} → ${newName} (speed: ${speed.toFixed(1)}, shift: ${isShiftPressed})`);

                if (prevAction) {
                    prevAction.fadeOut(0.2);
                }
                this.currentAction.reset().fadeIn(0.2).play();
            }
        } else {
            // Log which animations are missing
            const missing = [];
            if (!this.animations['Idle']) missing.push('Idle');
            if (!this.animations['Run']) missing.push('Run');
            if (!this.animations['Walk']) missing.push('Walk');
            if (missing.length > 0) {
                // Only log once per second to avoid spam
                if (!this._lastMissingLog || Date.now() - this._lastMissingLog > 1000) {
                    console.warn(`⏳ Waiting for animations: ${missing.join(', ')}`);
                    this._lastMissingLog = Date.now();
                }
            }
        }
    }
}
