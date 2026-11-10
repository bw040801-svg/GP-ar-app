let scene, camera, renderer, terrain, controls;
let raycaster, centerScreen;
let globalMeta, globalDem, globalLith;
let rockColors = {}; 

document.getElementById('startBtn').addEventListener('click', startAR);

// Generate random colors for dynamic rock codes
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
    document.getElementById('infoText').innerText = "Loading HK terrain (this may take a few seconds)...";
    const meta = await (await fetch('data/meta.json')).json();
    const demArray = new Float32Array(await (await fetch('data/dem_25m.bin')).arrayBuffer());
    const lithArray = new Uint8Array(await (await fetch('data/lith_25m.bin')).arrayBuffer());

    globalMeta = meta; globalDem = demArray; globalLith = lithArray;
    generateColors(meta.rock_dictionary);
    initThreeJS(meta, demArray, lithArray);
}

function initThreeJS(meta, dem, lith) {
    scene = new THREE.Scene();
    
    // Setup Fog and Clipping
    const initialDistance = parseInt(document.getElementById('viewDistance').value);
    scene.fog = new THREE.Fog(0x87CEEB, initialDistance * 0.5, initialDistance);
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, initialDistance);
    
    // Spawn in the middle of the HK grid at 1000m height
    const mapCenterX = (meta.cols * meta.resolution) / 2;
    const mapCenterY = -(meta.rows * meta.resolution) / 2;
    camera.position.set(mapCenterX, 1000, mapCenterY); 

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    controls = new THREE.DeviceOrientationControls(camera);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(mapCenterX + 2000, 3000, mapCenterY + 2000);
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
        const color = rockColors[lith[i]] || rockColors[0];
        vertexColors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(width / 2, 0, -height / 2);

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.8, side: THREE.DoubleSide,
        transparent: true, opacity: 0.65 
    });

    terrain = new THREE.Mesh(geometry, material);
    scene.add(terrain);

    raycaster = new THREE.Raycaster();
    centerScreen = new THREE.Vector2(0, 0);

    // Wire up the slider
    document.getElementById('sliderContainer').style.display = 'block';
    const slider = document.getElementById('viewDistance');
    slider.addEventListener('input', (e) => {
        const dist = parseInt(e.target.value);
        document.getElementById('distVal').innerText = dist;
        camera.far = dist;
        camera.updateProjectionMatrix();
        scene.fog.near = dist * 0.5;
        scene.fog.far = dist;
    });

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
            const rockName = globalMeta.rock_dictionary[rockId] || "Unmapped";
            
            document.getElementById('infoText').innerHTML = 
                `<b>Target Locked:</b><br>` +
                `<span style="color:#00ff00; font-weight:bold;">${rockName}</span><br>` +
                `Elevation: ~${Math.round(hit.point.y)} m`;
        }
    } else {
        document.getElementById('infoText').innerHTML = "Aim at terrain...";
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();     
    updateRaycaster();     
    renderer.render(scene, camera);
}