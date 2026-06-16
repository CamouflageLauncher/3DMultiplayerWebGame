import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- FIREBASE IMPORTS ---
// You must run this on a local server (like Live Server) to prevent CORS/Module issues.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, onChildAdded, onChildChanged, onChildRemoved, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// === 1. FIREBASE SETUP ===
const firebaseConfig = {
    // REPLACE THESE WITH YOUR FIREBASE PROJECT CONFIG
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// === 2. GAME STATE & VARIABLES ===
let currentRoom = null;
let playerId = Math.random().toString(36).substring(2, 10);
let players = {}; // Stores remote player meshes
let isPlaying = false;

// UI Elements
const mainMenu = document.getElementById('main-menu');
const pauseMenu = document.getElementById('pause-menu');
const crosshair = document.getElementById('crosshair');
const statusText = document.getElementById('menu-status');

// === 3. THREE.JS SETUP ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.y = 1.6; // Average eye height

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game-container').appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// Ground
const groundGeometry = new THREE.PlaneGeometry(100, 100);
const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Controls
const controls = new PointerLockControls(camera, document.body);

controls.addEventListener('lock', () => {
    isPlaying = true;
    mainMenu.classList.add('hidden');
    pauseMenu.classList.add('hidden');
    crosshair.classList.remove('hidden');
});

controls.addEventListener('unlock', () => {
    isPlaying = false;
    if (currentRoom) {
        pauseMenu.classList.remove('hidden');
        crosshair.classList.add('hidden');
    }
});

// Movement State
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const moveState = { forward: false, backward: false, left: false, right: false };

document.addEventListener('keydown', (e) => {
    switch (e.code) {
        case 'KeyW': moveState.forward = true; break;
        case 'KeyA': moveState.left = true; break;
        case 'KeyS': moveState.backward = true; break;
        case 'KeyD': moveState.right = true; break;
    }
});
document.addEventListener('keyup', (e) => {
    switch (e.code) {
        case 'KeyW': moveState.forward = false; break;
        case 'KeyA': moveState.left = false; break;
        case 'KeyS': moveState.backward = false; break;
        case 'KeyD': moveState.right = false; break;
    }
});

// === 4. MULTIPLAYER LOGIC ===
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function joinGame(roomCode) {
    currentRoom = roomCode;
    document.getElementById('display-room-code').innerText = roomCode;
    
    // Set initial position in Firebase
    const playerRef = ref(db, `rooms/${currentRoom}/players/${playerId}`);
    set(playerRef, {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        name: document.getElementById('player-name').value || "Player"
    });

    // Remove player from DB on disconnect
    window.addEventListener('beforeunload', () => {
        remove(playerRef);
    });

    listenForPlayers();
    controls.lock(); // Start the game
}

function listenForPlayers() {
    const playersRef = ref(db, `rooms/${currentRoom}/players`);

    onChildAdded(playersRef, (snapshot) => {
        if (snapshot.key === playerId) return; // Ignore self
        
        const data = snapshot.val();
        const geometry = new THREE.BoxGeometry(1, 2, 1); // Simple player model
        const material = new THREE.MeshLambertMaterial({ color: 0xff0000 });
        const mesh = new THREE.Mesh(geometry, material);
        
        mesh.position.set(data.x, data.y, data.z);
        scene.add(mesh);
        players[snapshot.key] = mesh;
    });

    onChildChanged(playersRef, (snapshot) => {
        if (snapshot.key === playerId) return;
        const data = snapshot.val();
        if (players[snapshot.key]) {
            players[snapshot.key].position.set(data.x, data.y, data.z);
        }
    });

    onChildRemoved(playersRef, (snapshot) => {
        if (players[snapshot.key]) {
            scene.remove(players[snapshot.key]);
            delete players[snapshot.key];
        }
    });
}

// === 5. UI EVENT LISTENERS ===
document.getElementById('btn-host').addEventListener('click', () => {
    const newCode = generateRoomCode();
    statusText.innerText = "Creating room...";
    joinGame(newCode);
});

document.getElementById('btn-join').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code.length > 0) {
        statusText.innerText = "Joining room...";
        joinGame(code);
    } else {
        statusText.innerText = "Please enter a valid code.";
    }
});

pauseMenu.addEventListener('click', () => {
    controls.lock(); // Resume game
});

// === 6. MAIN GAME LOOP ===
let prevTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();

    if (isPlaying) {
        const delta = (time - prevTime) / 1000;

        // Fluid Movement physics
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveState.forward) - Number(moveState.backward);
        direction.x = Number(moveState.right) - Number(moveState.left);
        direction.normalize(); // Ensure consistent speed in all directions

        if (moveState.forward || moveState.backward) velocity.z -= direction.z * 40.0 * delta;
        if (moveState.left || moveState.right) velocity.x -= direction.x * 40.0 * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        // Sync local position to Firebase (limit update rate in a real game)
        if (currentRoom) {
            set(ref(db, `rooms/${currentRoom}/players/${playerId}/x`), camera.position.x);
            set(ref(db, `rooms/${currentRoom}/players/${playerId}/y`), camera.position.y);
            set(ref(db, `rooms/${currentRoom}/players/${playerId}/z`), camera.position.z);
        }
    }

    prevTime = time;
    renderer.render(scene, camera);
}

// Handle window resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();