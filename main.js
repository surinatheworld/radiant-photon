import * as THREE from 'three';
import { initPhysics, world, rapier } from './src/physics.js';
import { Player } from './src/player.js';
import { City } from './src/city.js';

async function init() {
    await initPhysics();

    // 1. Setup Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky Blue
    // Add Fog to hide render distance limits
    scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

    // 2. Setup Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);

    // 3. Setup Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    // 5. Create World (City)
    const city = new City(scene);

    // 6. Create Player
    const player = new Player(scene);

    // Camera Control Variables
    let cameraAngleX = 0;
    let cameraAngleY = 0;
    const sensitivity = 0.002;
    let cameraDistance = 5; // Default distance

    // Pointer Lock
    document.body.addEventListener('click', () => {
        document.body.requestPointerLock();
    });

    document.addEventListener('mousemove', (event) => {
        if (document.pointerLockElement === document.body) {
            cameraAngleX -= event.movementX * sensitivity;
            cameraAngleY -= event.movementY * sensitivity;

            // Clamp pitch
            cameraAngleY = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraAngleY));
        }
    });

    // Scroll to Zoom
    document.addEventListener('wheel', (event) => {
        cameraDistance += event.deltaY * 0.01;
        cameraDistance = Math.max(2, Math.min(10, cameraDistance));
    });

    // Resize Handler
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
        requestAnimationFrame(animate);

        world.step();
        player.update(camera);

        // Camera Follow Logic (Orbit around Player)
        if (player.mesh) {
            const playerPos = player.mesh.position.clone();
            // Aim slightly above player head
            const targetPos = playerPos.add(new THREE.Vector3(0, 1.5, 0));

            // Calculate camera position based on angles
            const offset = new THREE.Vector3(
                0,
                0,
                cameraDistance
            );

            // Apply rotations
            offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), cameraAngleY);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngleX);

            camera.position.copy(targetPos).add(offset);
            camera.lookAt(targetPos);
        }

        renderer.render(scene, camera);
    }

    animate();
}

init();
