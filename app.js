let scene, camera, renderer, terrain, controls;
let raycaster, centerScreen;
let globalMeta, globalDem, globalLith;
let rockColors = {}; 

document.getElementById('startBtn').addEventListener('click', startAR);

function generateColors(dictionary) {
    rockColors[0] = new THREE.Color("white"); 
    for (let id in dictionary) {
        const hue = (id * 137.508) % 360; 
        rockColors[id] = new THREE.Color(`hsl(${hue}, 70%, 50%)`);
    }
}

async function startAR() {
    document.getElementById('startBtn').style.display = 'none';
    
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const permissionState = await DeviceMotionEvent.requestPermission();
            if (permissionState !== 'granted') {
                document.getElementById('infoText').innerText = "Sensor permission denied.";
                return;
            }
        } catch (error) {
            console.error(error);
            document.getElementById('infoText').innerText = "Sensor request failed.";
            return;
        }
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        document.getElementById('cameraFeed').srcObject = stream;
    } catch (err) {
        console.error("Camera access denied or unavailable", err);
    }

    loadTerrainData();
}

async function loadTerrainData() {
    document.getElementById('infoText').innerText = "Loading HK terrain...";
    const meta = await (await fetch('data/meta.json')).json();
    const demArray = new Float32Array(await (await fetch('data/dem_25m.bin')).arrayBuffer());
    const lithArray = new Uint8Array(await (await fetch('data/lith_25m.bin')).arrayBuffer());

    globalMeta = meta; globalDem = demArray; globalLith = lithArray;
    generateColors(meta.rock_dictionary);
    initThreeJS();
}

function initThreeJS() {
    scene = new THREE.Scene();
    
    const initialDistance = parseInt(document.getElementById('viewDistance').value);
    scene.fog = new THREE.Fog(0x87CEEB, initialDistance * 0.5, initialDistance);
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, initialDistance);
    
    // Spawn in the middle of the HK grid at 800m height
    const startCol = Math.floor(globalMeta.cols / 2);
    const startRow = Math.floor(globalMeta.rows / 2);
    const mapCenterX = startCol * globalMeta.resolution;
    const mapCenterZ = -(startRow * globalMeta.resolution);
    camera.position.set(mapCenterX, 800, mapCenterZ); 

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    controls = new THREE.DeviceOrientationControls(camera);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(mapCenterX + 2000, 3000, mapCenterZ + 2000);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x666666));

    // Build the initial optimized chunk
    buildTerrainChunk(startCol, startRow, initialDistance);

    raycaster = new THREE.Raycaster();
    centerScreen = new THREE.Vector2(0, 0);

    // Reveal bottom sliders panel
    document.getElementById('bottomSliders').style.display = 'block';
    
    // Distance Slider Logic
    const distSlider = document.getElementById('viewDistance');
    distSlider.addEventListener('input', (e) => {
        document.getElementById('distVal').innerText = e.target.value;
    });
    distSlider.addEventListener('change', (e) => {
        const dist = parseInt(e.target.value);
        camera.far = dist;
        camera.updateProjectionMatrix();
        scene.fog.near = dist * 0.5;
        scene.fog.far = dist;
        
        const centerCol = Math.floor(camera.position.x / globalMeta.resolution);
        const centerRow = Math.floor(Math.abs(camera.position.z) / globalMeta.resolution);
        buildTerrainChunk(centerCol, centerRow, dist);
    });

    // Opacity Slider Logic
    const opSlider = document.getElementById('opacitySlider');
    opSlider.addEventListener('input', (e) => {
        const op = parseFloat(e.target.value);
        document.getElementById('opacityVal').innerText = op;
        if (terrain && terrain.material) {
            terrain.material.opacity = op;
        }
    });

    window.addEventListener('resize', onWindowResize);
    animate();
}

// Dynamically generate a smaller mesh based on render distance
function buildTerrainChunk(centerCol, centerRow, distanceMeters) {
    if (terrain) {
        scene.remove(terrain);
        terrain.geometry.dispose();
        terrain.material.dispose();
    }

    const radiusCells = Math.ceil(distanceMeters / globalMeta.resolution);

    const startCol = Math.max(0, centerCol - radiusCells);
    const endCol = Math.min(globalMeta.cols - 1, centerCol + radiusCells);
    const startRow = Math.max(0, centerRow - radiusCells);
    const endRow = Math.min(globalMeta.rows - 1, centerRow + radiusCells);

    const cols = endCol - startCol;
    const rows = endRow - startRow;

    if (cols <= 0 || rows <= 0) return;

    const width = cols * globalMeta.resolution;
    const height = rows * globalMeta.resolution;

    const geometry = new THREE.PlaneGeometry(width, height, cols - 1, rows - 1);
    const vertices = geometry.attributes.position.array;
    const vertexColors = [];

    let vIdx = 0;
    for (let r = startRow; r < endRow; r++) {
        for (let c = startCol; c < endCol; c++) {
            const dataIdx = r * globalMeta.cols + c;
            const elev = globalDem[dataIdx];
            
            vertices[vIdx * 3 + 2] = (elev !== globalMeta.nodata) ? elev : -500;
            
            const rockId = globalLith[dataIdx];
            const color = rockColors[rockId] || rockColors[0];
            vertexColors.push(color.r, color.g, color.b);
            
            vIdx++;
        }
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    
    // Corrected Z-axis translation so geometry aligns perfectly with the raycaster
    const chunkCenterX = startCol * globalMeta.resolution + (width / 2);
    const chunkCenterZ = -(startRow * globalMeta.resolution) + (height / 2);
    geometry.translate(chunkCenterX, 0, chunkCenterZ);

    // Read current opacity from the new slider
    const currentOpacity = parseFloat(document.getElementById('opacitySlider').value);
    
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.8, side: THREE.DoubleSide,
        transparent: true, opacity: currentOpacity 
    });

    terrain = new THREE.Mesh(geometry, material);
    scene.add(terrain);
    
    document.getElementById('infoText').innerHTML = `Built ${cols}x${rows} mesh. Aim at terrain...`;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateRaycaster() {
    if (!terrain) return;
    
    raycaster.setFromCamera(centerScreen, camera);
    const intersects = raycaster.intersectObject(terrain);

    if (intersects.length > 0) {
        const hit = intersects[0];
        
        const col = Math.floor(hit.point.x / globalMeta.resolution);
        const row = Math.floor(Math.abs(hit.point.z) / globalMeta.resolution);
        const index = row * globalMeta.cols + col;

        // Calculate exact HK1980 Coordinates
        const easting = globalMeta.origin_x + hit.point.x;
        const northing = globalMeta.origin_y - Math.abs(hit.point.z);

        if (index >= 0 && index < globalLith.length) {
            const rockId = globalLith[index];
            const rockName = globalMeta.rock_dictionary[rockId] || "Unmapped";
            
            document.getElementById('infoText').innerHTML = 
                `<b>Target Locked:</b><br>` +
                `<span style="color:#00ff00; font-weight:bold;">${rockName}</span><br>` +
                `Elev: ~${Math.round(hit.point.y)} m<br>` +
                `<span style="font-size: 0.85em; color: #ccc;">HK1980 Grid: E ${Math.round(easting)}, N ${Math.round(northing)}</span>`;
        }
    } else {
        // Keep the existing text if looking at the sky
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();     
    updateRaycaster();     
    renderer.render(scene, camera);
}