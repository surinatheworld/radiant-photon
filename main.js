import * as THREE from 'three';
import { initPhysics, stepPhysics, world, rapier } from './src/physics.js';
import { Player } from './src/player.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue

// Camera setup
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// Camera control variables
let cameraAngleX = 0; // Pitch (up/down)
let cameraAngleY = 0; // Yaw (left/right)
let cameraDistance = 10;

document.addEventListener('click', () => {
    document.body.requestPointerLock();
});

document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === document.body) {
        // Reverting to standard look: Mouse Right -> Look Right -> Camera moves Left
        cameraAngleY -= event.movementX * 0.002;

        // Reverting/Inverting Pitch: Mouse Up -> Look Up -> Camera moves Down
        cameraAngleX += event.movementY * 0.002;

        // Clamp pitch to avoid Gimbal Lock (and going underground)
        // Limit from slightly below ground to almost top-down
        cameraAngleX = Math.max(-0.1, Math.min(Math.PI / 2 - 0.1, cameraAngleX));
    }
});

document.addEventListener('wheel', (event) => {
    if (document.pointerLockElement === document.body) {
        cameraDistance += event.deltaY * 0.01;
        cameraDistance = Math.max(2, Math.min(20, cameraDistance));
    }
});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);

// Floor
let floorBody;
function createFloor() {
    // Visual
    const geometry = new THREE.BoxGeometry(50, 1, 50);
    const material = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const floorMesh = new THREE.Mesh(geometry, material);
    floorMesh.position.y = -0.5;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // Physics
    let groundBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    floorBody = world.createRigidBody(groundBodyDesc);
    let groundColliderDesc = rapier.ColliderDesc.cuboid(25, 0.5, 25);
    world.createCollider(groundColliderDesc, floorBody);
}

let player;

async function init() {
    await initPhysics();
    createFloor();
    player = new Player(scene);

    animate();
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    stepPhysics();

    if (player) {
        player.update(camera);

        // Orbit Camera Logic
        const playerPos = player.mesh.position;

        // Calculate camera position based on angles
        // We want cameraAngleY = 0 to be behind the player (assuming player faces -Z)
        // If AngleY increases (Mouse Right -> Camera Right), we move to +X.
        // x = sin(angle)
        // z = cos(angle)
        const cx = playerPos.x + cameraDistance * Math.sin(cameraAngleY) * Math.cos(cameraAngleX);
        const cy = playerPos.y + cameraDistance * Math.sin(cameraAngleX); // Height depends on Pitch
        const cz = playerPos.z + cameraDistance * Math.cos(cameraAngleY) * Math.cos(cameraAngleX);

        camera.position.set(cx, cy, cz);
        camera.lookAt(playerPos.x, playerPos.y + 1, playerPos.z); // Look slightly above player center
    }

    renderer.render(scene, camera);
}

init();

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
