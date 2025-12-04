import RAPIER from '@dimforge/rapier3d-compat';

export const GRAVITY = { x: 0.0, y: -20.0, z: 0.0 };
export let world;
export let rapier;

export async function initPhysics() {
    await RAPIER.init();
    rapier = RAPIER;
    world = new RAPIER.World(GRAVITY);
    console.log("Rapier Physics initialized");
    return world;
}

export function stepPhysics() {
    if (world) {
        world.step();
    }
}
