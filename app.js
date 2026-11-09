let scene, camera, renderer, terrain, controls;
let raycaster, centerScreen;
let globalMeta, globalDem, globalLith;

const ROCK_NAMES = [
    "No data / Unmapped", "Volcanic (lava, tuff)", "Volcaniclastic / tuffaceous sediment",
    "Granitic & other plutonic", "Sedimentary", "Metasedimentary",
    "Dykes, veins & minor intrusions", "Other / undifferentiated"
];

const ROCK_COLORS = [
    new THREE.Color("white"), new THREE.Color("#d95f02"), new THREE.Color("#fdae6b"),
    new THREE.Color("#e7298a"), new THREE.Color("#e6c229"), new THREE.Color("#7570b3"),
    new THREE.Color("#1b9e77"), new THREE.Color("#999999")
];

document.getElementById('startBtn').addEventListener('click', startAR);

async function startAR() {
    document.getElementById('startBtn').style.display = 'none';
    
    // 1. Request Camera Access
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        document.getElementById('cameraFeed').srcObject = stream;
    } catch (err) {
        console.error("Camera access denied or unavailable", err);
        document.getElementById('ui').innerText = "Camera access required for AR.";
        return;
    }

    // 2. Request Sensor Access (Required for iOS 13+)
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const permissionState = await DeviceMotionEvent.requestPermission();
            if (permissionState !== 'granted') throw new Error("Sensor permission denied");
        } catch (error) {
            console.error(error);
            document.getElementById('ui').innerText = "Device orientation permission needed.";
            return;
        }
    }

    loadTerrainData();
}

async function loadTerrainData() {
    document.getElementById('ui').innerText = "Loading terrain...";
    const meta = await (await fetch('data/meta.json')).json();
    const demArray = new Float32Array(await (await fetch('data/dem_25m.bin')).arrayBuffer());
    const lithArray = new Uint8Array(await (await fetch('data/lith_25m.bin')).arrayBuffer());

    globalMeta = meta; globalDem = demArray; globalLith = lithArray;
    initThreeJS(meta, demArray, lithArray);
}

function initThreeJS(meta, dem, lith) {
    scene = new THREE.Scene();
    
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 20000);
    // Simulate standing on the terrain: X, Y (height), Z
    camera.position.set(0, 100, 0); 

    // Enable alpha (transparency) so the video feed shows behind the WebGL canvas
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // Link camera to phone gyroscope
    controls = new THREE.DeviceOrientationControls(camera);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1000, 2000, 1000);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x666666));

    const width = meta.cols * meta.resolution;
    const height = meta.rows * meta.resolution;
    const geometry = new THREE.PlaneGeometry(width, height, meta.cols - 1, meta.rows - 1);

    const vertexColors = [];
    const vertices = geometry.attributes.position.array;

    for (let i = 0; i < dem.length; i++) {
        const elev = dem[i];
        vertices[i * 3 + 2] = (elev !== meta.nodata) ? elev : -500;
        const color = ROCK_COLORS[lith[i]] || ROCK_COLORS[0];
        vertexColors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
    geometry.computeVertexNormals();
    
    // Rotate plane so Z is up, matching standard GIS coordinates
    geometry.rotateX(-Math.PI / 2);

    // Make material partially transparent to blend terrain with the real world
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.8, side: THREE.DoubleSide,
        transparent: true, opacity: 0.65 
    });

    terrain = new THREE.Mesh(geometry, material);
    scene.add(terrain);

    raycaster = new THREE.Raycaster();
    centerScreen = new THREE.Vector2(0, 0); // Always raycast from the exact center of the screen

    window.addEventListener('resize', onWindowResize);
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateRaycaster() {
    raycaster.setFromCamera(centerScreen, camera);
    const intersects = raycaster.intersectObject(terrain);

    if (intersects.length > 0) {
        const hit = intersects[0];
        const uv = hit.uv;
        const col = Math.floor(uv.x * globalMeta.cols);
        const row = Math.floor((1 - uv.y) * globalMeta.rows);
        const index = row * globalMeta.cols + col;

        if (index >= 0 && index < globalLith.length) {
            const rockId = globalLith[index];
            const rockName = ROCK_NAMES[rockId] || "Unknown";
            
            document.getElementById('ui').innerHTML = 
                `<b>Target Locked:</b><br>` +
                `<span style="color:#00ff00; font-weight:bold;">${rockName}</span><br>` +
                `Elevation: ~${Math.round(hit.point.y)} m`;
        }
    } else {
        document.getElementById('ui').innerHTML = "Aim at terrain...";
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();     // Update camera based on phone sensors
    updateRaycaster();     // Update UI based on what the crosshair is looking at
    renderer.render(scene, camera);
}