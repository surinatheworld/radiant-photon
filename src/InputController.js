export class InputController {
    constructor() {
        this.keys = {
            w: false, a: false, s: false, d: false, space: false,
            q: false, e: false, r: false, shift: false
        };
        this.callbacks = {}; // Store event callbacks (e.g., 'attack', 'shootHook')

        this.init();
    }

    init() {
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
        window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    }

    onKeyDown(e) {
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
                    this.emit('shootHook', 'right'); // SWAPPED: Q -> Right
                }
                break;
            case 'e':
                if (!this.keys.e) {
                    this.keys.e = true;
                    this.emit('shootHook', 'left'); // SWAPPED: E -> Left
                }
                break;
            case 'r': this.keys.r = true; break;
        }
    }

    onKeyUp(e) {
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
    }

    onMouseDown(e) {
        if (document.pointerLockElement !== document.body) return;
        if (e.button === 0) {
            this.emit('attack');
        }
    }

    on(event, callback) {
        this.callbacks[event] = callback;
    }

    emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event](data);
        }
    }
}
